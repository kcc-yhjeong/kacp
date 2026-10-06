import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth } from '../auth/guards.js';
import { db } from '../db/client.js';
import { notifications } from '../db/schema.js';
import { markRead } from './service.js';

// C-06 알림 패널 (04-api.md §2 /me/notifications).

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/api/v1/me/notifications', { preHandler: requireAuth }, async (req) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(req.query);
    const userId = req.session!.user.id;
    const rows = await db.select().from(notifications).where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt)).limit(limit);
    const [unread] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return {
      items: rows.map((n) => ({
        id: n.id, type: n.type, title: n.title, link: n.link, createdAt: n.createdAt.toISOString(), readAt: n.readAt?.toISOString() ?? null,
      })),
      unread: unread?.n ?? 0,
    };
  });

  app.get('/api/v1/me/notifications/unread-count', { preHandler: requireAuth }, async (req) => {
    const [r] = await db.select({ n: count() }).from(notifications)
      .where(and(eq(notifications.userId, req.session!.user.id), isNull(notifications.readAt)));
    return { count: r?.n ?? 0 };
  });

  app.post('/api/v1/me/notifications/read', { preHandler: requireAuth }, async (req, reply) => {
    const body = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.uuid()).min(1).max(100) })]).parse(req.body);
    await markRead(req.session!.user.id, 'all' in body ? 'all' : body.ids);
    return reply.code(204).send();
  });
}
