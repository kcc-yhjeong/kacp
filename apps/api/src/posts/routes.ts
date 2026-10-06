import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, ilike, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { NAME_PATTERN } from '@kacp/shared';
import { requireAuth } from '../auth/guards.js';
import { audit } from '../audit.js';
import { db } from '../db/client.js';
import { apps, mcpPackages, posts, teams } from '../db/schema.js';
import { newId } from '../lib/crypto.js';
import { ApiError } from '../lib/errors.js';
import { originOf, publicHost } from '../apps/service.js';
import { packagesOut, userRefs } from '../mcp/service.js';
import { canEditPost, canUseCategory, likePattern, POST_CATEGORIES } from './logic.js';

// 커뮤니티 (U-13, 04-api.md §2 /posts). Everyone signed in reads and writes; 공지 is admins only.

type PostRow = typeof posts.$inferSelect;
const PAGE = 50;
const viewer = (req: FastifyRequest) => req.session!.user;

const Input = z.object({
  category: z.enum(POST_CATEGORIES),
  title: z.string().trim().min(1, '제목을 입력하세요.').max(200),
  bodyMd: z.string().max(50_000).default(''),
  attachedPackage: z.string().regex(NAME_PATTERN).nullable().optional(),
  attachedAppId: z.uuid().nullable().optional(),
});

/** Attachments: a published, active MCP package; a public app. null clears, undefined keeps. */
async function resolveAttachments(body: { attachedPackage?: string | null; attachedAppId?: string | null }) {
  const out: { attachedPackageId?: string | null; attachedAppId?: string | null } = {};
  if (body.attachedPackage === null) out.attachedPackageId = null;
  else if (body.attachedPackage) {
    const [p] = await db.select().from(mcpPackages).where(eq(mcpPackages.name, body.attachedPackage));
    if (!p || (!p.isPlatform && (p.status !== 'active' || !p.latestVersionId))) throw new ApiError(422, 'MCP_NOT_PUBLISHED');
    out.attachedPackageId = p.id;
  }
  if (body.attachedAppId === null) out.attachedAppId = null;
  else if (body.attachedAppId) {
    const [a] = await db.select().from(apps).where(and(eq(apps.id, body.attachedAppId), isNull(apps.deletedAt), isNotNull(apps.publicVersion)));
    if (!a) throw new ApiError(422, 'APP_NOT_PUBLIC');
    out.attachedAppId = a.id;
  }
  return out;
}

async function summaries(rows: PostRow[]) {
  const authors = await userRefs(rows.map((r) => r.authorId));
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    title: r.title,
    author: authors.get(r.authorId) ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    hasPackage: !!r.attachedPackageId,
    hasApp: !!r.attachedAppId,
  }));
}

async function loadPost(id: string) {
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, 'NOT_FOUND');
  const [p] = await db.select().from(posts).where(and(eq(posts.id, id), isNull(posts.deletedAt)));
  if (!p) throw new ApiError(404, 'NOT_FOUND');
  return p;
}

async function detail(req: FastifyRequest, p: PostRow, team: string | undefined) {
  const [summary] = await summaries([p]);
  let attachedPackage = null;
  if (p.attachedPackageId) {
    const [pkg] = await db.select().from(mcpPackages).where(eq(mcpPackages.id, p.attachedPackageId));
    if (pkg) {
      const teamId = team ? (await db.select({ id: teams.id }).from(teams).where(and(eq(teams.name, team), isNull(teams.deletedAt))))[0]?.id ?? null : null;
      [attachedPackage] = await packagesOut([pkg], teamId);
    }
  }
  let attachedApp = null;
  if (p.attachedAppId) {
    const [r] = await db.select({ a: apps, team: teams.name }).from(apps).innerJoin(teams, eq(teams.id, apps.teamId)).where(eq(apps.id, p.attachedAppId));
    // An unpublished or deleted app shows as gone instead of a dead link.
    attachedApp = r && r.a.publicName && !r.a.deletedAt
      ? { id: r.a.id, name: r.a.publicName, slug: r.a.slug, team: r.team, url: originOf(publicHost(r.a.publicName)), version: r.a.publicVersion, available: true }
      : { id: p.attachedAppId, name: null, slug: null, team: null, url: null, version: null, available: false };
  }
  return { ...summary!, bodyMd: p.bodyMd, attachedPackage, attachedApp, canEdit: canEditPost(viewer(req), p.authorId) };
}

