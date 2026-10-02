import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { PLATFORM_ROLES, TEAM_ROLES, type TeamRole } from '@kacp/shared';
import { requireAuth, requirePlatformAdmin } from '../auth/guards.js';
import { invalidateUser, revokeUserSessions } from '../auth/session.js';
import { audit } from '../audit.js';
import { db } from '../db/client.js';
import { departments, loginAttempts, memberships, teamPresence, teams, users } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { bulkSetDepartment, departmentRefs, departmentScope } from '../org/service.js';
import { requestRestart, scheduleApply } from '../teams/runtime.js';
import { createUser, generatePassword } from './service.js';

// A-02 / A-03 user administration and /users/search (04-api.md §2).

type UserRow = typeof users.$inferSelect;

export async function toAdminUsers(rows: UserRow[]) {
  if (rows.length === 0) return [];
  const refs = await departmentRefs(rows.map((r) => r.departmentId));
  const ms = await db
    .select({ userId: memberships.userId, name: teams.name, teamRole: memberships.teamRole })
    .from(memberships)
    .innerJoin(teams, eq(teams.id, memberships.teamId))
    .where(and(inArray(memberships.userId, rows.map((r) => r.id)), isNull(teams.deletedAt)));
  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    department: (u.departmentId && refs.get(u.departmentId)) || null,
    title: u.title,
    employeeNo: u.employeeNo,
    platformRole: u.platformRole,
    status: u.status,
    mustChangePassword: u.mustChangePassword,
    teams: ms.filter((m) => m.userId === u.id).map((m) => ({ name: m.name, teamRole: m.teamRole as TeamRole })),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  }));
}

async function loadUser(id: string) {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) throw new ApiError(404, 'USER_NOT_FOUND');
  return u;
}

const ListQuery = z.object({
  q: z.string().trim().optional(),
  role: z.enum(PLATFORM_ROLES).optional(),
  status: z.enum(['active', 'disabled', 'must_change_password']).optional(),
  team: z.string().optional(),
  departmentId: z.uuid().optional(),
  includeDescendants: z.stringbool().default(true),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const CreateBody = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  name: z.string().trim().min(1).max(60),
  departmentId: z.uuid().optional(),
  title: z.string().trim().max(60).optional(),
  employeeNo: z.string().trim().max(40).optional(),
  platformRole: z.enum(PLATFORM_ROLES).default('user'),
  initialPassword: z.string().min(10).max(256).optional(),
  teams: z.array(z.object({ team: z.string(), teamRole: z.enum(TEAM_ROLES) })).default([]),
});

const PatchBody = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  departmentId: z.uuid().nullable().optional(),
  title: z.string().trim().max(60).nullable().optional(),
  employeeNo: z.string().trim().max(40).nullable().optional(),
  platformRole: z.enum(PLATFORM_ROLES).optional(),
});

type IdReq = FastifyRequest<{ Params: { userId: string } }>;

