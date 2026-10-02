import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TEAM_CONTAINER_STATUSES } from '@kacp/shared';
import { requireInternal } from '../auth/guards.js';
import { setStatus } from '../teams/runtime.js';

// Status notifications from the orchestrator (04-api.md §3). Stage 2 handles team.status only.
const TeamStatusEvent = z.object({
  type: z.literal('team.status'),
  id: z.string(),
  status: z.enum(TEAM_CONTAINER_STATUSES),
  detail: z.string().nullable().optional(),
});

export async function internalEventRoutes(app: FastifyInstance) {
  app.post('/internal/events', { preHandler: requireInternal }, async (req, reply) => {
    const ev = TeamStatusEvent.parse(req.body);
    await setStatus(ev.id, ev.status, ev.detail ?? null);
    req.log.info({ team: ev.id, status: ev.status }, 'team status');
    return reply.code(204).send();
  });
}
