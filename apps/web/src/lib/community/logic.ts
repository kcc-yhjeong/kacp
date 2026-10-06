import { ApiError } from '@/lib/api';

// U-13 community rules that do not need React. Mirrors apps/api/src/posts/logic.ts.

export const POST_CATEGORIES = ['notice', 'question', 'tip', 'mcp_share', 'app_share'] as const;
export type PostCategory = (typeof POST_CATEGORIES)[number];

export const POST_CATEGORY_LABEL: Record<PostCategory, string> = {
  notice: '공지',
  question: '질문',
  tip: '팁',
  mcp_share: 'MCP 공유',
  app_share: '앱 자랑',
};

export const TITLE_MAX = 200;
export const BODY_MAX = 50_000;

export function isPostCategory(v: unknown): v is PostCategory {
  return typeof v === 'string' && (POST_CATEGORIES as readonly string[]).includes(v);
}

export function categoryLabel(c: string): string {
  return isPostCategory(c) ? POST_CATEGORY_LABEL[c] : c;
}

/** 공지 is for platform admins only. */
export function canUseCategory(category: PostCategory, platformRole: string | undefined): boolean {
  return category !== 'notice' || platformRole === 'admin';
}

/** Categories the writer may pick (공지 only for platform admins). */
export function selectableCategories(platformRole: string | undefined): PostCategory[] {
  return POST_CATEGORIES.filter((c) => canUseCategory(c, platformRole));
}

export interface PostForm {
  category: PostCategory | '';
  title: string;
  bodyMd: string;
  /** Package name or null. */
  attachedPackage: string | null;
  /** Public app id or null. */
  attachedAppId: string | null;
}

export type PostFormField = 'category' | 'title' | 'bodyMd' | 'attachedPackage' | 'attachedAppId';
export type PostFormErrors = Partial<Record<PostFormField | 'form', string>>;

export function validatePostForm(f: PostForm, platformRole: string | undefined): PostFormErrors {
  const e: PostFormErrors = {};
  if (!f.category) e.category = '분류를 고르세요.';
  else if (!canUseCategory(f.category, platformRole)) e.category = '공지 분류는 플랫폼 관리자만 쓸 수 있어요.';
  const title = f.title.trim();
  if (!title) e.title = '제목을 입력하세요.';
  else if (title.length > TITLE_MAX) e.title = `제목은 ${TITLE_MAX}자까지 쓸 수 있어요.`;
  if (f.bodyMd.length > BODY_MAX) e.bodyMd = `본문은 ${BODY_MAX.toLocaleString()}자까지 쓸 수 있어요.`;
  return e;
}

export const hasErrors = (e: PostFormErrors) => Object.keys(e).length > 0;

/** `POST /posts` body. Call after `validatePostForm` passes. */
export function createBody(f: PostForm) {
  return {
    category: f.category as PostCategory,
    title: f.title.trim(),
    bodyMd: f.bodyMd,
    attachedPackage: f.attachedPackage,
    attachedAppId: f.attachedAppId,
  };
}

/**
 * `PATCH /posts/{id}` body: changed fields only. Attachments are sent only when they changed
 * (null clears), so an app that stopped being public does not fail an unrelated edit with 422.
 */
export function patchBody(original: PostForm, f: PostForm) {
  const out: {
    category?: PostCategory;
    title?: string;
    bodyMd?: string;
    attachedPackage?: string | null;
    attachedAppId?: string | null;
  } = {};
  if (f.category && f.category !== original.category) out.category = f.category;
  if (f.title.trim() !== original.title.trim()) out.title = f.title.trim();
  if (f.bodyMd !== original.bodyMd) out.bodyMd = f.bodyMd;
  if (f.attachedPackage !== original.attachedPackage) out.attachedPackage = f.attachedPackage;
  if (f.attachedAppId !== original.attachedAppId) out.attachedAppId = f.attachedAppId;
  return out;
}

/** API error → the field it belongs to, with Korean copy (422 attachments, 403 공지/권한). */
export function postSaveError(err: unknown, category: PostCategory | ''): PostFormErrors {
  if (err instanceof ApiError) {
    if (err.code === 'MCP_NOT_PUBLISHED') return { attachedPackage: '게시 중인 MCP만 첨부할 수 있어요. 다른 MCP를 고르세요.' };
    if (err.code === 'APP_NOT_PUBLIC') return { attachedAppId: '공개 중인 앱만 첨부할 수 있어요. 다른 앱을 고르세요.' };
    if (err.status === 403) {
      return category === 'notice'
        ? { category: '공지 분류는 플랫폼 관리자만 쓸 수 있어요.' }
        : { form: '이 글을 고칠 권한이 없어요. 작성자나 플랫폼 관리자만 고칠 수 있어요.' };
    }
    if (err.status === 404) return { form: '글을 찾을 수 없어요. 이미 삭제됐을 수 있어요.' };
    return { form: err.message };
  }
  return { form: '저장하지 못했어요. 잠시 후 다시 시도하세요.' };
}
