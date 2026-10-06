import type { FastifyInstance, FastifyRequest } from 'fastify';
import { readFile } from 'node:fs/promises';
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { MCP_CATEGORIES, MCP_PACKAGE_MAX_BYTES, NAME_PATTERN, type McpManifest } from '@kacp/shared';
import { requireAuth } from '../auth/guards.js';
import { audit } from '../audit.js';
import { db } from '../db/client.js';
import { mcpInstalls, mcpPackages, mcpVersions, memberships, teams } from '../db/schema.js';
import { newId } from '../lib/crypto.js';
import { ApiError } from '../lib/errors.js';
import { orchestrator } from '../orchestrator.js';
import { readPackage } from './package.js';
import {
  dispatchBuilds, installPackage, installsOut, packagesOut, platformInstallRow, removeInstall, storeUpload, updateSecrets,
  versionDir, versionsOut, type PackageRow,
} from './service.js';

// MCP 마켓 API (04-api.md §2 MCP 마켓, U-09~U-12·U-15). Rights (06-auth.md §7): everyone signed in
// views the market and uploads; team admins (and platform admins) install, remove and add manually.

type Req = FastifyRequest;
const me = (req: Req) => req.session!.user;
const isPlatformAdmin = (req: Req) => me(req).platformRole === 'admin';

async function teamByNameOr404(name: string) {
  const [t] = await db.select().from(teams).where(and(eq(teams.name, name), isNull(teams.deletedAt)));
  if (!t) throw new ApiError(404, 'TEAM_NOT_FOUND');
  return t;
}

async function roleIn(teamId: string, userId: string) {
  const [m] = await db.select({ role: memberships.teamRole }).from(memberships)
    .where(and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)));
  return (m?.role as 'team_admin' | 'member' | undefined) ?? null;
}

/** Team admin of that team, or platform admin (any team). */
export async function requireTeamManager(req: Req, teamName: string) {
  const t = await teamByNameOr404(teamName);
  if (!isPlatformAdmin(req) && (await roleIn(t.id, me(req).id)) !== 'team_admin') throw new ApiError(403, 'FORBIDDEN');
  return t;
}

async function packageByName(name: string) {
  const [p] = await db.select().from(mcpPackages).where(eq(mcpPackages.name, name));
  if (!p) throw new ApiError(404, 'MCP_NOT_FOUND');
  return p;
}

/** Owner of the package (uploader of its first version) or a platform admin. */
function requireOwner(req: Req, p: PackageRow) {
  if (!isPlatformAdmin(req) && p.ownerId !== me(req).id) throw new ApiError(403, 'FORBIDDEN');
}

const visibleInMarket = or(eq(mcpPackages.isPlatform, true), and(eq(mcpPackages.status, 'active'), isNotNull(mcpPackages.latestVersionId)));

