import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { LoginRequest, passwordProblems, PasswordChangeRequest, type Me, type MyTeam, type TeamRole } from '@kacp/shared';
import { config, teamUrl } from '../config.js';
import { db } from '../db/client.js';
import { departments, memberships, sessions, teams, users } from '../db/schema.js';
import { csrfTokenFor } from '../lib/crypto.js';
import { ApiError } from '../lib/errors.js';
import { hashPassword, verifyDummy, verifyPassword } from '../lib/password.js';
import { requireAuth } from './guards.js';
import { isLocked, recordAttempt } from './rate-limit.js';
import {
  createSession, invalidateUser, revokeSession, revokeUserSessions, SESSION_COOKIE,
} from './session.js';

const COOKIE_MAX_AGE_S = 7 * 24 * 60 * 60;

function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    domain: `.${config.baseDomain}`,
    path: '/',
    httpOnly: true,
    secure: config.scheme === 'https',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_S,
  });
}

function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { domain: `.${config.baseDomain}`, path: '/' });
}

async function loadMe(userId: string, sessionId: string): Promise<Me> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new ApiError(401, 'AUTH_REQUIRED');
  let department: Me['department'] = null;
  if (u.departmentId) {
    const [d] = await db.select().from(departments).where(eq(departments.id, u.departmentId));
    if (d) {
      const chain = await db
        .select({ name: departments.name })
        .from(departments)
        .where(sql`${departments.path} @> ${d.path}::ltree`)
        .orderBy(departments.depth);
      department = { id: d.id, code: d.code, name: d.name, pathNames: chain.map((c) => c.name) };
    }
  }
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    platformRole: u.platformRole as Me['platformRole'],
    department,
    title: u.title,
    mustChangePassword: u.mustChangePassword,
    csrfToken: csrfTokenFor(sessionId),
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/v1/auth/login', async (req, reply) => {
    const body = LoginRequest.parse(req.body);
    const ip = req.ip ?? null;

    // Locked: same response whether or not the password is right (06-auth.md §4).
    if (await isLocked(body.email, ip)) {
      await verifyDummy(body.password);
      throw new ApiError(429, 'AUTH_LOCKED');
    }

    const [u] = await db.select().from(users).where(eq(users.email, body.email));
    const ok = u?.passwordHash ? await verifyPassword(u.passwordHash, body.password) : (await verifyDummy(body.password), false);
    // A disabled account is recorded as a failed attempt even with the right password.
    await recordAttempt(body.email, ip, ok && u?.status === 'active');
    if (!u || !ok) throw new ApiError(401, 'AUTH_INVALID_CREDENTIALS');
    if (u.status !== 'active') throw new ApiError(403, 'AUTH_DISABLED');

    const s = await createSession(u.id, ip, req.headers['user-agent'] ?? null);
    await db.update(users).set({ lastLoginAt: sql`now()` }).where(eq(users.id, u.id));
    setSessionCookie(reply, s.token);
    return loadMe(u.id, s.id);
  });

  app.post('/api/v1/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    await revokeSession(req.session!.sessionId);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get('/api/v1/auth/me', { preHandler: requireAuth }, async (req) =>
    loadMe(req.session!.user.id, req.session!.sessionId));

  app.post('/api/v1/auth/password', { preHandler: requireAuth }, async (req, reply) => {
    const body = PasswordChangeRequest.parse(req.body);
    const s = req.session!;
    const [u] = await db.select().from(users).where(eq(users.id, s.user.id));
    if (!u) throw new ApiError(401, 'AUTH_REQUIRED');

    // The setup-only session skips the current password; any other change must prove it.
    if (!u.mustChangePassword) {
      if (!body.currentPassword || !u.passwordHash || !(await verifyPassword(u.passwordHash, body.currentPassword))) {
        throw new ApiError(400, 'AUTH_CURRENT_PASSWORD_WRONG');
      }
    }
    const rules: string[] = passwordProblems(body.newPassword, u.email);
    if (u.passwordHash && (await verifyPassword(u.passwordHash, body.newPassword))) rules.push('not_previous');
    if (rules.length > 0) throw new ApiError(400, 'AUTH_PASSWORD_POLICY', { rules });

    await db.update(users).set({
      passwordHash: await hashPassword(body.newPassword),
      mustChangePassword: false,
      passwordChangedAt: sql`now()`,
      updatedAt: sql`now()`,
    }).where(eq(users.id, u.id));
    await revokeUserSessions(u.id, s.sessionId);
    invalidateUser(u.id);
    return reply.code(204).send();
  });

  app.get('/api/v1/me/teams', { preHandler: requireAuth }, async (req) => {
    const rows = await db
      .select({
        name: teams.name,
        displayName: teams.displayName,
        teamRole: memberships.teamRole,
        containerStatus: teams.containerStatus,
      })
      .from(memberships)
      .innerJoin(teams, eq(teams.id, memberships.teamId))
      .where(and(eq(memberships.userId, req.session!.user.id), isNull(teams.deletedAt)))
      .orderBy(teams.displayName);
    const items: MyTeam[] = rows.map((r) => ({
      ...r,
      teamRole: r.teamRole as TeamRole,
      containerStatus: r.containerStatus as MyTeam['containerStatus'],
      url: teamUrl(r.name),
    }));
    return { items };
  });

  app.get('/api/v1/me/sessions', { preHandler: requireAuth }, async (req) => {
    const rows = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, req.session!.user.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`)))
      .orderBy(desc(sessions.lastSeenAt));
    return {
      items: rows.map((r) => ({
        id: r.id,
        current: r.id === req.session!.sessionId,
        createdAt: r.createdAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
        ip: r.ip,
        userAgent: r.userAgent,
      })),
    };
  });

  app.delete('/api/v1/me/sessions', { preHandler: requireAuth }, async (req, reply) => {
    await revokeUserSessions(req.session!.user.id, req.session!.sessionId);
    return reply.code(204).send();
  });
}
