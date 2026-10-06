// Pure notification rules (docs/README.md 7단계 알림), tested without a database.

export const NOTIFICATION_TYPES = [
  'deploy_approved', 'deploy_rejected', 'mcp_build_succeeded', 'mcp_build_failed', 'mcp_approved', 'mcp_rejected',
  'team_container_error', 'agent_assignment_changed', 'admin_review_requested', 'app_force_stopped', 'post_commented',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Deploy decisions go to the requester; an agent request (requestedBy null) goes to the team admins. */
export function deployRecipients(requestedBy: string | null, teamAdmins: string[]): string[] {
  return requestedBy ? [requestedBy] : unique(teamAdmins);
}

/** Container errors are announced once, on the transition into `error`. */
export const isNewError = (prev: string | null | undefined, next: string) => next === 'error' && prev !== 'error';

/** Same person once; the actor of an action never notifies themselves. */
export function recipients(ids: (string | null | undefined)[], exclude?: string | null): string[] {
  return unique(ids.filter((x): x is string => !!x && x !== exclude));
}

/** Links starting with http(s) open that address; others are app paths. */
export function linkKind(link: string | null): 'external' | 'internal' | 'none' {
  if (!link) return 'none';
  return /^https?:\/\//.test(link) ? 'external' : link.startsWith('/') ? 'internal' : 'none';
}

const unique = (xs: string[]) => [...new Set(xs)];
