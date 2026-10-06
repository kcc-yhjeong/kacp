import { createHmac, timingSafeEqual } from 'node:crypto';
import { NAME_PATTERN } from '@kacp/shared';

// Pure app rules (docs/README.md 5단계, 03-data-model.md apps, 04-api.md 앱 목록 필터).

export type Runtime = 'node' | 'python' | 'static';
export type CopyStatus = 'starting' | 'running' | 'stopped' | 'error';
export type StopReason = 'idle' | 'limit' | 'manual' | 'admin';

/** Picks runtime and default command from the source folder (top-level names + package.json). */
export function detectRuntime(
  files: string[],
  packageJson: { scripts?: Record<string, string>; main?: string } | null,
  requested?: { runtime?: Runtime; command?: string },
): { runtime: Runtime; command: string } | null {
  const has = (f: string) => files.includes(f);
  let runtime: Runtime | null = requested?.runtime ?? null;
  if (!runtime) {
    if (has('package.json') || ['server.js', 'index.js', 'app.js', 'main.js'].some(has)) runtime = 'node';
    else if (has('requirements.txt') || files.some((f) => f.endsWith('.py'))) runtime = 'python';
    else if (has('index.html')) runtime = 'static';
  }
  if (!runtime) return null;
  if (requested?.command?.trim()) return { runtime, command: requested.command.trim() };
  if (runtime === 'node') {
    if (packageJson?.scripts?.start) return { runtime, command: 'npm start' };
    const entry = [packageJson?.main, 'server.js', 'index.js', 'app.js', 'main.js'].find((f) => f && has(f));
    return entry ? { runtime, command: `node ${entry}` } : null;
  }
  if (runtime === 'python') {
    const entry = ['app.py', 'main.py', 'server.py'].find(has);
    return entry ? { runtime, command: `python ${entry}` } : null;
  }
  return { runtime, command: 'httpd -f -v -p "$PORT" -h /src' };
}

/** Folder name → app slug (team-unique; `--` and odd characters are not allowed in hosts). */
export function slugFrom(input: string): string | null {
  const s = input.toLowerCase().normalize('NFKD').replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)
    .replace(/-+$/, '');
  return NAME_PATTERN.test(s) ? s : null;
}

/** First free slug: `calc`, `calc-2`, `calc-3`, … */
export function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const s = `${base.slice(0, 27).replace(/-+$/, '')}-${i}`;
    if (!taken.has(s)) return s;
  }
  throw new Error('no free slug');
}

export type FileSig = Map<string, string>;

/** Snapshot vs source: added / modified / removed relative paths (sorted). */
export function diffTrees(current: FileSig, next: FileSig) {
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  for (const [p, sig] of next) {
    const before = current.get(p);
    if (before === undefined) added.push(p);
    else if (before !== sig) modified.push(p);
  }
  for (const p of current.keys()) if (!next.has(p)) removed.push(p);
  return { added: added.sort(), modified: modified.sort(), removed: removed.sort() };
}

/** U-07 / API filter values (02-design-system.md 앱 목록 필터 값). */
export function workFilter(status: CopyStatus, reason: StopReason | null): 'running' | 'sleeping' | 'stopped' | 'error' {
  if (status === 'error') return 'error';
  if (status === 'stopped') return reason === 'idle' || reason === 'limit' ? 'sleeping' : 'stopped';
  return 'running';
}

export function publicFilter(publicVersion: number | null, pendingKind: 'publish' | 'update' | null): 'none' | 'publish_pending' | 'update_pending' | 'live' {
  if (publicVersion === null) return pendingKind === 'publish' ? 'publish_pending' : 'none';
  return pendingKind === 'update' ? 'update_pending' : 'live';
}

/** Whether a stopped copy is woken by a visit (C-04): idle/limit only — never manual or admin. */
export const canWake = (status: CopyStatus | null, reason: StopReason | null) =>
  status === 'stopped' && (reason === 'idle' || reason === 'limit');

// Team MCP token (docs/README.md 5단계): `{team}.{hmac}` — derived, never stored, team-scoped.
export function mcpToken(secret: string, team: string): string {
  return `${team}.${createHmac('sha256', secret).update(`mcp:${team}`).digest('base64url')}`;
}

export function verifyMcpToken(secret: string, token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const team = token.slice(0, dot);
  if (!NAME_PATTERN.test(team)) return null;
  const expected = Buffer.from(mcpToken(secret, team));
  const got = Buffer.from(token);
  return got.length === expected.length && timingSafeEqual(got, expected) ? team : null;
}
