import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, gte, inArray, isNull, lt, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { RESERVED_NAMES } from '@kacp/shared';
import { requireInternal, requirePlatformAdmin } from '../auth/guards.js';
import { audit } from '../audit.js';
import { db } from '../db/client.js';
import {
  agentTemplates, auditEvents, departments, names, teamPresence, teams, usageSamples, users,
} from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import { configuredApiKeys, getAllSettings, setApiKey, setSetting, type Limits } from '../settings.js';
import { seedReservedNames } from './service.js';

// A-01 dashboard + metrics, A-10 settings, A-11 audit log, and the orchestrator usage feed.

const LimitsSchema = z.object({ cpu: z.number().positive(), memoryMb: z.number().int().positive(), diskGb: z.number().int().positive() });
const Thresholds = z.object({ cpu: z.number().int().min(1).max(100), memory: z.number().int().min(1).max(100), disk: z.number().int().min(1).max(100) });

const SettingsBody = z.object({
  models: z.object({
    allowed: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), provider: z.string().min(1), default: z.boolean() })).min(1),
  }).partial().optional(),
  limits: z.object({ teamDefault: LimitsSchema, appDefault: LimitsSchema, mcpDefault: LimitsSchema }).partial().optional(),
  ops: z.object({
    idleStopMinutes: z.number().int().min(5).max(1440),
    appIdleStopMinutes: z.object({ work: z.number().int().min(5), public: z.number().int().min(5) }),
    maxRunningWorkAppsPerTeam: z.number().int().min(1).max(50),
    capacityWarn: z.object({ warn: Thresholds, danger: Thresholds }),
    trashRetentionDays: z.number().int().min(1).max(365),
  }).partial().optional(),
  names: z.object({ reservedExtra: z.array(z.string().regex(/^[a-z0-9-]{1,30}$/)) }).partial().optional(),
});

async function settingsOut() {
  const s = await getAllSettings();
  return {
    models: { allowed: s['models.allowed'], apiKeysConfigured: await configuredApiKeys() },
    limits: { teamDefault: s['limits.team_default'], appDefault: s['limits.app_default'], mcpDefault: s['limits.mcp_default'] },
    ops: {
      idleStopMinutes: s['ops.idle_stop_minutes'],
      appIdleStopMinutes: s['ops.app_idle_stop_minutes'],
      maxRunningWorkAppsPerTeam: s['ops.max_running_work_apps_per_team'],
      capacityWarn: s['ops.capacity_warn'],
      trashRetentionDays: s['ops.trash_retention_days'],
    },
    names: { reserved: RESERVED_NAMES, reservedExtra: s['names.reserved_extra'] },
  };
}

const RESOURCE_LABEL = { cpu: 'CPU', memory: '메모리', disk: '디스크' } as const;

/** Display label for an audit target (A-11 "대상"). */
async function targetLabels(rows: (typeof auditEvents.$inferSelect)[]) {
  const ids = (type: string) => [...new Set(rows.filter((r) => r.targetType === type && r.targetId).map((r) => r.targetId!))];
  const isUuid = (s: string) => /^[0-9a-f-]{36}$/.test(s);
  const label = new Map<string, string>();
  const userIds = ids('user').filter(isUuid);
  if (userIds.length) for (const u of await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, userIds))) label.set(`user:${u.id}`, `${u.name} (${u.email})`);
  const teamIds = ids('team').filter(isUuid);
  if (teamIds.length) for (const t of await db.select({ id: teams.id, name: teams.name, displayName: teams.displayName }).from(teams).where(inArray(teams.id, teamIds))) label.set(`team:${t.id}`, `${t.displayName} (${t.name})`);
  const deptIds = ids('department').filter(isUuid);
  if (deptIds.length) for (const d of await db.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, deptIds))) label.set(`department:${d.id}`, d.name);
  const tplIds = ids('template').filter(isUuid);
  if (tplIds.length) for (const t of await db.select({ id: agentTemplates.id, name: agentTemplates.name }).from(agentTemplates).where(inArray(agentTemplates.id, tplIds))) label.set(`template:${t.id}`, t.name);
  return label;
}

