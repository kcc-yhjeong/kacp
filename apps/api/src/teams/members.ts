import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { checkName, TEAM_ROLES, type TeamRole } from '@kacp/shared';
import { requireAuth } from '../auth/guards.js';
import { audit } from '../audit.js';
import { db } from '../db/client.js';
import { departments, memberships, names, teamPresence, teams, users } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import { getSetting } from '../settings.js';
import { invalidateTeamCaches } from './lookup.js';
import { scheduleApply } from './runtime.js';

// Member management (`팀관리`: the team's admins, plus platform admins for these management APIs —
// 06-auth.md §7) and the name availability check.

type TeamReq = FastifyRequest<{ Params: { team: string } }>;

async function managedTeam(req: TeamReq) {
  const [t] = await db.select().from(teams).where(and(eq(teams.name, req.params.team), isNull(teams.deletedAt)));
  if (!t) throw new ApiError(404, 'TEAM_NOT_FOUND');
  if (req.session!.user.platformRole === 'admin') return t;
  const [m] = await db.select({ role: memberships.teamRole }).from(memberships)
    .where(and(eq(memberships.teamId, t.id), eq(memberships.userId, req.session!.user.id)));
  if (m?.role !== 'team_admin') throw new ApiError(403, 'FORBIDDEN');
  return t;
}

async function memberOut(teamId: string, userId: string) {
  const [r] = await db
    .select({ id: users.id, name: users.name, email: users.email, departmentName: departments.name, teamRole: memberships.teamRole, addedAt: memberships.createdAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .where(and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)));
  if (!r) throw new ApiError(404, 'USER_NOT_FOUND');
  return { user: { id: r.id, name: r.name, email: r.email, departmentName: r.departmentName }, teamRole: r.teamRole as TeamRole, addedAt: r.addedAt.toISOString() };
}

async function adminCount(teamId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(memberships)
    .where(and(eq(memberships.teamId, teamId), eq(memberships.teamRole, 'team_admin')));
  return r?.n ?? 0;
}

export async function memberRoutes(app: FastifyInstance) {
  app.post('/api/v1/teams/:team/members', { preHandler: requireAuth }, async (req: TeamReq, reply) => {
    const body = z.object({
      email: z.email().optional(),
      userIds: z.array(z.uuid()).max(500).optional(),
      teamRole: z.enum(TEAM_ROLES).default('member'),
    }).refine((b) => b.email || b.userIds?.length).parse(req.body);
    const t = await managedTeam(req);
    const targets = body.email
      ? await db.select({ id: users.id }).from(users).where(eq(users.email, body.email.toLowerCase()))
      : await db.select({ id: users.id }).from(users).where(inArray(users.id, body.userIds!));
    if (targets.length === 0) throw new ApiError(404, 'USER_NOT_FOUND');
    const added: string[] = [];
    for (const { id } of targets) {
      const r = await db.insert(memberships).values({ teamId: t.id, userId: id, teamRole: body.teamRole, addedBy: req.session!.user.id })
        .onConflictDoNothing().returning();
      if (r.length === 0) continue;
      added.push(id);
      await audit({ actorId: req.session!.user.id, action: 'membership.add', targetType: 'team', targetId: t.id, teamId: t.id, detail: { userId: id, teamRole: body.teamRole } });
    }
    if (body.email && added.length === 0) throw new ApiError(409, 'MEMBER_EXISTS');
    invalidateTeamCaches();
    if (body.teamRole === 'team_admin') void scheduleApply(t.name);
    return reply.code(201).send(added.length === 1 ? await memberOut(t.id, added[0]!) : { added: added.length });
  });

  app.patch('/api/v1/teams/:team/members/:userId', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { team: string; userId: string } }>) => {
      const { teamRole } = z.object({ teamRole: z.enum(TEAM_ROLES) }).parse(req.body);
      const t = await managedTeam(req);
      const before = await memberOut(t.id, req.params.userId);
      if (before.teamRole === teamRole) return before;
      if (before.teamRole === 'team_admin' && (await adminCount(t.id)) <= 1) throw new ApiError(409, 'LAST_TEAM_ADMIN');
      await db.update(memberships).set({ teamRole })
        .where(and(eq(memberships.teamId, t.id), eq(memberships.userId, req.params.userId)));
      await audit({ actorId: req.session!.user.id, action: 'membership.role_change', targetType: 'team', targetId: t.id, teamId: t.id, detail: { userId: req.params.userId, from: before.teamRole, to: teamRole } });
      invalidateTeamCaches();
      // Both sides must change: forward-auth (scope cap) and identityScopes (06-auth.md §5).
      void scheduleApply(t.name);
      return memberOut(t.id, req.params.userId);
    });

  app.delete('/api/v1/teams/:team/members/:userId', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { team: string; userId: string } }>, reply) => {
      const t = await managedTeam(req);
      const before = await memberOut(t.id, req.params.userId);
      if (before.teamRole === 'team_admin' && (await adminCount(t.id)) <= 1) throw new ApiError(409, 'LAST_TEAM_ADMIN');
      await db.delete(memberships).where(and(eq(memberships.teamId, t.id), eq(memberships.userId, req.params.userId)));
      await db.delete(teamPresence).where(and(eq(teamPresence.teamId, t.id), eq(teamPresence.userId, req.params.userId)));
      await audit({ actorId: req.session!.user.id, action: 'membership.remove', targetType: 'team', targetId: t.id, teamId: t.id, detail: { userId: req.params.userId } });
      invalidateTeamCaches();
      if (before.teamRole === 'team_admin') void scheduleApply(t.name);
      return reply.code(204).send();
    });

  app.get('/api/v1/names/check', { preHandler: requireAuth }, async (req) => {
    const { name } = z.object({ name: z.string() }).parse(req.query);
    const problem = checkName(name, await getSetting('names.reserved_extra'));
    if (problem) return { available: false, reason: problem };
    const [taken] = await db.select().from(names).where(eq(names.name, name));
    if (taken) return { available: false, reason: taken.kind === 'reserved' ? 'NAME_RESERVED' : 'NAME_TAKEN' };
    return { available: true, reason: null };
  });
}
