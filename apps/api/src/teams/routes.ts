import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import type { Member, TeamDetail, TeamRole } from '@kacp/shared';
import { teamUrl } from '../config.js';
import { requireAuth } from '../auth/guards.js';
import { db } from '../db/client.js';
import { departments, memberships, names, teams, users } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import { getSetting } from '../settings.js';
import { requestStart, teamStatus, touchPresence } from './runtime.js';

/** `멤버` guard: the team's members only. Platform admins who are not members are refused here (06-auth.md §7). */
async function memberOf(req: FastifyRequest<{ Params: { team: string } }>) {
  const [t] = await db.select().from(teams).where(and(eq(teams.name, req.params.team), isNull(teams.deletedAt)));
  if (!t) throw new ApiError(404, 'TEAM_NOT_FOUND');
  const [m] = await db
    .select({ role: memberships.teamRole })
    .from(memberships)
    .where(and(eq(memberships.teamId, t.id), eq(memberships.userId, req.session!.user.id)));
  if (!m) throw new ApiError(403, 'FORBIDDEN');
  return { team: t, role: m.role as TeamRole };
}

type TeamReq = FastifyRequest<{ Params: { team: string } }>;

export async function teamRoutes(app: FastifyInstance) {
  app.get('/api/v1/teams/:team', { preHandler: requireAuth }, async (req: TeamReq): Promise<TeamDetail> => {
    const { team, role } = await memberOf(req);
    return {
      name: team.name,
      displayName: team.displayName,
      url: teamUrl(team.name),
      myRole: role,
      status: await teamStatus(team),
      agents: [],
      resourceLimits: team.resourceLimits ?? (await getSetting('limits.team_default')),
    };
  });

  app.get('/api/v1/teams/:team/status', { preHandler: requireAuth }, async (req: TeamReq) => {
    const { team } = await memberOf(req);
    return teamStatus(team);
  });

  // Shell entry: register presence and make sure the container is (being) started.
  app.post('/api/v1/teams/:team/session', { preHandler: requireAuth }, async (req: TeamReq, reply) => {
    const { team } = await memberOf(req);
    await touchPresence(team, req.session!.sessionId, req.session!.user.id);
    if (team.containerStatus === 'running') return teamStatus(team);
    await requestStart(team);
    const [fresh] = await db.select().from(teams).where(eq(teams.id, team.id));
    return reply.code(202).send(await teamStatus(fresh ?? team));
  });

  app.post('/api/v1/teams/:team/heartbeat', { preHandler: requireAuth }, async (req: TeamReq, reply) => {
    const { team } = await memberOf(req);
    await touchPresence(team, req.session!.sessionId, req.session!.user.id);
    return reply.code(204).send();
  });

  app.get('/api/v1/teams/:team/members', { preHandler: requireAuth }, async (req: TeamReq) => {
    const { team } = await memberOf(req);
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        departmentName: departments.name,
        teamRole: memberships.teamRole,
        addedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(eq(memberships.teamId, team.id))
      .orderBy(users.name);
    const items: Member[] = rows.map((r) => ({
      user: { id: r.id, name: r.name, email: r.email, departmentName: r.departmentName },
      teamRole: r.teamRole as TeamRole,
      addedAt: r.addedAt.toISOString(),
    }));
    return { items };
  });

  // Host classification for the web 404 screen (no auth, minimal info).
  app.get('/api/v1/names/:name', async (req: FastifyRequest<{ Params: { name: string } }>) => {
    const [n] = await db.select().from(names).where(eq(names.name, req.params.name));
    if (n?.kind === 'team') {
      const [t] = await db.select().from(teams).where(and(eq(teams.name, n.name), isNull(teams.deletedAt)));
      if (t) return { hostKind: 'team', running: t.containerStatus === 'running' };
    }
    if (n?.kind === 'public_app') return { hostKind: 'public_app', running: false };
    return { hostKind: 'none', running: false };
  });
}
