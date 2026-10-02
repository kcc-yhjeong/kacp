import type { AdminUser, ApplyStatus, ImportRowAction, ProvisionStage, Reasoning } from './types';

// Korean labels for admin screens (02-design-system.md §6, 03-data-model.md audit_events).

/** Every action listed in 03-data-model.md `audit_events.action`, plus a few the api also writes. */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  'user.create': '사용자 추가',
  'user.update': '사용자 수정',
  'user.disable': '비활성화',
  'user.enable': '재활성화',
  'user.reset_password': '비밀번호 초기화',
  'user.department_change': '부서 변경',
  'team.create': '팀 생성',
  'team.update': '팀 수정',
  'team.delete': '팀 삭제',
  'membership.add': '멤버 추가',
  'membership.remove': '멤버 제거',
  'membership.role_change': '팀 역할 변경',
  'department.create': '부서 추가',
  'department.update': '부서 수정',
  'department.move': '부서 이동',
  'department.archive': '부서 보관',
  'department.unarchive': '부서 보관 해제',
  'import.apply': 'CSV 가져오기',
  'agent.assign': '할당',
  'agent.unassign': '할당 해제',
  'template.create': '템플릿 생성',
  'template.update': '템플릿 수정',
  'template.delete': '템플릿 삭제',
  'container.start': '컨테이너 시작',
  'container.stop': '컨테이너 정지',
  'container.restart': '컨테이너 재시작',
  'resources.update': '리소스 한도 변경',
  'deploy.approve': '승인',
  'deploy.reject': '반려',
  'app.force_stop': '공개본 강제 중지',
  'app.force_resume': '강제 중지 해제',
  'mcp.approve': '승인',
  'mcp.reject': '반려',
  'mcp.suspend': '게시 중단',
  'mcp.resume': '게시 재개',
  'mcp.set_default': '전사 기본 설정',
  'mcp.install': '설치',
  'mcp.remove': '제거',
  'mcp.manual_add': '직접 추가',
  'settings.update': '설정 변경',
  'settings.api_key': 'API 키 변경',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? action;
}

export const AUDIT_TARGET_LABEL: Record<string, string> = {
  user: '사용자',
  department: '부서',
  team: '팀',
  app: '앱',
  mcp_package: 'MCP',
  mcp_version: 'MCP 버전',
  template: '에이전트',
  settings: '설정',
  import: '가져오기',
};

export function auditTargetLabel(type: string): string {
  return AUDIT_TARGET_LABEL[type] ?? type;
}

export type Dot = 'success' | 'warning' | 'danger' | 'muted';

export const APPLY_STATUS: Record<ApplyStatus, { label: string; dot: Dot }> = {
  pending: { label: '반영 대기', dot: 'warning' },
  applied: { label: '반영 완료', dot: 'success' },
  failed: { label: '반영 실패', dot: 'danger' },
};

export const IMPORT_ACTION: Record<ImportRowAction, { label: string; dot: Dot }> = {
  add: { label: '추가', dot: 'success' },
  update: { label: '변경', dot: 'warning' },
  unchanged: { label: '그대로', dot: 'muted' },
  error: { label: '오류', dot: 'danger' },
};

export type DerivedUserStatus = 'active' | 'disabled' | 'must_change_password';

export const USER_STATUS: Record<DerivedUserStatus, { label: string; dot: Dot }> = {
  active: { label: '활성', dot: 'success' },
  disabled: { label: '비활성', dot: 'muted' },
  must_change_password: { label: '비밀번호 변경 대기', dot: 'warning' },
};

export function userStatusOf(u: Pick<AdminUser, 'status' | 'mustChangePassword'>): DerivedUserStatus {
  if (u.status === 'disabled') return 'disabled';
  return u.mustChangePassword ? 'must_change_password' : 'active';
}

export const PLATFORM_ROLE_LABEL = { admin: '플랫폼 관리자', user: '일반' } as const;

export const REASONING_LABEL: Record<Reasoning, string> = { low: '낮음', medium: '보통', high: '높음' };

/** Provisioning steps shown in the A-04 progress view (order matters). */
export const PROVISION_STEPS: { stage: Exclude<ProvisionStage, 'done' | 'failed'>; label: string }[] = [
  { stage: 'name', label: '이름 예약' },
  { stage: 'storage', label: '저장 공간' },
  { stage: 'container', label: '컨테이너 기동' },
  { stage: 'default_mcp', label: '기본 MCP' },
];
