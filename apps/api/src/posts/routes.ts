import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { NAME_PATTERN } from '@kacp/shared';
import { requireAuth, requirePlatformAdmin } from '../auth/guards.js';
import { audit } from '../audit.js';
import { db } from '../db/client.js';
import { apps, mcpPackages, postCategories, postComments, posts, teams } from '../db/schema.js';
import { newId } from '../lib/crypto.js';
import { ApiError } from '../lib/errors.js';
import { originOf, publicHost } from '../apps/service.js';
import { packagesOut, userRefs } from '../mcp/service.js';
import { CATEGORY_KEY, canEditPost, canUseCategory, categoryListProblem, likePattern } from './logic.js';
import { notify } from '../notify/service.js';

// 커뮤니티 (U-13, 04-api.md §2 /posts). Everyone signed in reads, writes and comments. Categories are
// managed by platform admins; admin-only ones (공지) take posts from platform admins only.

type PostRow = typeof posts.$inferSelect;
const PAGE = 50;
const viewer = (req: FastifyRequest) => req.session!.user;

const Input = z.object({
  category: z.string().regex(CATEGORY_KEY),
  title: z.string().trim().min(1, '제목을 입력하세요.').max(200),
  bodyMd: z.string().max(50_000).default(''),
  attachedPackage: z.string().regex(NAME_PATTERN).nullable().optional(),
  attachedAppId: z.uuid().nullable().optional(),
});

async function categoryMap() {
  const rows = await db.select().from(postCategories).orderBy(asc(postCategories.sortOrder), asc(postCategories.key));
  return new Map(rows.map((c) => [c.key, c]));
}

async function requireCategory(req: FastifyRequest, key: string) {
  const c = (await categoryMap()).get(key);
  if (!c) throw new ApiError(422, 'VALIDATION_FAILED', undefined, '없는 분류예요.');
  if (!canUseCategory(viewer(req), c)) {
    throw new ApiError(403, 'FORBIDDEN', undefined, c.hidden ? '지금은 글을 쓸 수 없는 분류예요.' : `"${c.label}" 분류는 플랫폼 관리자만 쓸 수 있어요.`);
  }
}

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
  const cats = await categoryMap();
  const counts = rows.length
    ? new Map((await db.select({ postId: postComments.postId, n: count() }).from(postComments)
      .where(and(inArray(postComments.postId, rows.map((r) => r.id)), isNull(postComments.deletedAt))).groupBy(postComments.postId)).map((c) => [c.postId, c.n]))
    : new Map<string, number>();
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    categoryLabel: cats.get(r.category)?.label ?? r.category,
    commentCount: counts.get(r.id) ?? 0,
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
      category: z.string().regex(CATEGORY_KEY).optional(),
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
    await requireCategory(req, body.category);
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
      if (body.category && body.category !== p.category) await requireCategory(req, body.category);
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

  // ── categories ──

  app.get('/api/v1/post-categories', { preHandler: requireAuth }, async (req) => {
    const admin = viewer(req).platformRole === 'admin';
    const items = [...(await categoryMap()).values()].filter((c) => admin || !c.hidden).map((c) => ({
      key: c.key, label: c.label, adminOnly: c.adminOnly, hidden: c.hidden, canPost: canUseCategory(viewer(req), c),
    }));
    return { items };
  });

  /** Whole list in display order: add, rename, reorder, hide, or remove (only when it has no posts). */
  app.put('/api/v1/admin/post-categories', { preHandler: requirePlatformAdmin }, async (req) => {
    const { items } = z.object({
      items: z.array(z.object({
        key: z.string().trim(), label: z.string().trim().max(30), adminOnly: z.boolean().default(false), hidden: z.boolean().default(false),
      })).max(30),
    }).parse(req.body);
    const used = new Set((await db.selectDistinct({ c: posts.category }).from(posts).where(isNull(posts.deletedAt))).map((r) => r.c));
    const problem = categoryListProblem(items, used);
    if (problem) throw new ApiError(422, 'VALIDATION_FAILED', undefined, problem);
    const before = [...(await categoryMap()).values()];
    await db.transaction(async (tx) => {
      const keep = items.map((c) => c.key);
      const gone = before.filter((c) => !keep.includes(c.key)).map((c) => c.key);
      if (gone.length) await tx.delete(postCategories).where(inArray(postCategories.key, gone));
      for (const [i, c] of items.entries()) {
        await tx.insert(postCategories).values({ key: c.key, label: c.label, sortOrder: i, adminOnly: c.adminOnly, hidden: c.hidden })
          .onConflictDoUpdate({ target: postCategories.key, set: { label: c.label, sortOrder: i, adminOnly: c.adminOnly, hidden: c.hidden } });
      }
      await audit({
        actorId: viewer(req).id, action: 'post_category.update', targetType: 'settings', targetId: 'post_categories',
        detail: { before: before.map((c) => c.key), after: items.map((c) => c.key) }, ip: req.ip,
      }, tx);
    });
    return { items: [...(await categoryMap()).values()].map((c) => ({ key: c.key, label: c.label, adminOnly: c.adminOnly, hidden: c.hidden, canPost: true })) };
  });

  // ── comments ──

  const commentsOut = async (req: FastifyRequest, rows: (typeof postComments.$inferSelect)[]) => {
    const authors = await userRefs(rows.map((r) => r.authorId));
    return rows.map((c) => ({
      id: c.id, body: c.body, author: authors.get(c.authorId) ?? null, createdAt: c.createdAt.toISOString(), canDelete: canEditPost(viewer(req), c.authorId),
    }));
  };

  app.get('/api/v1/posts/:id/comments', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const p = await loadPost(req.params.id);
      const rows = await db.select().from(postComments).where(and(eq(postComments.postId, p.id), isNull(postComments.deletedAt))).orderBy(asc(postComments.createdAt));
      return { items: await commentsOut(req, rows) };
    });

  app.post('/api/v1/posts/:id/comments', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const p = await loadPost(req.params.id);
      const { body } = z.object({ body: z.string().trim().min(1, '내용을 입력하세요.').max(2000) }).parse(req.body);
      const [c] = await db.insert(postComments).values({ id: newId(), postId: p.id, authorId: viewer(req).id, body }).returning();
      void notify([p.authorId], { type: 'post_commented', title: `"${p.title}"에 댓글이 달렸어요: ${body.slice(0, 60)}`, link: `/community/${p.id}` }, viewer(req).id);
      return reply.code(201).send((await commentsOut(req, [c!]))[0]);
    });

  app.delete('/api/v1/posts/:id/comments/:commentId', { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { id: string; commentId: string } }>, reply) => {
      const p = await loadPost(req.params.id);
      if (!z.uuid().safeParse(req.params.commentId).success) throw new ApiError(404, 'NOT_FOUND');
      const [c] = await db.select().from(postComments)
        .where(and(eq(postComments.id, req.params.commentId), eq(postComments.postId, p.id), isNull(postComments.deletedAt)));
      if (!c) throw new ApiError(404, 'NOT_FOUND');
      const v = viewer(req);
      if (!canEditPost(v, c.authorId)) throw new ApiError(403, 'FORBIDDEN');
      await db.update(postComments).set({ deletedAt: sql`now()` }).where(eq(postComments.id, c.id));
      if (v.id !== c.authorId) {
        await audit({ actorId: v.id, action: 'post_comment.delete', targetType: 'post', targetId: p.id, detail: { commentAuthorId: c.authorId }, ip: req.ip });
      }
      return reply.code(204).send();
    });
}
