import type { TeamContainerStatus } from '@kacp/shared';
import { config } from './config.js';

// Notifications to the api (04-api.md §3 POST /internal/events, /internal/usage). Retried a few times.

async function post(path: string, payload: unknown, attempts = 5) {
  const body = JSON.stringify(payload);
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(`${config.apiUrl}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.internalToken}`, 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return;
    } catch {
      // api restarting — retry
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

export const notifyTeamStatus = (team: string, status: TeamContainerStatus, detail?: string) =>
  post('/internal/events', { type: 'team.status', id: team, status, detail: detail ?? null });

export const notifyProvision = (team: string, stage: 'storage' | 'container' | 'default_mcp' | 'done' | 'failed', detail?: string) =>
  post('/internal/events', { type: 'team.provision', id: team, stage, detail: detail ?? null });

export const notifyApp = (appId: string, copy: 'work' | 'public', status: 'running' | 'stopped' | 'error', stopReason: string | null = null, detail?: string) =>
  post('/internal/events', { type: 'app.status', id: appId, copy, status, stopReason, detail: detail ?? null });

export interface McpBuildEvent {
  status: 'building' | 'scanning' | 'testing' | 'in_review' | 'failed';
  failedStage?: 'validate' | 'build' | 'scan' | 'test';
  detail?: string;
  imageRef?: string;
  scanSummary?: { critical: number; high: number; medium: number; low: number };
  findings?: { severity: string; pkg: string; id: string; title: string }[];
  tools?: { name: string; title?: string; description: string; inputSchema: unknown }[];
}

export const notifyMcpBuild = (versionId: string, ev: McpBuildEvent) =>
  post('/internal/events', { type: 'mcp.build', id: versionId, ...ev });

export const notifyMcpInstall = (team: string, key: string, status: 'installed' | 'error' | 'removed', detail?: string) =>
  post('/internal/events', { type: 'mcp.install', id: team, key, status, detail: detail ?? null });

export const sendUsage =(samples: unknown[]) => post('/internal/usage', { samples }, 1);
