import type { TeamContainerStatus } from '@kacp/shared';
import { config } from './config.js';

// Status notifications to the api (04-api.md §3 POST /internal/events). Retried a few times.
export async function notifyTeamStatus(team: string, status: TeamContainerStatus, detail?: string) {
  const body = JSON.stringify({ type: 'team.status', id: team, status, detail: detail ?? null });
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`${config.apiUrl}/internal/events`, {
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
