import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  canUseCategory,
  categoryLabel,
  createBody,
  hasErrors,
  isPostCategory,
  patchBody,
  POST_CATEGORIES,
  postSaveError,
  selectableCategories,
  TITLE_MAX,
  validatePostForm,
  type PostForm,
} from './logic';

const form = (over: Partial<PostForm> = {}): PostForm => ({
  category: 'tip',
  title: '주간 보고서 10분 만에',
  bodyMd: '## 준비',
  attachedPackage: null,
  attachedAppId: null,
  ...over,
});

describe('categories', () => {
  it('has Korean labels', () => {
    expect(POST_CATEGORIES.map(categoryLabel)).toEqual(['공지', '질문', '팁', 'MCP 공유', '앱 자랑']);
    expect(categoryLabel('unknown')).toBe('unknown');
    expect(isPostCategory('mcp_share')).toBe(true);
    expect(isPostCategory('news')).toBe(false);
    expect(isPostCategory(undefined)).toBe(false);
  });

  it('allows 공지 to platform admins only', () => {
    expect(canUseCategory('notice', 'admin')).toBe(true);
    expect(canUseCategory('notice', 'user')).toBe(false);
    expect(canUseCategory('notice', undefined)).toBe(false);
    expect(canUseCategory('question', 'user')).toBe(true);
    expect(selectableCategories('user')).not.toContain('notice');
    expect(selectableCategories('admin')).toContain('notice');
  });
});

describe('validatePostForm', () => {
  it('passes a complete form', () => {
    expect(hasErrors(validatePostForm(form(), 'user'))).toBe(false);
    expect(hasErrors(validatePostForm(form({ bodyMd: '' }), 'user'))).toBe(false);
  });

  it('needs a category and a title', () => {
    const e = validatePostForm(form({ category: '', title: '   ' }), 'user');
    expect(e.category).toBeDefined();
    expect(e.title).toBeDefined();
  });

  it('blocks 공지 for non-admins and long titles', () => {
    expect(validatePostForm(form({ category: 'notice' }), 'user').category).toContain('플랫폼 관리자');
    expect(validatePostForm(form({ category: 'notice' }), 'admin').category).toBeUndefined();
    expect(validatePostForm(form({ title: 'a'.repeat(TITLE_MAX + 1) }), 'user').title).toBeDefined();
    expect(validatePostForm(form({ title: ` ${'a'.repeat(TITLE_MAX)} ` }), 'user').title).toBeUndefined();
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
    expect(postSaveError(new ApiError(422, 'MCP_NOT_PUBLISHED', 'x'), 'tip').attachedPackage).toBeDefined();
    expect(postSaveError(new ApiError(422, 'APP_NOT_PUBLIC', 'x'), 'tip').attachedAppId).toBeDefined();
  });

  it('maps 403 to the category for 공지 and to the form otherwise', () => {
    expect(postSaveError(new ApiError(403, 'FORBIDDEN', 'x'), 'notice').category).toBeDefined();
    expect(postSaveError(new ApiError(403, 'FORBIDDEN', 'x'), 'tip').form).toBeDefined();
  });

  it('falls back to the server message or a generic one', () => {
    expect(postSaveError(new ApiError(400, 'VALIDATION_FAILED', '입력값을 확인하세요.'), 'tip')).toEqual({ form: '입력값을 확인하세요.' });
    expect(postSaveError(new Error('boom'), 'tip').form).toBeDefined();
  });
});
