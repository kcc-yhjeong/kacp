import { NAME_PATTERN } from './names.js';

// Host classification shared by api forward-auth and the web router (05-urls-and-storage.md §2).

export type HostClass =
  | { kind: 'apex' }
  | { kind: 'app' }
  /** Single label: a team or a public app name — the `names` table decides which. */
  | { kind: 'name'; name: string }
  /** Work copy `{slug}--{team}`. */
  | { kind: 'work'; slug: string; team: string }
  | { kind: 'unknown' };

/** `host` may include a port. `baseDomain` is e.g. `kacp.cloud` or `kacp.localhost`. */
export function classifyHost(host: string, baseDomain: string): HostClass {
  const h = host.toLowerCase().replace(/:\d+$/, '');
  if (h === baseDomain) return { kind: 'apex' };
  const suffix = `.${baseDomain}`;
  if (!h.endsWith(suffix)) return { kind: 'unknown' };
  const label = h.slice(0, -suffix.length);
  if (label === 'app') return { kind: 'app' };
  if (label.includes('.')) return { kind: 'unknown' };
  const sep = label.indexOf('--');
  if (sep >= 0) {
    const slug = label.slice(0, sep);
    const team = label.slice(sep + 2);
    if (NAME_PATTERN.test(slug) && NAME_PATTERN.test(team)) return { kind: 'work', slug, team };
    return { kind: 'unknown' };
  }
  if (NAME_PATTERN.test(label)) return { kind: 'name', name: label };
  return { kind: 'unknown' };
}

export function teamOrigin(team: string, baseDomain: string, scheme: 'http' | 'https'): string {
  return `${scheme}://${team}.${baseDomain}`;
}

export function appOrigin(baseDomain: string, scheme: 'http' | 'https'): string {
  return `${scheme}://app.${baseDomain}`;
}