export async function postRoutes(app: FastifyInstance) {
  app.get('/api/v1/posts', { preHandler: requireAuth }, async (req) => {
    const q = z.object({
      category: z.enum(POST_CATEGORIES).optional(),
      q: z.string().trim().max(100).optional(),
      cursor: z.iso.datetime().optional(),
    }).parse(req.query);
    const where = [isNull(posts.deletedAt)];
    if (q.category) where.push(eq(posts.category, q.category));
    if (q.q) where.push(or(ilike(posts.title, likePattern(q.q)), ilike(posts.bodyMd, likePattern(q.q)))!);
    if (q.cursor) where.push(lt(posts.createdAt, new Date(q.cursor)));
    const rows = await db.select().from(posts).where(and(...where)).orderBy(desc(posts.createdAt)).limit(PAGE + 1);
    const page = rows.slice(0, PAGE);
    return { items: await summaries(page), nextCursor: rows.length > PAGE ? page[page.length - 1]!.createdAt.toISOString() : null };
  });

  app.get('/api/v1/posts/:id', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const { team } = z.object({ team: z.string().regex(NAME_PATTERN).optional() }).parse(req.query);
      return detail(req, await loadPost(req.params.id), team);
    });

  app.post('/api/v1/posts', { preHandler: requireAuth }, async (req, reply) => {
    const body = Input.parse(req.body);
    if (!canUseCategory(viewer(req), body.category)) throw new ApiError(403, 'FORBIDDEN', undefined, '공지는 플랫폼 관리자만 쓸 수 있어요.');
    const att = await resolveAttachments(body);
    const [p] = await db.insert(posts).values({
      id: newId(), authorId: viewer(req).id, category: body.category, title: body.title, bodyMd: body.bodyMd,
      attachedPackageId: att.attachedPackageId ?? null, attachedAppId: att.attachedAppId ?? null,
    }).returning();
    return reply.code(201).send(await detail(req, p!, undefined));
  });

  app.patch('/api/v1/posts/:id', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const p = await loadPost(req.params.id);
      if (!canEditPost(viewer(req), p.authorId)) throw new ApiError(403, 'FORBIDDEN');
      const body = Input.partial().parse(req.body);
      if (body.category && !canUseCategory(viewer(req), body.category)) throw new ApiError(403, 'FORBIDDEN', undefined, '공지는 플랫폼 관리자만 쓸 수 있어요.');
      const att = await resolveAttachments(body);
      const [u] = await db.update(posts).set({
        ...(body.category ? { category: body.category } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.bodyMd !== undefined ? { bodyMd: body.bodyMd } : {}),
        ...att,
        updatedAt: sql`now()`,
      }).where(eq(posts.id, p.id)).returning();
      return detail(req, u!, undefined);
    });

  app.delete('/api/v1/posts/:id', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const p = await loadPost(req.params.id);
      const v = viewer(req);
      if (!canEditPost(v, p.authorId)) throw new ApiError(403, 'FORBIDDEN');
      await db.update(posts).set({ deletedAt: sql`now()` }).where(eq(posts.id, p.id));
      // Moderation leaves a trace; authors deleting their own posts do not.
      if (v.id !== p.authorId) {
        await audit({ actorId: v.id, action: 'post.delete', targetType: 'post', targetId: p.id, detail: { title: p.title, authorId: p.authorId }, ip: req.ip });
      }
      return reply.code(204).send();
    });

}
