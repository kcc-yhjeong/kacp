// apply-config patch computation (04-api.md §3, spike 04): desired agents + team admins → a JSON merge
// patch for config.patch. Pure, so it can be unit-tested without a Gateway.
//
// Rules:
// - KACP owns only `agents.entries.kacp-*` and `gateway.auth.identityScopes`; other keys are left alone.
// - No `default: true`: in 2026.9.7 it is a legacy marker that doctor rewrites into explicit owners
//   (talk/heartbeat/systemAgent stay on `main`); template agents are picked in the Control UI.
// - Entries are replaced whole (their arrays too), so every touched path goes into `replacePaths`.
// - Deletions are `null` + `replacePaths` (OpenClaw refuses to drop array-valued paths otherwise).

import { STATE_DIR } from './config.js';

export interface DesiredAgent {
  id: string;
  name: string;
  emoji: string;
  model: string | null;
  thinking: 'low' | 'medium' | 'high' | null;
  instructions: string;
  skills: string[];
  tools: { allow: string[]; deny: string[] };
}

export interface DesiredConfig {
  agents: DesiredAgent[];
  adminEmails: string[];
  /** Team-scoped platform-mcp (`mcp.servers.platform`). Optional only for older callers/tests. */
  platformMcp?: { url: string; token: string };
  /** Installed market/default MCP servers (docs/README.md 6단계). Omitted = leave market keys alone. */
  mcpServers?: { key: string; url: string; pkg?: string; headers?: Record<string, string> }[];
}

/** Market MCP servers KACP runs (kacp-mcp-{pkg}, earlier kacp-mcp-{pkg}--{team}). Only keys with such a URL are ever deleted. */
export const MANAGED_MCP_URL = /^http:\/\/kacp-mcp-[a-z0-9-]+:8080\/mcp$/;

export const MANAGED_PREFIX = 'kacp-';
export const PLATFORM_MCP_NAME = 'platform';
export const workspaceFor = (agentId: string) => `${STATE_DIR}/workspace-${agentId}`;

export function agentEntry(a: DesiredAgent): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    name: a.name,
    identity: { emoji: a.emoji },
    workspace: workspaceFor(a.id),
  };
  if (a.model) entry.model = a.model;
  if (a.thinking) entry.thinkingDefault = a.thinking;
  if (a.skills.length) entry.skills = a.skills;
  // An allow list admits only what it names. MCP tools (platform-mcp, market MCP) must survive it,
  // otherwise one "허용" entry silently takes run_app and the drive tools away.
  const allow = a.tools.allow.length && !a.tools.allow.some((t) => t === 'bundle-mcp' || t === 'group:plugins')
    ? [...a.tools.allow, 'bundle-mcp']
    : a.tools.allow;
  if (allow.length || a.tools.deny.length) {
    entry.tools = {
      ...(allow.length ? { allow } : {}),
      ...(a.tools.deny.length ? { deny: a.tools.deny } : {}),
    };
  }
  return entry;
}

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val)
    ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, (val as Record<string, unknown>)[k]]))
    : val));

export interface PatchPlan {
  patch: Record<string, unknown>;
  replacePaths: string[];
}

/** Idle sandboxes are pruned after an hour (OpenClaw default: 24 h — too much memory per session). */
export const SANDBOX_PRUNE = { idleHours: 1, maxAgeDays: 1 };

