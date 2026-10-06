import type { McpManifest } from '@kacp/shared';

// Pure MCP rules (tested without a database).

export type Servers = Record<string, { url?: string; command?: string } | null>;

export interface SyncPlan { addManual: { key: string; url: string | null }[]; dropManual: string[]; reapply: boolean }

/** Pure: what to change for one team. `platform` is ours and never recorded. */
export function planSync(servers: Servers, rows: { serverKey: string; source: string; status: string }[]): SyncPlan {
  const known = new Map(rows.map((r) => [r.serverKey, r]));
  const addManual = Object.entries(servers)
    .filter(([key, s]) => key !== 'platform' && s && !known.has(key))
    .map(([key, s]) => ({ key, url: s?.url ?? (s?.command ? `(명령) ${s.command}` : null) }));
  const dropManual = rows.filter((r) => r.source === 'manual' && !servers[r.serverKey]).map((r) => r.serverKey);
  const reapply = rows.some((r) => r.source !== 'manual' && r.status === 'installed' && !servers[r.serverKey]);
  return { addManual, dropManual, reapply };
}

/** What changed since the published version: secrets and network are what reviewers must re-check. */
export function manifestChanges(prev: McpManifest | null, next: McpManifest) {
  const diff = (a: string[], b: string[]) => b.filter((x) => !a.includes(x));
  const ps = prev?.secrets.map((s) => s.name) ?? [];
  const ns = next.secrets.map((s) => s.name);
  const pn = prev?.network ?? [];
  return { secretsAdded: diff(ps, ns), secretsRemoved: diff(ns, ps), networkAdded: diff(pn, next.network), networkRemoved: diff(next.network, pn) };
}

/** Missing required secrets after an install or upgrade (shown as 오류 detail, the server still runs). */
export function missingSecrets(manifest: McpManifest, have: string[]) {
  return manifest.secrets.filter((s) => s.required && !have.includes(s.name)).map((s) => s.name);
}
