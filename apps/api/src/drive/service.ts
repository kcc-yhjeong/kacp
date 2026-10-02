import { chmod, chown, cp, lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { departments, driveEvents, teams, users } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import { baseName, joinPath, mimeOf, normalizePath, resolveInside } from './paths.js';

// Drive storage and records (03-data-model.md 드라이브, 05-urls-and-storage.md §5).

export type Space = 'me' | 'shared';
type TeamRow = typeof teams.$inferSelect;

export interface DriveContext {
  team: TeamRow;
  userId: string;
  linuxUid: number;
  teamRole: 'team_admin' | 'member';
}

const OPENCLAW_UID = 1000;

export const teamDriveDir = (team: string) => path.join(config.dataRoot, 'teams', team, 'drive');
export const teamTrashDir = (team: string) => path.join(config.dataRoot, 'teams', team, '.trash');

export function spaceRoot(ctx: DriveContext, space: Space) {
  return space === 'shared'
    ? path.join(teamDriveDir(ctx.team.name), 'shared')
    : path.join(teamDriveDir(ctx.team.name), 'personal', `u${ctx.linuxUid}`);
}

// Ownership (docs/README.md 4단계): shared = 1000:{gid} 2770/0660 so the OpenClaw node user can write;
// personal = {uid} 0700/0600 (never mounted into the team container).
export async function setOwnership(ctx: DriveContext, space: Space, abs: string, isDir: boolean) {
  try {
    if (space === 'shared') {
      await chown(abs, OPENCLAW_UID, ctx.team.linuxGid);
      await chmod(abs, isDir ? 0o2770 : 0o660);
    } else {
      await chown(abs, ctx.linuxUid, ctx.linuxUid);
      await chmod(abs, isDir ? 0o700 : 0o600);
    }
  } catch {
    // Not root (local tests on Windows): ownership is best effort.
  }
}

export async function ensureSpace(ctx: DriveContext, space: Space) {
  const root = spaceRoot(ctx, space);
  const existed = await stat(root).then(() => true, () => false);
  if (!existed) {
    await mkdir(root, { recursive: true });
    await setOwnership(ctx, space, root, true);
  }
  return root;
}

/** Creates intermediate folders of a relative path below `dirAbs`, each with the right ownership. */
export async function mkdirs(ctx: DriveContext, space: Space, root: string, apiDir: string): Promise<string> {
  const rel = normalizePath(apiDir);
  let cur = root;
  let curApi = '/';
  const created: RecordInput[] = [];
  for (const part of rel.split('/').filter(Boolean)) {
    cur = path.join(cur, part);
    curApi = joinPath(curApi, part);
    const st = await lstat(cur).catch(() => null);
    if (st?.isSymbolicLink()) throw new ApiError(400, 'DRIVE_PATH_INVALID');
    if (st && !st.isDirectory()) throw new ApiError(409, 'DRIVE_EXISTS');
    if (!st) {
      await mkdir(cur);
      await setOwnership(ctx, space, cur, true);
      created.push({ space, path: curApi, action: 'create', actor: 'user' });
    }
  }
  await recordEvents(ctx, created);
  return resolveInside(root, rel);
}

/** Applies ownership to a whole tree after copy/move (cross-space moves change the owner). */
export async function ownTree(ctx: DriveContext, space: Space, abs: string) {
  const st = await lstat(abs);
  await setOwnership(ctx, space, abs, st.isDirectory());
  if (!st.isDirectory()) return;
  for (const e of await readdir(abs, { withFileTypes: true })) {
    if (!e.isSymbolicLink()) await ownTree(ctx, space, path.join(abs, e.name));
  }
}

/** Total bytes under a directory (no symlink following). */
export async function du(abs: string): Promise<number> {
  const st = await lstat(abs).catch(() => null);
  if (!st || st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const e of await readdir(abs)) total += await du(path.join(abs, e));
  return total;
}

const usageCache = new Map<string, { at: number; bytes: number }>();
/** Team drive + trash usage, cached for a minute (04-api.md drive/usage). */
export async function teamUsage(team: string, fresh = false): Promise<number> {
  const hit = usageCache.get(team);
  if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.bytes;
  const bytes = (await du(teamDriveDir(team))) + (await du(teamTrashDir(team)));
  usageCache.set(team, { at: Date.now(), bytes });
  return bytes;
}
export const bumpUsage = (team: string, delta: number) => {
  const hit = usageCache.get(team);
  if (hit) hit.bytes = Math.max(0, hit.bytes + delta);
};

export const moveFs = async (from: string, to: string) => {
  try {
    await rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await cp(from, to, { recursive: true, verbatimSymlinks: true, errorOnExist: true });
    await rm(from, { recursive: true, force: true });
  }
};

// ── records ──

export interface RecordInput {
  space: Space;
  path: string;
  action: 'create' | 'update' | 'rename' | 'move' | 'copy' | 'trash' | 'restore' | 'delete';
  prevPath?: string | null;
  actor: 'user' | 'agent' | 'system';
}

export async function recordEvents(ctx: DriveContext, events: RecordInput[]) {
  if (events.length === 0) return;
  await db.insert(driveEvents).values(events.map((e) => ({
    teamId: ctx.team.id,
    space: e.space,
    ownerUserId: e.space === 'me' ? ctx.userId : null,
    path: e.path,
    prevPath: e.prevPath ?? null,
    action: e.action,
    actorKind: e.actor,
    actorUserId: e.actor === 'user' ? ctx.userId : null,
  })));
}

const spaceWhere = (ctx: DriveContext, space: Space) =>
  space === 'me'
    ? and(eq(driveEvents.teamId, ctx.team.id), eq(driveEvents.space, 'me'), eq(driveEvents.ownerUserId, ctx.userId))
    : and(eq(driveEvents.teamId, ctx.team.id), eq(driveEvents.space, 'shared'));

/** After a move/rename, history follows the item: rewrite `path` of it and everything below. */
export async function rewriteEventPaths(ctx: DriveContext, from: { space: Space; path: string }, to: { space: Space; path: string }) {
  const len = from.path.length;
  await db.update(driveEvents).set({
    // ::int matters: an untyped parameter makes Postgres pick the regex form of substring().
    path: sql`${to.path} || substring(${driveEvents.path} from ${len + 1}::int)`,
    space: to.space,
    ownerUserId: to.space === 'me' ? ctx.userId : null,
  }).where(and(
    spaceWhere(ctx, from.space),
    or(eq(driveEvents.path, from.path), like(driveEvents.path, `${from.path.replace(/[%_\\]/g, '\\$&')}/%`)),
  ));
}

export interface Actor { kind: 'user' | 'agent' | 'system'; user: { id: string; name: string; email: string; departmentName: string | null } | null }

async function actorsFor(rows: { actorKind: string; actorUserId: string | null }[]) {
  const ids = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))];
  const people = ids.length
    ? await db.select({ id: users.id, name: users.name, email: users.email, departmentName: departments.name })
      .from(users).leftJoin(departments, eq(departments.id, users.departmentId)).where(inArray(users.id, ids))
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  return (r: { actorKind: string; actorUserId: string | null }): Actor => ({
    kind: r.actorKind as Actor['kind'],
    user: r.actorUserId ? byId.get(r.actorUserId) ?? null : null,
  });
}

