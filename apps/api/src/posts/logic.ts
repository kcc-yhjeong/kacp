// Community rules (U-13, docs/README.md 7단계), tested without a database.

/** Category keys: admins create them, so keep them URL- and code-safe. */
export const CATEGORY_KEY = /^[a-z][a-z0-9_]{1,29}$/;

export interface Viewer { id: string; platformRole: string }
export interface CategoryRule { adminOnly: boolean; hidden: boolean }

/** Hidden categories take no new posts; admin-only ones (공지) only from platform admins. */
export function canUseCategory(v: Viewer, c: CategoryRule | undefined): boolean {
  if (!c || c.hidden) return false;
  return !c.adminOnly || v.platformRole === 'admin';
}

/** Author or platform admin (posts and comments). */
export const canEditPost = (v: Viewer, authorId: string) => v.id === authorId || v.platformRole === 'admin';

/** Search text for ILIKE: `%`, `_` and `\` are literal. */
export const likePattern = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

export interface CategoryInput { key: string; label: string; adminOnly: boolean; hidden: boolean }

/**
 * Admin edit of the whole category list (order = array order). Returns a Korean problem or null.
 * A category that still has posts can be hidden but not removed.
 */
export function categoryListProblem(next: CategoryInput[], usedKeys: Set<string>): string | null {
  if (!next.length) return '분류가 하나는 있어야 해요.';
  const keys = new Set<string>();
  for (const c of next) {
    if (!CATEGORY_KEY.test(c.key)) return `분류 코드 "${c.key}"는 영문 소문자로 시작하는 소문자·숫자·밑줄 2~30자여야 해요.`;
    if (!c.label.trim()) return '분류 이름을 입력하세요.';
    if (keys.has(c.key)) return `분류 코드 "${c.key}"가 겹쳐요.`;
    keys.add(c.key);
  }
  const removedInUse = [...usedKeys].filter((k) => !keys.has(k));
  if (removedInUse.length) return `글이 있는 분류는 지울 수 없어요(숨기기를 쓰세요): ${removedInUse.join(', ')}`;
  if (!next.some((c) => !c.hidden && !c.adminOnly)) return '누구나 쓸 수 있는 분류가 하나는 있어야 해요.';
  return null;
}
