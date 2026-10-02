import { classifyHost, type HostClass } from '@kacp/shared';

// Runtime host parsing: the same build serves app.{base}, {team}.{base} and unknown names
// (docs/design/05-urls-and-storage.md §2). No build-time config.

export interface HostInfo {
  /** e.g. `kacp.cloud` — hostname minus its first label. Null when the hostname has no dot. */
  base: string | null;
  /** `http:` or `https:` */
  protocol: string;
  /** `:8443` or empty. Kept so local setups on a non-default port still work. */
  portSuffix: string;
  hostClass: HostClass;
}

export function parseHost(hostname: string, protocol: string, port = ''): HostInfo {
  const h = hostname.toLowerCase();
  const dot = h.indexOf('.');
  const base = dot > 0 && dot < h.length - 1 ? h.slice(dot + 1) : null;
  return {
    base,
    protocol,
    portSuffix: port ? `:${port}` : '',
    hostClass: base ? classifyHost(h, base) : { kind: 'unknown' },
  };
}

export function appOriginOf(info: HostInfo): string {
  return `${info.protocol}//app.${info.base ?? 'localhost'}${info.portSuffix}`;
}

/** True when `next` is an absolute http(s) URL on `base` or one of its subdomains. */
export function isSafeNext(next: string | null | undefined, base: string | null): next is string {
  if (!next || !base) return false;
  let url: URL;
  try {
    url = new URL(next);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const h = url.hostname.toLowerCase();
  return h === base || h.endsWith(`.${base}`);
}

/** Origin root of a team (`MyTeam.url` is the full origin; tolerate a trailing slash or path). */
export function teamRoot(url: string): string {
  return new URL('/', url).href;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export const currentHost: HostInfo = parseHost(
  typeof location === 'undefined' ? 'localhost' : location.hostname,
  typeof location === 'undefined' ? 'http:' : location.protocol,
  typeof location === 'undefined' ? '' : location.port,
);

export const appOrigin = appOriginOf(currentHost);
export const apiBase = `${appOrigin}/api/v1`;

/** Login URL that brings the user back here afterwards (no `next` for the app root). */
export function loginUrl(): string {
  const here = location.href;
  const isAppRoot = currentHost.hostClass.kind === 'app' && location.pathname === '/' && !location.search;
  return isAppRoot ? `${appOrigin}/login` : `${appOrigin}/login?next=${encodeURIComponent(here)}`;
}
