import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { TeamContainerStatus, TeamStatus } from '@kacp/shared';
import { db } from '../db/client.js';
import { memberships, teamPresence, teams, users } from '../db/schema.js';
import { decrypt } from '../lib/crypto.js';
import { orchestrator, type TeamRuntimeSpec } from '../orchestrator.js';
import { getSetting } from '../settings.js';

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

export async function runtimeSpec(team: TeamRow): Promise<TeamRuntimeSpec> {
  const admins = await db
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.teamId, team.id), eq(memberships.teamRole, 'team_admin')));
  return {
    gatewayPassword: decrypt(team.gatewayPasswordEnc),
    adminEmails: admins.map((a) => a.email),
    resourceLimits: team.resourceLimits ?? (await getSetting('limits.team_default')),
  };
}

/** Moves `stopped`/`error` → `starting` and asks the orchestrator. Only the caller that wins the update calls it. */
export async function requestStart(team: TeamRow): Promise<void> {
  const won = await db
    .update(teams)
    .set({ containerStatus: 'starting', containerStatusAt: sql`now()`, containerError: null })
    .where(and(eq(teams.id, team.id), inArray(teams.containerStatus, ['stopped', 'error'])))
    .returning({ id: teams.id });
  if (won.length === 0) return;
  try {
    await orchestrator.ensureRunning(team.name, await runtimeSpec(team));
  } catch {
    await setStatus(team.name, 'error', '오케스트레이터에 연결하지 못했어요.');
  }
}

export async function requestStop(team: TeamRow): Promise<void> {
  const won = await db
    .update(teams)
    .set({ containerStatus: 'stopping', containerStatusAt: sql`now()` })
    .where(and(eq(teams.id, team.id), eq(teams.containerStatus, 'running')))
    .returning({ id: teams.id });
  if (won.length === 0) return;
  try {
    await orchestrator.stop(team.name);
  } catch {
    await setStatus(team.name, 'error', '오케스트레이터에 연결하지 못했어요.');
  }
}

export async function setStatus(team: string, status: TeamContainerStatus, detail: string | null) {
  await db
    .update(teams)
    .set({ containerStatus: status, containerStatusAt: sql`now()`, containerError: status === 'error' ? detail : null })
    .where(eq(teams.name, team));
}

export async function touchPresence(team: TeamRow, sessionId: string, userId: string) {
  await db
    .insert(teamPresence)
    .values({ teamId: team.id, sessionId, userId })
    .onConflictDoUpdate({ target: [teamPresence.teamId, teamPresence.sessionId], set: { lastSeenAt: sql`now()` } });
  await db.update(teams).set({ lastActiveAt: sql`now()` }).where(eq(teams.id, team.id));
}