/** "만든 사람" for many paths: the earliest create/copy event per path (03-data-model.md). */
export async function creatorsFor(ctx: DriveContext, space: Space, paths: string[]) {
  if (paths.length === 0) return new Map<string, Actor>();
  const rows = await db.selectDistinctOn([driveEvents.path], {
    path: driveEvents.path, actorKind: driveEvents.actorKind, actorUserId: driveEvents.actorUserId, createdAt: driveEvents.createdAt,
  }).from(driveEvents)
    .where(and(spaceWhere(ctx, space), inArray(driveEvents.path, paths), inArray(driveEvents.action, ['create', 'copy'])))
    .orderBy(driveEvents.path, asc(driveEvents.createdAt));
  const toActor = await actorsFor(rows);
  return new Map(rows.map((r) => [r.path, toActor(r)]));
}

export async function historyFor(ctx: DriveContext, space: Space, p: string) {
  const rows = await db.select().from(driveEvents)
    .where(and(spaceWhere(ctx, space), eq(driveEvents.path, p)))
    .orderBy(desc(driveEvents.createdAt), desc(driveEvents.id)).limit(50);
  const toActor = await actorsFor(rows);
  return rows.map((r) => ({ action: r.action, actor: toActor(r), path: r.path, prevPath: r.prevPath, at: r.createdAt.toISOString() }));
}

/**
 * Lazy reconcile (docs/README.md 4단계 ⚠️ 해소): files in the shared space that changed outside the
 * API (agents, sandboxes) get `create`/`update` events with actor `agent`.
 */
