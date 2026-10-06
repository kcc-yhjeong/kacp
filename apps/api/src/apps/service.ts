import { chown, cp, lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { apps, deployRequests, departments, teams, usageSamples, users } from '../db/schema.js';
import { du } from '../drive/service.js';
import { ApiError } from '../lib/errors.js';
import { orchestrator } from '../orchestrator.js';
import { getSetting } from '../settings.js';
import { canWake, diffTrees, type CopyStatus, type FileSig, type StopReason } from './logic.js';

// App copies: state transitions on the api side (03-data-model.md 상태 전이 — 앱).

export type AppRow = typeof apps.$inferSelect;
export type Copy = 'work' | 'public';
type TeamRow = typeof teams.$inferSelect;

const APP_UID = 1000;

export const workHost = (slug: string, team: string) => `${slug}--${team}.${config.baseDomain}`;
export const publicHost = (name: string) => `${name}.${config.baseDomain}`;
export const originOf = (host: string) => `${config.scheme}://${host}`;

// Paths relative to the data root (05-urls-and-storage.md §5).
export const sourceRel = (team: string, sourcePath: string) => `teams/${team}/drive/shared${sourcePath === '/' ? '' : sourcePath}`;
export const dataRel = (appId: string, copy: Copy) => `apps/${appId}/${copy}-data`;
export const snapshotRel = (appId: string, version: number) => `apps/${appId}/snapshots/${version}`;
const abs = (rel: string) => path.join(config.dataRoot, rel);

// ── output shape (openapi App / AppCopy / PublicCopy) ──

async function latestUsage(appIds: string[]) {
  if (appIds.length === 0) return new Map<string, { cpuPct: number; memBytes: number; memLimitBytes: number | null }>();
  const ids = appIds.flatMap((id) => [`${id}:work`, `${id}:public`]);
  const rows = await db.selectDistinctOn([usageSamples.targetId], {
    targetId: usageSamples.targetId, cpuPct: usageSamples.cpuPct, memBytes: usageSamples.memBytes, memLimitBytes: usageSamples.memLimitBytes,
  }).from(usageSamples)
    .where(and(eq(usageSamples.targetType, 'app'), inArray(usageSamples.targetId, ids), sql`${usageSamples.ts} > now() - interval '5 minutes'`))
    .orderBy(usageSamples.targetId, desc(usageSamples.ts));
  return new Map(rows.map((r) => [r.targetId, { cpuPct: r.cpuPct, memBytes: r.memBytes, memLimitBytes: r.memLimitBytes }]));
}

export async function pendingFor(appIds: string[]) {
  if (appIds.length === 0) return new Map<string, { id: string; kind: 'publish' | 'update' }>();
  const rows = await db.select({ id: deployRequests.id, appId: deployRequests.appId, kind: deployRequests.kind })
    .from(deployRequests).where(and(inArray(deployRequests.appId, appIds), eq(deployRequests.status, 'pending')));
  return new Map(rows.map((r) => [r.appId, { id: r.id, kind: r.kind as 'publish' | 'update' }]));
}

export async function appsOut(rows: AppRow[]) {
  const teamNames = new Map((await db.select({ id: teams.id, name: teams.name }).from(teams)
    .where(inArray(teams.id, [...new Set(rows.map((r) => r.teamId))].concat(['00000000-0000-0000-0000-000000000000'])))).map((t) => [t.id, t.name]));
  const usage = await latestUsage(rows.map((r) => r.id));
  const pending = await pendingFor(rows.map((r) => r.id));
  return rows.map((a) => {
    const team = teamNames.get(a.teamId) ?? '';
    const running = (s: string | null) => s === 'running' || s === 'starting';
    return {
      id: a.id,
      team,
      slug: a.slug,
      creator: { kind: 'agent' as const, user: null },
      work: {
        kind: 'work' as const,
        url: originOf(workHost(a.slug, team)),
        status: a.workStatus as CopyStatus,
        stopReason: (a.workStatus === 'stopped' ? a.workStopReason : null) as StopReason | null,
        statusDetail: a.workStatusDetail,
        lastAccessedAt: a.workLastAccessedAt?.toISOString() ?? null,
        usage: running(a.workStatus) ? usage.get(`${a.id}:work`) ?? null : null,
      },
      public: a.publicVersion === null ? null : {
        kind: 'public' as const,
        name: a.publicName!,
        url: originOf(publicHost(a.publicName!)),
        version: a.publicVersion,
        status: (a.publicStatus ?? 'stopped') as CopyStatus,
        stopReason: (a.publicStatus === 'stopped' ? a.publicStopReason : null) as StopReason | null,
        statusDetail: a.publicStatusDetail,
        lastAccessedAt: a.publicLastAccessedAt?.toISOString() ?? null,
        publishedAt: a.publicPublishedAt?.toISOString() ?? null,
        approvedBy: a.publicApprovedBy,
        usage: running(a.publicStatus) ? usage.get(`${a.id}:public`) ?? null : null,
      },
      pendingRequest: pending.get(a.id) ?? null,
    };
  });
}

export async function requestsOut(rows: (typeof deployRequests.$inferSelect)[]) {
  const ids = [...new Set(rows.flatMap((r) => [r.requestedBy, r.decidedBy]).filter((x): x is string => !!x))];
  const people = ids.length
    ? await db.select({ id: users.id, name: users.name, email: users.email, departmentName: departments.name })
      .from(users).leftJoin(departments, eq(departments.id, users.departmentId)).where(inArray(users.id, ids))
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  return rows.map((r) => ({
    id: r.id,
    appId: r.appId,
    kind: r.kind as 'publish' | 'update',
    requestedName: r.requestedName,
    reason: r.reason,
    fromVersion: r.fromVersion,
    approvedVersion: r.approvedVersion,
    diffSummary: r.diffSummary ?? null,
    status: r.status,
    // null = the agent asked through deploy_app ("에이전트 · 팀").
    requestedBy: r.requestedBy ? byId.get(r.requestedBy) ?? null : null,
    requestedAt: r.createdAt.toISOString(),
    decidedBy: r.decidedBy ? byId.get(r.decidedBy) ?? null : null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
  }));
}

// ── lookups ──

export async function loadApp(id: string): Promise<AppRow> {
  const [a] = await db.select().from(apps).where(and(eq(apps.id, id), isNull(apps.deletedAt)));
  if (!a) throw new ApiError(404, 'APP_NOT_FOUND');
  return a;
}

export async function teamOf(app: AppRow): Promise<TeamRow> {
  const [t] = await db.select().from(teams).where(eq(teams.id, app.teamId));
  if (!t) throw new ApiError(404, 'TEAM_NOT_FOUND');
  return t;
}

/** `slug--team` or a public name → the app copy it serves. */
export async function appForHost(host: string): Promise<{ app: AppRow; copy: Copy; team: TeamRow } | null> {
  const h = host.toLowerCase().replace(/:\d+$/, '');
  const suffix = `.${config.baseDomain}`;
  if (!h.endsWith(suffix)) return null;
  const label = h.slice(0, -suffix.length);
  if (label.includes('--')) {
    const [slug, teamName] = label.split('--') as [string, string];
    const [row] = await db.select({ a: apps, t: teams }).from(apps).innerJoin(teams, eq(teams.id, apps.teamId))
      .where(and(eq(apps.slug, slug), eq(teams.name, teamName), isNull(apps.deletedAt), isNull(teams.deletedAt)));
    return row ? { app: row.a, copy: 'work', team: row.t } : null;
  }
  const [row] = await db.select({ a: apps, t: teams }).from(apps).innerJoin(teams, eq(teams.id, apps.teamId))
    .where(and(eq(apps.publicName, label), isNull(apps.deletedAt)));
  return row ? { app: row.a, copy: 'public', team: row.t } : null;
}

// ── copy lifecycle ──

async function ensureDataDir(rel: string) {
  const dir = abs(rel);
  await mkdir(dir, { recursive: true });
  await chown(dir, APP_UID, APP_UID).catch(() => undefined);
}

async function setCopy(appId: string, copy: Copy, status: CopyStatus, reason: StopReason | null, detail: string | null) {
  const now = sql`now()`;
  await db.update(apps).set(copy === 'work'
    ? { workStatus: status, workStopReason: status === 'stopped' ? reason : null, workStatusDetail: detail, ...(status === 'starting' ? { workStartedAt: now, workLastAccessedAt: now } : {}), updatedAt: now }
    : { publicStatus: status, publicStopReason: status === 'stopped' ? reason : null, publicStatusDetail: detail, ...(status === 'starting' ? { publicLastAccessedAt: now } : {}), updatedAt: now })
    .where(eq(apps.id, appId));
}

/** Team running-work limit (docs/README.md 5단계): the least recently used work copy is put to sleep (`limit`). */
async function enforceWorkLimit(app: AppRow) {
  const max = await getSetting('ops.max_running_work_apps_per_team');
  const running = await db.select().from(apps)
    .where(and(eq(apps.teamId, app.teamId), isNull(apps.deletedAt), ne(apps.id, app.id), inArray(apps.workStatus, ['running', 'starting'])))
    .orderBy(asc(apps.workLastAccessedAt));
  for (const victim of running.slice(0, Math.max(0, running.length - (max - 1)))) {
    await stopCopy(victim, 'work', 'limit');
  }
}

export async function startCopy(app: AppRow, copy: Copy) {
  const team = await teamOf(app);
  if (copy === 'public') {
    if (app.publicVersion === null || !app.publicName) throw new ApiError(409, 'APP_NOT_PUBLIC');
    if (app.publicStatus === 'stopped' && app.publicStopReason === 'admin') throw new ApiError(409, 'APP_STATE_CONFLICT');
  }
  if (copy === 'work') await enforceWorkLimit(app);
  const limits = app.resourceLimits ?? (await getSetting('limits.app_default'));
  const rel = dataRel(app.id, copy);
  await ensureDataDir(rel);
  await setCopy(app.id, copy, 'starting', null, null);
  try {
    await orchestrator.runApp(app.id, {
      team: team.name,
      slug: app.slug,
      copy,
      ...(copy === 'public' ? { publicName: app.publicName!, version: app.publicVersion! } : {}),
      sourceRel: copy === 'work' ? sourceRel(team.name, app.sourcePath) : snapshotRel(app.id, app.publicVersion!),
      dataRel: rel,
      runtime: app.runSpec.runtime,
      command: app.runSpec.command,
      port: app.runSpec.port,
      env: app.runSpec.env ?? {},
      limits: { cpu: limits.cpu, memoryMb: limits.memoryMb },
    });
  } catch (err) {
    await setCopy(app.id, copy, 'error', null, '앱을 실행하지 못했어요.');
    throw err;
  }
}

export async function stopCopy(app: AppRow, copy: Copy, reason: StopReason, detail: string | null = null) {
  await setCopy(app.id, copy, 'stopped', reason, detail);
  await orchestrator.stopApp(app.id, copy).catch(() => undefined);
}

/** Wake a sleeping copy on visit (C-04): only `idle`/`limit`. */
export async function wakeCopy(app: AppRow, copy: Copy) {
  const status = (copy === 'work' ? app.workStatus : app.publicStatus) as CopyStatus | null;
  const reason = (copy === 'work' ? app.workStopReason : app.publicStopReason) as StopReason | null;
  if (status === 'starting' || status === 'running') return;
  if (!canWake(status, reason)) throw new ApiError(409, 'APP_STATE_CONFLICT');
  await startCopy(app, copy);
}

// ── snapshots and diffs (api side — docs/README.md 5단계) ──

const SKIP = new Set(['node_modules', '.git', '.venv', '__pycache__', '.deps']);

/** Relative file → "size:mtime" signature for every regular file (no symlinks, skips dependency dirs). */
export async function fileSigs(root: string): Promise<FileSig> {
  const out: FileSig = new Map();
  const walk = async (dir: string, rel: string) => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.isSymbolicLink() || SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(p, r);
      else if (e.isFile()) {
        const st = await lstat(p);
        out.set(r, `${st.size}:${Math.floor(st.mtimeMs / 1000)}`);
      }
    }
  };
  await walk(root, '');
  return out;
}

