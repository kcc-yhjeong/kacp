import { config } from './config.js';
import { ApiError } from './lib/errors.js';

// Client for the orchestrator internal API (04-api.md §3). Only the api calls it.

export interface TeamRuntimeSpec {
  /** Plain Gateway password for OPENCLAW_GATEWAY_PASSWORD; never leaves the internal network. */
  gatewayPassword: string;
  /** Team admin emails for the seeded `gateway.auth.identityScopes` (first seed only). */
  adminEmails: string[];
  resourceLimits: { cpu: number; memoryMb: number; diskGb: number };
  /** Extra container env (model provider keys from A-10). */
  env: Record<string, string>;
  /** Group of the team shared drive (teams.linux_gid). */
  linuxGid: number;
}

/** One assigned template as the orchestrator turns it into `agents.entries.<id>` + AGENTS.md. */
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
  /** platform-mcp for this team (`mcp.servers.platform`), docs/README.md 5단계. */
  platformMcp: { url: string; token: string };
  /** Installed market/default MCP servers (`mcp.servers.{key}`), docs/README.md 6단계. */
  mcpServers: { key: string; url: string; pkg: string }[];
}

export interface TeamStats {
  team: string;
  cpuPct: number;
  memBytes: number;
  memLimitBytes: number;
}

async function call(path: string, body?: unknown, method = 'POST', timeoutMs = 15_000): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${config.orchestratorUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.internalToken}`,
        ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
      },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError(503, 'ORCHESTRATOR_UNAVAILABLE');
  }
  if (!res.ok) {
    const text = await res.text();
    let message: string | undefined;
    try {
      message = (JSON.parse(text) as { message?: string }).message;
    } catch {
      // not JSON
    }
    throw new ApiError(503, 'ORCHESTRATOR_UNAVAILABLE', { status: res.status }, message);
  }
  return res.status === 204 ? null : res.json();
}

/** One app copy as the orchestrator runs it (docs/README.md 5단계). Paths are relative to the data root. */
export interface AppCopySpec {
  team: string;
  slug: string;
  copy: 'work' | 'public';
  /** Public copies: the public name and version (container `kacp-pub-{name}-v{n}`). */
  publicName?: string;
  version?: number;
  sourceRel: string;
  dataRel: string;
  runtime: 'node' | 'python' | 'static';
  command: string;
  port: number;
  env: Record<string, string>;
  limits: { cpu: number; memoryMb: number };
}

export const orchestrator = {
  /** 202: stages arrive as team.provision events. */
  provision: (team: string, spec: TeamRuntimeSpec) => call(`/internal/teams/${team}/provision`, spec),
  /** 202: the outcome arrives as a team.status event. */
  ensureRunning: (team: string, spec: TeamRuntimeSpec) => call(`/internal/teams/${team}/ensure-running`, spec),
  restart: (team: string, spec: TeamRuntimeSpec) => call(`/internal/teams/${team}/restart`, spec),
  stop: (team: string) => call(`/internal/teams/${team}/stop`),
  /** Synchronous: resolves when the running Gateway accepted the patch. */
  applyConfig: (team: string, desired: DesiredConfig) => call(`/internal/teams/${team}/apply-config`, desired, 'POST', 60_000),
  resources: (team: string, limits: TeamRuntimeSpec['resourceLimits']) => call(`/internal/teams/${team}/resources`, limits, 'PUT'),
  remove: (team: string) => call(`/internal/teams/${team}`, {}, 'DELETE', 90_000),
  stats: () => call('/internal/stats', undefined, 'GET') as Promise<{ teams: TeamStats[] }>,
  /** 202; the outcome arrives as an app.status event. */
  runApp: (appId: string, spec: AppCopySpec) => call(`/internal/apps/${appId}/${spec.copy}/run`, spec),
  stopApp: (appId: string, copy: 'work' | 'public') => call(`/internal/apps/${appId}/${copy}/stop`),
  removeApp: (appId: string, copy: 'work' | 'public') => call(`/internal/apps/${appId}/${copy}`, {}, 'DELETE', 60_000),
  appLogs: (appId: string, copy: 'work' | 'public', tail: number) =>
    call(`/internal/apps/${appId}/${copy}/logs?tail=${tail}`, undefined, 'GET') as Promise<{ lines: string[] }>,

  // ── MCP (docs/README.md 6단계) ──
  /** 202; stages arrive as mcp.build events. */
  mcpBuild: (job: { versionId: string; pkg: string; version: string; resources: McpResources }) => call('/internal/mcp/builds', job),
  mcpRemoveImage: (pkg: string, version: string) => call(`/internal/mcp/images/${pkg}/${version}`, {}, 'DELETE'),
  /** 202; `secrets: null` keeps the Secret Store (version upgrade). The outcome is an mcp.install event. */
  mcpInstall: (team: string, key: string, spec: McpInstallSpec & { secrets: Record<string, string> | null }) =>
    call(`/internal/teams/${team}/mcp/${key}`, spec, 'PUT'),
  /** Merges into the team's Secret Store (blank keeps); the next apply-config carries them as headers. */
  mcpSecrets: (team: string, key: string, secrets: Record<string, string>) =>
    call(`/internal/teams/${team}/mcp/${key}/secrets`, { secrets }, 'PUT'),
  /** The shared package server, after the last team removed it. */
  mcpRemovePackage: (pkg: string) => call(`/internal/mcp/packages/${pkg}`, {}, 'DELETE', 60_000),
  mcpRemove: (team: string, key: string) => call(`/internal/teams/${team}/mcp/${key}`, {}, 'DELETE'),
  /** Synchronous Gateway patch for a "직접 추가" server (null = delete). */
  mcpManual: (team: string, key: string, server: { url: string; headers?: Record<string, string> } | null) =>
    call(`/internal/gateway/${team}/mcp-manual/${key}`, { server }, 'PUT', 60_000),
  /** Gateway model catalog (models.list): the models this team has auth for. */
  gatewayModels: (team: string) =>
    call(`/internal/gateway/${team}/rpc`, { method: 'models.list', params: {} }, 'POST', 30_000) as Promise<{ payload?: { models?: { id: string; name?: string; provider?: string }[] } }>,
  gatewayConfig: (team: string) =>
    call(`/internal/gateway/${team}/rpc`, { method: 'config.get' }, 'POST', 30_000) as Promise<{ payload?: { config?: Record<string, unknown>; parsed?: Record<string, unknown> } }>,
};

export interface McpResources { cpu: number; memoryMb: number }
export interface McpInstallSpec { pkg: string; version: string; network: string[]; resources: McpResources }
