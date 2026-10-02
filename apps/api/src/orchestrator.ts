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
};
