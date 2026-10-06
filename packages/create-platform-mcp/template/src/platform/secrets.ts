// 플랫폼 고정 영역 — 수정하지 마세요.
//
// Secrets declared in platform-plugin.yaml arrive as environment variables of the same name
// (the team admin enters them when installing). Never log or return their values.

export function getSecret(name: string): string;
export function getSecret(name: string, opts: { required: false }): string | undefined;
export function getSecret(name: string, opts: { required?: boolean } = {}): string | undefined {
  const value = process.env[name];
  if (value) return value;
  if (opts.required === false) return undefined;
  throw new Error(
    `비밀값 ${name}이(가) 설정되지 않았어요. 팀 설정 → MCP에서 값을 입력해 주세요. (로컬에서는 환경변수 ${name}을 지정하세요)`,
  );
}
