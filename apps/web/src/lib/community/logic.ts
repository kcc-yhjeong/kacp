import { ApiError } from '@/lib/api';

// U-13 community rules that do not need React. Mirrors apps/api/src/posts/logic.ts.

/** Category keys are managed by platform admins (`GET /post-categories`). Mirrors api CATEGORY_KEY. */
export type PostCategory = string;

export interface PostCategoryInfo {
  key: string;
  label: string;
  adminOnly: boolean;
  hidden: boolean;
  /** Whether the viewer may post in it (admin-only and hidden ones are false for normal users). */
  canPost: boolean;
}

export const TITLE_MAX = 200;
export const BODY_MAX = 50_000;
export const COMMENT_MAX = 2000;
export const CATEGORY_LABEL_MAX = 30;

/** Lowercase letter first, then lowercase letters, digits or `_`; 2–30 characters. */
export const CATEGORY_KEY = /^[a-z][a-z0-9_]{1,29}$/;

export function isCategoryKey(v: unknown): v is PostCategory {
  return typeof v === 'string' && CATEGORY_KEY.test(v);
}

export function categoryKeyProblem(key: string): string | null {
  if (!key) return '코드를 입력하세요.';
  if (key.length < 2 || key.length > 30) return '코드는 2~30자로 입력하세요.';
  if (!CATEGORY_KEY.test(key)) return '영문 소문자로 시작하고 소문자·숫자·밑줄(_)만 쓸 수 있어요.';
  return null;
}

export interface CategoryRow {
  key: string;
  label: string;
  adminOnly: boolean;
  hidden: boolean;
}

/** Client check before `PUT /admin/post-categories` (the api also refuses removing categories that have posts). */
export function categoryListProblem(rows: CategoryRow[]): string | null {
  if (rows.length === 0) return '분류가 하나는 있어야 해요.';
  const keys = new Set<string>();
  for (const r of rows) {
    const p = categoryKeyProblem(r.key);
    if (p) return `분류 코드 "${r.key}": ${p}`;
    if (!r.label.trim()) return '분류 이름을 입력하세요.';
    if (r.label.trim().length > CATEGORY_LABEL_MAX) return `분류 이름은 ${CATEGORY_LABEL_MAX}자까지 쓸 수 있어요.`;
    if (keys.has(r.key)) return `분류 코드 "${r.key}"가 겹쳐요.`;
    keys.add(r.key);
  }
  if (!rows.some((r) => !r.hidden && !r.adminOnly)) return '누구나 쓸 수 있는 분류가 하나는 있어야 해요.';
  return null;
}

/** Label for a key; unknown keys show the key itself. */
export function categoryLabel(categories: PostCategoryInfo[] | undefined, key: string): string {
  return categories?.find((c) => c.key === key)?.label ?? key;
}

/** Categories the writer may pick. The post's current category stays selectable on edit. */
export function selectableCategories(categories: PostCategoryInfo[], current?: string): PostCategoryInfo[] {
  return categories.filter((c) => c.canPost || c.key === current);
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

/**
 * `categories` = `GET /post-categories`. `keep` = the post's current category on edit (allowed even when the
 * writer could not pick it now, since the api checks only a changed category).
 */
export function validatePostForm(f: PostForm, categories: PostCategoryInfo[], keep?: string): PostFormErrors {
  const e: PostFormErrors = {};
  const c = categories.find((x) => x.key === f.category);
  if (!f.category) e.category = '분류를 고르세요.';
  else if (f.category !== keep && !c) e.category = '없는 분류예요. 다른 분류를 고르세요.';
  else if (f.category !== keep && c && !c.canPost)
    e.category = c.hidden ? '지금은 글을 쓸 수 없는 분류예요.' : `"${c.label}" 분류는 플랫폼 관리자만 쓸 수 있어요.`;
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
    category: f.category,
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

/**
 * API error → the field it belongs to, with Korean copy (422 attachments, 403 category/권한).
 * `categoryRestricted` = the chosen category is admin-only or hidden, so a 403 is about the category.
 */
export function postSaveError(err: unknown, categoryRestricted: boolean): PostFormErrors {
  if (err instanceof ApiError) {
    if (err.code === 'MCP_NOT_PUBLISHED') return { attachedPackage: '게시 중인 MCP만 첨부할 수 있어요. 다른 MCP를 고르세요.' };
    if (err.code === 'APP_NOT_PUBLIC') return { attachedAppId: '공개 중인 앱만 첨부할 수 있어요. 다른 앱을 고르세요.' };
    if (err.status === 403) {
      return categoryRestricted
        ? { category: err.message || '이 분류에는 글을 쓸 수 없어요.' }
        : { form: '이 글을 고칠 권한이 없어요. 작성자나 플랫폼 관리자만 고칠 수 있어요.' };
    }
    if (err.status === 404) return { form: '글을 찾을 수 없어요. 이미 삭제됐을 수 있어요.' };
    return { form: err.message };
  }
  return { form: '저장하지 못했어요. 잠시 후 다시 시도하세요.' };
}

/** Comment body check (1–2000 characters after trimming the ends). */
export function commentProblem(body: string): string | null {
  const t = body.trim();
  if (!t) return '댓글을 입력하세요.';
  if (t.length > COMMENT_MAX) return `댓글은 ${COMMENT_MAX.toLocaleString()}자까지 쓸 수 있어요.`;
  return null;
}