/** Returns null when the current config already matches. `sandbox` = also enforce the prune policy. */
export function computePatch(
  current: Record<string, unknown>,
  desired: DesiredConfig,
  opts: { sandbox?: boolean; sandboxOrigin?: string } = {},
): PatchPlan | null {
  const cur = current as {
    agents?: {
      ownership?: string;
      entries?: Record<string, unknown>;
      defaults?: { sandbox?: { prune?: unknown }; heartbeat?: { agentId?: string }; systemAgent?: { agentId?: string } };
    };
    gateway?: { auth?: { identityScopes?: Record<string, unknown> } };
  };
  const entries: Record<string, unknown> = {};
  const scopes: Record<string, unknown> = {};
  const replacePaths: string[] = [];

  const currentEntries = cur.agents?.entries ?? {};
  const wanted = new Map(desired.agents.map((a) => [a.id, agentEntry(a)]));
  for (const id of Object.keys(currentEntries)) {
    if (id.startsWith(MANAGED_PREFIX) && !wanted.has(id)) {
      entries[id] = null;
      replacePaths.push(`agents.entries.${id}`);
    }
  }
  for (const [id, entry] of wanted) {
    if (stable(currentEntries[id]) !== stable(entry)) {
      entries[id] = entry;
      replacePaths.push(`agents.entries.${id}`);
    }
  }

  const currentScopes = cur.gateway?.auth?.identityScopes ?? {};
  const admins = new Set(desired.adminEmails);
  for (const email of Object.keys(currentScopes)) {
    if (!admins.has(email)) {
      scopes[email] = null;
      replacePaths.push(`gateway.auth.identityScopes.${email}`);
    }
  }
  for (const email of admins) {
    if (stable(currentScopes[email]) !== stable(['operator.admin'])) {
      scopes[email] = ['operator.admin'];
      replacePaths.push(`gateway.auth.identityScopes.${email}`);
    }
  }

  const prune = opts.sandbox && stable(cur.agents?.defaults?.sandbox?.prune) !== stable(SANDBOX_PRUNE);
  if (prune) replacePaths.push('agents.defaults.sandbox.prune');

  // Template agents next to `main` make a multi-agent roster: OpenClaw then requires
  // agents.ownership="explicit" (doctor stamps it on later starts, a fresh team has none). `main` keeps
  // the ambient owners (heartbeat, system agent) — the same values doctor writes. Never with a legacy
  // `default: true` marker, and existing values are left alone.
  const legacyDefault = Object.values(currentEntries).some((e) => (e as { default?: boolean } | null)?.default === true);
  const ownership = desired.agents.length > 0 && cur.agents?.ownership !== 'explicit' && !legacyDefault;
  const needMain = ownership && !('main' in currentEntries);
  const needHeartbeat = ownership && !cur.agents?.defaults?.heartbeat?.agentId;
  const needSystem = ownership && !cur.agents?.defaults?.systemAgent?.agentId;
  if (ownership) replacePaths.push('agents.ownership');
  if (needHeartbeat) replacePaths.push('agents.defaults.heartbeat.agentId');
  if (needSystem) replacePaths.push('agents.defaults.systemAgent.agentId');
  if (needMain) entries.main = {};

  // platform-mcp (docs/README.md 5단계). config.get may redact header values, so only url/transport
  // and the presence of Authorization decide whether to rewrite it.
  const currentMcp = (current as { mcp?: { servers?: Record<string, { url?: string; transport?: string; headers?: Record<string, unknown> }> } })
    .mcp?.servers?.[PLATFORM_MCP_NAME];
  const mcpChanged = !!desired.platformMcp && (
    currentMcp?.url !== desired.platformMcp.url || currentMcp?.transport !== 'streamable-http' || !currentMcp?.headers?.Authorization
  );
  if (mcpChanged) replacePaths.push(`mcp.servers.${PLATFORM_MCP_NAME}`);

  // Market MCP servers: add/replace the desired ones, delete managed ones that are no longer installed.
  // Servers added in the Control UI or with "직접 추가" have other URLs and are never touched here.
  const servers: Record<string, unknown> = {};
  if (desired.mcpServers) {
    const currentServers = (current as { mcp?: { servers?: Record<string, { url?: string; transport?: string; headers?: Record<string, unknown> }> } }).mcp?.servers ?? {};
    const want = new Map(desired.mcpServers.map((m) => [m.key, m]));
    for (const [key, s] of Object.entries(currentServers)) {
      if (key !== PLATFORM_MCP_NAME && !want.has(key) && MANAGED_MCP_URL.test(s?.url ?? '')) {
        servers[key] = null;
        replacePaths.push(`mcp.servers.${key}`);
      }
    }
    for (const [key, m] of want) {
      const cur = currentServers[key];
      // Team secrets ride as headers; their values may be hidden by config.get, so the revision
      // marker (X-KACP-Secrets-Rev, not secret) decides whether the entry is current.
      const rev = m.headers?.['X-KACP-Secrets-Rev'];
      if (cur?.url !== m.url || cur?.transport !== 'streamable-http' || (rev !== undefined && cur?.headers?.['X-KACP-Secrets-Rev'] !== rev)) {
        servers[key] = { url: m.url, transport: 'streamable-http', ...(m.headers ? { headers: m.headers } : {}) };
        replacePaths.push(`mcp.servers.${key}`);
      }
    }
  }

  // Sandbox origin for HTML previews (05 §2). A restart-required key: OpenClaw restarts in-process.
  const currentApps = (current as { mcp?: { apps?: { sandboxOrigin?: string; sandboxPort?: number } } }).mcp?.apps;
  const appsChanged = !!opts.sandboxOrigin && (currentApps?.sandboxOrigin !== opts.sandboxOrigin || currentApps?.sandboxPort !== 18790);
  if (appsChanged) replacePaths.push('mcp.apps.sandboxOrigin', 'mcp.apps.sandboxPort');

  // Codex harness (enabled per team in the Control UI): its default "searchable" loading hides MCP tools
  // behind Codex tool search, which small models skip ("도구가 노출되지 않았다"). Load them directly.
  const codex = (current as { plugins?: { entries?: { codex?: { config?: { codexDynamicToolsLoading?: string } } } } }).plugins?.entries?.codex;
  const codexDirect = !!codex && codex.config?.codexDynamicToolsLoading !== 'direct';
  if (codexDirect) replacePaths.push('plugins.entries.codex.config.codexDynamicToolsLoading');

  if (replacePaths.length === 0) return null;
  const patch: Record<string, unknown> = {};
  if (codexDirect) patch.plugins = { entries: { codex: { config: { codexDynamicToolsLoading: 'direct' } } } };
  if (appsChanged) patch.mcp = { apps: { sandboxOrigin: opts.sandboxOrigin, sandboxPort: 18790 } };
  if (mcpChanged || Object.keys(servers).length) {
    patch.mcp = {
      ...(patch.mcp as object | undefined),
      servers: {
        ...servers,
        ...(mcpChanged ? { [PLATFORM_MCP_NAME]: {
          url: desired.platformMcp!.url,
          transport: 'streamable-http',
          headers: { Authorization: `Bearer ${desired.platformMcp!.token}` },
        } } : {}),
      },
    };
  }
  if (Object.keys(entries).length || prune || ownership) {
    const defaults = {
      ...(prune ? { sandbox: { prune: SANDBOX_PRUNE } } : {}),
      ...(needHeartbeat ? { heartbeat: { agentId: 'main' } } : {}),
      ...(needSystem ? { systemAgent: { agentId: 'main' } } : {}),
    };
    patch.agents = {
      ...(ownership ? { ownership: 'explicit' } : {}),
      ...(Object.keys(entries).length ? { entries } : {}),
      ...(Object.keys(defaults).length ? { defaults } : {}),
    };
  }
  if (Object.keys(scopes).length) patch.gateway = { auth: { identityScopes: scopes } };
  return { patch, replacePaths };
}

