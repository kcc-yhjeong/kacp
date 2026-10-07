import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { TEAM_ROLES, type TeamRole } from '@kacp/shared';
import { requirePlatformAdmin } from '../auth/guards.js';
import { audit } from '../audit.js';
import { teamUrl } from '../config.js';
import { db } from '../db/client.js';
import {
  agentTemplates, departments, memberships, names, teamAgents, teamPresence, teams, usageSamples, users,
} from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import { orchestrator } from '../orchestrator.js';
import { getSetting } from '../settings.js';
import { invalidateTeamCaches } from '../teams/lookup.js';
import {
  requestRestart, requestStart, requestStop, scheduleApply, teamStatus,
} from '../teams/runtime.js';
import { createTeam } from './service.js';
import { ensureInstalled } from '../mcp/service.js';
import { notify, teamMemberIds } from '../notify/service.js';
import { restartTeamsForKeyChange } from '../teams/runtime.js';

// A-04 / A-05 team administration (04-api.md 관리자).

type TeamRow = typeof teams.$inferSelect;
const Limits = z.object({ cpu: z.number().positive().max(64), memoryMb: z.number().int().min(256).max(262144), diskGb: z.number().int().min(1).max(4096) });

export async function loadTeam(name: string): Promise<TeamRow> {
  const [t] = await db.select().from(teams).where(and(eq(teams.name, name), isNull(teams.deletedAt)));
  if (!t) throw new ApiError(404, 'TEAM_NOT_FOUND');
  return t;
}

