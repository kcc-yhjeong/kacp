import type { FastifyBaseLogger } from 'fastify';
import { and, eq, lt, notExists, or, isNull, sql } from 'drizzle-orm';
import { db } from './db/client.js';
import { teamPresence, teams, usageSamples } from './db/schema.js';
import { getSetting } from './settings.js';
import { requestStop, setStatus } from './teams/runtime.js';

// Background workers (04-api.md §4). Stage 2: idle stop and stuck-start recovery.

// The orchestrator retries an owner-lease failure for up to 6 minutes before reporting.
const STUCK_STARTING = sql`now() - interval '8 minutes'`;

async function idleStop(log: FastifyBaseLogger) {
  const minutes = await getSetting('ops.idle_stop_minutes');
  const idle = await db
    .select()
    .from(teams)
    .where(and(
      eq(teams.containerStatus, 'running'),
      isNull(teams.deletedAt),
      or(isNull(teams.lastActiveAt), lt(teams.lastActiveAt, sql`now() - make_interval(mins => ${minutes})`)),
      notExists(db.select().from(teamPresence).where(and(
        eq(teamPresence.teamId, teams.id),
        sql`${teamPresence.lastSeenAt} > now() - interval '2 minutes'`,
      ))),
    ));
  for (const t of idle) {
    log.info({ team: t.name }, 'idle stop');
    await requestStop(t);
  }

  const stuck = await db
    .select({ name: teams.name })
    .from(teams)
    .where(and(eq(teams.containerStatus, 'starting'), lt(teams.containerStatusAt, STUCK_STARTING)));
  for (const t of stuck) await setStatus(t.name, 'error', '시작 시간이 너무 오래 걸렸어요.');

  await db.delete(teamPresence).where(lt(teamPresence.lastSeenAt, sql`now() - interval '1 day'`));
  // usage_samples keep 7 days (03-data-model.md).
  await db.delete(usageSamples).where(lt(usageSamples.ts, sql`now() - interval '7 days'`));
}

export function startWorkers(log: FastifyBaseLogger) {
  const tick = () => idleStop(log).catch((err) => log.error({ err }, 'idle stop worker failed'));
  const timer = setInterval(tick, 60_000);
  timer.unref();
}
