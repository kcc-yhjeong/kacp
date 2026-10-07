import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { TeamContainerStatus, TeamStatus } from '@kacp/shared';
import { db } from '../db/client.js';
import { agentTemplates, memberships, teamAgents, teamPresence, teams, users } from '../db/schema.js';
import { decrypt } from '../lib/crypto.js';
import { orchestrator, type DesiredAgent, type TeamRuntimeSpec } from '../orchestrator.js';
import { getSetting } from '../settings.js';
import { config, teamUrl } from '../config.js';
import { mcpToken } from '../apps/logic.js';
import { modelKeyEnv, providerOf, type AgentSpec } from '../agents/spec.js';
import { desiredMcpServers } from '../mcp/service.js';
import { isNewError } from '../notify/logic.js';
import { notify, platformAdminIds, teamAdminIds } from '../notify/service.js';

// Team container lifecycle as seen from the api (03-data-model.md 상태 전이 — 팀 컨테이너).

type TeamRow = typeof teams.$inferSelect;
const PRESENCE_WINDOW = sql`now() - interval '2 minutes'`;

export async function teamStatus(team: TeamRow): Promise<TeamStatus> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${teamPresence.userId})::int` })
    .from(teamPresence)
    .where(and(eq(teamPresence.teamId, team.id), gt(teamPresence.lastSeenAt, PRESENCE_WINDOW)));
  return {
    status: team.containerStatus as TeamContainerStatus,
    detail: team.containerError,
    activeUsers: row?.n ?? 0,
    since: team.containerStatusAt.toISOString(),
  };
}

async function adminEmails(teamId: string) {
  const rows = await db
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.teamId, teamId), eq(memberships.teamRole, 'team_admin'), eq(users.status, 'active')));
  return rows.map((r) => r.email).sort();
}

export async function runtimeSpec(team: TeamRow): Promise<TeamRuntimeSpec> {
  return {
    gatewayPassword: decrypt(team.gatewayPasswordEnc),
    adminEmails: await adminEmails(team.id),
    resourceLimits: team.resourceLimits ?? (await getSetting('limits.team_default')),
    // Keys entered on assigned templates (A-06); without one the team's own Control UI auth is used.
    env: await templateKeyEnv(team.id),
    linuxGid: team.linuxGid,
  };
}

/** <PROVIDER>_API_KEY(S) from the keys of the team's assigned templates. */
async function templateKeyEnv(teamId: string): Promise<Record<string, string>> {
  const rows = await db.select({ spec: agentTemplates.spec, keyEnc: agentTemplates.modelKeyEnc }).from(teamAgents)
    .innerJoin(agentTemplates, eq(agentTemplates.id, teamAgents.templateId)).where(eq(teamAgents.teamId, teamId));
  const items = rows.flatMap((r) => {
    const provider = providerOf((r.spec as AgentSpec).model?.id);
    return provider && r.keyEnc ? [{ provider, key: decrypt(r.keyEnc) }] : [];
  });
  return modelKeyEnv(items);
}

/** Template key added, changed or removed: running teams that use it restart to get the new env. */
export async function restartTeamsForKeyChange(templateId: string, onlyTeamId?: string) {
  const rows = await db.select({ t: teams }).from(teamAgents).innerJoin(teams, eq(teams.id, teamAgents.teamId))
    .where(eq(teamAgents.templateId, templateId));
  const targets = rows.map((r) => r.t);
  if (onlyTeamId) {
    const [t] = await db.select().from(teams).where(eq(teams.id, onlyTeamId));
    if (t && !targets.some((x) => x.id === t.id)) targets.push(t);
  }
  for (const t of targets) {
    if ((onlyTeamId && t.id !== onlyTeamId) || t.containerStatus !== 'running') continue;
    await requestRestart(t).catch(() => undefined);
  }
}

/** Moves `stopped`/`error` → `starting` and asks the orchestrator. Only the caller that wins the update calls it. */
export async function requestStart(team: TeamRow): Promise<boolean> {
  const won = await db
    .update(teams)
    // A fresh start gets a full idle window, even when started by an admin without presence.
    .set({ containerStatus: 'starting', containerStatusAt: sql`now()`, containerError: null, lastActiveAt: sql`now()` })
    .where(and(eq(teams.id, team.id), inArray(teams.containerStatus, ['stopped', 'error'])))
    .returning({ id: teams.id });
  if (won.length === 0) return false;
  try {
    await orchestrator.ensureRunning(team.name, await runtimeSpec(team));
  } catch {
    await setStatus(team.name, 'error', '오케스트레이터에 연결하지 못했어요.');
  }
  return true;
}

export async function requestStop(team: TeamRow): Promise<boolean> {
  const won = await db
    .update(teams)
    .set({ containerStatus: 'stopping', containerStatusAt: sql`now()` })
    .where(and(eq(teams.id, team.id), eq(teams.containerStatus, 'running')))
    .returning({ id: teams.id });
  if (won.length === 0) return false;
  try {
    await orchestrator.stop(team.name);
  } catch {
    await setStatus(team.name, 'error', '오케스트레이터에 연결하지 못했어요.');
  }
  return true;
}

/** running/error → starting via a graceful stop + start in the orchestrator (picks up env and limits). */
export async function requestRestart(team: TeamRow): Promise<boolean> {
  const won = await db
    .update(teams)
    // A fresh start gets a full idle window, even when started by an admin without presence.
    .set({ containerStatus: 'starting', containerStatusAt: sql`now()`, containerError: null, lastActiveAt: sql`now()` })
    .where(and(eq(teams.id, team.id), inArray(teams.containerStatus, ['running', 'error', 'stopped'])))
    .returning({ id: teams.id });
  if (won.length === 0) return false;
  try {
    await orchestrator.restart(team.name, await runtimeSpec(team));
  } catch {
    await setStatus(team.name, 'error', '오케스트레이터에 연결하지 못했어요.');
  }
  return true;
}

export async function setStatus(team: string, status: TeamContainerStatus, detail: string | null) {
  const [before] = await db.select({ id: teams.id, status: teams.containerStatus }).from(teams).where(eq(teams.name, team));
  await db
    .update(teams)
    .set({ containerStatus: status, containerStatusAt: sql`now()`, containerError: status === 'error' ? detail : null })
    .where(eq(teams.name, team));
  if (status === 'running') scheduleApply(team);
  if (before && isNewError(before.status, status)) {
    const title = `${team} 팀 에이전트에 문제가 생겼어요${detail ? `: ${detail}` : ''}`.slice(0, 280);
    void notify(await teamAdminIds(before.id), { type: 'team_container_error', title, link: teamUrl(team) });
    void notify(await platformAdminIds(), { type: 'team_container_error', title, link: `/admin/teams/${team}` });
  }
}

export async function touchPresence(team: TeamRow, sessionId: string, userId: string) {
  await db
    .insert(teamPresence)
    .values({ teamId: team.id, sessionId, userId })
    .onConflictDoUpdate({ target: [teamPresence.teamId, teamPresence.sessionId], set: { lastSeenAt: sql`now()` } });
  await db.update(teams).set({ lastActiveAt: sql`now()` }).where(eq(teams.id, team.id));
}

// ── apply-config (04-api.md §3): assigned templates + team admins → the running team Gateway ──

/** Stable OpenClaw agent id for a template (uuid v7 tail is random, so unique in practice). */
export const agentIdFor = (templateId: string) => `kacp-${templateId.replace(/-/g, '').slice(-12)}`;

async function desiredAgents(teamId: string): Promise<{ agents: DesiredAgent[]; versions: Map<string, number> }> {
  const rows = await db
    .select({ t: agentTemplates, assignedAt: teamAgents.createdAt })
    .from(teamAgents)
    .innerJoin(agentTemplates, eq(agentTemplates.id, teamAgents.templateId))
    .where(eq(teamAgents.teamId, teamId))
    .orderBy(teamAgents.createdAt);
  const versions = new Map(rows.map((r) => [r.t.id, r.t.version]));
  const agents = rows.map(({ t }): DesiredAgent => {
    const spec = t.spec as AgentSpec;
    return {
      id: agentIdFor(t.id),
      name: t.name,
      emoji: t.icon,
      model: spec.model?.id ?? null,
      thinking: spec.model?.reasoning ?? null,
      instructions: spec.instructions ?? '',
      skills: (spec.skills ?? []).filter((s) => s.source === 'bundled').map((s) => s.name),
      tools: { allow: spec.tools?.allow ?? [], deny: spec.tools?.deny ?? [] },
    };
  });
  return { agents, versions };
}

const applying = new Map<string, Promise<void>>();

/** Fire-and-forget; calls for the same team are serialised. Stopped teams are applied on their next start. */
export function scheduleApply(team: string) {
  const prev = applying.get(team) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(() => applyTeamConfig(team)).catch(() => undefined);
  applying.set(team, next);
  return next;
}

async function applyTeamConfig(teamName: string) {
  const [team] = await db.select().from(teams).where(eq(teams.name, teamName));
  if (!team || team.deletedAt || team.containerStatus !== 'running') return;
  const { agents, versions } = await desiredAgents(team.id);
  try {
    await orchestrator.applyConfig(team.name, {
      agents,
      adminEmails: await adminEmails(team.id),
      platformMcp: { url: config.platformMcpUrl, token: mcpToken(config.internalToken, team.name) },
      mcpServers: await desiredMcpServers(team.id),
    });
    for (const [templateId, version] of versions) {
      await db.update(teamAgents)
        .set({ applyStatus: 'applied', appliedVersion: version, applyError: null, appliedAt: sql`now()` })
        .where(and(eq(teamAgents.teamId, team.id), eq(teamAgents.templateId, templateId)));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(teamAgents)
      .set({ applyStatus: 'failed', applyError: message.slice(0, 500) })
      .where(and(eq(teamAgents.teamId, team.id), eq(teamAgents.applyStatus, 'pending')));
  }
}