async function adminTeams(rows: TeamRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((t) => t.id);
  const ms = await db
    .select({ teamId: memberships.teamId, role: memberships.teamRole, id: users.id, name: users.name, email: users.email, departmentName: departments.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .where(inArray(memberships.teamId, ids));
  const agentCounts = await db.select({ teamId: teamAgents.teamId, n: sql<number>`count(*)::int` })
    .from(teamAgents).where(inArray(teamAgents.teamId, ids)).groupBy(teamAgents.teamId);
  const defaults = await getSetting('limits.team_default');
  return Promise.all(rows.map(async (t) => ({
    name: t.name,
    displayName: t.displayName,
    memberCount: ms.filter((m) => m.teamId === t.id).length,
    admins: ms.filter((m) => m.teamId === t.id && m.role === 'team_admin')
      .map(({ id, name, email, departmentName }) => ({ id, name, email, departmentName })),
    agentCount: agentCounts.find((a) => a.teamId === t.id)?.n ?? 0,
    status: await teamStatus(t),
    provisionStage: t.provisionStage,
    resourceLimits: t.resourceLimits ?? defaults,
    createdAt: t.createdAt.toISOString(),
  })));
}

export async function teamAgentList(teamId: string) {
  const rows = await db.select({ ta: teamAgents, t: agentTemplates })
    .from(teamAgents).innerJoin(agentTemplates, eq(agentTemplates.id, teamAgents.templateId))
    .where(eq(teamAgents.teamId, teamId)).orderBy(teamAgents.createdAt);
  return rows.map(({ ta, t }) => ({
    template: { id: t.id, name: t.name, icon: t.icon, description: t.description, version: t.version },
    templateVersion: t.version,
    appliedVersion: ta.appliedVersion,
    // A template edited after its last apply is pending again for this team.
    applyStatus: ta.applyStatus === 'applied' && ta.appliedVersion !== t.version ? 'pending' : ta.applyStatus,
    applyError: ta.applyError,
    appliedAt: ta.appliedAt?.toISOString() ?? null,
  }));
}

async function teamMembers(teamId: string) {
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, departmentName: departments.name, teamRole: memberships.teamRole, addedAt: memberships.createdAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .where(eq(memberships.teamId, teamId))
    .orderBy(users.name);
  return rows.map((r) => ({
    user: { id: r.id, name: r.name, email: r.email, departmentName: r.departmentName },
    teamRole: r.teamRole as TeamRole,
    addedAt: r.addedAt.toISOString(),
  }));
}

type TeamReq = FastifyRequest<{ Params: { team: string } }>;
const actor = (req: FastifyRequest) => req.session!.user.id;

export async function adminTeamRoutes(app: FastifyInstance) {
  app.get('/api/v1/admin/teams', { preHandler: requirePlatformAdmin }, async (req) => {
    const { q } = z.object({ q: z.string().trim().optional() }).parse(req.query);
    const where = [isNull(teams.deletedAt)];
    if (q) where.push(or(ilike(teams.name, `%${q}%`), ilike(teams.displayName, `%${q}%`))!);
    const rows = await db.select().from(teams).where(and(...where)).orderBy(teams.name);
    return { items: await adminTeams(rows) };
  });

  app.post('/api/v1/admin/teams', { preHandler: requirePlatformAdmin }, async (req, reply) => {
    const body = z.object({
      name: z.string().trim(),
      displayName: z.string().trim().min(1).max(60),
      adminEmails: z.array(z.email()).min(1),
      memberUserIds: z.array(z.uuid()).default([]),
      resourceLimits: Limits.optional(),
    }).parse(req.body);
    await createTeam({
      name: body.name,
      displayName: body.displayName,
      admins: body.adminEmails,
      memberUserIds: body.memberUserIds,
      resourceLimits: body.resourceLimits ?? null,
    }, actor(req));
    const [out] = await adminTeams([await loadTeam(body.name)]);
    return reply.code(202).send(out);
  });

  app.get('/api/v1/admin/teams/:team', { preHandler: requirePlatformAdmin }, async (req: TeamReq) => {
    const t = await loadTeam(req.params.team);
    const [base] = await adminTeams([t]);
    const [latest] = await db.select().from(usageSamples)
      .where(and(eq(usageSamples.targetType, 'team'), eq(usageSamples.targetId, t.name)))
      .orderBy(desc(usageSamples.ts)).limit(1);
    return {
      ...base,
      url: teamUrl(t.name),
      members: await teamMembers(t.id),
      agents: await teamAgentList(t.id),
      usage: latest ? { cpuPct: latest.cpuPct, memBytes: latest.memBytes, diskBytes: latest.diskBytes ?? 0 } : null,
      mcpInstalls: [],
      apps: [],
    };
  });

  app.patch('/api/v1/admin/teams/:team', { preHandler: requirePlatformAdmin }, async (req: TeamReq) => {
    const { displayName } = z.object({ displayName: z.string().trim().min(1).max(60) }).parse(req.body);
    const t = await loadTeam(req.params.team);
    await db.update(teams).set({ displayName, updatedAt: sql`now()` }).where(eq(teams.id, t.id));
    await audit({ actorId: actor(req), action: 'team.update', targetType: 'team', targetId: t.id, teamId: t.id, detail: { displayName: [t.displayName, displayName] } });
    const [out] = await adminTeams([await loadTeam(t.name)]);
    return out;
  });

  app.delete('/api/v1/admin/teams/:team', { preHandler: requirePlatformAdmin }, async (req: TeamReq, reply) => {
    const { confirmName } = z.object({ confirmName: z.string() }).parse(req.body);
    const t = await loadTeam(req.params.team);
    if (confirmName !== t.name) throw new ApiError(422, 'TEAM_CONFIRM_MISMATCH');
    await db.transaction(async (tx) => {
      await tx.update(teams).set({ deletedAt: sql`now()`, containerStatus: 'stopping', containerStatusAt: sql`now()` }).where(eq(teams.id, t.id));
      // Free the name for reuse (05 §3 namespace); the team row keeps its history.
      await tx.delete(names).where(and(eq(names.name, t.name), eq(names.kind, 'team')));
      await tx.delete(teamPresence).where(eq(teamPresence.teamId, t.id));
      await tx.delete(teamAgents).where(eq(teamAgents.teamId, t.id));
      await tx.delete(memberships).where(eq(memberships.teamId, t.id));
      await audit({ actorId: actor(req), action: 'team.delete', targetType: 'team', targetId: t.id, teamId: t.id, detail: { name: t.name } }, tx);
    });
    invalidateTeamCaches();
    void orchestrator.remove(t.name).catch((err) => req.log.error({ err, team: t.name }, 'team remove failed'));
    return reply.code(202).send();
  });

  app.post('/api/v1/admin/teams/:team/container/:action', { preHandler: requirePlatformAdmin },
    async (req: FastifyRequest<{ Params: { team: string; action: string } }>, reply) => {
      const action = z.enum(['start', 'stop', 'restart']).parse(req.params.action);
      const t = await loadTeam(req.params.team);
      const ok = action === 'start' ? await requestStart(t) : action === 'stop' ? await requestStop(t) : await requestRestart(t);
      if (!ok) throw new ApiError(409, 'VALIDATION_FAILED', { status: t.containerStatus }, '지금 상태에서는 할 수 없어요.');
      await audit({ actorId: actor(req), action: `container.${action}`, targetType: 'team', targetId: t.id, teamId: t.id });
      return reply.code(202).send(await teamStatus(await loadTeam(t.name)));
    });

  app.put('/api/v1/admin/teams/:team/resources', { preHandler: requirePlatformAdmin }, async (req: TeamReq) => {
    const limits = Limits.parse(req.body);
    const t = await loadTeam(req.params.team);
    await db.update(teams).set({ resourceLimits: limits, updatedAt: sql`now()` }).where(eq(teams.id, t.id));
    // Applied immediately to a running container; otherwise at its next start.
    if (t.containerStatus === 'running') await orchestrator.resources(t.name, limits);
    await audit({ actorId: actor(req), action: 'resources.update', targetType: 'team', targetId: t.id, teamId: t.id, detail: { before: t.resourceLimits, after: limits } });
    return limits;
  });

  app.get('/api/v1/admin/teams/:team/agents', { preHandler: requirePlatformAdmin }, async (req: TeamReq) => {
    const t = await loadTeam(req.params.team);
    return { items: await teamAgentList(t.id) };
  });

  app.post('/api/v1/admin/teams/:team/agents', { preHandler: requirePlatformAdmin }, async (req: TeamReq, reply) => {
    const { templateIds } = z.object({ templateIds: z.array(z.uuid()).min(1).max(20) }).parse(req.body);
    const t = await loadTeam(req.params.team);
    const found = await db.select({ id: agentTemplates.id }).from(agentTemplates).where(inArray(agentTemplates.id, templateIds));
    if (found.length !== new Set(templateIds).size) throw new ApiError(404, 'TEMPLATE_NOT_FOUND');
    for (const templateId of templateIds) {
      const added = await db.insert(teamAgents).values({ teamId: t.id, templateId, assignedBy: actor(req) })
        .onConflictDoNothing().returning();
      if (added.length) await audit({ actorId: actor(req), action: 'agent.assign', targetType: 'template', targetId: templateId, teamId: t.id });
    }
    // Template default MCPs (A-06) are installed into the team if missing (docs/README.md 6단계).
    const specs = await db.select({ id: agentTemplates.id, spec: agentTemplates.spec, keyEnc: agentTemplates.modelKeyEnc }).from(agentTemplates).where(inArray(agentTemplates.id, templateIds));
    const defaultMcp = [...new Set(specs.flatMap((s) => (s.spec as { defaultMcp?: string[] }).defaultMcp ?? []))];
    if (defaultMcp.length) await ensureInstalled(t, defaultMcp).catch((err) => req.log.warn({ err }, 'template default mcp'));
    void scheduleApply(t.name);
    void notify(await teamMemberIds(t.id), { type: 'agent_assignment_changed', title: `${t.name} 팀에 에이전트가 추가됐어요`, link: teamUrl(t.name) }, actor(req));
    // A template key reaches the team as container env: restart once if any assigned template has one.
    const keyed = specs.find((s) => s.keyEnc);
    if (keyed) void restartTeamsForKeyChange(keyed.id, t.id);
    return reply.code(202).send({ items: await teamAgentList(t.id) });
  });

  app.delete('/api/v1/admin/teams/:team/agents/:templateId', { preHandler: requirePlatformAdmin },
    async (req: FastifyRequest<{ Params: { team: string; templateId: string } }>, reply) => {
      const t = await loadTeam(req.params.team);
      const [tpl] = await db.select({ keyEnc: agentTemplates.modelKeyEnc }).from(agentTemplates).where(eq(agentTemplates.id, req.params.templateId));
      const removed = await db.delete(teamAgents)
        .where(and(eq(teamAgents.teamId, t.id), eq(teamAgents.templateId, req.params.templateId))).returning();
      if (removed.length === 0) throw new ApiError(404, 'TEMPLATE_NOT_FOUND');
      await audit({ actorId: actor(req), action: 'agent.unassign', targetType: 'template', targetId: req.params.templateId, teamId: t.id });
      void scheduleApply(t.name);
      void notify(await teamMemberIds(t.id), { type: 'agent_assignment_changed', title: `${t.name} 팀 에이전트 하나가 빠졌어요`, link: teamUrl(t.name) }, actor(req));
      if (tpl?.keyEnc) void restartTeamsForKeyChange(req.params.templateId, t.id);
      return reply.code(202).send();
    });
}

export { TEAM_ROLES };
