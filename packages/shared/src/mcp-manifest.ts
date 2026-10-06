import { z } from 'zod';
import { NAME_PATTERN } from './names.js';

// `platform-plugin.yaml` (docs/README.md 6단계). One schema for the api (upload validation) and the
// create-platform-mcp CLI (`validate`), so a package that validates locally validates on upload.

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
// Domain or `*.domain` (wildcard covers subdomains only). No scheme, port or path.
const DOMAIN = /^(\*\.)?(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const MCP_CATEGORIES = ['문서', '데이터', '메신저', '일정', '개발', '업무', '기타'] as const;

export const McpManifest = z.object({
  name: z.string().regex(NAME_PATTERN, '이름은 소문자·숫자·하이픈 3~30자예요.'),
  version: z.string().regex(SEMVER, '버전은 1.2.3 형식(semver)이어야 해요.'),
  displayName: z.string().trim().min(1).max(60),
  summary: z.string().trim().min(1).max(200),
  category: z.enum(MCP_CATEGORIES).default('기타'),
  icon: z.string().max(16).optional(),
  secrets: z.array(z.object({
    name: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/, '비밀값 이름은 대문자·숫자·밑줄이에요(예: NOTION_TOKEN).'),
    description: z.string().trim().max(200).default(''),
    required: z.boolean().default(true),
    // v1 is team scope only: OpenClaw does not pass the caller to MCP servers (spike 05).
    scope: z.literal('team', { error: '비밀값은 팀 범위(team)만 쓸 수 있어요. 사람별 비밀값은 v2예요.' }).default('team'),
  }).strict()).max(20).default([]),
  network: z.array(z.string().toLowerCase().regex(DOMAIN, '네트워크 대상은 도메인만 적어요(예: api.notion.com, *.example.com).')).max(50).default([]),
  resources: z.object({
    cpu: z.number().positive().max(2).default(0.25),
    memoryMb: z.number().int().min(64).max(2048).default(256),
  }).default({ cpu: 0.25, memoryMb: 256 }),
  examples: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
}).strict();
export type McpManifest = z.infer<typeof McpManifest>;

/** Readable problems ("secrets.0.scope: …") for CLI output and upload errors. */
export function manifestProblems(input: unknown): { manifest: McpManifest | null; problems: string[] } {
  const r = McpManifest.safeParse(input);
  if (r.success) {
    const dup = r.data.secrets.map((s) => s.name).filter((n, i, a) => a.indexOf(n) !== i);
    if (dup.length) return { manifest: null, problems: [`secrets: 이름이 겹쳐요 (${[...new Set(dup)].join(', ')})`] };
    return { manifest: r.data, problems: [] };
  }
  return { manifest: null, problems: r.error.issues.map((i) => `${i.path.join('.') || '(전체)'}: ${i.message}`) };
}

/** Egress allowlist check shared by the egress proxy and tests: exact host or `*.domain` subdomain. */
export function hostAllowed(host: string, allow: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return allow.some((d) => (d.startsWith('*.') ? h.endsWith(d.slice(1)) && h.length > d.length - 1 : h === d));
}

/**
 * Key of an MCP server in the team Gateway's `mcp.servers`. OpenClaw names tools `{key}__{tool}`, and
 * some models cannot call function names with hyphens (VM, gpt-5.6-luna), so hyphens become underscores.
 * Containers, the Secret Store and the DB keep the package name.
 */
export const mcpGatewayKey = (key: string) => key.replace(/-/g, '_');

/** Files a package zip must contain (create-platform-mcp layout). */
export const MCP_PACKAGE_REQUIRED_FILES = ['platform-plugin.yaml', 'package.json', 'README.md'] as const;
export const MCP_PACKAGE_MAX_BYTES = 50 * 1024 * 1024;
export const MCP_SERVER_PORT = 8080;
