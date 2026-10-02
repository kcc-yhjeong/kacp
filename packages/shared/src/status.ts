// Status values (02-design-system.md state tables). DB stores these as text + check constraint.

export const PLATFORM_ROLES = ['admin', 'user'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const USER_STATUSES = ['active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const TEAM_ROLES = ['team_admin', 'member'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const TEAM_CONTAINER_STATUSES = ['stopped', 'starting', 'running', 'stopping', 'error'] as const;
export type TeamContainerStatus = (typeof TEAM_CONTAINER_STATUSES)[number];

export const NAME_KINDS = ['team', 'public_app', 'reserved'] as const;
export type NameKind = (typeof NAME_KINDS)[number];

/** Employee-facing wording for the team container (U-01, C-00 team switcher). */
export const TEAM_STATUS_LABEL_USER: Record<TeamContainerStatus, string> = {
  stopped: '쉬는 중',
  starting: '준비 중',
  running: '사용 가능',
  stopping: '정리 중',
  error: '문제 발생',
};

/** Admin-facing wording (A-*). */
export const TEAM_STATUS_LABEL_ADMIN: Record<TeamContainerStatus, string> = {
  stopped: '정지',
  starting: '기동 중',
  running: '실행 중',
  stopping: '정지 중',
  error: '오류',
};

export const TEAM_ROLE_LABEL: Record<TeamRole, string> = {
  team_admin: '팀 관리자',
  member: '팀원',
};

// OpenClaw operator scopes sent in X-Openclaw-Scopes (06-auth.md §5). Always sent; it is a cap.
export const MEMBER_SCOPES = ['operator.read', 'operator.write', 'operator.approvals', 'operator.questions'] as const;
export const TEAM_ADMIN_SCOPES = [...MEMBER_SCOPES, 'operator.admin'] as const;

export function scopesForRole(role: TeamRole): string {
  return (role === 'team_admin' ? TEAM_ADMIN_SCOPES : MEMBER_SCOPES).join(',');
}