export async function sourceDiff(app: AppRow, team: string) {
  const next = await fileSigs(abs(sourceRel(team, app.sourcePath)));
  const current = app.publicVersion !== null ? await fileSigs(abs(snapshotRel(app.id, app.publicVersion))) : new Map();
  return diffTrees(current, next);
}

async function chownTree(p: string, uid: number, gid: number) {
  const st = await lstat(p);
  if (st.isSymbolicLink()) return;
  await chown(p, uid, gid).catch(() => undefined);
  if (st.isDirectory()) for (const e of await readdir(p)) await chownTree(path.join(p, e), uid, gid);
}

/** Copies the source folder into snapshots/{version} (timestamps kept so diffs stay meaningful), keeps 3. */
export async function takeSnapshot(app: AppRow, team: string, version: number) {
  const dst = abs(snapshotRel(app.id, version));
  await rm(dst, { recursive: true, force: true });
  await mkdir(path.dirname(dst), { recursive: true });
  await cp(abs(sourceRel(team, app.sourcePath)), dst, {
    recursive: true,
    preserveTimestamps: true,
    filter: async (s) => !(await lstat(s)).isSymbolicLink() && !SKIP.has(path.basename(s)),
  });
  // The api copies as root; the public copy runs as uid 1000 and must be able to read its snapshot.
  await chownTree(dst, APP_UID, APP_UID);
  const versions = (await readdir(path.dirname(dst)).catch(() => [])).map(Number).filter(Number.isInteger).sort((a, b) => b - a);
  for (const old of versions.slice(3)) await rm(abs(snapshotRel(app.id, old)), { recursive: true, force: true });
  return snapshotRel(app.id, version);
}

