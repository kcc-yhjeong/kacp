import { describe, expect, it } from 'vitest';
import {
  appHostView,
  chipView,
  copyStateOf,
  deployKindLabel,
  displayUrl,
  filterApps,
  hostnameOf,
  lastRejection,
  memPct,
  nearLimit,
  nextVersion,
  pendingLabel,
  publicFilterOf,
  publishShape,
  wakeDescription,
  withSubject,
  workFilterOf,
} from './status';
import type { App, AppCopy, AppHostInfo, DeployRequest, PublicCopy } from './types';

const copy = (over: Partial<AppCopy> = {}): AppCopy => ({
  kind: 'work',
  url: 'http://lunch-vote--team1.kacp.localhost',
  status: 'running',
  stopReason: null,
  statusDetail: null,
  lastAccessedAt: null,
  usage: null,
  ...over,
});

const pub = (over: Partial<PublicCopy> = {}): PublicCopy => ({
  ...copy({ kind: 'public', url: 'http://lunch-vote.kacp.localhost' }),
  name: 'lunch-vote',
  version: 2,
  publishedAt: '2026-09-27T08:41:00Z',
  approvedBy: null,
  ...over,
});

const app = (over: Partial<App> = {}): App => ({
  id: 'a1',
  team: 'team1',
  slug: 'lunch-vote',
  creator: { kind: 'agent', user: null },
  work: copy(),
  public: null,
  pendingRequest: null,
  ...over,
});

const req = (over: Partial<DeployRequest> = {}): DeployRequest => ({
  id: 'r1',
  appId: 'a1',
  kind: 'update',
  requestedName: null,
  reason: '',
  fromVersion: 2,
  approvedVersion: null,
  diffSummary: null,
  status: 'pending',
  requestedBy: null,
  requestedAt: '2026-09-30T00:00:00Z',
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  ...over,
});

describe('copy state', () => {
  it('splits stopped by reason', () => {
    expect(copyStateOf({ status: 'stopped', stopReason: 'idle' })).toBe('sleeping');
    expect(copyStateOf({ status: 'stopped', stopReason: 'limit' })).toBe('sleeping');
    expect(copyStateOf({ status: 'stopped', stopReason: 'manual' })).toBe('stopped');
    expect(copyStateOf({ status: 'stopped', stopReason: null })).toBe('stopped');
    expect(copyStateOf({ status: 'stopped', stopReason: 'admin' })).toBe('admin');
    expect(copyStateOf({ status: 'error', stopReason: null })).toBe('error');
    expect(copyStateOf({ status: 'starting', stopReason: null })).toBe('starting');
  });
});

describe('list filters', () => {
  it('maps work state to the filter value', () => {
    expect(workFilterOf(app({ work: copy({ status: 'starting' }) }))).toBe('running');
    expect(workFilterOf(app({ work: copy({ status: 'stopped', stopReason: 'limit' }) }))).toBe('sleeping');
    expect(workFilterOf(app({ work: copy({ status: 'stopped', stopReason: 'manual' }) }))).toBe('stopped');
    expect(workFilterOf(app({ work: copy({ status: 'error' }) }))).toBe('error');
  });

  it('maps public state to the filter value', () => {
    expect(publicFilterOf(app())).toBe('none');
    expect(publicFilterOf(app({ pendingRequest: { id: 'r', kind: 'publish' } }))).toBe('publish_pending');
    expect(publicFilterOf(app({ public: pub() }))).toBe('live');
    expect(publicFilterOf(app({ public: pub(), pendingRequest: { id: 'r', kind: 'update' } }))).toBe('update_pending');
  });

  it('filters by work, public and search', () => {
    const apps = [
      app({ id: '1', slug: 'lunch-vote', public: pub() }),
      app({ id: '2', slug: 'budget-calc', work: copy({ status: 'stopped', stopReason: 'idle' }) }),
      app({ id: '3', slug: 'survey', work: copy({ status: 'error' }) }),
    ];
    expect(filterApps(apps, {}).map((a) => a.id)).toEqual(['1', '2', '3']);
    expect(filterApps(apps, { work: 'sleeping' }).map((a) => a.id)).toEqual(['2']);
    expect(filterApps(apps, { public: 'live' }).map((a) => a.id)).toEqual(['1']);
    expect(filterApps(apps, { public: 'none', q: 'SUR' }).map((a) => a.id)).toEqual(['3']);
  });
});

describe('chip badges', () => {
  it('shows public version and pending update', () => {
    const v = chipView(app({ public: pub({ version: 1 }), pendingRequest: { id: 'r', kind: 'update' } }));
    expect(v.dimmed).toBe(false);
    expect(v.badges).toEqual([
      { kind: 'public', label: 'Public v1' },
      { kind: 'pending', label: '업데이트 대기' },
    ]);
  });

  it('shows first publish pending', () => {
    expect(chipView(app({ pendingRequest: { id: 'r', kind: 'publish' } })).badges).toEqual([
      { kind: 'pending', label: '공개 승인 대기' },
    ]);
  });

  it('dims sleeping apps', () => {
    const v = chipView(app({ work: copy({ status: 'stopped', stopReason: 'idle' }) }));
    expect(v.dimmed).toBe(true);
    expect(v.badges).toEqual([{ kind: 'sleeping', label: '잠듦' }]);
    expect(chipView(app({ work: copy({ status: 'stopped', stopReason: 'manual' }) })).dimmed).toBe(false);
  });

  it('long pending label carries versions', () => {
    expect(pendingLabel(app({ public: pub({ version: 2 }), pendingRequest: { id: 'r', kind: 'update' } }))).toBe(
      '업데이트 대기 v2→v3',
    );
    expect(pendingLabel(app())).toBeNull();
  });
});

