import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { requirePlatformAdmin } from '../auth/guards.js';
import { audit } from '../audit.js';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { apps, appVersions, deployRequests, names, teams } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import { invalidateTeamCaches } from '../teams/lookup.js';
import {
  appsOut, loadApp, originOf, publicHost, requestsOut, sourceRel, startCopy, stopCopy, takeSnapshot, teamOf, workHost,
} from './service.js';

// A-09 배포 승인 + 공개 중인 앱 (04-api.md 관리자). Platform admins only.

async function sourceFiles(team: string, sourcePath: string, limit = 200): Promise<string[]> {
  const root = path.join(config.dataRoot, sourceRel(team, sourcePath));
  const out: string[] = [];
  const walk = async (dir: string, rel: string) => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (out.length >= limit) return;
      if (e.isSymbolicLink() || ['node_modules', '.git'].includes(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else out.push(r);
    }
  };
  await walk(root, '');
  return out;
}

const actor = (req: FastifyRequest) => req.session!.user.id;

export async function adminAppRoutes(app: FastifyInstance) {
  app.get('/api/v1/admin/deploy-requests', { preHandler: requirePlatformAdmin }, async (req) => {
    const { status } = z.object({ status: z.enum(['pending', 'decided']).default('pending') }).parse(req.query);
    const rows = await db.select().from(deployRequests)
      .where(status === 'pending' ? eq(deployRequests.status, 'pending') : ne(deployRequests.status, 'pending'))
      .orderBy(desc(deployRequests.createdAt)).limit(200);
    const out = await requestsOut(rows);
    const appRows = rows.length ? await db.select({ a: apps, team: teams.name }).from(apps).innerJoin(teams, eq(teams.id, apps.teamId))
      .where(inArray(apps.id, [...new Set(rows.map((r) => r.appId))])) : [];
    const byId = new Map(appRows.map((r) => [r.a.id, r]));
    return {
      items: await Promise.all(out.map(async (r) => {
        const x = byId.get(r.appId);
        const info = x ? {
          id: x.a.id, slug: x.a.slug, team: x.team,
          workUrl: originOf(workHost(x.a.slug, x.team)),
          publicUrl: x.a.publicName ? originOf(publicHost(x.a.publicName)) : null,
          publicVersion: x.a.publicVersion,
        } : null;
        return {
          ...r,
          app: info,
          ...(status === 'pending' && r.kind === 'publish' && x ? { sourceFiles: await sourceFiles(x.team, x.a.sourcePath) } : {}),
        };
      })),
    };
  });

  app.post('/api/v1/admin/deploy-requests/:id/approve', { preHandler: requirePlatformAdmin },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { note } = z.object({ note: z.string().max(2000).optional() }).parse(req.body ?? {});
      const [r] = await db.select().from(deployRequests).where(eq(deployRequests.id, req.params.id));
      if (!r || r.status !== 'pending') throw new ApiError(404, 'NOT_FOUND');
      const a = await loadApp(r.appId);
      const team = await teamOf(a);
      // Versions keep counting across unpublish → publish again (app_versions keeps the history).
      const [last] = await db.select({ v: sql<number>`coalesce(max(${appVersions.version}), 0)::int` })
        .from(appVersions).where(eq(appVersions.appId, a.id));
      const version = Math.max(a.publicVersion ?? 0, last?.v ?? 0) + 1;
      // Snapshot first (filesystem), then flip the records in one transaction.
      const snapshotPath = await takeSnapshot(a, team.name, version);
      await db.transaction(async (tx) => {
        if (r.kind === 'publish') {
          const reserved = await tx.insert(names).values({ name: r.requestedName!, kind: 'public_app', ownerId: a.id }).onConflictDoNothing().returning();
          if (reserved.length === 0) throw new ApiError(409, 'NAME_TAKEN');
        }
        await tx.update(apps).set({
          ...(r.kind === 'publish' ? { publicName: r.requestedName } : {}),
          publicVersion: version,
          publicSnapshotPath: snapshotPath,
          publicPublishedAt: sql`now()`,
          publicApprovedBy: actor(req),
          updatedAt: sql`now()`,
        }).where(eq(apps.id, a.id));
        await tx.insert(appVersions).values({ appId: a.id, version, snapshotPath, requestId: r.id, approvedBy: actor(req) });
        await tx.update(deployRequests).set({ status: 'approved', decidedBy: actor(req), decidedAt: sql`now()`, decisionNote: note ?? null, approvedVersion: version })
          .where(eq(deployRequests.id, r.id));
        await audit({ actorId: actor(req), action: 'deploy.approve', targetType: 'app', targetId: a.id, teamId: a.teamId, detail: { kind: r.kind, version, name: r.requestedName ?? a.publicName } }, tx);
      });
      invalidateTeamCaches();
      // publish: start the public copy. update: a new versioned container replaces the old one (zero downtime).
      await startCopy(await loadApp(a.id), 'public');
      return reply.code(202).send({ version });
    });

  app.post('/api/v1/admin/deploy-requests/:id/reject', { preHandler: requirePlatformAdmin },
    async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const { note } = z.object({ note: z.string().trim().min(1).max(2000) }).parse(req.body);
      const updated = await db.update(deployRequests).set({ status: 'rejected', decidedBy: actor(req), decidedAt: sql`now()`, decisionNote: note })
        .where(and(eq(deployRequests.id, req.params.id), eq(deployRequests.status, 'pending'))).returning();
      if (updated.length === 0) throw new ApiError(404, 'NOT_FOUND');
      const [a] = await db.select().from(apps).where(eq(apps.id, updated[0]!.appId));
      await audit({ actorId: actor(req), action: 'deploy.reject', targetType: 'app', targetId: updated[0]!.appId, teamId: a?.teamId, detail: { note } });
      const [out] = await requestsOut(updated);
      return out;
    });

  app.get('/api/v1/admin/apps', { preHandler: requirePlatformAdmin }, async (req) => {
    const q = z.object({ public: z.stringbool().optional(), team: z.string().optional() }).parse(req.query);
    const where = [isNull(apps.deletedAt)];
    if (q.public) where.push(isNotNull(apps.publicVersion));
    if (q.team) {
      const [t] = await db.select({ id: teams.id }).from(teams).where(eq(teams.name, q.team));
      if (!t) return { items: [] };
      where.push(eq(apps.teamId, t.id));
    }
    return { items: await appsOut(await db.select().from(apps).where(and(...where)).orderBy(apps.slug)) };
  });

  app.post('/api/v1/admin/apps/:appId/public/:action', { preHandler: requirePlatformAdmin },
    async (req: FastifyRequest<{ Params: { appId: string; action: string } }>, reply) => {
      const action = z.enum(['force-stop', 'resume']).parse(req.params.action);
      const a = await loadApp(req.params.appId);
      if (a.publicVersion === null) throw new ApiError(409, 'APP_NOT_PUBLIC');
      if (action === 'force-stop') {
        const { reason } = z.object({ reason: z.string().trim().min(1).max(500) }).parse(req.body);
        // Only the public copy stops; the work copy is untouched (A-09).
        await stopCopy(a, 'public', 'admin', reason);
        await audit({ actorId: actor(req), action: 'app.force_stop', targetType: 'app', targetId: a.id, teamId: a.teamId, detail: { reason } });
      } else {
        if (!(a.publicStatus === 'stopped' && a.publicStopReason === 'admin')) throw new ApiError(409, 'APP_STATE_CONFLICT');
        await db.update(apps).set({ publicStopReason: 'manual', publicStatusDetail: null }).where(eq(apps.id, a.id));
        await startCopy(await loadApp(a.id), 'public');
        await audit({ actorId: actor(req), action: 'app.force_resume', targetType: 'app', targetId: a.id, teamId: a.teamId });
      }
      return reply.code(202).send();
    });
}
