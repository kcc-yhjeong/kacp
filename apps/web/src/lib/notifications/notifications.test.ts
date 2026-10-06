import { describe, expect, it } from 'vitest';
import { formatTime } from '@/lib/format';
import { notificationVisual, NOTIFICATION_TYPES, resolveNotificationLink, unreadBadge } from './logic';

const APP = 'https://app.kacp.cloud';

describe('resolveNotificationLink', () => {
  it('uses the router for app paths on the app host', () => {
    expect(resolveNotificationLink('/t/sales/apps/123', true, APP)).toEqual({ kind: 'router', path: '/t/sales/apps/123' });
    expect(resolveNotificationLink('/admin/deploy', true, APP)).toEqual({ kind: 'router', path: '/admin/deploy' });
  });

  it('goes to the app origin for app paths seen from a team host', () => {
    expect(resolveNotificationLink('/market/mine/notion-sync/1.2.0', false, APP)).toEqual({
      kind: 'href',
      href: 'https://app.kacp.cloud/market/mine/notion-sync/1.2.0',
    });
  });

  it('navigates to absolute team addresses on either host', () => {
    expect(resolveNotificationLink('https://sales.kacp.cloud/', true, APP)).toEqual({ kind: 'href', href: 'https://sales.kacp.cloud/' });
    expect(resolveNotificationLink('http://team1.kacp.localhost/', false, APP)).toEqual({ kind: 'href', href: 'http://team1.kacp.localhost/' });
  });

  it('does nothing for missing or unsafe links', () => {
    for (const link of [null, undefined, '', '   ', 'javascript:alert(1)', '//evil.example/x', '/\\evil.example', 'market/mine', 'mailto:a@b.c']) {
      expect(resolveNotificationLink(link, true, APP)).toEqual({ kind: 'none' });
      expect(resolveNotificationLink(link, false, APP)).toEqual({ kind: 'none' });
    }
  });
});

describe('notificationVisual', () => {
  it('has an icon for every known type and marks failures red', () => {
    for (const t of NOTIFICATION_TYPES) expect(notificationVisual(t).icon).not.toBe('bell');
    expect(notificationVisual('team_container_error').danger).toBe(true);
    expect(notificationVisual('mcp_build_failed').danger).toBe(true);
    expect(notificationVisual('deploy_approved').danger).toBe(false);
    expect(notificationVisual('something_new')).toEqual({ icon: 'bell', danger: false });
  });
});

describe('unreadBadge', () => {
  it('hides zero and caps at 99+', () => {
    expect(unreadBadge(undefined)).toBeNull();
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(3)).toBe('3');
    expect(unreadBadge(99)).toBe('99');
    expect(unreadBadge(120)).toBe('99+');
  });
});

describe('relative time in the panel', () => {
  const now = new Date(2026, 9, 6, 12, 0, 0);
  it('is relative within 24 hours, absolute after', () => {
    expect(formatTime(new Date(2026, 9, 6, 11, 59, 50).toISOString(), now)).toBe('방금 전');
    expect(formatTime(new Date(2026, 9, 6, 11, 57).toISOString(), now)).toBe('3분 전');
    expect(formatTime(new Date(2026, 9, 6, 7, 0).toISOString(), now)).toBe('5시간 전');
    expect(formatTime(new Date(2026, 9, 5, 11, 0).toISOString(), now)).toBe('2026-10-05 11:00');
  });
});
