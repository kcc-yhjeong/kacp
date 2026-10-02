import { config } from './config.js';
import { ApiError } from './lib/errors.js';

// Client for the orchestrator internal API (04-api.md §3). Only the api calls it.

export interface TeamRuntimeSpec {
  /** Plain Gateway password for OPENCLAW_GATEWAY_PASSWORD; never leaves the internal network. */
  gatewayPassword: string;
  /** Team admin emails for the seeded `gateway.auth.identityScopes` (first seed only). */
  adminEmails: string[];
  resourceLimits: { cpu: number; memoryMb: number; diskGb: number };
}

async function call(path: string, body?: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${config.orchestratorUrl}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.internalToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(503, 'ORCHESTRATOR_UNAVAILABLE');
  }
  if (!res.ok) throw new ApiError(503, 'ORCHESTRATOR_UNAVAILABLE', { status: res.status, body: await res.text() });
  return res.status === 204 ? null : res.json();
}

export const orchestrator = {
  provision: (team: string, spec: TeamRuntimeSpec) => call(`/internal/teams/${team}/provision`, spec),
  /** 202: the orchestrator reports the outcome through POST /internal/events. */
  ensureRunning: (team: string, spec: TeamRuntimeSpec) => call(`/internal/teams/${team}/ensure-running`, spec),
  stop: (team: string) => call(`/internal/teams/${team}/stop`),
};
