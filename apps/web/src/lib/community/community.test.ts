import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  categoryKeyProblem,
  categoryLabel,
  categoryListProblem,
  COMMENT_MAX,
  commentProblem,
  createBody,
  hasErrors,
  isCategoryKey,
  patchBody,
  postSaveError,
  selectableCategories,
  TITLE_MAX,
  validatePostForm,
  type PostCategoryInfo,
  type PostForm,
} from './logic';

const cat = (key: string, label: string, over: Partial<PostCategoryInfo> = {}): PostCategoryInfo => ({
  key,
  label,
  adminOnly: false,
  hidden: false,
  canPost: true,
  ...over,
});

/** What a normal user gets from `GET /post-categories`. */
const USER_CATS = [
  cat('notice', '공지', { adminOnly: true, canPost: false }),
  cat('question', '질문'),
  cat('tip', '팁'),
  cat('mcp_share', 'MCP 공유'),
  cat('free', '자유게시판'),
];
/** Admins also see hidden ones and may post everywhere. */
const ADMIN_CATS = [...USER_CATS.map((c) => ({ ...c, canPost: true })), cat('old', '옛 분류', { hidden: true })];

const form = (over: Partial<PostForm> = {}): PostForm => ({
  category: 'tip',
  title: '주간 보고서 10분 만에',
  bodyMd: '## 준비',
  attachedPackage: null,
  attachedAppId: null,
  ...over,
});

describe('category keys', () => {
  it('accepts lowercase-first keys of 2–30 characters', () => {
    for (const k of ['qa', 'mcp_share', 'free', 'tip2', 'a'.repeat(30)]) {
      expect(categoryKeyProblem(k), k).toBeNull();
      expect(isCategoryKey(k)).toBe(true);
    }
  });

  it('rejects bad keys', () => {
    for (const k of ['', 'a', 'a'.repeat(31), '1tip', '_tip', 'Tip', 'mcp-share', 'free board', '자유']) {
      expect(categoryKeyProblem(k), k).not.toBeNull();
      expect(isCategoryKey(k)).toBe(false);
    }
    expect(isCategoryKey(undefined)).toBe(false);
  });

  it('checks the whole list before saving', () => {
    const rows = USER_CATS.map(({ key, label, adminOnly, hidden }) => ({ key, label, adminOnly, hidden }));
    const row = (key: string, label: string) => ({ key, label, adminOnly: false, hidden: false });
    expect(categoryListProblem(rows)).toBeNull();
    expect(categoryListProblem([])).not.toBeNull();
    expect(categoryListProblem([...rows, row('tip', '또 팁')])).toContain('겹쳐요');
    expect(categoryListProblem([...rows, row('News', '소식')])).toContain('News');
    expect(categoryListProblem([...rows, row('news', '  ')])).toContain('이름');
    expect(categoryListProblem([{ key: 'notice', label: '공지', adminOnly: true, hidden: false }])).toContain('누구나');
  });
});

describe('categories', () => {
  it('labels come from the list; unknown keys show the key', () => {
    expect(categoryLabel(USER_CATS, 'free')).toBe('자유게시판');
    expect(categoryLabel(USER_CATS, 'app_share')).toBe('app_share');
    expect(categoryLabel(undefined, 'tip')).toBe('tip');
  });

  it('offers only categories the writer may post in, plus the current one on edit', () => {
    expect(selectableCategories(USER_CATS).map((c) => c.key)).toEqual(['question', 'tip', 'mcp_share', 'free']);
    expect(selectableCategories(USER_CATS, 'notice').map((c) => c.key)).toContain('notice');
    expect(selectableCategories(ADMIN_CATS).map((c) => c.key)).toContain('notice');
  });
});

