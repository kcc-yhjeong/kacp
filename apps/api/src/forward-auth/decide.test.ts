import { describe, expect, it } from 'vitest';
import type { SessionContext } from '../auth/session.js';
import { decide, type ForwardAuthDeps, type ForwardAuthRequest } from './decide.js';

const deps: ForwardAuthDeps = {
  baseDomain: 'kacp.cloud',
  scheme: 'https',
  lookupName: async (n) =>
    n === 'team1' ? { kind: 'team', teamId: 't1', team: 'team1' } : n === 'lunch' ? { kind: 'public_app' } : null,
  lookupTeam: async (n) => (n === 'team1' ? { teamId: 't1' } : null),
  membership: async (teamId, userId) => (teamId !== 't1' ? null : userId === 'kim' ? 'team_admin' : userId === 'lee' ? 'member' : null),
};

const user = (id: string, setupOnly = false): SessionContext => ({
  sessionId: 's',
  setupOnly,
  user: { id, email: `${id}@kcc.co.kr`, name: '김하늘', platformRole: 'user', mustChangePassword: setupOnly },
});

const req = (over: Partial<ForwardAuthRequest>): ForwardAuthRequest => ({
  host: 'team1.kacp.cloud', uri: '/claw/', accept: 'text/html', upgrade: '', session: null, ...over,
});

describe('forward-auth decide', () => {
  it('passes unknown hosts without identity', async () => {
    expect(await decide(req({ host: 'nope.kacp.cloud' }), deps)).toEqual({ status: 200, headers: {} });
    expect(await decide(req({ host: 'app--ghost.kacp.cloud' }), deps)).toEqual({ status: 200, headers: {} });
  });

  it('redirects browsers without a session to an absolute login URL', async () => {
    expect(await decide(req({ uri: '/claw/?x=1' }), deps)).toEqual({
      status: 302,
      location: 'https://app.kacp.cloud/login?next=https%3A%2F%2Fteam1.kacp.cloud%2Fclaw%2F%3Fx%3D1',
    });
  });

  it('answers 401 to XHR and WebSocket without a session', async () => {
    expect(await decide(req({ accept: 'application/json' }), deps)).toEqual({ status: 401 });
    expect(await decide(req({ upgrade: 'websocket' }), deps)).toEqual({ status: 401 });
  });

  it('sends setup-only sessions to password setup', async () => {
    expect(await decide(req({ session: user('kim', true) }), deps)).toEqual({
      status: 302, location: 'https://app.kacp.cloud/password/setup',
    });
  });

  it('refuses non-members', async () => {
    expect(await decide(req({ session: user('park') }), deps)).toEqual({
      status: 302, location: 'https://app.kacp.cloud/forbidden?team=team1',
    });
    expect(await decide(req({ session: user('park'), upgrade: 'websocket' }), deps)).toEqual({ status: 403 });
  });

  it('injects identity and scope cap for members', async () => {
    const d = await decide(req({ session: user('lee') }), deps);
    expect(d.status).toBe(200);
    if (d.status !== 200) return;
    expect(d.headers['X-Forwarded-User']).toBe('lee@kcc.co.kr');
    expect(d.headers['X-Openclaw-Scopes']).toBe('operator.read,operator.write,operator.approvals,operator.questions');
    expect(d.headers['X-KACP-Team-Role']).toBe('member');
    expect(d.headers['X-KACP-User-Name']).toBe(encodeURIComponent('김하늘'));
  });

  it('adds operator.admin to the cap for team admins', async () => {
    const d = await decide(req({ session: user('kim') }), deps);
    expect(d.status === 200 && d.headers['X-Openclaw-Scopes']?.endsWith(',operator.admin')).toBe(true);
  });

  it('requires only login for public app names', async () => {
    const d = await decide(req({ host: 'lunch.kacp.cloud', session: user('park') }), deps);
    expect(d.status).toBe(200);
    if (d.status === 200) expect(d.headers['X-Forwarded-User']).toBeUndefined();
  });

  it('checks the team of a work copy host', async () => {
    expect((await decide(req({ host: 'calc--team1.kacp.cloud', session: user('lee') }), deps)).status).toBe(200);
    expect((await decide(req({ host: 'calc--team1.kacp.cloud', session: user('park'), accept: '*/*' }), deps)).status).toBe(403);
  });
});
