import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, lstat, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import yazl from 'yazl';
import { z } from 'zod';
import { requireAuth } from '../auth/guards.js';
import { db } from '../db/client.js';
import { memberships, teams, trashItems, users } from '../db/schema.js';
import { newId } from '../lib/crypto.js';
import { ApiError } from '../lib/errors.js';
import { getSetting } from '../settings.js';
import { baseName, checkName, inlineType, joinPath, mimeOf, nextFreeName, normalizePath, parentOf, resolveInside } from './paths.js';
import {
  bumpUsage, du, ensureSpace, entryFor, historyFor, listDir, mkdirs, moveFs, ownTree, recordEvents, reconcile,
  rewriteEventPaths, searchSpace, setOwnership, teamTrashDir, teamUsage, type DriveContext, type Space,
} from './service.js';

// Drive API (04-api.md §2 드라이브, U-04~U-06). Data API: members only — platform admins who are
// not members get 403 (06-auth.md §7). `space=me` is always the caller's own drive.

const MAX_FILE = 500 * 1024 * 1024;
const SpaceQ = z.enum(['me', 'shared']);
type TeamReq = FastifyRequest<{ Params: { team: string } }>;

async function context(req: TeamReq): Promise<DriveContext> {
  const [t] = await db.select().from(teams).where(and(eq(teams.name, req.params.team), isNull(teams.deletedAt)));
  if (!t) throw new ApiError(404, 'TEAM_NOT_FOUND');
  const [m] = await db.select({ role: memberships.teamRole, uid: users.linuxUid }).from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.teamId, t.id), eq(memberships.userId, req.session!.user.id)));
  if (!m) throw new ApiError(403, 'FORBIDDEN');
  return { team: t, userId: req.session!.user.id, linuxUid: m.uid, teamRole: m.role as DriveContext['teamRole'] };
}

async function limitBytes(team: typeof teams.$inferSelect) {
  const limits = team.resourceLimits ?? (await getSetting('limits.team_default'));
  return limits.diskGb * 1024 ** 3;
}

const exists = (abs: string) => lstat(abs).then(() => true, () => false);

async function freeName(dirAbs: string, name: string) {
  const taken = new Set(await readdir(dirAbs).catch(() => [] as string[]));
  return nextFreeName(name, (n) => taken.has(n));
}

function contentDisposition(kind: 'inline' | 'attachment', name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Streams a zip of the given absolute roots (folders recursively, symlinks skipped). */
async function sendZip(reply: FastifyReply, items: { abs: string; name: string }[], fileName: string) {
  const zip = new yazl.ZipFile();
  const add = async (abs: string, rel: string) => {
    const st = await lstat(abs);
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      zip.addEmptyDirectory(rel);
      for (const e of await readdir(abs)) await add(path.join(abs, e), `${rel}/${e}`);
    } else if (st.isFile()) {
      zip.addFile(abs, rel);
    }
  };
  for (const it of items) await add(it.abs, it.name);
  zip.end();
  reply.header('content-type', 'application/zip').header('content-disposition', contentDisposition('attachment', fileName));
  return reply.send(zip.outputStream);
}

const RefSchema = z.object({ space: SpaceQ, path: z.string() });