describe('validatePostForm', () => {
  it('passes a complete form', () => {
    expect(hasErrors(validatePostForm(form(), USER_CATS))).toBe(false);
    expect(hasErrors(validatePostForm(form({ bodyMd: '' }), USER_CATS))).toBe(false);
  });

  it('needs a category and a title', () => {
    const e = validatePostForm(form({ category: '', title: '   ' }), USER_CATS);
    expect(e.category).toBeDefined();
    expect(e.title).toBeDefined();
  });

  it('blocks admin-only, hidden and unknown categories, and long titles', () => {
    expect(validatePostForm(form({ category: 'notice' }), USER_CATS).category).toContain('플랫폼 관리자');
    expect(validatePostForm(form({ category: 'notice' }), ADMIN_CATS).category).toBeUndefined();
    expect(validatePostForm(form({ category: 'app_share' }), USER_CATS).category).toContain('없는 분류');
    expect(validatePostForm(form({ category: 'old' }), [cat('old', '옛 분류', { hidden: true, canPost: false })]).category).toContain('지금은');
    // Editing a post that already sits in 공지 keeps it.
    expect(validatePostForm(form({ category: 'notice' }), USER_CATS, 'notice').category).toBeUndefined();
    expect(validatePostForm(form({ title: 'a'.repeat(TITLE_MAX + 1) }), USER_CATS).title).toBeDefined();
    expect(validatePostForm(form({ title: ` ${'a'.repeat(TITLE_MAX)} ` }), USER_CATS).title).toBeUndefined();
  });
});

describe('request bodies', () => {
  it('trims the title on create', () => {
    expect(createBody(form({ title: '  제목  ', attachedPackage: 'notion-sync' }))).toEqual({
      category: 'tip',
      title: '제목',
      bodyMd: '## 준비',
      attachedPackage: 'notion-sync',
      attachedAppId: null,
    });
  });

  it('sends only changed fields on edit; null clears an attachment', () => {
    const original = form({ attachedPackage: 'notion-sync', attachedAppId: 'a1' });
    expect(patchBody(original, original)).toEqual({});
    expect(patchBody(original, { ...original, title: '새 제목' })).toEqual({ title: '새 제목' });
    expect(patchBody(original, { ...original, attachedPackage: null })).toEqual({ attachedPackage: null });
    expect(patchBody(original, { ...original, attachedAppId: 'a2', category: 'question' })).toEqual({
      attachedAppId: 'a2',
      category: 'question',
    });
  });
});

describe('postSaveError', () => {
  it('puts attachment errors next to their pickers', () => {
    expect(postSaveError(new ApiError(422, 'MCP_NOT_PUBLISHED', 'x'), false).attachedPackage).toBeDefined();
    expect(postSaveError(new ApiError(422, 'APP_NOT_PUBLIC', 'x'), false).attachedAppId).toBeDefined();
  });

  it('maps 403 to the category for restricted categories and to the form otherwise', () => {
    expect(postSaveError(new ApiError(403, 'FORBIDDEN', '"공지" 분류는 플랫폼 관리자만 쓸 수 있어요.'), true).category).toContain('공지');
    expect(postSaveError(new ApiError(403, 'FORBIDDEN', 'x'), false).form).toBeDefined();
  });

  it('falls back to the server message or a generic one', () => {
    expect(postSaveError(new ApiError(400, 'VALIDATION_FAILED', '입력값을 확인하세요.'), false)).toEqual({ form: '입력값을 확인하세요.' });
    expect(postSaveError(new Error('boom'), false).form).toBeDefined();
  });
});

describe('commentProblem', () => {
  it('needs 1–2000 characters after trimming', () => {
    expect(commentProblem('좋은 글이에요')).toBeNull();
    expect(commentProblem('   \n ')).not.toBeNull();
    expect(commentProblem('a'.repeat(COMMENT_MAX))).toBeNull();
    expect(commentProblem(` ${'a'.repeat(COMMENT_MAX)} `)).toBeNull();
    expect(commentProblem('a'.repeat(COMMENT_MAX + 1))).not.toBeNull();
  });
});
