import type { FastifyInstance, FastifyRequest } from 'fastify';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requirePlatformAdmin } from '../auth/guards.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import { toAdminUsers } from '../admin/users.js';
import {
  createDepartment, departmentOut, departmentScope, departmentTree, moveDepartment, setArchived, updateDepartment,
} from './service.js';

// 조직 API (04-api.md §2, A-12).

const DepartmentInput = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
  parentId: z.uuid().nullable().optional(),
  headUserId: z.uuid().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

type IdReq = FastifyRequest<{ Params: { id: string } }>;

export async function orgRoutes(app: FastifyInstance) {
  app.get('/api/v1/departments', { preHandler: requireAuth }, async (req) => {
    const { includeArchived } = z.object({ includeArchived: z.stringbool().default(false) }).parse(req.query);
    // Archived departments are an admin-only view.
    return { items: await departmentTree(includeArchived && req.session!.user.platformRole === 'admin') };
  });

  app.post('/api/v1/admin/departments', { preHandler: requirePlatformAdmin }, async (req, reply) => {
    const body = DepartmentInput.parse(req.body);
    return reply.code(201).send(await createDepartment(body, req.session!.user.id));
  });

  app.patch('/api/v1/admin/departments/:id', { preHandler: requirePlatformAdmin }, async (req: IdReq) => {
    const body = DepartmentInput.parse(req.body);
    return updateDepartment(req.params.id, body, req.session!.user.id);
  });

  app.post('/api/v1/admin/departments/:id/move', { preHandler: requirePlatformAdmin }, async (req: IdReq) => {
    const body = z.object({ parentId: z.uuid().nullable(), sortOrder: z.number().int().optional() }).parse(req.body);
    return moveDepartment(req.params.id, body.parentId, body.sortOrder, req.session!.user.id);
  });

  app.post('/api/v1/admin/departments/:id/:action', { preHandler: requirePlatformAdmin },
    async (req: FastifyRequest<{ Params: { id: string; action: string } }>) => {
      const action = z.enum(['archive', 'unarchive']).parse(req.params.action);
      return setArchived(req.params.id, action === 'archive', req.session!.user.id);
    });

  app.get('/api/v1/admin/departments/:id/members', { preHandler: requirePlatformAdmin }, async (req: IdReq) => {
    const { includeDescendants } = z.object({ includeDescendants: z.stringbool().default(false) }).parse(req.query);
    await departmentOut(req.params.id).catch(() => {
      throw new ApiError(404, 'DEPARTMENT_NOT_FOUND');
    });
    const ids = await departmentScope(req.params.id, includeDescendants);
    const rows = await db.select().from(users).where(inArray(users.departmentId, ids)).orderBy(users.name);
    return { items: await toAdminUsers(rows) };
  });
}