describe('deploy kind label', () => {
  it('labels publish and update', () => {
    expect(deployKindLabel(req({ kind: 'publish', fromVersion: null }))).toBe('새 공개');
    expect(deployKindLabel(req({ fromVersion: 2 }))).toBe('업데이트 v2→v3');
    expect(deployKindLabel(req({ fromVersion: null }), 4)).toBe('업데이트 v4→v5');
    expect(deployKindLabel(req({ fromVersion: null }))).toBe('업데이트');
  });

  it('computes the next version', () => {
    expect(nextVersion(req({ kind: 'publish', fromVersion: null }))).toBe(1);
    expect(nextVersion(req({ fromVersion: 2 }))).toBe(3);
  });
});

describe('publish modal shape and rejection', () => {
  it('picks the shape', () => {
    expect(publishShape(app())).toBe('unpublished');
    expect(publishShape(app({ pendingRequest: { id: 'r', kind: 'publish' } }))).toBe('pending');
    expect(publishShape(app({ public: pub() }))).toBe('public');
    expect(publishShape(app({ public: pub(), pendingRequest: { id: 'r', kind: 'update' } }))).toBe('pending');
  });

  it('finds the last rejection only when it is the latest decision', () => {
    const rejected = req({ id: 'x', status: 'rejected', decidedAt: '2026-09-30T02:00:00Z' });
    const approved = req({ id: 'y', status: 'approved', decidedAt: '2026-09-29T02:00:00Z' });
    expect(lastRejection({ history: [approved, rejected], pendingRequest: null })?.id).toBe('x');
    expect(lastRejection({ history: [rejected, { ...approved, decidedAt: '2026-10-01T00:00:00Z' }], pendingRequest: null })).toBeNull();
    expect(lastRejection({ history: [rejected], pendingRequest: { id: 'p', kind: 'update' } })).toBeNull();
  });
});

describe('near-limit banner', () => {
  it('shows from one slot left', () => {
    expect(nearLimit({ maxRunningWork: 5, runningWork: 3 })).toBe(false);
    expect(nearLimit({ maxRunningWork: 5, runningWork: 4 })).toBe(true);
    expect(nearLimit({ maxRunningWork: 5, runningWork: 5 })).toBe(true);
    expect(nearLimit(undefined)).toBe(false);
    expect(nearLimit({ maxRunningWork: 0, runningWork: 0 })).toBe(false);
  });
});

describe('wake page variant', () => {
  const info = (over: Partial<AppHostInfo> = {}): AppHostInfo => ({
    exists: true,
    copy: 'work',
    appId: 'a1',
    team: 'team1',
    slug: 'lunch-vote',
    status: 'stopped',
    stopReason: 'idle',
    statusDetail: null,
    canWake: true,
    ...over,
  });

  it('wakes sleeping copies', () => {
    expect(appHostView(info(), true)).toEqual({ kind: 'waking', reason: 'idle', wake: true });
    expect(appHostView(info({ stopReason: 'limit' }), true)).toEqual({ kind: 'waking', reason: 'limit', wake: true });
    expect(appHostView(info({ status: 'starting', stopReason: null }), true)).toEqual({ kind: 'waking', reason: null, wake: false });
  });

  it('handles stopped, admin, error and running', () => {
    expect(appHostView(info({ stopReason: 'manual', canWake: false }), true)).toEqual({ kind: 'stopped', member: true });
    expect(appHostView(info({ copy: 'public', stopReason: 'manual', canWake: false }), false)).toEqual({ kind: 'stopped', member: false });
    expect(appHostView(info({ copy: 'public', stopReason: 'admin', statusDetail: '사유', canWake: false }), false)).toEqual({
      kind: 'admin',
      member: false,
      reason: '사유',
    });
    expect(appHostView(info({ status: 'error', stopReason: null }), true)).toEqual({ kind: 'error', member: true });
    expect(appHostView(info({ status: 'running', stopReason: null }), true)).toEqual({ kind: 'ready' });
  });

  it('handles missing, anonymous and non-member work copies', () => {
    expect(appHostView(info({ exists: false }), false)).toEqual({ kind: 'not_found' });
    expect(appHostView(info({ status: null }), false)).toEqual({ kind: 'login' });
    expect(appHostView(info(), false)).toEqual({ kind: 'forbidden' });
    expect(appHostView(info({ copy: 'public' }), false)).toEqual({ kind: 'waking', reason: 'idle', wake: true });
    expect(appHostView(info({ canWake: false }), true)).toEqual({ kind: 'stopped', member: true });
  });

  it('words the wake page by reason', () => {
    expect(wakeDescription('idle')).toContain('오래 쓰지 않아');
    expect(wakeDescription('limit')).toContain('실행 중인 앱이 많아');
  });
});

describe('misc', () => {
  it('memory percent and hosts', () => {
    expect(memPct({ memBytes: 50, memLimitBytes: 200 })).toBe(25);
    expect(memPct({ memBytes: 50 })).toBeNull();
    expect(memPct(null)).toBeNull();
    expect(hostnameOf('http://lunch-vote--team1.kacp.localhost:8080/')).toBe('lunch-vote--team1.kacp.localhost');
    expect(displayUrl('https://lunch-vote.kacp.cloud/')).toBe('lunch-vote.kacp.cloud');
  });
});

describe('withSubject', () => {
  it('picks 이 or 가', () => {
    expect(withSubject('마케팅팀')).toBe('마케팅팀이');
    expect(withSubject('인사부서')).toBe('인사부서가');
  });
});