export async function driveRoutes(app: FastifyInstance) {
  app.get('/api/v1/teams/:team/drive/list', { preHandler: requireAuth }, async (req: TeamReq) => {
    const q = z.object({ space: SpaceQ, path: z.string().default('/') }).parse(req.query);
    const ctx = await context(req);
    return { path: normalizePath(q.path), items: await listDir(ctx, q.space, q.path) };
  });

  app.get('/api/v1/teams/:team/drive/search', { preHandler: requireAuth }, async (req: TeamReq) => {
    const q = z.object({ space: SpaceQ, q: z.string().trim().min(1).max(100) }).parse(req.query);
    return { items: await searchSpace(await context(req), q.space, q.q) };
  });

  app.get('/api/v1/teams/:team/drive/meta', { preHandler: requireAuth }, async (req: TeamReq) => {
    const q = z.object({ space: SpaceQ, path: z.string() }).parse(req.query);
    const ctx = await context(req);
    const p = normalizePath(q.path);
    const abs = await resolveInside(await ensureSpace(ctx, q.space), p);
    const st = await lstat(abs);
    await reconcile(ctx, q.space, [{ path: p, isDir: st.isDirectory(), mtimeMs: st.mtimeMs }]);
    const entry = await entryFor(ctx, q.space, p);
    const history = await historyFor(ctx, q.space, p);
    const created = history.filter((h) => h.action === 'create' || h.action === 'copy').at(-1);
    return {
      ...entry,
      size: st.isDirectory() ? await du(abs) : st.size,
      createdAt: created?.at ?? null,
      access: q.space === 'me' ? 'only_me' : 'team',
      history,
    };
  });

  app.get('/api/v1/teams/:team/drive/usage', { preHandler: requireAuth }, async (req: TeamReq) => {
    const ctx = await context(req);
    return { usedBytes: await teamUsage(ctx.team.name), limitBytes: await limitBytes(ctx.team) };
  });

  app.get('/api/v1/teams/:team/drive/download', { preHandler: requireAuth }, async (req: TeamReq, reply) => {
    const q = z.object({ space: SpaceQ, path: z.string(), inline: z.stringbool().default(false) }).parse(req.query);
    const ctx = await context(req);
    const p = normalizePath(q.path);
    const abs = await resolveInside(await ensureSpace(ctx, q.space), p);
    const st = await stat(abs);
    const name = p === '/' ? (q.space === 'shared' ? '팀 공유' : '내 드라이브') : baseName(p);
    if (st.isDirectory()) return sendZip(reply, [{ abs, name }], `${name}.zip`);
    const inline = q.inline ? inlineType(name) : null;
    reply
      .header('content-type', inline ?? mimeOf(name))
      .header('content-length', st.size)
      .header('content-disposition', contentDisposition(inline ? 'inline' : 'attachment', name))
      // Files are user content: no sniffing, no scripts even when opened directly.
      .header('x-content-type-options', 'nosniff')
      // `sandbox` would also stop Chrome's PDF viewer, so PDFs (no script path in our types) skip it.
      .header('content-security-policy', `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'${mimeOf(name) === 'application/pdf' ? '' : '; sandbox'}`);
    return reply.send(createReadStream(abs));
  });

  app.post('/api/v1/teams/:team/drive/download-zip', { preHandler: requireAuth }, async (req: TeamReq, reply) => {
    const b = z.object({ space: SpaceQ, paths: z.array(z.string()).min(1).max(1000) }).parse(req.body);
    const ctx = await context(req);
    const root = await ensureSpace(ctx, b.space);
    const items = [];
    for (const p of b.paths) items.push({ abs: await resolveInside(root, p), name: baseName(normalizePath(p)) || 'root' });
    return sendZip(reply, items, `${ctx.team.name}-${new Date().toISOString().slice(0, 10)}.zip`);
  });

  app.post('/api/v1/teams/:team/drive/upload', { preHandler: requireAuth }, async (req: TeamReq, reply) => {
    const q = z.object({ space: SpaceQ, path: z.string().default('/') }).parse(req.query);
    const ctx = await context(req);
    const root = await ensureSpace(ctx, q.space);
    const destDir = normalizePath(q.path);
    await resolveInside(root, destDir);

    const declared = Number(req.headers['content-length'] ?? 0);
    const limit = await limitBytes(ctx.team);
    if ((await teamUsage(ctx.team.name)) + declared > limit) throw new ApiError(413, 'DRIVE_QUOTA_EXCEEDED');

    const relPaths: string[] = [];
    const saved: string[] = [];
    let index = 0;
    for await (const part of req.parts({ limits: { fileSize: MAX_FILE, files: 1000 } })) {
      if (part.type === 'field') {
        if (part.fieldname === 'relativePaths') relPaths.push(String(part.value));
        continue;
      }
      // relativePaths may come before or interleaved with files; same order as files.
      const rel = relPaths[index++] ?? part.filename;
      const parts = normalizePath(rel).split('/').filter(Boolean).map(checkName);
      const fileName = parts.pop() ?? checkName(part.filename);
      const dirApi = parts.reduce((d, seg) => joinPath(d, seg), destDir);
      const dirAbs = await mkdirs(ctx, q.space, root, dirApi);
      const finalName = await freeName(dirAbs, fileName);
      const abs = path.join(dirAbs, finalName);
      try {
        await pipeline(part.file, createWriteStream(abs, { flags: 'wx' }));
      } catch (err) {
        await rm(abs, { force: true });
        throw err;
      }
      if (part.file.truncated) {
        await rm(abs, { force: true });
        throw new ApiError(413, 'DRIVE_TOO_LARGE');
      }
      await setOwnership(ctx, q.space, abs, false);
      const apiPath = joinPath(dirApi, finalName);
      saved.push(apiPath);
      bumpUsage(ctx.team.name, (await stat(abs)).size);
    }
    await recordEvents(ctx, saved.map((p) => ({ space: q.space, path: p, action: 'create', actor: 'user' })));
    const items = await Promise.all(saved.map((p) => entryFor(ctx, q.space, p)));
    return reply.code(201).send({ items });
  });

  app.post('/api/v1/teams/:team/drive/folder', { preHandler: requireAuth }, async (req: TeamReq, reply) => {
    const b = RefSchema.parse(req.body);
    const ctx = await context(req);
    const root = await ensureSpace(ctx, b.space);
    const p = normalizePath(b.path);
    if (p === '/') throw new ApiError(400, 'DRIVE_PATH_INVALID');
    checkName(baseName(p));
    const abs = await resolveInside(root, p, false);
    if (await exists(abs)) throw new ApiError(409, 'DRIVE_EXISTS');
    await mkdir(abs);
    await setOwnership(ctx, b.space, abs, true);
    await recordEvents(ctx, [{ space: b.space, path: p, action: 'create', actor: 'user' }]);
    return reply.code(201).send(await entryFor(ctx, b.space, p));
  });

  app.post('/api/v1/teams/:team/drive/rename', { preHandler: requireAuth }, async (req: TeamReq) => {
    const b = RefSchema.extend({ newName: z.string() }).parse(req.body);
    const ctx = await context(req);
    const root = await ensureSpace(ctx, b.space);
    const p = normalizePath(b.path);
    if (p === '/') throw new ApiError(400, 'DRIVE_PATH_INVALID');
    const abs = await resolveInside(root, p);
    const target = joinPath(parentOf(p), checkName(b.newName));
    const targetAbs = await resolveInside(root, target, false);
    if (target === p) return entryFor(ctx, b.space, p);
    if (await exists(targetAbs)) throw new ApiError(409, 'DRIVE_EXISTS');
    await moveFs(abs, targetAbs);
    await rewriteEventPaths(ctx, { space: b.space, path: p }, { space: b.space, path: target });
    await recordEvents(ctx, [{ space: b.space, path: target, prevPath: p, action: 'rename', actor: 'user' }]);
    return entryFor(ctx, b.space, target);
  });

  // move / copy share the transfer shape {from: DriveRef[], to: DriveRef(folder)}; cross-space allowed.
  for (const op of ['move', 'copy'] as const) {
    app.post(`/api/v1/teams/:team/drive/${op}`, { preHandler: requireAuth }, async (req: TeamReq) => {
      const b = z.object({ from: z.array(RefSchema).min(1).max(500), to: RefSchema }).parse(req.body);
      const ctx = await context(req);
      const toRoot = await ensureSpace(ctx, b.to.space);
      const toDir = normalizePath(b.to.path);
      const toDirAbs = await resolveInside(toRoot, toDir);
      if (!(await stat(toDirAbs)).isDirectory()) throw new ApiError(400, 'DRIVE_PATH_INVALID');
      if (op === 'copy') {
        const incoming = (await Promise.all(b.from.map(async (f) => du(await resolveInside(await ensureSpace(ctx, f.space), f.path))))).reduce((a, n) => a + n, 0);
        if ((await teamUsage(ctx.team.name)) + incoming > (await limitBytes(ctx.team))) throw new ApiError(413, 'DRIVE_QUOTA_EXCEEDED');
      }
      const out: string[] = [];
      for (const f of b.from) {
        const fromRoot = await ensureSpace(ctx, f.space);
        const src = normalizePath(f.path);
        if (src === '/') throw new ApiError(400, 'DRIVE_PATH_INVALID');
        const srcAbs = await resolveInside(fromRoot, src);
        // Refuse moving a folder into itself.
        if (f.space === b.to.space && (toDir === src || toDir.startsWith(`${src}/`))) throw new ApiError(400, 'DRIVE_PATH_INVALID');
        if (op === 'move' && f.space === b.to.space && parentOf(src) === toDir) {
          out.push(src);
          continue;
        }
        const name = await freeName(toDirAbs, baseName(src));
        const dst = joinPath(toDir, name);
        const dstAbs = path.join(toDirAbs, name);
        if (op === 'move') {
          await moveFs(srcAbs, dstAbs);
          if (f.space !== b.to.space) await ownTree(ctx, b.to.space, dstAbs);
          await rewriteEventPaths(ctx, { space: f.space, path: src }, { space: b.to.space, path: dst });
          await recordEvents(ctx, [{ space: b.to.space, path: dst, prevPath: src, action: 'move', actor: 'user' }]);
        } else {
          await cp(srcAbs, dstAbs, { recursive: true, verbatimSymlinks: true, errorOnExist: true, filter: async (s) => !(await lstat(s)).isSymbolicLink() });
          await ownTree(ctx, b.to.space, dstAbs);
          await recordEvents(ctx, [{ space: b.to.space, path: dst, prevPath: src, action: 'copy', actor: 'user' }]);
          bumpUsage(ctx.team.name, await du(dstAbs));
        }
        out.push(dst);
      }
      return { items: await Promise.all(out.map((p) => entryFor(ctx, b.to.space, p))) };
    });
  }

  // ── trash (U-06) ──

  app.post('/api/v1/teams/:team/drive/trash', { preHandler: requireAuth }, async (req: TeamReq, reply) => {
    const b = z.object({ space: SpaceQ, paths: z.array(z.string()).min(1).max(500) }).parse(req.body);
    const ctx = await context(req);
    const root = await ensureSpace(ctx, b.space);
    const trashDir = teamTrashDir(ctx.team.name);
    await mkdir(trashDir, { recursive: true });
    const days = await getSetting('ops.trash_retention_days');
    for (const raw of b.paths) {
      const p = normalizePath(raw);
      if (p === '/') throw new ApiError(400, 'DRIVE_PATH_INVALID');
      const abs = await resolveInside(root, p);
      const st = await lstat(abs);
      const id = newId();
      const size = await du(abs);
      await moveFs(abs, path.join(trashDir, id));
      await db.insert(trashItems).values({
        id, teamId: ctx.team.id, space: b.space, ownerUserId: b.space === 'me' ? ctx.userId : null,
        originalPath: p, isDir: st.isDirectory(), sizeBytes: size, deletedBy: ctx.userId,
        purgeAfter: sql`now() + make_interval(days => ${days})`,
      });
      await recordEvents(ctx, [{ space: b.space, path: p, action: 'trash', actor: 'user' }]);
    }
    return reply.code(204).send();
  });

  /** Items the caller may see: own `me` items and every shared item of the team. */
  const visibleTrash = (ctx: DriveContext) => and(
    eq(trashItems.teamId, ctx.team.id),
    or(eq(trashItems.space, 'shared'), and(eq(trashItems.space, 'me'), eq(trashItems.ownerUserId, ctx.userId))),
  );
  const canPurge = (ctx: DriveContext, t: typeof trashItems.$inferSelect) =>
    t.deletedBy === ctx.userId || (t.space === 'shared' && ctx.teamRole === 'team_admin');

  app.get('/api/v1/teams/:team/drive/trash', { preHandler: requireAuth }, async (req: TeamReq) => {
    const ctx = await context(req);
    const rows = await db.select({ t: trashItems, name: users.name, email: users.email })
      .from(trashItems).innerJoin(users, eq(users.id, trashItems.deletedBy))
      .where(visibleTrash(ctx)).orderBy(sql`${trashItems.deletedAt} desc`);
    return {
      items: rows.map(({ t, name, email }) => ({
        id: t.id, name: baseName(t.originalPath), space: t.space, originalPath: t.originalPath, isDir: t.isDir,
        size: t.sizeBytes, deletedBy: { id: t.deletedBy, name, email, departmentName: null },
        deletedAt: t.deletedAt.toISOString(), purgeAfter: t.purgeAfter.toISOString(), canPurge: canPurge(ctx, t),
      })),
    };
  });

  app.post('/api/v1/teams/:team/drive/trash/:id/restore', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { team: string; id: string } }>) => {
      const ctx = await context(req);
      const [t] = await db.select().from(trashItems).where(and(visibleTrash(ctx), eq(trashItems.id, req.params.id)));
      if (!t) throw new ApiError(404, 'DRIVE_NOT_FOUND');
      const space = t.space as Space;
      const root = await ensureSpace(ctx, space);
      // Recreate missing parent folders; on a name clash the restored item gets `(n)`.
      const parentAbs = await mkdirs(ctx, space, root, parentOf(t.originalPath));
      const name = await freeName(parentAbs, baseName(t.originalPath));
      const target = joinPath(parentOf(t.originalPath), name);
      await moveFs(path.join(teamTrashDir(ctx.team.name), t.id), path.join(parentAbs, name));
      await db.delete(trashItems).where(eq(trashItems.id, t.id));
      if (target !== t.originalPath) await rewriteEventPaths(ctx, { space, path: t.originalPath }, { space, path: target });
      await recordEvents(ctx, [{ space, path: target, action: 'restore', actor: 'user' }]);
      return entryFor(ctx, space, target);
    });

  async function purge(ctx: DriveContext | null, items: (typeof trashItems.$inferSelect)[], teamName: string) {
    for (const t of items) {
      await rm(path.join(teamTrashDir(teamName), t.id), { recursive: true, force: true });
      await db.delete(trashItems).where(eq(trashItems.id, t.id));
      bumpUsage(teamName, -t.sizeBytes);
      if (ctx) await recordEvents(ctx, [{ space: t.space as Space, path: t.originalPath, action: 'delete', actor: 'user' }]);
    }
  }

  app.delete('/api/v1/teams/:team/drive/trash/:id', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { team: string; id: string } }>, reply) => {
      const ctx = await context(req);
      const [t] = await db.select().from(trashItems).where(and(visibleTrash(ctx), eq(trashItems.id, req.params.id)));
      if (!t) throw new ApiError(404, 'DRIVE_NOT_FOUND');
      if (!canPurge(ctx, t)) throw new ApiError(403, 'FORBIDDEN');
      await purge(ctx, [t], ctx.team.name);
      return reply.code(204).send();
    });

  // Empty trash: own deletions; team admins also every shared item (U-06).
  app.delete('/api/v1/teams/:team/drive/trash', { preHandler: requireAuth }, async (req: TeamReq, reply) => {
    const ctx = await context(req);
    const rows = await db.select().from(trashItems).where(visibleTrash(ctx));
    await purge(ctx, rows.filter((t) => canPurge(ctx, t)), ctx.team.name);
    return reply.code(204).send();
  });
}

/** Daily worker: permanently delete trash items past `purge_after` (04-api.md §4 휴지통 정리). */
export async function purgeExpiredTrash() {
  const rows = await db.select({ t: trashItems, team: teams.name }).from(trashItems)
    .innerJoin(teams, eq(teams.id, trashItems.teamId)).where(lt(trashItems.purgeAfter, sql`now()`));
  for (const { t, team } of rows) {
    await rm(path.join(teamTrashDir(team), t.id), { recursive: true, force: true });
    await db.delete(trashItems).where(eq(trashItems.id, t.id));
  }
  return rows.length;
}