export async function reconcile(ctx: DriveContext, space: Space, entries: { path: string; isDir: boolean; mtimeMs: number }[]) {
  if (space !== 'shared') return;
  // Folders only get a `create` (their mtime changes whenever a child does).
  const files = entries;
  if (files.length === 0) return;
  const last = await db.select({ path: driveEvents.path, at: sql<Date>`max(${driveEvents.createdAt})` })
    .from(driveEvents)
    .where(and(spaceWhere(ctx, space), inArray(driveEvents.path, files.map((f) => f.path))))
    .groupBy(driveEvents.path);
  const lastAt = new Map(last.map((r) => [r.path, new Date(r.at).getTime()]));
  const events: RecordInput[] = [];
  for (const f of files) {
    const seen = lastAt.get(f.path);
    if (seen === undefined) events.push({ space, path: f.path, action: 'create', actor: 'agent' });
    else if (f.isDir) continue;
    // 2 s slack: API writes record their event right after writing the file.
    else if (f.mtimeMs > seen + 2000) events.push({ space, path: f.path, action: 'update', actor: 'agent' });
  }
  await recordEvents(ctx, events);
}

export interface Entry {
  name: string;
  path: string;
  space: Space;
  isDir: boolean;
  size: number;
  mimeType: string;
  modifiedAt: string;
  createdBy: Actor | null;
}

/** Lists a folder (symbolic links are hidden), reconciling agent writes first. */
export async function listDir(ctx: DriveContext, space: Space, apiPath: string): Promise<Entry[]> {
  const root = await ensureSpace(ctx, space);
  const dirAbs = await resolveInside(root, apiPath);
  if (!(await stat(dirAbs)).isDirectory()) throw new ApiError(400, 'DRIVE_PATH_INVALID');
  const dir = normalizePath(apiPath);
  const raw: { name: string; path: string; isDir: boolean; size: number; mtimeMs: number }[] = [];
  for (const d of await readdir(dirAbs, { withFileTypes: true })) {
    if (d.isSymbolicLink() || (!d.isFile() && !d.isDirectory())) continue;
    const st = await lstat(path.join(dirAbs, d.name)).catch(() => null);
    if (!st) continue;
    raw.push({ name: d.name, path: joinPath(dir, d.name), isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtimeMs: st.mtimeMs });
  }
  await reconcile(ctx, space, raw);
  const creators = await creatorsFor(ctx, space, raw.map((r) => r.path));
  return raw
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, 'ko'))
    .map((r) => ({
      name: r.name, path: r.path, space, isDir: r.isDir, size: r.size,
      mimeType: r.isDir ? 'inode/directory' : mimeOf(r.name),
      modifiedAt: new Date(r.mtimeMs).toISOString(),
      createdBy: creators.get(r.path) ?? null,
    }));
}

export async function entryFor(ctx: DriveContext, space: Space, apiPath: string): Promise<Entry> {
  const root = await ensureSpace(ctx, space);
  const abs = await resolveInside(root, apiPath);
  const st = await lstat(abs);
  const p = normalizePath(apiPath);
  const creators = await creatorsFor(ctx, space, [p]);
  return {
    name: p === '/' ? '' : baseName(p), path: p, space, isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size,
    mimeType: st.isDirectory() ? 'inode/directory' : mimeOf(baseName(p)),
    modifiedAt: st.mtime.toISOString(), createdBy: creators.get(p) ?? null,
  };
}

/** Name search in a whole space (max 200, breadth-first, no symlinks). */
export async function searchSpace(ctx: DriveContext, space: Space, q: string): Promise<Entry[]> {
  const root = await ensureSpace(ctx, space);
  const needle = q.toLowerCase();
  const found: { name: string; path: string; isDir: boolean; size: number; mtimeMs: number }[] = [];
  const queue = ['/'];
  while (queue.length && found.length < 200) {
    const dir = queue.shift()!;
    const abs = path.join(root, dir);
    for (const d of await readdir(abs, { withFileTypes: true }).catch(() => [])) {
      if (d.isSymbolicLink()) continue;
      const p = joinPath(dir, d.name);
      if (d.isDirectory()) queue.push(p);
      if (d.name.toLowerCase().includes(needle)) {
        const st = await lstat(path.join(abs, d.name)).catch(() => null);
        if (st) found.push({ name: d.name, path: p, isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtimeMs: st.mtimeMs });
        if (found.length >= 200) break;
      }
    }
  }
  const creators = await creatorsFor(ctx, space, found.map((f) => f.path));
  return found.map((r) => ({
    name: r.name, path: r.path, space, isDir: r.isDir, size: r.size,
    mimeType: r.isDir ? 'inode/directory' : mimeOf(r.name), modifiedAt: new Date(r.mtimeMs).toISOString(),
    createdBy: creators.get(r.path) ?? null,
  }));
}
