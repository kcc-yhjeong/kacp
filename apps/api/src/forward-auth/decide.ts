import { classifyHost, scopesForRole, type TeamRole } from '@kacp/shared';
import type { SessionContext } from '../auth/session.js';

// forward-auth decision (06-auth.md §5). Pure: all lookups are injected so it can be unit-tested.

export interface ForwardAuthRequest {
  host: string;
  uri: string;
  accept: string;
  upgrade: string;
  session: SessionContext | null;
}

export type NameOwner = { kind: 'team'; teamId: string; team: string } | { kind: 'public_app' } | null;

export interface ForwardAuthDeps {
  baseDomain: string;
  scheme: 'http' | 'https';
  lookupName(name: string): Promise<NameOwner>;
  lookupTeam(team: string): Promise<{ teamId: string } | null>;
  membership(teamId: string, userId: string): Promise<TeamRole | null>;
}

export type Decision =
  | { status: 200; headers: Record<string, string> }
  | { status: 302; location: string }
  | { status: 401 | 403 };

export async function decide(req: ForwardAuthRequest, deps: ForwardAuthDeps): Promise<Decision> {
  const appOrigin = `${deps.scheme}://app.${deps.baseDomain}`;
  const isBrowserNav = req.accept.includes('text/html') && !req.upgrade;

  // 1. Classify the host and find what has to be checked.
  const hc = classifyHost(req.host, deps.baseDomain);
  let target: { kind: 'team'; teamId: string; team: string } | { kind: 'login_only' } | null = null;
  if (hc.kind === 'name') {
    const owner = await deps.lookupName(hc.name);
    if (owner?.kind === 'team') target = owner;
    else if (owner?.kind === 'public_app') target = { kind: 'login_only' };
  } else if (hc.kind === 'work') {
    const t = await deps.lookupTeam(hc.team);
    if (t) target = { kind: 'team', teamId: t.teamId, team: hc.team };
  }
  // 2. Unknown hosts pass without identity; web renders the 404 screen.
  if (!target) return { status: 200, headers: {} };

  // 3. No session.
  const s = req.session;
  if (!s) {
    if (!isBrowserNav) return { status: 401 };
    const original = `${deps.scheme}://${req.host}${req.uri}`;
    // Always absolute: Traefik resolves relative Locations against the auth server (spike 01).
    return { status: 302, location: `${appOrigin}/login?next=${encodeURIComponent(original)}` };
  }
  // 4. First-login session.
  if (s.setupOnly) {
    return isBrowserNav ? { status: 302, location: `${appOrigin}/password/setup` } : { status: 403 };
  }

  const identity: Record<string, string> = {
    'X-KACP-User-Id': s.user.id,
    'X-KACP-User-Email': s.user.email,
    'X-KACP-User-Name': encodeURIComponent(s.user.name),
  };
  // 5. Permission.
  if (target.kind === 'login_only') return { status: 200, headers: identity };

  const role = await deps.membership(target.teamId, s.user.id);
  // Platform admins review work copies from A-09 ("작업본 열기"), so they may open `slug--team`
  // hosts. Team hosts (shell, agent) stay members-only (06-auth.md §7).
  if (!role && hc.kind === 'work' && s.user.platformRole === 'admin') {
    return { status: 200, headers: { ...identity, 'X-KACP-Team': target.team, 'X-KACP-Team-Role': 'platform_admin' } };
  }
  if (!role) {
    if (!isBrowserNav) return { status: 403 };
    return { status: 302, location: `${appOrigin}/forbidden?team=${encodeURIComponent(target.team)}` };
  }
  return {
    status: 200,
    headers: {
      ...identity,
      'X-KACP-Team': target.team,
      'X-KACP-Team-Role': role,
      'X-Forwarded-User': s.user.email,
      // Always sent on team hosts: without it OpenClaw HTTP paths fall back to CLI scopes (spike 01).
      'X-Openclaw-Scopes': scopesForRole(role),
    },
  };
}
