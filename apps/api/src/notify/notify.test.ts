import { describe, expect, it } from 'vitest';
import { deployRecipients, isNewError, linkKind, recipients } from './logic.js';
import { canEditPost, canUseCategory, categoryListProblem, likePattern } from '../posts/logic.js';

describe('notification recipients', () => {
  it('sends deploy decisions to the requester, or to team admins for agent requests', () => {
    expect(deployRecipients('u1', ['a1', 'a2'])).toEqual(['u1']);
    expect(deployRecipients(null, ['a1', 'a2', 'a1'])).toEqual(['a1', 'a2']);
  });

  it('dedupes and never notifies the actor', () => {
    expect(recipients(['a', 'b', 'a', null, undefined, 'me'], 'me')).toEqual(['a', 'b']);
  });

  it('announces container errors only on the transition into error', () => {
    expect(isNewError('running', 'error')).toBe(true);
    expect(isNewError('error', 'error')).toBe(false);
    expect(isNewError('running', 'stopped')).toBe(false);
  });

  it('tells app paths from external addresses', () => {
    expect(linkKind('/admin/deploy')).toBe('internal');
    expect(linkKind('https://team1.kacp.cloud')).toBe('external');
    expect(linkKind('javascript:alert(1)')).toBe('none');
    expect(linkKind(null)).toBe('none');
  });
});

describe('post rules', () => {
  const admin = { id: 'a', platformRole: 'admin' };
  const user = { id: 'u', platformRole: 'user' };
  it('keeps admin-only categories (공지) for platform admins and hidden ones closed', () => {
    const notice = { adminOnly: true, hidden: false };
    const free = { adminOnly: false, hidden: false };
    expect(canUseCategory(user, notice)).toBe(false);
    expect(canUseCategory(user, free)).toBe(true);
    expect(canUseCategory(admin, notice)).toBe(true);
    expect(canUseCategory(admin, { adminOnly: false, hidden: true })).toBe(false);
    expect(canUseCategory(user, undefined)).toBe(false);
  });
  it('checks the admin category list', () => {
    const c = (key: string, o: Partial<{ adminOnly: boolean; hidden: boolean }> = {}) => ({ key, label: key, adminOnly: false, hidden: false, ...o });
    expect(categoryListProblem([c('notice', { adminOnly: true }), c('free')], new Set(['free']))).toBeNull();
    expect(categoryListProblem([c('free')], new Set(['tip']))).toContain('지울 수 없어요');
    expect(categoryListProblem([c('Free')], new Set())).toContain('분류 코드');
    expect(categoryListProblem([c('free'), c('free')], new Set())).toContain('겹쳐요');
    expect(categoryListProblem([c('notice', { adminOnly: true })], new Set())).toContain('누구나');
  });
  it('lets the author or a platform admin edit', () => {
    expect(canEditPost(user, 'u')).toBe(true);
    expect(canEditPost(user, 'x')).toBe(false);
    expect(canEditPost(admin, 'x')).toBe(true);
  });
  it('escapes LIKE wildcards', () => {
    expect(likePattern('50%_a')).toBe('%50\\%\\_a%');
  });
});
