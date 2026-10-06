import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { parseInline, parseMarkdown, safeHref } from './markdown';
import { canManageTeamMcp, pickMarketTeam } from './market-team';
import {
  buildInstallMatrix,
  canRemoveInstall,
  canReenterSecrets,
  changeCount,
  compareSemver,
  consentComplete,
  consentItems,
  hasBusyInstall,
  headerObject,
  INSTALL_STATUS,
  INSTALL_SOURCE_LABEL,
  isVersionBusy,
  latestInColumn,
  manualUrlProblem,
  missingSecrets,
  networkKind,
  scanSummaryText,
  secretPayload,
  sortFindings,
  stopTitle,
  uploadErrorView,
  versionSteps,
  zipProblem,
} from './status';
import type { AdminMcpInstall } from './types';

const states = (s: ReturnType<typeof versionSteps>) => s.map((x) => x.state);

describe('versionSteps', () => {
  it('marks the running stage as current', () => {
    expect(states(versionSteps('uploaded', null))).toEqual(['current', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo']);
    expect(states(versionSteps('building', null))).toEqual(['done', 'done', 'current', 'todo', 'todo', 'todo', 'todo']);
    expect(states(versionSteps('in_review', null))).toEqual(['done', 'done', 'done', 'done', 'done', 'current', 'todo']);
  });
  it('is all done when published or superseded', () => {
    expect(states(versionSteps('published', null)).every((s) => s === 'done')).toBe(true);
    expect(states(versionSteps('superseded', null)).every((s) => s === 'done')).toBe(true);
  });
  it('stops with X at the failed stage', () => {
    expect(states(versionSteps('failed', 'scan'))).toEqual(['done', 'done', 'done', 'failed', 'todo', 'todo', 'todo']);
    expect(states(versionSteps('failed', 'validate'))).toEqual(['done', 'failed', 'todo', 'todo', 'todo', 'todo', 'todo']);
    expect(states(versionSteps('failed', null))[1]).toBe('failed');
  });
  it('stops with X at 심사 대기 when rejected', () => {
    const s = versionSteps('rejected', null);
    expect(s[5]).toEqual({ label: '심사 대기', state: 'failed' });
    expect(s[6]?.state).toBe('todo');
  });
  it('labels the stop and busy states', () => {
    expect(stopTitle({ status: 'failed', failedStage: 'scan' })).toBe('보안 스캔에서 멈췄어요');
    expect(stopTitle({ status: 'rejected', failedStage: null })).toBe('심사에서 반려됐어요');
    expect(stopTitle({ status: 'published', failedStage: null })).toBeNull();
    expect(isVersionBusy('testing')).toBe(true);
    expect(isVersionBusy('in_review')).toBe(false);
  });
});

describe('install badges and actions', () => {
  it('uses the 02 wording', () => {
    expect(INSTALL_STATUS.installed).toMatchObject({ label: '설치됨', dot: 'success' });
    expect(INSTALL_STATUS.error).toMatchObject({ label: '오류', dot: 'danger' });
    expect(INSTALL_STATUS.installing).toMatchObject({ label: '설치 중', dot: 'warning' });
    expect(INSTALL_STATUS.removing).toMatchObject({ label: '제거 중', dot: 'muted' });
    expect(INSTALL_SOURCE_LABEL.manual).toBe('직접 추가 · 검토되지 않음');
  });
  it('polls only while something moves', () => {
    expect(hasBusyInstall([{ status: 'installed' }, { status: 'error' }])).toBe(false);
    expect(hasBusyInstall([{ status: 'installed' }, { status: 'removing' }])).toBe(true);
  });
  it('never removes platform-mcp', () => {
    expect(canRemoveInstall({ packageName: 'platform-mcp', status: 'installed' })).toBe(false);
    expect(canRemoveInstall({ packageName: 'notion-sync', status: 'installed' })).toBe(true);
    expect(canRemoveInstall({ packageName: null, status: 'removing' })).toBe(false);
    expect(canReenterSecrets({ source: 'market', secretNames: [], status: 'installed', packageName: 'x' })).toBe(false);
    expect(canReenterSecrets({ source: 'manual', secretNames: ['A'], status: 'error', packageName: null })).toBe(true);
  });
});

describe('install consent and secrets', () => {
  const manifest = {
    network: ['api.notion.com'],
    secrets: [
      { name: 'NOTION_TOKEN', description: '토큰', required: true, scope: 'team' as const },
      { name: 'NOTION_SPACE', description: '', required: false, scope: 'team' as const },
    ],
  };
  it('needs every box ticked', () => {
    const items = consentItems(manifest);
    expect(items.map((i) => i.key)).toEqual(['net:api.notion.com', 'secret:NOTION_TOKEN', 'secret:NOTION_SPACE']);
    expect(consentComplete(items, new Set(['net:api.notion.com', 'secret:NOTION_TOKEN']))).toBe(false);
    expect(consentComplete(items, new Set(items.map((i) => i.key)))).toBe(true);
    expect(consentComplete(consentItems({ network: [], secrets: [] }), new Set())).toBe(true);
    expect(consentItems(null)).toEqual([]);
  });
  it('lists required secrets left empty', () => {
    expect(missingSecrets(manifest.secrets, { NOTION_TOKEN: '  ' })).toEqual(['NOTION_TOKEN']);
    expect(missingSecrets(manifest.secrets, { NOTION_TOKEN: 'x' })).toEqual([]);
    expect(secretPayload({ A: 'x', B: ' ' })).toEqual({ A: 'x' });
  });
});

describe('upload errors', () => {
  it('lists manifest problems', () => {
    const v = uploadErrorView(new ApiError(422, 'MCP_MANIFEST_INVALID', 'bad', { problems: ['version: semver', 3] }));
    expect(v.problems).toEqual(['version: semver']);
    expect(v.title).toContain('platform-plugin.yaml');
  });
  it('maps conflicts and ownership', () => {
    expect(uploadErrorView(new ApiError(409, 'MCP_VERSION_EXISTS', 'x')).title).toContain('이미 올린 버전');
    expect(uploadErrorView(new ApiError(403, 'FORBIDDEN', 'x')).title).toContain('다른 사람');
    expect(uploadErrorView(new ApiError(413, 'INTERNAL', 'x')).title).toContain('50MB');
    expect(uploadErrorView(new Error('boom')).problems).toEqual([]);
  });
  it('checks the file before sending', () => {
    expect(zipProblem({ name: 'a.tar.gz', size: 10 })).toContain('.zip');
    expect(zipProblem({ name: 'a.zip', size: 51 * 1024 * 1024 })).toContain('50MB');
    expect(zipProblem({ name: 'A.ZIP', size: 10 })).toBeNull();
  });
});

describe('matrix', () => {
  const row = (team: string, pkg: string | null, version: string | null, source: AdminMcpInstall['source'] = 'market'): AdminMcpInstall => ({
    id: `${team}-${pkg}`,
    team,
    source,
    name: pkg ?? 'manual-thing',
    packageName: pkg,
    version,
    manualUrl: null,
    status: 'installed',
    statusDetail: null,
    secretNames: [],
    installedBy: null,
    lastCheckedAt: null,
  });
  it('builds team × package with platform-mcp first and skips manual', () => {
    const m = buildInstallMatrix([
      row('sales', 'notion-sync', '1.1.0'),
      row('marketing', 'notion-sync', '1.2.0'),
      row('marketing', 'platform-mcp', '2.0.1', 'default'),
      row('marketing', 'ga4', '0.9.3'),
      row('marketing', null, null, 'manual'),
    ]);
    expect(m.packages).toEqual(['platform-mcp', 'notion-sync', 'ga4']);
    expect(m.rows.map((r) => r.team)).toEqual(['marketing', 'sales']);
    expect(m.rows[1]?.cells['ga4']).toBeUndefined();
    expect(m.rows[0]?.cells['notion-sync']?.version).toBe('1.2.0');
    expect(latestInColumn(m, 'notion-sync')).toBe('1.2.0');
  });
  it('compares semver numerically', () => {
    expect(compareSemver('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0-beta', '1.0.0')).toBeLessThan(0);
    expect(compareSemver('2.0.0', '2.0.0')).toBe(0);
  });
});

describe('review helpers', () => {
  it('tells internal from external hosts', () => {
    expect(networkKind('jira.kacp.internal', 'kacp.cloud')).toBe('internal');
    expect(networkKind('*.kacp.cloud', 'kacp.cloud')).toBe('internal');
    expect(networkKind('api.atlassian.com', 'kacp.cloud')).toBe('external');
  });
  it('summarizes scans and changes', () => {
    expect(scanSummaryText({ critical: 0, high: 1, medium: 2, low: 5 })).toBe('Critical 0 · High 1 · Medium 2 · Low 5');
    expect(scanSummaryText(null)).toBe('—');
    expect(sortFindings([{ severity: 'LOW' }, { severity: 'critical' }, { severity: 'x' }]).map((f) => f.severity)).toEqual(['critical', 'LOW', 'x']);
    expect(changeCount({ secretsAdded: ['A'], secretsRemoved: [], networkAdded: ['b.com'], networkRemoved: [] })).toBe(2);
  });
});

describe('manual add', () => {
  it('accepts http(s) only', () => {
    expect(manualUrlProblem('https://mcp.design-lab.internal/sse')).toBeNull();
    expect(manualUrlProblem('ftp://x')).not.toBeNull();
    expect(manualUrlProblem('https://u:p@x.com')).not.toBeNull();
    expect(manualUrlProblem('')).not.toBeNull();
  });
  it('builds headers', () => {
    expect(headerObject([{ name: ' Authorization ', value: 'Bearer x' }, { name: '', value: 'y' }])).toEqual({ Authorization: 'Bearer x' });
    expect(headerObject([{ name: '', value: '' }])).toBeUndefined();
  });
});

describe('market team', () => {
  const teams = [
    { name: 'a', displayName: 'A', url: 'http://a', teamRole: 'member' as const, containerStatus: 'stopped' as const },
    { name: 'b', displayName: 'B', url: 'http://b', teamRole: 'team_admin' as const, containerStatus: 'running' as const },
  ];
  it('prefers ?team=, then the last one, then the first', () => {
    expect(pickMarketTeam(teams as never, 'b', 'a')?.name).toBe('b');
    expect(pickMarketTeam(teams as never, 'zzz', 'b')?.name).toBe('b');
    expect(pickMarketTeam(teams as never, undefined, null)?.name).toBe('a');
  });
  it('lets team admins and platform admins manage', () => {
    expect(canManageTeamMcp(teams[0], 'user')).toBe(false);
    expect(canManageTeamMcp(teams[1], 'user')).toBe(true);
    expect(canManageTeamMcp(teams[0], 'admin')).toBe(true);
  });
});

describe('markdown', () => {
  it('parses blocks', () => {
    const b = parseMarkdown('# Title\n\nHello **world**\n\n- a\n- b\n\n```ts\nconst x = 1;\n```\n> note');
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'ul', 'code', 'quote']);
    expect(b[3]).toEqual({ t: 'code', lang: 'ts', v: 'const x = 1;' });
  });
  it('keeps unsafe links and HTML as text', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(parseInline('[x](javascript:alert(1))')).toEqual([{ t: 'text', v: 'x' }, { t: 'text', v: ')' }]);
    expect(parseInline('[docs](https://a.b)')).toEqual([{ t: 'link', href: 'https://a.b', c: [{ t: 'text', v: 'docs' }] }]);
    expect(parseMarkdown('<img src=x onerror=alert(1)>')).toEqual([{ t: 'p', c: [{ t: 'text', v: '<img src=x onerror=alert(1)>' }] }]);
  });
});
