import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { requirePlatformAdmin } from '../auth/guards.js';
import { AgentTemplateInputSchema } from '../agents/spec.js';
import { audit } from '../audit.js';
import { db } from '../db/client.js';
import { agentTemplates, departments, teamAgents, teams, users } from '../db/schema.js';
import { newId } from '../lib/crypto.js';
import { ApiError } from '../lib/errors.js';
import { getSetting } from '../settings.js';
import { scheduleApply } from '../teams/runtime.js';

// A-06 agent templates. Saving bumps the version; assigned teams become pending and are re-applied.

type TemplateRow = typeof agentTemplates.$inferSelect;
type IdReq = FastifyRequest<{ Params: { id: string } }>;

async function templateOut(t: TemplateRow) {
  const assigned = await db.select({ name: teams.name, applyStatus: teamAgents.applyStatus, appliedVersion: teamAgents.appliedVersion })
    .from(teamAgents).innerJoin(teams, eq(teams.id, teamAgents.teamId)).where(eq(teamAgents.templateId, t.id));
  const [by] = t.updatedBy
    ? await db.select({ id: users.id, name: users.name, email: users.email, departmentName: departments.name })
      .from(users).leftJoin(departments, eq(departments.id, users.departmentId)).where(eq(users.id, t.updatedBy))
    : [];
  return {
    id: t.id,
    name: t.name,
    icon: t.icon,
    description: t.description,
    version: t.version,
    spec: t.spec,
    assignedTeams: assigned.map((a) => ({
      name: a.name,
      applyStatus: a.applyStatus === 'applied' && a.appliedVersion !== t.version ? 'pending' : a.applyStatus,
    })),
    updatedAt: t.updatedAt.toISOString(),
    updatedBy: by ?? null,
  };
}

async function loadTemplate(id: string) {
  const [t] = await db.select().from(agentTemplates).where(eq(agentTemplates.id, id));
  if (!t) throw new ApiError(404, 'TEMPLATE_NOT_FOUND');
  return t;
}

async function parseInput(body: unknown) {
  const input = AgentTemplateInputSchema.parse(body);
  if (input.spec.model) {
    const allowed = await getSetting('models.allowed');
    if (!allowed.some((m) => m.id === input.spec.model!.id)) throw new ApiError(422, 'MODEL_NOT_ALLOWED');
  }
  return input;
}

export async function templateRoutes(app: FastifyInstance) {
  app.get('/api/v1/admin/agent-templates', { preHandler: requirePlatformAdmin }, async () => {
    const rows = await db.select().from(agentTemplates).orderBy(desc(agentTemplates.updatedAt));
    return { items: await Promise.all(rows.map(templateOut)) };
  });

  app.post('/api/v1/admin/agent-templates', { preHandler: requirePlatformAdmin }, async (req, reply) => {
    const input = await parseInput(req.body);
    const [t] = await db.insert(agentTemplates).values({
      id: newId(), ...input, createdBy: req.session!.user.id, updatedBy: req.session!.user.id,
    }).returning();
    await audit({ actorId: req.session!.user.id, action: 'template.create', targetType: 'template', targetId: t!.id, detail: { name: t!.name } });
    return reply.code(201).send(await templateOut(t!));
  });

  app.get('/api/v1/admin/agent-templates/:id', { preHandler: requirePlatformAdmin }, async (req: IdReq) =>
    templateOut(await loadTemplate(req.params.id)));

  app.put('/api/v1/admin/agent-templates/:id', { preHandler: requirePlatformAdmin }, async (req: IdReq) => {
    const input = await parseInput(req.body);
    const before = await loadTemplate(req.params.id);
    const [t] = await db.update(agentTemplates).set({
      ...input, version: sql`${agentTemplates.version} + 1`, updatedBy: req.session!.user.id, updatedAt: sql`now()`,
    }).where(eq(agentTemplates.id, before.id)).returning();
    await db.update(teamAgents).set({ applyStatus: 'pending' }).where(eq(teamAgents.templateId, before.id));
    await audit({ actorId: req.session!.user.id, action: 'template.update', targetType: 'template', targetId: before.id, detail: { version: t!.version } });
    const assigned = await db.select({ name: teams.name }).from(teamAgents)
      .innerJoin(teams, eq(teams.id, teamAgents.teamId)).where(eq(teamAgents.templateId, before.id));
    for (const a of assigned) void scheduleApply(a.name);
    return templateOut(t!);
  });

  app.delete('/api/v1/admin/agent-templates/:id', { preHandler: requirePlatformAdmin }, async (req: IdReq, reply) => {
    const t = await loadTemplate(req.params.id);
    const [inUse] = await db.select().from(teamAgents).where(and(eq(teamAgents.templateId, t.id))).limit(1);
    if (inUse) throw new ApiError(409, 'TEMPLATE_IN_USE');
    await db.delete(agentTemplates).where(eq(agentTemplates.id, t.id));
    await audit({ actorId: req.session!.user.id, action: 'template.delete', targetType: 'template', targetId: t.id, detail: { name: t.name } });
    return reply.code(204).send();
  });
}