/** Base instructions every KACP agent gets in front of its own (A-06 note, docs/README.md 4단계). */
export const PLATFORM_INSTRUCTIONS = `# KACP 플랫폼 기본 지시문

- 이 에이전트는 회사 팀이 함께 쓰는 에이전트예요. 팀 채팅(공유됨 세션)의 대화는 팀원 모두가 봐요.
- 사용자에게는 한국어로 답해요.
- 비밀번호·API 키 같은 비밀값을 대화나 파일에 그대로 남기지 않아요.

## 팀 공유 드라이브

- 팀 공유 드라이브는 \`/team-drive\` 폴더예요(기본 에이전트 작업 공간의 \`team-drive/\`와 같은 폴더). 사용자가 "팀 드라이브", "공유 드라이브", "팀 공유"라고 하면 이 폴더를 말해요.
- 팀원에게 줄 결과물(문서·표·코드)은 여기에 저장해요. 팀원은 웹 드라이브의 "팀 공유"에서 바로 봐요.
- 사람마다 있는 "내 드라이브"는 에이전트가 볼 수도 쓸 수도 없어요. 내 드라이브로 옮겨 달라고 하면, 팀 공유에 저장한 뒤 웹 드라이브에서 직접 옮기도록 안내해요.
- \`/team-drive\`에서는 git 커밋을 하지 않아요.
- 사용자에게 파일을 알려줄 때는 작업 공간 기준 경로 \`team-drive/폴더/파일\`로 적어요(예: \`team-drive/hello-app/index.html\`). 채팅의 파일 링크는 작업 공간 기준으로만 열려서, \`/team-drive/…\`나 \`hello-app/…\`처럼 적으면 "session file not found"가 나요. 웹 드라이브의 "팀 공유"에서도 같은 파일을 볼 수 있다고 함께 알려요.

## 웹 앱 (platform 도구)

- 웹 앱은 반드시 \`platform\` 도구의 \`run_app\`으로 실행해요(\`folder\`는 팀 공유 드라이브 안 앱 폴더, 예: \`/lunch-vote\`). 직접 서버를 띄우지 않아요.
- 서버는 \`0.0.0.0\`과 \`PORT\` 환경변수(또는 지정한 \`port\`)에서 들어요. Node면 \`package.json\`의 \`start\` 스크립트나 \`server.js\`, Python이면 \`app.py\`, 정적 사이트면 \`index.html\`이면 돼요.
- 저장이 필요하면 \`APP_DATA_DIR\`(\`/app-data\`) 아래에 SQLite 같은 파일을 만들어요. 앱 폴더(원본)는 실행 중에 읽기 전용이에요.
- \`run_app\`이 알려 주는 주소(\`이름--팀\`)는 팀원만 열 수 있는 작업본이에요. 같은 폴더로 다시 \`run_app\`하면 새 앱이 아니라 작업본이 다시 시작돼요.
- 회사 전체에 공개하려면 \`deploy_app\`으로 공개(또는 업데이트) 요청을 해요. 관리자가 승인하기 전에는 공개본이 바뀌지 않는다고 사용자에게 알려요.
- 작업본과 공개본은 데이터를 따로 가져요. 공개본에 필요한 초기 데이터는 앱이 시작할 때 스스로 만들도록 작성해요.
`;

export const agentsMd = (a: DesiredAgent) =>
  `${PLATFORM_INSTRUCTIONS}\n---\n\n# ${a.name}\n\n${a.instructions.trim()}\n`;

const BEGIN = '<!-- KACP:BEGIN (플랫폼이 관리하는 영역 — 수정해도 다음 기동 때 덮어써요) -->';
const END = '<!-- KACP:END -->';

/** Puts (or refreshes) the platform block at the top of `main`'s own AGENTS.md, keeping the rest. */
export function withPlatformBlock(existing: string | null): string {
  const block = `${BEGIN}\n${PLATFORM_INSTRUCTIONS}${END}\n`;
  if (!existing) return block;
  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END);
  const rest = start >= 0 && end > start
    ? existing.slice(0, start) + existing.slice(end + END.length).replace(/^\n/, '')
    : existing;
  return `${block}\n${rest.replace(/^\n+/, '')}`;
}