export async function mcpRoutes(app: FastifyInstance) {
  // ── market (U-09, U-10) ──

  app.get('/api/v1/mcp/packages', { preHandler: requireAuth }, async (req) => {
    const q = z.object({
      q: z.string().trim().max(100).optional(),
      category: z.enum(MCP_CATEGORIES).optional(),
      sort: z.enum(['popular', 'recent']).default('popular'),
      team: z.string().regex(NAME_PATTERN).optional(),
    }).parse(req.query);
    const conds = [visibleInMarket];
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      conds.push(or(ilike(mcpPackages.name, like), ilike(mcpPackages.displayName, like), ilike(mcpPackages.summary, like)));
    }
    if (q.category) conds.push(eq(mcpPackages.category, q.category));
    const rows = await db.select().from(mcpPackages).where(and(...conds))
      .orderBy(desc(mcpPackages.isPlatform), q.sort === 'popular' ? desc(mcpPackages.installCount) : desc(mcpPackages.updatedAt), mcpPackages.name);
    const teamId = q.team ? await viewerTeamId(req, q.team) : null;
    return { items: await packagesOut(rows, teamId) };
  });

  app.get('/api/v1/mcp/packages/:pkg', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { pkg: string } }>) => {
      const { team } = z.object({ team: z.string().regex(NAME_PATTERN).optional() }).parse(req.query);
      const p = await packageByName(req.params.pkg);
      const owner = isPlatformAdmin(req) || p.ownerId === me(req).id;
      if (!p.isPlatform && !p.latestVersionId && !owner) throw new ApiError(404, 'MCP_NOT_FOUND');
      const [summary] = await packagesOut([p], team ? await viewerTeamId(req, team) : null);
      const [latest] = p.latestVersionId ? await db.select().from(mcpVersions).where(eq(mcpVersions.id, p.latestVersionId)) : [];
      const history = await db.select().from(mcpVersions)
        .where(and(eq(mcpVersions.packageId, p.id), inArray(mcpVersions.status, ['published', 'superseded'])))
        .orderBy(desc(mcpVersions.publishedAt));
      const canInstallTeams = p.isPlatform ? [] : isPlatformAdmin(req)
        ? (await db.select({ name: teams.name }).from(teams).where(isNull(teams.deletedAt)).orderBy(teams.name)).map((r) => r.name)
        : (await db.select({ name: teams.name }).from(memberships).innerJoin(teams, eq(teams.id, memberships.teamId))
          .where(and(eq(memberships.userId, me(req).id), eq(memberships.teamRole, 'team_admin'), isNull(teams.deletedAt))).orderBy(teams.name)).map((r) => r.name);
      return {
        ...summary!,
        readme: latest?.readme ?? '',
        manifest: (latest?.manifest as McpManifest | undefined) ?? null,
        tools: latest?.tools ?? [],
        versions: await versionsOut(history),
        canInstallTeams,
      };
    });

  // ── my packages and uploads (U-12) ──

  app.post('/api/v1/mcp/uploads', { preHandler: requireAuth }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: MCP_PACKAGE_MAX_BYTES, files: 1 } });
    if (!file) throw new ApiError(422, 'MCP_MANIFEST_INVALID', { problems: ['zip 파일을 골라 주세요.'] });
    let zip: Buffer;
    try {
      zip = await file.toBuffer();
    } catch {
      throw new ApiError(413, 'MCP_TOO_LARGE');
    }
    const r = await readPackage(zip);
    if (!r.ok) throw new ApiError(422, 'MCP_MANIFEST_INVALID', { problems: r.problems });
    const m = r.manifest;

    let [p] = await db.select().from(mcpPackages).where(eq(mcpPackages.name, m.name));
    if (p && (p.isPlatform || (p.ownerId !== me(req).id && !isPlatformAdmin(req)))) {
      throw new ApiError(403, 'FORBIDDEN', undefined, '다른 사람이 올린 MCP 이름이에요. name을 바꿔 주세요.');
    }
    if (p) {
      const [dup] = await db.select({ id: mcpVersions.id }).from(mcpVersions).where(and(eq(mcpVersions.packageId, p.id), eq(mcpVersions.version, m.version)));
      if (dup) throw new ApiError(409, 'MCP_VERSION_EXISTS');
    }
    await storeUpload(m.name, m.version, zip, r.files);
    if (!p) {
      [p] = await db.insert(mcpPackages).values({
        id: newId(), name: m.name, ownerId: me(req).id, displayName: m.displayName, summary: m.summary, category: m.category, icon: m.icon ?? null,
      }).onConflictDoNothing({ target: mcpPackages.name }).returning();
      if (!p) throw new ApiError(409, 'MCP_VERSION_EXISTS');
    } else if (!p.latestVersionId) {
      // Not published yet: show the newest upload's names in 내 배포.
      await db.update(mcpPackages).set({ displayName: m.displayName, summary: m.summary, category: m.category, icon: m.icon ?? null, updatedAt: sql`now()` }).where(eq(mcpPackages.id, p.id));
    }
    const [v] = await db.insert(mcpVersions).values({
      id: newId(), packageId: p.id, version: m.version, uploadedBy: me(req).id, manifest: m, readme: r.readme,
    }).onConflictDoNothing().returning();
    if (!v) throw new ApiError(409, 'MCP_VERSION_EXISTS');
    void dispatchBuilds();
    const [out] = await versionsOut([v]);
    return reply.code(201).send(out);
  });

  app.get('/api/v1/me/mcp/packages', { preHandler: requireAuth }, async (req) => {
    const rows = await db.select().from(mcpPackages).where(eq(mcpPackages.ownerId, me(req).id)).orderBy(desc(mcpPackages.updatedAt));
    const out = await packagesOut(rows);
    const versions = rows.length
      ? await db.select().from(mcpVersions).where(inArray(mcpVersions.packageId, rows.map((r) => r.id))).orderBy(desc(mcpVersions.createdAt))
      : [];
    const vout = await versionsOut(versions);
    // newest activity first
    const items = out.map((p, i) => ({ ...p, versions: vout.filter((v) => v.packageName === rows[i]!.name) }));
    items.sort((a, b) => (b.versions[0]?.uploadedAt ?? '').localeCompare(a.versions[0]?.uploadedAt ?? ''));
    return { items };
  });

  app.get('/api/v1/mcp/packages/:pkg/versions/:ver', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { pkg: string; ver: string } }>) => {
      const p = await packageByName(req.params.pkg);
      requireOwner(req, p);
      const [v] = await db.select().from(mcpVersions).where(and(eq(mcpVersions.packageId, p.id), eq(mcpVersions.version, req.params.ver)));
      if (!v) throw new ApiError(404, 'MCP_NOT_FOUND');
      const [out] = await versionsOut([v]);
      return { ...out!, findings: v.scanFindings ?? [] };
    });

  app.get('/api/v1/mcp/packages/:pkg/versions/:ver/logs', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { pkg: string; ver: string } }>) => {
      const { stage } = z.object({ stage: z.enum(['build', 'scan', 'test']) }).parse(req.query);
      const p = await packageByName(req.params.pkg);
      requireOwner(req, p);
      const [v] = await db.select().from(mcpVersions).where(and(eq(mcpVersions.packageId, p.id), eq(mcpVersions.version, req.params.ver)));
      if (!v) throw new ApiError(404, 'MCP_NOT_FOUND');
      return { text: await readLog(p.name, v.version, stage) };
    });

  // ── team installs (U-10 설치, U-11, U-15 MCP 탭) ──

  app.get('/api/v1/teams/:team/mcp/installs', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { team: string } }>) => {
      const t = await teamByNameOr404(req.params.team);
      const role = await roleIn(t.id, me(req).id);
      if (!role && !isPlatformAdmin(req)) throw new ApiError(403, 'FORBIDDEN');
      const rows = await db.select().from(mcpInstalls).where(eq(mcpInstalls.teamId, t.id)).orderBy(mcpInstalls.createdAt);
      const lastSynced = rows.reduce<Date | null>((a, r) => (r.lastCheckedAt && (!a || r.lastCheckedAt > a) ? r.lastCheckedAt : a), null);
      return {
        items: [await platformInstallRow(), ...(await installsOut(rows))],
        teamRunning: t.containerStatus === 'running',
        lastSyncedAt: lastSynced?.toISOString() ?? null,
        canManage: role === 'team_admin' || isPlatformAdmin(req),
      };
    });

  app.post('/api/v1/teams/:team/mcp/installs', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { team: string } }>, reply) => {
      const t = await requireTeamManager(req, req.params.team);
      const body = z.object({
        packageName: z.string().regex(NAME_PATTERN),
        version: z.string().optional(),
        secrets: z.record(z.string(), z.string().max(8192)).default({}),
      }).parse(req.body);
      const p = await packageByName(body.packageName);
      if (p.isPlatform) throw new ApiError(409, 'MCP_ALREADY_INSTALLED');
      if (p.status === 'suspended') throw new ApiError(409, 'MCP_SUSPENDED');
      if (!p.latestVersionId) throw new ApiError(409, 'MCP_NOT_PUBLISHED');
      const [v] = await db.select().from(mcpVersions).where(eq(mcpVersions.id, p.latestVersionId));
      if (!v || (body.version && body.version !== v.version)) throw new ApiError(409, 'MCP_NOT_PUBLISHED', undefined, '최신 게시 버전만 설치할 수 있어요.');
      const m = v.manifest as McpManifest;
      const declared = new Set(m.secrets.map((s) => s.name));
      const unknown = Object.keys(body.secrets).filter((k) => !declared.has(k));
      const missing = m.secrets.filter((s) => s.required && !body.secrets[s.name]?.trim()).map((s) => s.name);
      if (unknown.length || missing.length) throw new ApiError(422, 'VALIDATION_FAILED', { missing, unknown }, missing.length ? `필수 비밀값을 입력해 주세요: ${missing.join(', ')}` : undefined);
      const [taken] = await db.select({ id: mcpInstalls.id }).from(mcpInstalls).where(and(eq(mcpInstalls.teamId, t.id), eq(mcpInstalls.serverKey, p.name)));
      if (taken) throw new ApiError(409, 'MCP_ALREADY_INSTALLED');
      const row = await installPackage({ team: t, pkg: p, version: v, source: 'market', secrets: body.secrets, installedBy: me(req).id });
      await audit({
        actorId: me(req).id, action: 'mcp.install', targetType: 'mcp_package', targetId: p.name, teamId: t.id,
        detail: { version: v.version, secretNames: row.secretNames }, ip: req.ip,
      });
      const [out] = await installsOut([row]);
      return reply.code(202).send(out);
    });

  app.put('/api/v1/teams/:team/mcp/installs/:id/secrets', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { team: string; id: string } }>, reply) => {
      const t = await requireTeamManager(req, req.params.team);
      const { secrets } = z.object({ secrets: z.record(z.string(), z.string().max(8192)) }).parse(req.body);
      const row = await installOf(t.id, req.params.id);
      if (row.source === 'manual' || !row.versionId) throw new ApiError(409, 'MCP_STATE_CONFLICT', undefined, '직접 추가한 MCP는 제거 후 다시 추가해 주세요.');
      if (row.status === 'removing' || row.status === 'installing') throw new ApiError(409, 'MCP_STATE_CONFLICT');
      const [v] = await db.select().from(mcpVersions).where(eq(mcpVersions.id, row.versionId));
      const declared = new Set((v!.manifest as McpManifest).secrets.map((s) => s.name));
      const unknown = Object.keys(secrets).filter((k) => !declared.has(k));
      if (unknown.length) throw new ApiError(422, 'VALIDATION_FAILED', { unknown });
      await updateSecrets(t, row, secrets);
      await audit({
        actorId: me(req).id, action: 'mcp.secrets_update', targetType: 'mcp_package', targetId: row.serverKey, teamId: t.id,
        detail: { secretNames: Object.keys(secrets).filter((k) => secrets[k] !== '') }, ip: req.ip,
      });
      const [out] = await installsOut([await installOf(t.id, row.id)]);
      return reply.code(202).send(out);
    });

  app.delete('/api/v1/teams/:team/mcp/installs/:id', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { team: string; id: string } }>, reply) => {
      const t = await requireTeamManager(req, req.params.team);
      const [platform] = await db.select({ id: mcpPackages.id }).from(mcpPackages).where(eq(mcpPackages.isPlatform, true));
      if (platform?.id === req.params.id) throw new ApiError(409, 'MCP_PLATFORM_LOCKED');
      const row = await installOf(t.id, req.params.id);
      if (row.status === 'removing') return reply.code(202).send((await installsOut([row]))[0]);
      if (row.source === 'manual') {
        if (t.containerStatus !== 'running') throw new ApiError(409, 'TEAM_NOT_RUNNING', undefined, '직접 추가한 MCP는 팀 에이전트가 켜져 있을 때 제거할 수 있어요.');
        await orchestrator.mcpManual(t.name, row.serverKey, null);
        await db.delete(mcpInstalls).where(eq(mcpInstalls.id, row.id));
      } else {
        await removeInstall(t, row);
      }
      await audit({ actorId: me(req).id, action: 'mcp.remove', targetType: 'mcp_package', targetId: row.serverKey, teamId: t.id, detail: { source: row.source }, ip: req.ip });
      return reply.code(202).send({ ...(await installsOut([row]))[0], status: row.source === 'manual' ? 'removed' : 'removing' });
    });

  app.post('/api/v1/teams/:team/mcp/manual', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { team: string } }>, reply) => {
      const t = await requireTeamManager(req, req.params.team);
      const body = z.object({
        name: z.string().regex(NAME_PATTERN, '이름은 소문자·숫자·하이픈 3~30자예요.'),
        url: z.url().refine((u) => /^https?:\/\//.test(u), 'http(s) 주소만 쓸 수 있어요.'),
        headers: z.record(z.string().regex(/^[A-Za-z0-9-]{1,64}$/), z.string().max(4096)).default({}),
      }).parse(req.body);
      if (body.name === 'platform') throw new ApiError(409, 'NAME_TAKEN');
      if (t.containerStatus !== 'running') throw new ApiError(409, 'TEAM_NOT_RUNNING', undefined, '팀 에이전트가 켜져 있을 때 추가할 수 있어요.');
      const [taken] = await db.select({ id: mcpInstalls.id }).from(mcpInstalls).where(and(eq(mcpInstalls.teamId, t.id), eq(mcpInstalls.serverKey, body.name)));
      if (taken) throw new ApiError(409, 'NAME_TAKEN');
      // Header values (tokens) go to the Gateway only; the row keeps the header names.
      await orchestrator.mcpManual(t.name, body.name, { url: body.url, headers: body.headers });
      const [row] = await db.insert(mcpInstalls).values({
        id: newId(), teamId: t.id, source: 'manual', manualName: body.name, manualUrl: body.url, serverKey: body.name,
        status: 'installed', secretNames: Object.keys(body.headers).sort(), installedBy: me(req).id, lastCheckedAt: sql`now()`,
      }).returning();
      await audit({ actorId: me(req).id, action: 'mcp.manual_add', targetType: 'team', targetId: body.name, teamId: t.id, detail: { url: body.url, headerNames: Object.keys(body.headers) }, ip: req.ip });
      const [out] = await installsOut([row!]);
      return reply.code(201).send(out);
    });
}

/** Market `team` query: only teams the viewer belongs to count for "설치됨" (platform admins: any team). */
async function viewerTeamId(req: Req, teamName: string): Promise<string | null> {
  const [t] = await db.select().from(teams).where(and(eq(teams.name, teamName), isNull(teams.deletedAt)));
  if (!t) return null;
  if (isPlatformAdmin(req) || (await roleIn(t.id, me(req).id))) return t.id;
  return null;
}

async function installOf(teamId: string, id: string) {
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, 'MCP_NOT_FOUND');
  const [row] = await db.select().from(mcpInstalls).where(and(eq(mcpInstalls.teamId, teamId), eq(mcpInstalls.id, id)));
  if (!row) throw new ApiError(404, 'MCP_NOT_FOUND');
  return row;
}

export async function readLog(pkg: string, version: string, stage: 'build' | 'scan' | 'test') {
  const text = await readFile(`${versionDir(pkg, version)}/${stage}.log`, 'utf8').catch(() => '');
  return text.length > 200_000 ? `… (앞부분 생략)\n${text.slice(-200_000)}` : text;
}