export async function dataUsage(app: AppRow) {
  return {
    workBytes: await du(abs(dataRel(app.id, 'work'))),
    publicBytes: app.publicVersion !== null ? await du(abs(dataRel(app.id, 'public'))) : null,
  };
}

/** Unpublish / delete: public data goes to backups/deleted-apps for 30 days (03-data-model.md). */
export async function archivePublicData(app: AppRow) {
  const src = abs(dataRel(app.id, 'public'));
  const dst = path.join(config.dataRoot, 'backups', 'deleted-apps', `${app.id}-public-${new Date().toISOString().slice(0, 10)}-${Date.now()}`);
  await mkdir(path.dirname(dst), { recursive: true });
  await rename(src, dst).catch(() => undefined);
}

export async function removeAppFiles(app: AppRow) {
  await archivePublicData(app);
  await rm(abs(`apps/${app.id}`), { recursive: true, force: true });
}

/** app.status events from the orchestrator. */
export async function onAppStatus(appId: string, copy: Copy, status: CopyStatus, stopReason: StopReason | null, detail: string | null) {
  const [a] = await db.select().from(apps).where(eq(apps.id, appId));
  if (!a) return;
  // A stop requested by the api already recorded its reason; don't let a late "stopped" overwrite it.
  if (status === 'stopped' && (copy === 'work' ? a.workStatus : a.publicStatus) === 'stopped') return;
  await setCopy(appId, copy, status, stopReason, status === 'error' ? detail : null);
}
