import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { TEAM_CONTAINER_STATUSES } from '@kacp/shared';
import { requireInternal } from '../auth/guards.js';
import { db } from '../db/client.js';
import { teams } from '../db/schema.js';
import { setStatus } from '../teams/runtime.js';
import { onAppStatus } from '../apps/service.js';
import { ensureInstalled, onBuildEvent, onInstallEvent } from '../mcp/service.js';

// Status notifications from the orchestrator (04-api.md §3 POST /internal/events).
const Event = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('team.status'),
    id: z.string(),
    status: z.enum(TEAM_CONTAINER_STATUSES),
    detail: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal('app.status'),
    id: z.string(),
    copy: z.enum(['work', 'public']),
    status: z.enum(['starting', 'running', 'stopped', 'error']),
    stopReason: z.enum(['idle', 'limit', 'manual', 'admin']).nullable().optional(),
    detail: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal('mcp.build'),
    id: z.uuid(),
    status: z.enum(['building', 'scanning', 'testing', 'in_review', 'failed']),
    failedStage: z.enum(['validate', 'build', 'scan', 'test']).optional(),
    detail: z.string().optional(),
    imageRef: z.string().optional(),
    scanSummary: z.object({ critical: z.number().int(), high: z.number().int(), medium: z.number().int(), low: z.number().int() }).optional(),
    findings: z.array(z.object({ severity: z.string(), pkg: z.string(), id: z.string(), title: z.string() })).max(500).optional(),
    tools: z.array(z.object({ name: z.string(), title: z.string().optional(), description: z.string(), inputSchema: z.unknown() })).max(200).optional(),
  }),
  z.object({
    type: z.literal('mcp.install'),
    id: z.string(),
    key: z.string(),
    status: z.enum(['installed', 'error', 'removed']),
    detail: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal('team.provision'),
    id: z.string(),
    stage: z.enum(['storage', 'container', 'default_mcp', 'done', 'failed']),
    detail: z.string().nullable().optional(),
  }),
]);

export async function internalEventRoutes(app: FastifyInstance) {
  app.post('/internal/events', { preHandler: requireInternal }, async (req, reply) => {
    const ev = Event.parse(req.body);
    if (ev.type === 'team.status') {
      await setStatus(ev.id, ev.status, ev.detail ?? null);
      req.log.info({ team: ev.id, status: ev.status }, 'team status');
    } else if (ev.type === 'app.status') {
      await onAppStatus(ev.id, ev.copy, ev.status, ev.stopReason ?? null, ev.detail ?? null);
    } else if (ev.type === 'mcp.build') {
      await onBuildEvent(ev);
      req.log.info({ version: ev.id, status: ev.status, failedStage: ev.failedStage }, 'mcp build');
    } else if (ev.type === 'mcp.install') {
      await onInstallEvent(ev.id, ev.key, ev.status, ev.detail ?? null);
      req.log.info({ team: ev.id, key: ev.key, status: ev.status }, 'mcp install');
    } else {
      await db.update(teams)
        .set({ provisionStage: ev.stage, ...(ev.stage === 'failed' ? { containerError: ev.detail ?? '프로비저닝에 실패했어요.' } : {}) })
        .where(eq(teams.name, ev.id));
      req.log.info({ team: ev.id, stage: ev.stage }, 'team provision');
      // 전사 기본 MCP (A-08 기본 지정) go into every new team (03 provision_stage default_mcp).
      if (ev.stage === 'default_mcp') {
        const [t] = await db.select().from(teams).where(eq(teams.name, ev.id));
        if (t) await ensureInstalled(t, 'defaults').catch((err) => req.log.warn({ err }, 'default mcp'));
      }
    }
    return reply.code(204).send();
  });
}
