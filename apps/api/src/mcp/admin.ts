import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { McpManifest } from '@kacp/shared';
import { requirePlatformAdmin } from '../auth/guards.js';
import { audit } from '../audit.js';
import { db } from '../db/client.js';
import { mcpInstalls, mcpPackages, mcpVersions, teams } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import { orchestrator } from '../orchestrator.js';
import { readLog } from './routes.js';
import { manifestChanges } from './logic.js';
import { installsOut, packagesOut, removeInstall, upgradeInstalls, versionDir, versionsOut, type VersionRow } from './service.js';

// MCP 심사·관리 (A-07, A-08). Platform admins only.

const actor = (req: FastifyRequest) => req.session!.user.id;

async function versionById(id: string) {
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, 'MCP_NOT_FOUND');
  const [v] = await db.select().from(mcpVersions).where(eq(mcpVersions.id, id));
  if (!v) throw new ApiError(404, 'MCP_NOT_FOUND');
  const [p] = await db.select().from(mcpPackages).where(eq(mcpPackages.id, v.packageId));
  return { v, p: p! };
}


export async function adminMcpRoutes(app: FastifyInstance) {
  app.get('/api/v1/admin/mcp/reviews', { preHandler: requirePlatformAdmin }, async () => {
    const rows = await db.select().from(mcpVersions).where(eq(mcpVersions.status, 'in_review')).orderBy(asc(mcpVersions.stageAt));
    return { items: await versionsOut(rows) };
  });

  app.get('/api/v1/admin/mcp/versions/:id', { preHandler: requirePlatformAdmin },
    async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const { v, p } = await versionById(req.params.id);
      const [prev] = p.latestVersionId && p.latestVersionId !== v.id
        ? await db.select().from(mcpVersions).where(eq(mcpVersions.id, p.latestVersionId)) : [];
      const [out] = await versionsOut([v]);
      const [prevOut] = prev ? await versionsOut([prev]) : [];
      return {
        ...out!,
        readme: v.readme,
        findings: v.scanFindings ?? [],
        previous: prevOut ?? null,
        changes: manifestChanges((prev?.manifest as McpManifest | undefined) ?? null, v.manifest as McpManifest),
        package: (await packagesOut([p]))[0],
      };
    });

  app.get('/api/v1/admin/mcp/versions/:id/logs', { preHandler: requirePlatformAdmin },
    async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const { stage } = z.object({ stage: z.enum(['build', 'scan', 'test']) }).parse(req.query);
      const { v, p } = await versionById(req.params.id);
      return { text: await readLog(p.name, v.version, stage) };
    });

  app.get('/api/v1/admin/mcp/versions/:id/source', { preHandler: requirePlatformAdmin },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { v, p } = await versionById(req.params.id);
      const file = `${versionDir(p.name, v.version)}/source.zip`;
      const st = await stat(file).catch(() => null);
      if (!st) throw new ApiError(404, 'MCP_NOT_FOUND');
      return reply
        .header('content-type', 'application/zip')
        .header('content-length', st.size)
        .header('content-disposition', `attachment; filename="${p.name}-${v.version}.zip"`)
        .send(createReadStream(file));
    });

  app.post('/api/v1/admin/mcp/versions/:id/approve', { preHandler: requirePlatformAdmin },
    async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const { note } = z.object({ note: z.string().trim().max(1000).optional() }).parse(req.body ?? {});
      const { v, p } = await versionById(req.params.id);
      const won = await db.update(mcpVersions)
        .set({ status: 'published', reviewedBy: actor(req), reviewedAt: sql`now()`, reviewNote: note || null, publishedAt: sql`now()` })
        .where(and(eq(mcpVersions.id, v.id), eq(mcpVersions.status, 'in_review'))).returning();
      if (!won.length) throw new ApiError(409, 'MCP_STATE_CONFLICT');
      await db.update(mcpVersions).set({ status: 'superseded' })
        .where(and(eq(mcpVersions.packageId, p.id), eq(mcpVersions.status, 'published'), ne(mcpVersions.id, v.id)));
      const m = v.manifest as McpManifest;
      const [pkg] = await db.update(mcpPackages).set({
        latestVersionId: v.id, displayName: m.displayName, summary: m.summary, category: m.category, icon: m.icon ?? null, updatedAt: sql`now()`,
      }).where(eq(mcpPackages.id, p.id)).returning();
      await audit({ actorId: actor(req), action: 'mcp.approve', targetType: 'mcp_version', targetId: v.id, detail: { package: p.name, version: v.version }, ip: req.ip });
      if (p.latestVersionId) {
        await upgradeInstalls(pkg!, won[0] as VersionRow);
        // Installs now run the new version; the old image is untagged (running containers keep their layers).
        const [old] = await db.select({ version: mcpVersions.version }).from(mcpVersions).where(eq(mcpVersions.id, p.latestVersionId));
        if (old) void orchestrator.mcpRemoveImage(p.name, old.version).catch(() => undefined);
      }
      return (await versionsOut(won))[0];
    });

  app.post('/api/v1/admin/mcp/versions/:id/reject', { preHandler: requirePlatformAdmin },
    async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const { note } = z.object({ note: z.string().trim().min(1, '반려 사유를 적어 주세요.').max(1000) }).parse(req.body);
      const { v, p } = await versionById(req.params.id);
      const won = await db.update(mcpVersions)
        .set({ status: 'rejected', reviewedBy: actor(req), reviewedAt: sql`now()`, reviewNote: note })
        .where(and(eq(mcpVersions.id, v.id), eq(mcpVersions.status, 'in_review'))).returning();
      if (!won.length) throw new ApiError(409, 'MCP_STATE_CONFLICT');
      void orchestrator.mcpRemoveImage(p.name, v.version).catch(() => undefined);
      await audit({ actorId: actor(req), action: 'mcp.reject', targetType: 'mcp_version', targetId: v.id, detail: { package: p.name, version: v.version, note }, ip: req.ip });
      return (await versionsOut(won))[0];
    });

  // ── A-08 ──

  app.get('/api/v1/admin/mcp/packages', { preHandler: requirePlatformAdmin }, async () => {
    const rows = await db.select().from(mcpPackages).orderBy(desc(mcpPackages.isPlatform), mcpPackages.name);
    const pending = await db.select({ packageId: mcpVersions.packageId, n: sql<number>`count(*)::int` }).from(mcpVersions)
      .where(eq(mcpVersions.status, 'in_review')).groupBy(mcpVersions.packageId);
    const pendingBy = new Map(pending.map((r) => [r.packageId, r.n]));
    const out = await packagesOut(rows);
    return { items: out.map((p, i) => ({ ...p, pendingReviews: pendingBy.get(rows[i]!.id) ?? 0 })) };
  });

  app.post('/api/v1/admin/mcp/packages/:pkg/suspend', { preHandler: requirePlatformAdmin },
    async (req: FastifyRequest<{ Params: { pkg: string } }>) => {
      const { removeInstalls } = z.object({ removeInstalls: z.boolean().default(false) }).parse(req.body ?? {});
      const [p] = await db.select().from(mcpPackages).where(eq(mcpPackages.name, req.params.pkg));
      if (!p) throw new ApiError(404, 'MCP_NOT_FOUND');
      if (p.isPlatform) throw new ApiError(409, 'MCP_PLATFORM_LOCKED');
      await db.update(mcpPackages).set({ status: 'suspended', isDefault: false, updatedAt: sql`now()` }).where(eq(mcpPackages.id, p.id));
      let removed = 0;
      if (removeInstalls) {
        const rows = await db.select({ i: mcpInstalls, team: teams.name }).from(mcpInstalls).innerJoin(teams, eq(teams.id, mcpInstalls.teamId))
          .where(and(eq(mcpInstalls.packageId, p.id), ne(mcpInstalls.status, 'removing')));
        for (const { i, team } of rows) {
          await removeInstall({ name: team }, i).then(() => removed++, () => undefined);
        }
      }
      await audit({ actorId: actor(req), action: 'mcp.suspend', targetType: 'mcp_package', targetId: p.name, detail: { removeInstalls, removed }, ip: req.ip });
      return (await packagesOut([{ ...p, status: 'suspended', isDefault: false }]))[0];
    });

  app.post('/api/v1/admin/mcp/packages/:pkg/resume', { preHandler: requirePlatformAdmin },
    async (req: FastifyRequest<{ Params: { pkg: string } }>) => {
      const [p] = await db.update(mcpPackages).set({ status: 'active', updatedAt: sql`now()` })
        .where(and(eq(mcpPackages.name, req.params.pkg), eq(mcpPackages.isPlatform, false))).returning();
      if (!p) throw new ApiError(404, 'MCP_NOT_FOUND');
      await audit({ actorId: actor(req), action: 'mcp.resume', targetType: 'mcp_package', targetId: p.name, ip: req.ip });
      return (await packagesOut([p]))[0];
    });

  app.put('/api/v1/admin/mcp/packages/:pkg/default', { preHandler: requirePlatformAdmin },
    async (req: FastifyRequest<{ Params: { pkg: string } }>) => {
      const { isDefault } = z.object({ isDefault: z.boolean() }).parse(req.body);
      const [cur] = await db.select().from(mcpPackages).where(eq(mcpPackages.name, req.params.pkg));
      if (!cur) throw new ApiError(404, 'MCP_NOT_FOUND');
      if (cur.isPlatform) throw new ApiError(409, 'MCP_PLATFORM_LOCKED');
      if (isDefault && (cur.status !== 'active' || !cur.latestVersionId)) throw new ApiError(409, 'MCP_NOT_PUBLISHED');
      const [p] = await db.update(mcpPackages).set({ isDefault, updatedAt: sql`now()` }).where(eq(mcpPackages.id, cur.id)).returning();
      await audit({ actorId: actor(req), action: 'mcp.set_default', targetType: 'mcp_package', targetId: cur.name, detail: { isDefault }, ip: req.ip });
      return (await packagesOut([p!]))[0];
    });

  app.get('/api/v1/admin/mcp/installs', { preHandler: requirePlatformAdmin }, async (req) => {
    const q = z.object({ team: z.string().optional(), source: z.enum(['default', 'market', 'manual']).optional() }).parse(req.query);
    const conds = [isNull(teams.deletedAt)];
    if (q.team) conds.push(eq(teams.name, q.team));
    if (q.source) conds.push(eq(mcpInstalls.source, q.source));
    const rows = await db.select({ i: mcpInstalls, team: teams.name }).from(mcpInstalls).innerJoin(teams, eq(teams.id, mcpInstalls.teamId))
      .where(and(...conds)).orderBy(teams.name, mcpInstalls.serverKey);
    const out = await installsOut(rows.map((r) => r.i));
    return { items: out.map((o, i) => ({ ...o, team: rows[i]!.team })) };
  });

  // Force remove from A-05 (any source except the platform row).
  app.delete('/api/v1/admin/mcp/installs/:id', { preHandler: requirePlatformAdmin },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      if (!z.uuid().safeParse(req.params.id).success) throw new ApiError(404, 'MCP_NOT_FOUND');
      const [r] = await db.select({ i: mcpInstalls, t: teams }).from(mcpInstalls).innerJoin(teams, eq(teams.id, mcpInstalls.teamId))
        .where(eq(mcpInstalls.id, req.params.id));
      if (!r) throw new ApiError(404, 'MCP_NOT_FOUND');
      if (r.i.source === 'manual') {
        if (r.t.containerStatus === 'running') await orchestrator.mcpManual(r.t.name, r.i.serverKey, null);
        await db.delete(mcpInstalls).where(eq(mcpInstalls.id, r.i.id));
      } else {
        await removeInstall(r.t, r.i);
      }
      await audit({ actorId: actor(req), action: 'mcp.remove', targetType: 'mcp_package', targetId: r.i.serverKey, teamId: r.t.id, detail: { source: r.i.source, forced: true }, ip: req.ip });
      return reply.code(202).send({ ok: true });
    });

}
