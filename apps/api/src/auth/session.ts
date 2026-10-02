import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { PlatformRole } from '@kacp/shared';
import { db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { newId, randomToken, sha256 } from '../lib/crypto.js';

// Session model (06-auth.md §3): random cookie value, SHA-256 in the DB, 12 h idle / 7 d absolute.

export const SESSION_COOKIE = 'kacp_session';
const IDLE_MS = 12 * 60 * 60 * 1000;
const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;
const CACHE_MS = 10 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  platformRole: PlatformRole;
  mustChangePassword: boolean;
}

export interface SessionContext {
  sessionId: string;
  user: SessionUser;
  /** First-login session: only password change, me and logout are allowed (06-auth.md §2). */
  setupOnly: boolean;
}

interface CacheEntry { ctx: SessionContext | null; at: number; lastSeenAt: number }
const cache = new Map<string, CacheEntry>();

export async function createSession(userId: string, ip: string | null, userAgent: string | null) {
  const token = randomToken();
  const id = newId();
  await db.insert(sessions).values({
    id,
    tokenHash: sha256(token),
    userId,
    expiresAt: new Date(Date.now() + ABSOLUTE_MS),
    ip,
    userAgent: userAgent?.slice(0, 500) ?? null,
  });
  return { id, token };
}

/** Resolves a cookie value to a live session. Cached for 10 s; revocation clears the cache. */
export async function resolveSession(token: string | undefined): Promise<SessionContext | null> {
  if (!token) return null;
  const key = sha256(token).toString('hex');
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) {
    if (hit.ctx) void touch(hit, now);
    return hit.ctx;
  }

  const [row] = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      platformRole: users.platformRole,
      status: users.status,
      mustChangePassword: users.mustChangePassword,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, sha256(token)));

  let ctx: SessionContext | null = null;
  if (
    row && !row.revokedAt && row.status === 'active' &&
    row.expiresAt.getTime() > now && now - row.lastSeenAt.getTime() < IDLE_MS
  ) {
    ctx = {
      sessionId: row.sessionId,
      user: {
        id: row.userId,
        email: row.email,
        name: row.name,
        platformRole: row.platformRole as PlatformRole,
        mustChangePassword: row.mustChangePassword,
      },
      setupOnly: row.mustChangePassword,
    };
  }
  const entry: CacheEntry = { ctx, at: now, lastSeenAt: row?.lastSeenAt.getTime() ?? now };
  cache.set(key, entry);
  if (ctx) void touch(entry, now);
  return ctx;
}

// last_seen_at is written at most once a minute per session.
async function touch(entry: CacheEntry, now: number) {
  if (!entry.ctx || now - entry.lastSeenAt < TOUCH_EVERY_MS) return;
  entry.lastSeenAt = now;
  await db.update(sessions).set({ lastSeenAt: new Date(now) }).where(eq(sessions.id, entry.ctx.sessionId));
}

export async function revokeSession(sessionId: string) {
  await db.update(sessions).set({ revokedAt: sql`now()` }).where(eq(sessions.id, sessionId));
  dropCached((ctx) => ctx.sessionId === sessionId);
}

/** Revokes every live session of a user, optionally keeping one (password change). */
export async function revokeUserSessions(userId: string, exceptSessionId?: string) {
  const where = exceptSessionId
    ? and(eq(sessions.userId, userId), isNull(sessions.revokedAt), ne(sessions.id, exceptSessionId))
    : and(eq(sessions.userId, userId), isNull(sessions.revokedAt));
  await db.update(sessions).set({ revokedAt: sql`now()` }).where(where);
  invalidateUser(userId);
}

/** Drops cached sessions of a user so the next request re-reads user state (role, status, password flag). */
export function invalidateUser(userId: string) {
  dropCached((ctx) => ctx.user.id === userId);
}

function dropCached(match: (ctx: SessionContext) => boolean) {
  for (const [key, entry] of cache) if (entry.ctx && match(entry.ctx)) cache.delete(key);
}
