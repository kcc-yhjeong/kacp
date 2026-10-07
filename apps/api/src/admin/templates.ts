import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { requirePlatformAdmin } from '../auth/guards.js';
import { AgentTemplateInputSchema, providerOf } from '../agents/spec.js';
import { audit } from '../audit.js';
import { db } from '../db/client.js';
import { agentTemplates, departments, teamAgents, teams, users } from '../db/schema.js';
import { encrypt, newId } from '../lib/crypto.js';
import { ApiError } from '../lib/errors.js';
import { orchestrator } from '../orchestrator.js';
import { getSetting } from '../settings.js';
import { restartTeamsForKeyChange, scheduleApply } from '../teams/runtime.js';

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
    /** The key itself is never sent back. */
    modelKeySet: !!t.modelKeyEnc,
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
  // A template without a model id uses the team agent's default model. A key belongs to the model's
  // provider, so it needs a model in `provider/model` form.
  const { modelKey, ...input } = AgentTemplateInputSchema.parse(body);
  if (modelKey && !providerOf(input.spec.model?.id)) {
    throw new ApiError(422, 'VALIDATION_FAILED', undefined, '키를 넣으려면 모델(예: openai/gpt-5.4-mini)을 먼저 고르세요.');
  }
  return { input, modelKey };
}

let modelCache: { at: number; items: { ref: string; name: string; provider: string }[]; teams: string[] } | null = null;

/** Models offered in A-06: the union of running teams' Gateway catalogs (cached 10 min). */
async function modelCatalog() {
  if (modelCache && Date.now() - modelCache.at < 10 * 60_000 && modelCache.items.length) return modelCache;
  const running = await db.select({ name: teams.name }).from(teams).where(eq(teams.containerStatus, 'running')).limit(5);
  const byRef = new Map<string, { ref: string; name: string; provider: string }>();
  const used: string[] = [];
  for (const t of running) {
    const got = await orchestrator.gatewayModels(t.name).catch(() => null);
    const models = got?.payload?.models ?? [];
    if (models.length) used.push(t.name);
    for (const m of models) {
      if (!m.provider || !m.id) continue;
      const ref = `${m.provider}/${m.id}`;
      if (!byRef.has(ref)) byRef.set(ref, { ref, name: m.name ?? m.id, provider: m.provider });
    }
  }
  modelCache = { at: Date.now(), items: [...byRef.values()].sort((a, b) => a.ref.localeCompare(b.ref)), teams: used };
  return modelCache;
}

export async function templateRoutes(app: FastifyInstance) {
  app.get('/api/v1/admin/models', { preHandler: requirePlatformAdmin }, async () => modelCatalog());

  app.get('/api/v1/admin/agent-templates', { preHandler: requirePlatformAdmin }, async () => {
    const rows = await db.select().from(agentTemplates).orderBy(desc(agentTemplates.updatedAt));
    return { items: await Promise.all(rows.map(templateOut)) };
  });

  app.post('/api/v1/admin/agent-templates', { preHandler: requirePlatformAdmin }, async (req, reply) => {
    const { input, modelKey } = await parseInput(req.body);
    const [t] = await db.insert(agentTemplates).values({
      id: newId(), ...input, modelKeyEnc: modelKey ? encrypt(modelKey) : null, createdBy: req.session!.user.id, updatedBy: req.session!.user.id,
    }).returning();
    await audit({ actorId: req.session!.user.id, action: 'template.create', targetType: 'template', targetId: t!.id, detail: { name: t!.name, modelKeySet: !!modelKey } });
    return reply.code(201).send(await templateOut(t!));
  });

  app.get('/api/v1/admin/agent-templates/:id', { preHandler: requirePlatformAdmin }, async (req: IdReq) =>
    templateOut(await loadTemplate(req.params.id)));

  app.put('/api/v1/admin/agent-templates/:id', { preHandler: requirePlatformAdmin }, async (req: IdReq) => {
    const { input, modelKey } = await parseInput(req.body);
    const before = await loadTemplate(req.params.id);
    // A model without a provider prefix cannot carry a key: drop a stale one.
    const clearKey = modelKey === null || (!providerOf(input.spec.model?.id) && !!before.modelKeyEnc);
    const [t] = await db.update(agentTemplates).set({
      ...input,
      ...(modelKey ? { modelKeyEnc: encrypt(modelKey) } : clearKey ? { modelKeyEnc: null } : {}),
      version: sql`${agentTemplates.version} + 1`, updatedBy: req.session!.user.id, updatedAt: sql`now()`,
    }).where(eq(agentTemplates.id, before.id)).returning();
    await db.update(teamAgents).set({ applyStatus: 'pending' }).where(eq(teamAgents.templateId, before.id));
    await audit({
      actorId: req.session!.user.id, action: 'template.update', targetType: 'template', targetId: before.id,
      detail: { version: t!.version, ...(modelKey ? { modelKey: 'changed' } : clearKey ? { modelKey: 'cleared' } : {}) },
    });
    // The key reaches teams as container env: running teams restart when what they get changes.
    const keyChanged = !!modelKey || clearKey || (!!t!.modelKeyEnc && providerOf((before.spec as { model?: { id?: string } }).model?.id) !== providerOf(input.spec.model?.id));
    if (keyChanged) void restartTeamsForKeyChange(before.id);
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
