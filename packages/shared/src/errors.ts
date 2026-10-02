// Error envelope and codes (04-api.md §1). Messages are shown to users as-is.

export const ERROR_MESSAGES = {
  AUTH_REQUIRED: '로그인이 필요해요.',
  AUTH_INVALID_CREDENTIALS: '이메일 또는 비밀번호가 맞지 않아요.',
  AUTH_LOCKED: '로그인 시도가 너무 많아요. 잠시 후 다시 시도하세요.',
  AUTH_DISABLED: '비활성화된 계정이에요. 관리자에게 문의하세요.',
  AUTH_PASSWORD_CHANGE_REQUIRED: '비밀번호를 바꿔야 다른 화면을 쓸 수 있어요.',
  AUTH_PASSWORD_POLICY: '비밀번호 규칙에 맞지 않아요.',
  AUTH_CURRENT_PASSWORD_WRONG: '현재 비밀번호가 맞지 않아요.',
  CSRF_INVALID: '요청을 확인할 수 없어요. 새로고침 후 다시 시도하세요.',
  FORBIDDEN: '권한이 없어요.',
  VALIDATION_FAILED: '입력값을 확인해 주세요.',
  NAME_INVALID: '소문자·숫자·하이픈만, 3~30자, 하이픈으로 시작·끝 불가, -- 불가예요.',
  NAME_RESERVED: '예약된 이름이라 쓸 수 없어요.',
  NAME_TAKEN: '이미 쓰고 있는 이름이에요.',
  TEAM_NOT_FOUND: '팀을 찾을 수 없어요.',
  TEAM_NOT_RUNNING: '팀 에이전트가 꺼져 있어요.',
  NOT_FOUND: '찾을 수 없어요.',
  ORCHESTRATOR_UNAVAILABLE: '지금은 팀 에이전트를 켤 수 없어요. 잠시 후 다시 시도하세요.',
  INTERNAL: '문제가 생겼어요. 잠시 후 다시 시도하세요.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export interface ApiErrorBody {
  error: { code: ErrorCode | (string & {}); message: string; details?: Record<string, unknown> };
}
