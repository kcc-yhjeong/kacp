// C-06 notification rules that do not need React (docs/README.md 7단계 "알림").

export const NOTIFICATION_TYPES = [
  'deploy_approved',
  'deploy_rejected',
  'mcp_build_succeeded',
  'mcp_build_failed',
  'mcp_approved',
  'mcp_rejected',
  'team_container_error',
  'agent_assignment_changed',
  'admin_review_requested',
  'app_force_stopped',
  'post_commented',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationItem {
  id: string;
  /** Unknown future types fall back to the bell icon. */
  type: NotificationType | (string & {});
  title: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationList {
  items: NotificationItem[];
  unread: number;
}

export type NotificationIcon = 'globe' | 'plug' | 'alert' | 'bot' | 'shield' | 'comment' | 'bell';

/** Icon per type. `danger` = the icon itself is red (failures and errors only, like the C-00 mockup). */
export function notificationVisual(type: string): { icon: NotificationIcon; danger: boolean } {
  switch (type) {
    case 'deploy_approved':
    case 'deploy_rejected':
      return { icon: 'globe', danger: false };
    case 'mcp_build_succeeded':
    case 'mcp_approved':
    case 'mcp_rejected':
      return { icon: 'plug', danger: false };
    case 'mcp_build_failed':
    case 'team_container_error':
    case 'app_force_stopped':
      return { icon: 'alert', danger: true };
    case 'agent_assignment_changed':
      return { icon: 'bot', danger: false };
    case 'admin_review_requested':
      return { icon: 'shield', danger: false };
    case 'post_commented':
      return { icon: 'comment', danger: false };
    default:
      return { icon: 'bell', danger: false };
  }
}

export type LinkTarget =
  /** Same-origin SPA path on the app host: use the router. */
  | { kind: 'router'; path: string }
  /** Full page navigation (team hosts, or app paths seen from a team host). */
  | { kind: 'href'; href: string }
  | { kind: 'none' };

/**
 * Where a notification click goes.
 * - `http(s)://…` → that address (team hosts);
 * - `/…` → an app path: router on the app host, `${appOrigin}${link}` elsewhere;
 * - anything else (null, `//evil`, `javascript:`) → nowhere.
 */
export function resolveNotificationLink(link: string | null | undefined, onAppHost: boolean, appOrigin: string): LinkTarget {
  const l = link?.trim();
  if (!l) return { kind: 'none' };
  if (/^https?:\/\//i.test(l)) {
    try {
      return { kind: 'href', href: new URL(l).href };
    } catch {
      return { kind: 'none' };
    }
  }
  if (l.startsWith('/') && !l.startsWith('//') && !l.startsWith('/\\')) {
    return onAppHost ? { kind: 'router', path: l } : { kind: 'href', href: `${appOrigin}${l}` };
  }
  return { kind: 'none' };
}

/** Badge text on the bell: 1–99, then `99+`. Null hides the badge. */
export function unreadBadge(count: number | undefined): string | null {
  if (!count || count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}