export async function adminUserRoutes(app: FastifyInstance) {
  app.get('/api/v1/admin/users', { preHandler: requirePlatformAdmin }, async (req) => {
    const q = ListQuery.parse(req.query);
    const where: SQL[] = [];
    if (q.q) where.push(or(ilike(users.name, `%${q.q}%`), ilike(users.email, `%${q.q}%`))!);
    if (q.role) where.push(eq(users.platformRole, q.role));
    if (q.status === 'must_change_password') where.push(and(eq(users.status, 'active'), eq(users.mustChangePassword, true))!);
    else if (q.status) where.push(eq(users.status, q.status));
    if (q.departmentId) where.push(inArray(users.departmentId, await departmentScope(q.departmentId, q.includeDescendants)));
    if (q.team) {
      where.push(inArray(users.id, db.select({ id: memberships.userId }).from(memberships)
        .innerJoin(teams, eq(teams.id, memberships.teamId)).where(eq(teams.name, q.team))));
    }
    // Keyset cursor over (created_at desc, id desc).
    if (q.cursor) {
      const [at, id] = Buffer.from(q.cursor, 'base64url').toString().split('|');
      if (at && id) where.push(or(lt(users.createdAt, new Date(at)), and(eq(users.createdAt, new Date(at)), lt(users.id, id)))!);
    }
    const rows = await db.select().from(users).where(and(...where))
      .orderBy(desc(users.createdAt), desc(users.id)).limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: await toAdminUsers(page),
      nextCursor: rows.length > q.limit && last
        ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString('base64url') : null,
    };
  });

  app.post('/api/v1/admin/users', { preHandler: requirePlatformAdmin }, async (req, reply) => {
    const body = CreateBody.parse(req.body);
    if (body.departmentId) {
      const [d] = await db.select({ status: departments.status }).from(departments).where(eq(departments.id, body.departmentId));
      if (!d) throw new ApiError(404, 'DEPARTMENT_NOT_FOUND');
      if (d.status !== 'active') throw new ApiError(422, 'DEPARTMENT_ARCHIVED');
    }
    const created = await createUser({
      email: body.email,
      name: body.name,
      departmentId: body.departmentId ?? null,
      title: body.title ?? null,
      employeeNo: body.employeeNo ?? null,
      platformRole: body.platformRole,
      password: body.initialPassword,
      teams: body.teams,
    }, req.session!.user.id);
    const [user] = await toAdminUsers([await loadUser(created.id)]);
    return reply.code(201).send({ user, initialPassword: created.initialPassword });
  });

  app.get('/api/v1/admin/users/:userId', { preHandler: requirePlatformAdmin }, async (req: IdReq) => {
    const u = await loadUser(req.params.userId);
    const [out] = await toAdminUsers([u]);
    const recent = await db.select().from(loginAttempts).where(eq(loginAttempts.email, u.email))
      .orderBy(desc(loginAttempts.createdAt)).limit(10);
    return { ...out, recentLogins: recent.map((r) => ({ at: r.createdAt.toISOString(), ip: r.ip, success: r.success })) };
  });

  app.patch('/api/v1/admin/users/:userId', { preHandler: requirePlatformAdmin }, async (req: IdReq) => {
    const body = PatchBody.parse(req.body);
    const before = await loadUser(req.params.userId);
    if (body.employeeNo && body.employeeNo !== before.employeeNo) {
      const [dup] = await db.select({ id: users.id }).from(users).where(eq(users.employeeNo, body.employeeNo));
      if (dup) throw new ApiError(409, 'USER_EMPLOYEE_NO_TAKEN');
    }
    if (body.departmentId) {
      const [d] = await db.select({ status: departments.status }).from(departments).where(eq(departments.id, body.departmentId));
      if (!d) throw new ApiError(404, 'DEPARTMENT_NOT_FOUND');
    }
    await db.update(users).set({ ...body, employeeNo: body.employeeNo === undefined ? undefined : body.employeeNo || null, updatedAt: sql`now()` })
      .where(eq(users.id, before.id));
    invalidateUser(before.id);
    const changed = Object.keys(body).filter((k) => (body as Record<string, unknown>)[k] !== (before as Record<string, unknown>)[k]);
    if (changed.length) {
      await audit({
        actorId: req.session!.user.id,
        action: body.departmentId !== undefined && body.departmentId !== before.departmentId ? 'user.department_change' : 'user.update',
        targetType: 'user', targetId: before.id, detail: { changed },
      });
    }
    const [out] = await toAdminUsers([await loadUser(before.id)]);
    return out;
  });

  app.post('/api/v1/admin/users/:userId/reset-password', { preHandler: requirePlatformAdmin }, async (req: IdReq) => {
    const u = await loadUser(req.params.userId);
    const temporaryPassword = generatePassword();
    await db.update(users).set({ passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, updatedAt: sql`now()` })
      .where(eq(users.id, u.id));
    await revokeUserSessions(u.id);
    await audit({ actorId: req.session!.user.id, action: 'user.reset_password', targetType: 'user', targetId: u.id });
    return { temporaryPassword };
  });

  app.post('/api/v1/admin/users/:userId/:action', { preHandler: requirePlatformAdmin },
    async (req: FastifyRequest<{ Params: { userId: string; action: string } }>) => {
      const action = z.enum(['disable', 'enable']).parse(req.params.action);
      const { restartTeams } = z.object({ restartTeams: z.boolean().default(false) }).parse(req.body ?? {});
      const u = await loadUser(req.params.userId);
      if (action === 'disable' && u.id === req.session!.user.id) throw new ApiError(422, 'FORBIDDEN');
      await db.update(users).set({ status: action === 'disable' ? 'disabled' : 'active', updatedAt: sql`now()` }).where(eq(users.id, u.id));
      const teamRows = await db.select({ t: teams }).from(memberships)
        .innerJoin(teams, eq(teams.id, memberships.teamId)).where(eq(memberships.userId, u.id));
      if (action === 'disable') {
        await revokeUserSessions(u.id);
        await db.delete(teamPresence).where(eq(teamPresence.userId, u.id));
        // Open Gateway WebSockets only see forward-auth at upgrade time; a restart cuts them (06-auth.md §5).
        if (restartTeams) for (const { t } of teamRows) if (t.containerStatus === 'running') await requestRestart(t);
      }
      invalidateUser(u.id);
      // Disabled team admins lose their identityScopes entry; re-enabled ones get it back.
      for (const { t } of teamRows) scheduleApply(t.name);
      await audit({
        actorId: req.session!.user.id, action: action === 'disable' ? 'user.disable' : 'user.enable',
        targetType: 'user', targetId: u.id, detail: action === 'disable' ? { restartTeams } : undefined,
      });
      const [out] = await toAdminUsers([await loadUser(u.id)]);
      return out;
    });

  app.post('/api/v1/admin/users/bulk-department', { preHandler: requirePlatformAdmin }, async (req, reply) => {
    const body = z.object({ userIds: z.array(z.uuid()).max(1000), departmentId: z.uuid() }).parse(req.body);
    await bulkSetDepartment(body.userIds, body.departmentId, req.session!.user.id);
    for (const id of body.userIds) invalidateUser(id);
    return reply.code(204).send();
  });

  // People search for member pickers (로그인 — U-15 and A-05 both use it).
  app.get('/api/v1/users/search', { preHandler: requireAuth }, async (req) => {
    const q = z.object({
      q: z.string().trim().optional(),
      departmentId: z.uuid().optional(),
      includeDescendants: z.stringbool().default(true),
    }).parse(req.query);
    const where: SQL[] = [eq(users.status, 'active')];
    if (q.q) where.push(or(ilike(users.name, `%${q.q}%`), ilike(users.email, `%${q.q}%`))!);
    if (q.departmentId) where.push(inArray(users.departmentId, await departmentScope(q.departmentId, q.includeDescendants)));
    const rows = await db.select({ id: users.id, name: users.name, email: users.email, departmentName: departments.name })
      .from(users).leftJoin(departments, eq(departments.id, users.departmentId))
      .where(and(...where)).orderBy(users.name).limit(20);
    return { items: rows };
  });

}