export async function opsRoutes(app: FastifyInstance) {
  // ── A-01 ──
  app.get('/api/v1/admin/dashboard', { preHandler: requirePlatformAdmin }, async () => {
    const all = await db.select().from(teams).where(isNull(teams.deletedAt)).orderBy(teams.name);
    const [active] = await db.select({ n: sql<number>`count(distinct ${teamPresence.userId})::int` })
      .from(teamPresence).where(sql`${teamPresence.lastSeenAt} > now() - interval '2 minutes'`);
    const latest = await db.execute<{ target_type: string; target_id: string; cpu_pct: number; mem_bytes: number; mem_limit_bytes: number | null; disk_bytes: number | null; disk_limit_bytes: number | null }>(sql`
      select distinct on (target_type, target_id) target_type, target_id, cpu_pct, mem_bytes, mem_limit_bytes, disk_bytes, disk_limit_bytes
      from usage_samples where ts > now() - interval '5 minutes' order by target_type, target_id, ts desc`);
    const vm = latest.find((r) => r.target_type === 'vm');
    const pct = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? Math.round((Number(a) / Number(b)) * 1000) / 10 : 0);
    const vmNow = { cpuPct: vm ? Math.round(vm.cpu_pct * 10) / 10 : 0, memPct: pct(vm?.mem_bytes, vm?.mem_limit_bytes), diskPct: pct(vm?.disk_bytes, vm?.disk_limit_bytes) };
    const warn = (await getAllSettings())['ops.capacity_warn'];
    const warnings: { level: 'warn' | 'danger'; resource: 'cpu' | 'memory' | 'disk'; message: string }[] = [];
    for (const [resource, value] of [['cpu', vmNow.cpuPct], ['memory', vmNow.memPct], ['disk', vmNow.diskPct]] as const) {
      const level = value >= warn.danger[resource] ? 'danger' : value >= warn.warn[resource] ? 'warn' : null;
      if (level) {
        warnings.push({
          level, resource,
          message: `${RESOURCE_LABEL[resource]} ${value}% — ${resource === 'disk' ? '저장 공간이 부족해질 수 있어요' : '새 팀 기동이 실패할 수 있어요'}`,
        });
      }
    }
    const presence = await db.select({ teamId: teamPresence.teamId, n: sql<number>`count(distinct ${teamPresence.userId})::int` })
      .from(teamPresence).where(sql`${teamPresence.lastSeenAt} > now() - interval '2 minutes'`).groupBy(teamPresence.teamId);
    return {
      teams: { total: all.length, running: all.filter((t) => t.containerStatus === 'running').length },
      activeUsers: active?.n ?? 0,
      runningApps: { work: 0, public: 0 },
      pending: { deployRequests: 0, mcpReviews: 0 },
      vm: vmNow,
      warnings,
      teamContainers: all.map((t) => {
        const s = latest.find((r) => r.target_type === 'team' && r.target_id === t.name);
        const running = t.containerStatus === 'running';
        return {
          team: t.name,
          displayName: t.displayName,
          status: t.containerStatus,
          activeUsers: presence.find((p) => p.teamId === t.id)?.n ?? 0,
          cpuPct: running && s ? Math.round(s.cpu_pct * 10) / 10 : 0,
          memBytes: running && s ? Number(s.mem_bytes) : 0,
          memLimitBytes: s?.mem_limit_bytes ? Number(s.mem_limit_bytes) : (t.resourceLimits as Limits | null)?.memoryMb ? (t.resourceLimits as Limits).memoryMb * 1024 * 1024 : 0,
          lastActiveAt: t.lastActiveAt?.toISOString() ?? null,
        };
      }),
    };
  });

  app.get('/api/v1/admin/metrics', { preHandler: requirePlatformAdmin }, async (req) => {
    const q = z.object({ target: z.string().regex(/^(vm|team:[a-z0-9-]+|app:[0-9a-f-]+)$/), range: z.enum(['24h', '7d']).default('24h') }).parse(req.query);
    const [type, id = 'host'] = q.target.split(':') as [string, string?];
    // 24h → 5-minute buckets, 7d → 1-hour buckets.
    const bucket = q.range === '24h' ? '5 minutes' : '1 hour';
    const since = q.range === '24h' ? sql`now() - interval '24 hours'` : sql`now() - interval '7 days'`;
    const rows = await db.execute<{ ts: Date; cpu: number; mem: number; mem_limit: number | null; disk: number | null; disk_limit: number | null }>(sql`
      select date_bin(${bucket}::interval, ts, timestamptz '2000-01-01') as ts,
             avg(cpu_pct)::float8 as cpu, avg(mem_bytes)::float8 as mem, max(mem_limit_bytes)::float8 as mem_limit,
             avg(disk_bytes)::float8 as disk, max(disk_limit_bytes)::float8 as disk_limit
      from usage_samples where target_type = ${type} and target_id = ${id} and ts > ${since}
      group by 1 order by 1`);
    return {
      points: rows.map((r) => ({
        ts: new Date(r.ts).toISOString(),
        cpuPct: Math.round(Number(r.cpu) * 10) / 10,
        memBytes: Math.round(Number(r.mem)),
        memLimitBytes: r.mem_limit ? Math.round(Number(r.mem_limit)) : null,
        diskBytes: r.disk ? Math.round(Number(r.disk)) : 0,
        diskLimitBytes: r.disk_limit ? Math.round(Number(r.disk_limit)) : null,
      })),
    };
  });

  // ── A-10 ──
  app.get('/api/v1/admin/settings', { preHandler: requirePlatformAdmin }, settingsOut);

  app.put('/api/v1/admin/settings', { preHandler: requirePlatformAdmin }, async (req) => {
    const b = SettingsBody.parse(req.body);
    const actorId = req.session!.user.id;
    const before = await settingsOut();
    if (b.models?.allowed) {
      if (b.models.allowed.filter((m) => m.default).length !== 1) throw new ApiError(400, 'VALIDATION_FAILED', undefined, '기본 모델을 하나 정해 주세요.');
      await setSetting('models.allowed', b.models.allowed, actorId);
    }
    if (b.limits?.teamDefault) await setSetting('limits.team_default', b.limits.teamDefault, actorId);
    if (b.limits?.appDefault) await setSetting('limits.app_default', b.limits.appDefault, actorId);
    if (b.limits?.mcpDefault) await setSetting('limits.mcp_default', b.limits.mcpDefault, actorId);
    if (b.ops?.idleStopMinutes !== undefined) await setSetting('ops.idle_stop_minutes', b.ops.idleStopMinutes, actorId);
    if (b.ops?.appIdleStopMinutes) await setSetting('ops.app_idle_stop_minutes', b.ops.appIdleStopMinutes, actorId);
    if (b.ops?.maxRunningWorkAppsPerTeam !== undefined) await setSetting('ops.max_running_work_apps_per_team', b.ops.maxRunningWorkAppsPerTeam, actorId);
    if (b.ops?.capacityWarn) await setSetting('ops.capacity_warn', b.ops.capacityWarn, actorId);
    if (b.ops?.trashRetentionDays !== undefined) await setSetting('ops.trash_retention_days', b.ops.trashRetentionDays, actorId);
    if (b.names?.reservedExtra) {
      // Extra reserved words may not already be in use by a team or public app.
      const wanted = [...new Set(b.names.reservedExtra)].filter((n) => !RESERVED_NAMES.includes(n));
      const used = wanted.length ? await db.select().from(names).where(and(inArray(names.name, wanted), sql`${names.kind} <> 'reserved'`)) : [];
      if (used.length) throw new ApiError(409, 'NAME_TAKEN', { names: used.map((u) => u.name) }, `이미 쓰고 있는 이름은 예약할 수 없어요: ${used.map((u) => u.name).join(', ')}`);
      const removed = before.names.reservedExtra.filter((n) => !wanted.includes(n));
      if (removed.length) await db.delete(names).where(and(inArray(names.name, removed), eq(names.kind, 'reserved')));
      await setSetting('names.reserved_extra', wanted, actorId);
      await seedReservedNames();
    }
    const after = await settingsOut();
    await audit({ actorId, action: 'settings.update', targetType: 'settings', detail: { changed: Object.keys(b) } });
    return after;
  });

  app.put('/api/v1/admin/settings/api-keys/:provider', { preHandler: requirePlatformAdmin },
    async (req: FastifyRequest<{ Params: { provider: string } }>, reply) => {
      const provider = z.string().regex(/^[a-z0-9-]{2,30}$/).parse(req.params.provider);
      const { key } = z.object({ key: z.string().min(8).max(500) }).parse(req.body);
      await setApiKey(provider, key, req.session!.user.id);
      // Only the provider name is recorded, never the key.
      await audit({ actorId: req.session!.user.id, action: 'settings.update', targetType: 'settings', targetId: `api_key:${provider}` });
      return reply.code(204).send();
    });

  // ── A-11 ──
  app.get('/api/v1/admin/audit-events', { preHandler: requirePlatformAdmin }, async (req) => {
    const q = z.object({
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional(),
      actor: z.uuid().optional(),
      action: z.string().optional(),
      targetType: z.string().optional(),
      targetId: z.string().optional(),
      team: z.string().optional(),
      cursor: z.coerce.number().int().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query);
    const where: SQL[] = [];
    if (q.from) where.push(gte(auditEvents.createdAt, new Date(q.from)));
    if (q.to) where.push(lte(auditEvents.createdAt, new Date(q.to)));
    if (q.actor) where.push(eq(auditEvents.actorId, q.actor));
    if (q.action) where.push(sql`${auditEvents.action} like ${q.action.replace(/[%_]/g, '') + '%'}`);
    if (q.targetType) where.push(eq(auditEvents.targetType, q.targetType));
    if (q.targetId) where.push(eq(auditEvents.targetId, q.targetId));
    if (q.team) {
      const [t] = await db.select({ id: teams.id }).from(teams).where(eq(teams.name, q.team));
      where.push(eq(auditEvents.teamId, t?.id ?? '00000000-0000-0000-0000-000000000000'));
    }
    if (q.cursor) where.push(lt(auditEvents.id, q.cursor));
    const rows = await db.select().from(auditEvents).where(and(...where)).orderBy(desc(auditEvents.id)).limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const actorIds = [...new Set(page.map((r) => r.actorId).filter((x): x is string => !!x))];
    const actors = actorIds.length
      ? await db.select({ id: users.id, name: users.name, email: users.email, departmentName: departments.name })
        .from(users).leftJoin(departments, eq(departments.id, users.departmentId)).where(inArray(users.id, actorIds))
      : [];
    const teamIds = [...new Set(page.map((r) => r.teamId).filter((x): x is string => !!x))];
    const teamNames = teamIds.length ? await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIds)) : [];
    const labels = await targetLabels(page);
    return {
      items: page.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        actor: actors.find((a) => a.id === r.actorId) ?? null,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        targetLabel: (r.targetId && labels.get(`${r.targetType}:${r.targetId}`)) ?? r.targetId ?? '',
        team: teamNames.find((t) => t.id === r.teamId)?.name ?? null,
        detail: r.detail ?? {},
        ip: r.ip,
      })),
      nextCursor: rows.length > q.limit ? String(page.at(-1)!.id) : null,
    };
  });

  // ── orchestrator usage feed (04-api.md §3) ──
  app.post('/internal/usage', { preHandler: requireInternal, logLevel: 'warn' }, async (req, reply) => {
    const { samples } = z.object({
      samples: z.array(z.object({
        targetType: z.enum(['vm', 'team', 'app', 'mcp']),
        targetId: z.string().max(100),
        cpuPct: z.number(),
        memBytes: z.number(),
        memLimitBytes: z.number().nullable().optional(),
        diskBytes: z.number().nullable().optional(),
        diskLimitBytes: z.number().nullable().optional(),
      })).max(500),
    }).parse(req.body);
    if (samples.length) {
      await db.insert(usageSamples).values(samples.map((s) => ({
        targetType: s.targetType, targetId: s.targetId, cpuPct: s.cpuPct, memBytes: Math.round(s.memBytes),
        memLimitBytes: s.memLimitBytes ?? null, diskBytes: s.diskBytes ?? null, diskLimitBytes: s.diskLimitBytes ?? null,
      })));
    }
    return reply.code(204).send();
  });
}
