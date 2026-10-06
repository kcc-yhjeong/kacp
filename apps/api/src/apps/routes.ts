import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, ilike, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { checkName } from '@kacp/shared';
import { requireAuth } from '../auth/guards.js';
import { audit } from '../audit.js';
import { db } from '../db/client.js';
import { apps, deployRequests, memberships, names, teams } from '../db/schema.js';
import { newId } from '../lib/crypto.js';
import { ApiError } from '../lib/errors.js';
import { orchestrator } from '../orchestrator.js';
import { getSetting } from '../settings.js';
import { invalidateTeamCaches } from '../teams/lookup.js';
import { notify, platformAdminIds } from '../notify/service.js';
import { publicFilter, workFilter, type CopyStatus, type StopReason } from './logic.js';
import {
  appForHost, appsOut, archivePublicData, dataUsage, loadApp, originOf, publicHost, removeAppFiles, requestsOut, sourceDiff,
  startCopy, stopCopy, teamOf, wakeCopy, type AppRow, type Copy,
} from './service.js';

// 앱·배포 API (04-api.md §2, U-02·U-03·U-07·U-08·C-04). v1 apps are all agent-made: no "own app"
// rights — members start/stop/request, team admins delete/unpublish (06-auth.md §7).

type Role = 'team_admin' | 'member';

async function roleIn(teamId: string, userId: string): Promise<Role | null> {
  const [m] = await db.select({ role: memberships.teamRole }).from(memberships)
    .where(and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)));
  return (m?.role as Role | undefined) ?? null;
}

async function memberApp(req: FastifyRequest<{ Params: { appId: string } }>) {
  const app = await loadApp(req.params.appId);
  const role = await roleIn(app.teamId, req.session!.user.id);
  if (!role) throw new ApiError(403, 'FORBIDDEN');
  return { app, role, team: await teamOf(app) };
}

/** Creates a deploy request (shared with the platform-mcp deploy_app tool; requestedBy null = agent). */
export async function createDeployRequest(app: AppRow, team: string, body: { name?: string; reason: string }, requestedBy: string | null) {
  const [pending] = await db.select().from(deployRequests).where(and(eq(deployRequests.appId, app.id), eq(deployRequests.status, 'pending')));
  if (pending) throw new ApiError(409, 'DEPLOY_ALREADY_PENDING');
  const isPublic = app.publicVersion !== null;
  let requestedName: string | null = null;
  if (!isPublic) {
    const name = (body.name ?? app.slug).trim();
    const problem = checkName(name, await getSetting('names.reserved_extra'));
    if (problem) throw new ApiError(422, problem);
    const [taken] = await db.select().from(names).where(eq(names.name, name));
    if (taken) throw new ApiError(409, 'NAME_TAKEN');
    const [pendingSame] = await db.select().from(deployRequests).where(and(eq(deployRequests.requestedName, name), eq(deployRequests.status, 'pending')));
    if (pendingSame) throw new ApiError(409, 'NAME_TAKEN');
    requestedName = name;
  }
  const [row] = await db.insert(deployRequests).values({
    id: newId(),
    appId: app.id,
    kind: isPublic ? 'update' : 'publish',
    requestedBy,
    requestedName,
    reason: body.reason.trim(),
    fromVersion: isPublic ? app.publicVersion : null,
    diffSummary: isPublic ? await sourceDiff(app, team) : null,
  }).returning();
  void notify(await platformAdminIds(), {
    type: 'admin_review_requested',
    title: `${team} 팀의 "${requestedName ?? app.publicName ?? app.slug}" ${isPublic ? '업데이트' : '공개'} 요청이 들어왔어요`,
    link: '/admin/deploy',
    payload: { appId: app.id, requestId: row!.id },
  }, requestedBy);
  return row!;
}

