import type { FastifyInstance, FastifyRequest } from 'fastify';
import { lstat, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { apps, teams } from '../db/schema.js';
import { newId } from '../lib/crypto.js';
import { ApiError } from '../lib/errors.js';
import { detectRuntime, slugFrom, uniqueSlug, verifyMcpToken } from '../apps/logic.js';
import { appsOut, loadApp, startCopy, stopCopy } from '../apps/service.js';
import { createDeployRequest } from '../apps/routes.js';
import { checkName as checkFileName, joinPath, mimeOf, normalizePath, resolveInside } from '../drive/paths.js';
import { ensureSpace, listDir, mkdirs, recordEvents, setOwnership, type DriveContext } from '../drive/service.js';

// Internal API for platform-mcp (04-api.md §3). Auth = team MCP token only: the api knows the team,
// never the person (spike 05). Targets are limited to the team shared drive (06-auth.md §8).

const MAX_READ = 1024 * 1024;
const MAX_WRITE = 10 * 1024 * 1024;

declare module 'fastify' {
  interface FastifyRequest { mcpTeam?: typeof teams.$inferSelect }
}

async function requireTeamToken(req: FastifyRequest) {
  const auth = req.headers.authorization ?? '';
  const team = auth.startsWith('Bearer ') ? verifyMcpToken(config.internalToken, auth.slice(7)) : null;
  if (!team) throw new ApiError(401, 'AUTH_REQUIRED');
  const [t] = await db.select().from(teams).where(and(eq(teams.name, team), isNull(teams.deletedAt)));
  if (!t) throw new ApiError(401, 'AUTH_REQUIRED');
  req.mcpTeam = t;
}

/** Agent drive context: the shared space only; recorded as actor `agent` (no person). */
const agentCtx = (t: typeof teams.$inferSelect): DriveContext => ({ team: t, userId: '00000000-0000-0000-0000-000000000000', linuxUid: 1000, teamRole: 'member' });

async function findApp(teamId: string, ref: string) {
  const isUuid = /^[0-9a-f-]{36}$/.test(ref);
  const [a] = await db.select().from(apps).where(and(
    eq(apps.teamId, teamId), isNull(apps.deletedAt),
    isUuid ? or(eq(apps.id, ref), eq(apps.slug, ref)) : eq(apps.slug, ref),
  ));
  if (!a) throw new ApiError(404, 'APP_NOT_FOUND');
  return a;
}

async function summarize(rows: (typeof apps.$inferSelect)[]) {
  return (await appsOut(rows)).map((a) => ({
    id: a.id, name: a.slug, url: a.work.url, status: a.work.status, stopReason: a.work.stopReason,
    public: a.public ? { url: a.public.url, version: a.public.version, status: a.public.status } : null,
    pendingRequest: a.pendingRequest?.kind ?? null,
  }));
}

export async function internalMcpRoutes(app: FastifyInstance) {
  const opts = { preHandler: requireTeamToken };

  app.post('/internal/mcp/apps/run', opts, async (req) => {
    const t = req.mcpTeam!;
    const b = z.object({
      folder: z.string(),
      port: z.number().int().min(1024).max(65535),
      command: z.string().max(500).optional(),
      runtime: z.enum(['node', 'python', 'static']).optional(),
      name: z.string().max(60).optional(),
    }).parse(req.body);
    const ctx = agentCtx(t);
    const root = await ensureSpace(ctx, 'shared');
    const folder = normalizePath(b.folder.replace(/^\/team-drive/, ''));
    if (folder === '/') throw new ApiError(400, 'DRIVE_PATH_INVALID', undefined, '팀 드라이브 안의 앱 폴더를 지정해 주세요.');
    const dirAbs = await resolveInside(root, folder);
    if (!(await stat(dirAbs)).isDirectory()) throw new ApiError(400, 'DRIVE_PATH_INVALID');
    const files = (await readdir(dirAbs)).filter((f) => f !== 'node_modules');
    const pkg = files.includes('package.json') ? JSON.parse(await readFile(path.join(dirAbs, 'package.json'), 'utf8').catch(() => '{}')) : null;
    const detected = detectRuntime(files, pkg, { runtime: b.runtime, command: b.command });
    if (!detected) throw new ApiError(422, 'VALIDATION_FAILED', undefined, '실행 방법을 알 수 없어요. command와 runtime을 지정해 주세요.');
    const runSpec = { ...detected, port: b.port };

    const [existing] = await db.select().from(apps)
      .where(and(eq(apps.teamId, t.id), eq(apps.sourceSpace, 'shared'), eq(apps.sourcePath, folder), isNull(apps.deletedAt)));
    let appRow = existing;
    if (existing) {
      // Same folder again → restart the work copy with the new run spec (01-screens.md U-02).
      [appRow] = await db.update(apps).set({ runSpec }).where(eq(apps.id, existing.id)).returning();
    } else {
      const base = slugFrom(b.name ?? path.basename(folder)) ?? 'app';
      const taken = new Set((await db.select({ slug: apps.slug }).from(apps).where(and(eq(apps.teamId, t.id), isNull(apps.deletedAt)))).map((r) => r.slug));
      const slug = uniqueSlug(base.length >= 3 ? base : `${base}-app`, taken);
      if (`${slug}--${t.name}`.length > 63) throw new ApiError(422, 'NAME_INVALID');
      [appRow] = await db.insert(apps).values({ id: newId(), teamId: t.id, creatorId: null, slug, sourceSpace: 'shared', sourcePath: folder, runSpec }).returning();
    }
    await startCopy(appRow!, 'work');
    const [out] = await summarize([await loadApp(appRow!.id)]);
    return { appId: out!.id, name: out!.name, url: out!.url, status: out!.status, isNew: !existing };
  });

  app.post('/internal/mcp/apps/stop', opts, async (req) => {
    const { app: ref } = z.object({ app: z.string() }).parse(req.body);
    const a = await findApp(req.mcpTeam!.id, ref);
    await stopCopy(a, 'work', 'manual');
    return { stopped: true, name: a.slug };
  });

  app.post('/internal/mcp/apps/deploy', opts, async (req, reply) => {
    const b = z.object({ app: z.string(), name: z.string().optional(), reason: z.string().trim().min(1).max(2000) }).parse(req.body);
    const a = await findApp(req.mcpTeam!.id, b.app);
    const r = await createDeployRequest(a, req.mcpTeam!.name, b, null);
    return reply.code(201).send({ requestId: r.id, kind: r.kind, status: r.status, name: r.requestedName ?? a.publicName });
  });

  app.get('/internal/mcp/apps', opts, async (req) => {
    const rows = await db.select().from(apps).where(and(eq(apps.teamId, req.mcpTeam!.id), isNull(apps.deletedAt))).orderBy(apps.slug);
    return { items: await summarize(rows) };
  });

  // ── drive tools: team shared drive only ──

  app.get('/internal/mcp/drive/list', opts, async (req) => {
    const { path: p } = z.object({ path: z.string().default('/') }).parse(req.query);
    const items = await listDir(agentCtx(req.mcpTeam!), 'shared', p.replace(/^\/team-drive/, '') || '/');
    return { items: items.map((i) => ({ name: i.name, path: i.path, isDir: i.isDir, size: i.size, modifiedAt: i.modifiedAt })) };
  });

  app.get('/internal/mcp/drive/read', opts, async (req) => {
    const { path: p } = z.object({ path: z.string() }).parse(req.query);
    const ctx = agentCtx(req.mcpTeam!);
    const fileAbs = await resolveInside(await ensureSpace(ctx, 'shared'), p.replace(/^\/team-drive/, ''));
    const st = await lstat(fileAbs);
    if (st.isDirectory()) throw new ApiError(400, 'DRIVE_PATH_INVALID', undefined, '폴더예요. drive_list를 쓰세요.');
    const mime = mimeOf(fileAbs);
    const isText = mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml';
    if (!isText) return { path: normalizePath(p), size: st.size, mimeType: mime, binary: true };
    const buf = await readFile(fileAbs);
    return { path: normalizePath(p), size: st.size, mimeType: mime, content: buf.subarray(0, MAX_READ).toString('utf8'), truncated: st.size > MAX_READ };
  });

  app.post('/internal/mcp/drive/write', opts, async (req) => {
    const b = z.object({ path: z.string(), content: z.string().max(MAX_WRITE) }).parse(req.body);
    const ctx = agentCtx(req.mcpTeam!);
    const root = await ensureSpace(ctx, 'shared');
    const p = normalizePath(b.path.replace(/^\/team-drive/, ''));
    const name = checkFileName(path.posix.basename(p));
    const dirApi = path.posix.dirname(p);
    const dirAbs = await mkdirs(ctx, 'shared', root, dirApi);
    const fileAbs = path.join(dirAbs, name);
    const existed = await lstat(fileAbs).then((s) => { if (s.isSymbolicLink() || s.isDirectory()) throw new ApiError(400, 'DRIVE_PATH_INVALID'); return true; }, () => false);
    await writeFile(fileAbs, b.content, 'utf8');
    await setOwnership(ctx, 'shared', fileAbs, false);
    await recordEvents(ctx, [{ space: 'shared', path: joinPath(dirApi, name), action: existed ? 'update' : 'create', actor: 'agent' }]);
    return { path: joinPath(dirApi, name), size: Buffer.byteLength(b.content), created: !existed };
  });
}
