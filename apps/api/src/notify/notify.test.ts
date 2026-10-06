import { describe, expect, it } from 'vitest';
import { deployRecipients, isNewError, linkKind, recipients } from './logic.js';
import { canEditPost, canUseCategory, likePattern } from '../posts/logic.js';

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
  it('keeps 공지 for platform admins', () => {
    expect(canUseCategory(user, 'notice')).toBe(false);
    expect(canUseCategory(user, 'tip')).toBe(true);
    expect(canUseCategory(admin, 'notice')).toBe(true);
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