export async function appRoutes(app: FastifyInstance) {
  app.get('/api/v1/teams/:team/apps', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { team: string } }>) => {
      const q = z.object({
        work: z.enum(['running', 'sleeping', 'stopped', 'error']).optional(),
        public: z.enum(['none', 'publish_pending', 'update_pending', 'live']).optional(),
      }).parse(req.query);
      const [t] = await db.select().from(teams).where(and(eq(teams.name, req.params.team), isNull(teams.deletedAt)));
      if (!t) throw new ApiError(404, 'TEAM_NOT_FOUND');
      if (!(await roleIn(t.id, req.session!.user.id))) throw new ApiError(403, 'FORBIDDEN');
      const rows = await db.select().from(apps).where(and(eq(apps.teamId, t.id), isNull(apps.deletedAt))).orderBy(apps.slug);
      let items = await appsOut(rows);
      if (q.work) items = items.filter((a) => workFilter(a.work.status, a.work.stopReason) === q.work);
      if (q.public) items = items.filter((a) => publicFilter(a.public?.version ?? null, a.pendingRequest?.kind ?? null) === q.public);
      const runningWork = rows.filter((r) => r.workStatus === 'running' || r.workStatus === 'starting').length;
      return { items, limits: { maxRunningWork: await getSetting('ops.max_running_work_apps_per_team'), runningWork } };
    });

  app.get('/api/v1/apps/:appId', { preHandler: requireAuth }, async (req: FastifyRequest<{ Params: { appId: string } }>) => {
    const { app: a, role } = await memberApp(req);
    const [out] = await appsOut([a]);
    const history = await db.select().from(deployRequests).where(eq(deployRequests.appId, a.id)).orderBy(desc(deployRequests.createdAt));
    const hist = await requestsOut(history);
    const limits = a.resourceLimits ?? (await getSetting('limits.app_default'));
    return {
      ...out,
      source: { space: a.sourceSpace, path: a.sourcePath },
      runSpec: { command: a.runSpec.command, port: a.runSpec.port, runtime: a.runSpec.runtime },
      resourceLimits: { cpu: limits.cpu, memoryMb: limits.memoryMb, diskGb: 0 },
      dataUsage: await dataUsage(a),
      currentRequest: hist.find((h) => h.status === 'pending') ?? null,
      history: hist,
      createdAt: a.createdAt.toISOString(),
      canManage: role === 'team_admin',
    };
  });

  app.post('/api/v1/apps/:appId/:copy/:action', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { appId: string; copy: string; action: string } }>, reply) => {
      const copy = z.enum(['work', 'public']).parse(req.params.copy) as Copy;
      const action = z.enum(['start', 'stop', 'restart']).parse(req.params.action);
      const { app: a } = await memberApp(req);
      if (copy === 'public' && a.publicStatus === 'stopped' && a.publicStopReason === 'admin') throw new ApiError(409, 'APP_STATE_CONFLICT');
      if (action === 'stop') await stopCopy(a, copy, 'manual');
      else await startCopy(a, copy);
      const [out] = await appsOut([await loadApp(a.id)]);
      return reply.code(202).send(copy === 'work' ? out!.work : out!.public);
    });

  app.delete('/api/v1/apps/:appId', { preHandler: requireAuth }, async (req: FastifyRequest<{ Params: { appId: string } }>, reply) => {
    const { app: a, role, team } = await memberApp(req);
    if (role !== 'team_admin') throw new ApiError(403, 'FORBIDDEN');
    if (a.publicVersion !== null) {
      const { confirmName } = z.object({ confirmName: z.string() }).parse(req.body ?? {});
      if (confirmName !== a.slug) throw new ApiError(422, 'TEAM_CONFIRM_MISMATCH', undefined, '앱 이름이 맞지 않아요.');
    }
    await db.transaction(async (tx) => {
      await tx.update(apps).set({ deletedAt: sql`now()`, workStatus: 'stopped', publicStatus: a.publicVersion !== null ? 'stopped' : null }).where(eq(apps.id, a.id));
      await tx.update(deployRequests).set({ status: 'cancelled', decidedAt: sql`now()` }).where(and(eq(deployRequests.appId, a.id), eq(deployRequests.status, 'pending')));
      if (a.publicName) await tx.delete(names).where(and(eq(names.name, a.publicName), eq(names.kind, 'public_app')));
      await audit({ actorId: req.session!.user.id, action: 'app.delete', targetType: 'app', targetId: a.id, teamId: a.teamId, detail: { slug: a.slug, publicName: a.publicName } }, tx);
    });
    invalidateTeamCaches();
    void (async () => {
      await orchestrator.removeApp(a.id, 'work').catch(() => undefined);
      if (a.publicVersion !== null) await orchestrator.removeApp(a.id, 'public').catch(() => undefined);
      await removeAppFiles(a);
    })();
    req.log.info({ app: a.id, team: team.name }, 'app deleted');
    return reply.code(202).send();
  });

  app.post('/api/v1/apps/:appId/public-request', { preHandler: requireAuth }, async (req: FastifyRequest<{ Params: { appId: string } }>, reply) => {
    const body = z.object({ name: z.string().optional(), reason: z.string().trim().min(1).max(2000) }).parse(req.body);
    const { app: a, team } = await memberApp(req);
    const row = await createDeployRequest(a, team.name, body, req.session!.user.id);
    const [out] = await requestsOut([row]);
    return reply.code(201).send(out);
  });

  app.delete('/api/v1/apps/:appId/public-request', { preHandler: requireAuth }, async (req: FastifyRequest<{ Params: { appId: string } }>, reply) => {
    const { app: a } = await memberApp(req);
    const cancelled = await db.update(deployRequests).set({ status: 'cancelled', decidedBy: req.session!.user.id, decidedAt: sql`now()` })
      .where(and(eq(deployRequests.appId, a.id), eq(deployRequests.status, 'pending'))).returning();
    if (cancelled.length === 0) throw new ApiError(404, 'NOT_FOUND');
    return reply.code(204).send();
  });

  app.post('/api/v1/apps/:appId/unpublish', { preHandler: requireAuth }, async (req: FastifyRequest<{ Params: { appId: string } }>, reply) => {
    const { app: a, role } = await memberApp(req);
    if (role !== 'team_admin') throw new ApiError(403, 'FORBIDDEN');
    if (a.publicVersion === null) throw new ApiError(409, 'APP_NOT_PUBLIC');
    await db.transaction(async (tx) => {
      await tx.update(apps).set({
        publicName: null, publicVersion: null, publicStatus: null, publicStopReason: null, publicStatusDetail: null,
        publicContainerId: null, publicSnapshotPath: null, publicPublishedAt: null, publicApprovedBy: null, publicLastAccessedAt: null,
        updatedAt: sql`now()`,
      }).where(eq(apps.id, a.id));
      await tx.update(deployRequests).set({ status: 'cancelled', decidedAt: sql`now()` }).where(and(eq(deployRequests.appId, a.id), eq(deployRequests.status, 'pending')));
      if (a.publicName) await tx.delete(names).where(and(eq(names.name, a.publicName), eq(names.kind, 'public_app')));
      await audit({ actorId: req.session!.user.id, action: 'app.unpublish', targetType: 'app', targetId: a.id, teamId: a.teamId, detail: { publicName: a.publicName, version: a.publicVersion } }, tx);
    });
    invalidateTeamCaches();
    void orchestrator.removeApp(a.id, 'public').catch(() => undefined).then(() => archivePublicData(a));
    return reply.code(202).send();
  });

  app.get('/api/v1/apps/:appId/logs', { preHandler: requireAuth }, async (req: FastifyRequest<{ Params: { appId: string } }>) => {
    const q = z.object({ target: z.enum(['work', 'public']).default('work'), tail: z.coerce.number().int().min(1).max(2000).default(500) }).parse(req.query);
    const { app: a } = await memberApp(req);
    return orchestrator.appLogs(a.id, q.target, q.tail).catch(() => ({ lines: [] }));
  });

  app.get('/api/v1/apps/:appId/stats', { preHandler: requireAuth }, async (req: FastifyRequest<{ Params: { appId: string } }>) => {
    const q = z.object({ target: z.enum(['work', 'public']).default('work') }).parse(req.query);
    const { app: a } = await memberApp(req);
    const rows = await db.execute<{ ts: Date; cpu: number; mem: number; mem_limit: number | null }>(sql`
      select date_bin('1 minute'::interval, ts, timestamptz '2000-01-01') as ts, avg(cpu_pct)::float8 as cpu,
             avg(mem_bytes)::float8 as mem, max(mem_limit_bytes)::float8 as mem_limit
      from usage_samples where target_type = 'app' and target_id = ${`${a.id}:${q.target}`} and ts > now() - interval '1 hour'
      group by 1 order by 1`);
    return { points: rows.map((r) => ({ ts: new Date(r.ts).toISOString(), cpuPct: Math.round(Number(r.cpu) * 10) / 10, memBytes: Math.round(Number(r.mem)), memLimitBytes: r.mem_limit ? Math.round(Number(r.mem_limit)) : null })) };
  });

  // ── C-04: app hosts (no login needed to know whether it exists) ──

  app.get('/api/v1/app-hosts/:host', async (req: FastifyRequest<{ Params: { host: string } }>) => {
    const found = await appForHost(req.params.host);
    if (!found) return { exists: false };
    const { app: a, copy, team } = found;
    const loggedIn = !!req.session && !req.session.setupOnly;
    if (!loggedIn) return { exists: true };
    const status = (copy === 'work' ? a.workStatus : a.publicStatus) as CopyStatus;
    const stopReason = (status === 'stopped' ? (copy === 'work' ? a.workStopReason : a.publicStopReason) : null) as StopReason | null;
    const member = !!(await roleIn(a.teamId, req.session!.user.id));
    return {
      exists: true,
      copy,
      appId: member ? a.id : null,
      team: team.name,
      slug: a.slug,
      status,
      stopReason,
      // Force-stop reasons are shown to logged-in users (04-api.md app-hosts).
      statusDetail: copy === 'work' ? a.workStatusDetail : a.publicStatusDetail,
      canWake: status === 'stopped' && (stopReason === 'idle' || stopReason === 'limit') && (copy === 'public' || member),
      isMember: member,
    };
  });

  app.post('/api/v1/app-hosts/:host/wake', { preHandler: requireAuth }, async (req: FastifyRequest<{ Params: { host: string } }>, reply) => {
    const found = await appForHost(req.params.host);
    if (!found) throw new ApiError(404, 'APP_NOT_FOUND');
    if (found.copy === 'work' && !(await roleIn(found.app.teamId, req.session!.user.id))) throw new ApiError(403, 'FORBIDDEN');
    await wakeCopy(found.app, found.copy);
    return reply.code(202).send({ accepted: true });
  });

  app.get('/api/v1/public-apps', { preHandler: requireAuth }, async (req) => {
    const { q } = z.object({ q: z.string().trim().optional() }).parse(req.query);
    const where = [isNull(apps.deletedAt), isNotNull(apps.publicVersion)];
    if (q) where.push(ilike(apps.publicName, `%${q}%`));
    const rows = await db.select({ a: apps, team: teams.name }).from(apps).innerJoin(teams, eq(teams.id, apps.teamId))
      .where(and(...where)).orderBy(apps.publicName).limit(100);
    return {
      items: rows.map(({ a, team }) => ({
        id: a.id, name: a.publicName!, slug: a.slug, team, url: originOf(publicHost(a.publicName!)), version: a.publicVersion!,
      })),
    };
  });

}
