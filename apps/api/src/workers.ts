import type { FastifyBaseLogger } from 'fastify';
import { and, eq, lt, notExists, or, isNull, sql } from 'drizzle-orm';
import { db } from './db/client.js';
import { apps, loginAttempts, teamPresence, teams, usageSamples } from './db/schema.js';
import { stopCopy } from './apps/service.js';
import { purgeExpiredTrash } from './drive/routes.js';
import { getSetting } from './settings.js';
import { requestStop, setStatus } from './teams/runtime.js';
import { dispatchBuilds } from './mcp/service.js';
import { syncGateways } from './mcp/sync.js';

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

// Apps sleep after their idle window (work 30 min, public 120 min — A-10) without visits.
async function appIdleStop(log: FastifyBaseLogger) {
  const idle = await getSetting('ops.app_idle_stop_minutes');
  const work = await db.select().from(apps).where(and(isNull(apps.deletedAt), eq(apps.workStatus, 'running'),
    or(isNull(apps.workLastAccessedAt), lt(apps.workLastAccessedAt, sql`now() - make_interval(mins => ${idle.work})`))));
  for (const a of work) {
    log.info({ app: a.slug }, 'app work idle stop');
    await stopCopy(a, 'work', 'idle');
  }
  const pub = await db.select().from(apps).where(and(isNull(apps.deletedAt), eq(apps.publicStatus, 'running'),
    or(isNull(apps.publicLastAccessedAt), lt(apps.publicLastAccessedAt, sql`now() - make_interval(mins => ${idle.public})`))));
  for (const a of pub) {
    log.info({ app: a.slug }, 'app public idle stop');
    await stopCopy(a, 'public', 'idle');
  }
}

async function daily(log: FastifyBaseLogger) {
  const purged = await purgeExpiredTrash();
  if (purged) log.info({ purged }, 'trash purged');
  await db.delete(loginAttempts).where(lt(loginAttempts.createdAt, sql`now() - interval '30 days'`));
}

export function startWorkers(log: FastifyBaseLogger) {
  const runDaily = () => daily(log).catch((err) => log.error({ err }, 'daily worker failed'));
  setTimeout(runDaily, 30_000).unref();
  setInterval(runDaily, 24 * 60 * 60 * 1000).unref();
  const tick = () => {
    idleStop(log).catch((err) => log.error({ err }, 'idle stop worker failed'));
    appIdleStop(log).catch((err) => log.error({ err }, 'app idle stop worker failed'));
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  // MCP build queue (also kicked right after an upload and after each finished build).
  setInterval(() => void dispatchBuilds().catch((err) => log.error({ err }, 'mcp dispatch failed')), 10_000).unref();
  setInterval(() => void syncGateways(log).catch((err) => log.error({ err }, 'mcp sync failed')), 5 * 60_000).unref();
}
