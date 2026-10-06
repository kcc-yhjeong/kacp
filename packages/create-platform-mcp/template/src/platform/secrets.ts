// 플랫폼 고정 영역 — 수정하지 마세요.
//
// One server serves every team that installed this MCP. Each team's secrets (declared in
// platform-plugin.yaml, entered by its team admin) arrive with every request as headers
// `X-KACP-Secret-<NAME>` (`_` written as `-`). The server keeps them only for that request, so
// two teams' calls never see each other's values. Read them with getSecret() inside a tool;
// never store them in module variables, log them or return them.
// Locally (npm run dev, MCP Inspector) there is no platform: environment variables are used.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingHttpHeaders } from 'node:http';

const HEADER_PREFIX = 'x-kacp-secret-';
const requestSecrets = new AsyncLocalStorage<Map<string, string>>();

/** `X-KACP-Secret-EXAMPLE-API-KEY: v` → `EXAMPLE_API_KEY → v`. */
export function secretsFromHeaders(headers: IncomingHttpHeaders): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(headers)) {
    if (!k.startsWith(HEADER_PREFIX) || typeof v !== 'string' || v === '') continue;
    out.set(k.slice(HEADER_PREFIX.length).toUpperCase().replace(/-/g, '_'), v);
  }
  return out;
}

/** Runs one request with its team's secrets (platform server only). */
export const withRequestSecrets = <T>(secrets: Map<string, string>, fn: () => T): T => requestSecrets.run(secrets, fn);

export function getSecret(name: string): string;
export function getSecret(name: string, opts: { required: false }): string | undefined;
export function getSecret(name: string, opts: { required?: boolean } = {}): string | undefined {
  const value = requestSecrets.getStore()?.get(name) ?? process.env[name];
  if (value) return value;
  if (opts.required === false) return undefined;
  throw new Error(
    `비밀값 ${name}이(가) 설정되지 않았어요. 팀 설정 → MCP에서 값을 입력해 주세요. (로컬에서는 환경변수 ${name}을 지정하세요)`,
  );
}
