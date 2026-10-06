// Community rules (U-13, docs/README.md 7단계), tested without a database.

export const POST_CATEGORIES = ['notice', 'question', 'tip', 'mcp_share', 'app_share'] as const;
export type PostCategory = (typeof POST_CATEGORIES)[number];

export interface Viewer { id: string; platformRole: string }

/** 공지 is for platform admins only. */
export const canUseCategory = (v: Viewer, c: PostCategory) => c !== 'notice' || v.platformRole === 'admin';

/** Author or platform admin. */
export const canEditPost = (v: Viewer, authorId: string) => v.id === authorId || v.platformRole === 'admin';

/** Search text for ILIKE: `%`, `_` and `\` are literal. */
export const likePattern = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
