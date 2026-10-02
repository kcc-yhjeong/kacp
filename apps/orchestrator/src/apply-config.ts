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
}

export const MANAGED_PREFIX = 'kacp-';
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
  if (a.tools.allow.length || a.tools.deny.length) {
    entry.tools = {
      ...(a.tools.allow.length ? { allow: a.tools.allow } : {}),
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
export function computePatch(current: Record<string, unknown>, desired: DesiredConfig, opts: { sandbox?: boolean } = {}): PatchPlan | null {
  const cur = current as {
    agents?: { entries?: Record<string, unknown>; defaults?: { sandbox?: { prune?: unknown } } };
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

  if (replacePaths.length === 0) return null;
  const patch: Record<string, unknown> = {};
  if (Object.keys(entries).length || prune) {
    patch.agents = {
      ...(Object.keys(entries).length ? { entries } : {}),
      ...(prune ? { defaults: { sandbox: { prune: SANDBOX_PRUNE } } } : {}),
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
