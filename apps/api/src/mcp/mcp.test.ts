import { describe, expect, it } from 'vitest';
import { manifestProblems } from '@kacp/shared';
import { checkPackage, safeEntryPath, stripWrapper, type PackageFile } from './package.js';
import { codexHidesTools, manifestChanges, missingSecrets, planSync } from './logic.js';

const f = (path: string, text: string): PackageFile => ({ path, data: Buffer.from(text) });
const manifest = `name: weather-demo
version: 0.1.0
displayName: 날씨
summary: 날씨를 알려줘요
secrets:
  - name: EXAMPLE_API_KEY
    required: true
network: [api.example.com]
`;
const pkgJson = JSON.stringify({ name: 'weather-demo', version: '0.1.0', scripts: { build: 'tsc', start: 'node dist/server.js' } });
const good = () => [f('platform-plugin.yaml', manifest), f('package.json', pkgJson), f('README.md', '# 날씨'), f('src/tools/hello.ts', '')];

describe('package check', () => {
  it('accepts the create-platform-mcp layout', () => {
    const r = checkPackage(good());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.network).toEqual(['api.example.com']);
  });

  it('reports missing files, version mismatch and user-scoped secrets in Korean', () => {
    const files = good().filter((x) => x.path !== 'README.md').map((x) => x.path === 'package.json'
      ? f('package.json', JSON.stringify({ name: 'weather-demo', version: '0.2.0', scripts: { build: 'tsc' } }))
      : x.path === 'platform-plugin.yaml' ? f(x.path, manifest.replace('required: true', 'required: true\n    scope: user')) : x);
    const r = checkPackage(files);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems).toContain('README.md: 파일이 없어요.');
      expect(r.problems.some((p) => p.includes('scope'))).toBe(true);
    }
    const r2 = checkPackage(good().map((x) => (x.path === 'package.json' ? f(x.path, JSON.stringify({ name: 'weather-demo', version: '0.2.0', scripts: {} })) : x)));
    expect(!r2.ok && r2.problems.some((p) => p.includes('version(0.2.0)'))).toBe(true);
    expect(!r2.ok && r2.problems.some((p) => p.includes('scripts.start'))).toBe(true);
  });

  it('refuses platform names', () => {
    const r = checkPackage(good().map((x) => (x.path === 'platform-plugin.yaml' ? f(x.path, manifest.replace('weather-demo', 'platform-mcp')) : x)));
    expect(!r.ok && r.problems.some((p) => p.includes('플랫폼이 쓰는 이름'))).toBe(true);
  });

  it('strips a single wrapper folder and rejects unsafe paths', () => {
    const wrapped = good().map((x) => ({ ...x, path: `weather-demo/${x.path}` }));
    expect(stripWrapper(wrapped).map((x) => x.path)).toEqual(good().map((x) => x.path));
    for (const p of ['../x', '/etc/passwd', 'a/../../b', 'a\\b', 'a/./b']) expect(safeEntryPath(p), p).toBe(false);
    expect(safeEntryPath('src/tools/hello.ts')).toBe(true);
  });
});

describe('mcp rules', () => {
  const m = (secrets: string[], network: string[]) =>
    manifestProblems({ name: 'abc', version: '1.0.0', displayName: 'x', summary: 'y', secrets: secrets.map((name) => ({ name })), network }).manifest!;

  it('lists secret and network changes against the published version', () => {
    expect(manifestChanges(m(['A', 'B'], ['a.com']), m(['B', 'C'], ['a.com', 'b.com']))).toEqual({
      secretsAdded: ['C'], secretsRemoved: ['A'], networkAdded: ['b.com'], networkRemoved: [],
    });
    expect(manifestChanges(null, m(['A'], [])).secretsAdded).toEqual(['A']);
  });

  it('finds required secrets that were never entered', () => {
    expect(missingSecrets(m(['A', 'B'], []), ['A'])).toEqual(['B']);
  });

  it('plans the gateway sync: record UI-added servers, drop vanished manual rows, reapply missing installs', () => {
    const plan = planSync(
      { platform: { url: 'http://platform-mcp:5000/mcp' }, mine: { url: 'https://x.example.com/mcp' }, local: { command: 'npx foo' } },
      [
        { serverKey: 'gone', source: 'manual', status: 'installed' },
        { serverKey: 'weather', source: 'market', status: 'installed' },
        { serverKey: 'pending', source: 'market', status: 'installing' },
      ],
    );
    expect(plan.addManual).toEqual([{ key: 'mine', url: 'https://x.example.com/mcp' }, { key: 'local', url: '(명령) npx foo' }]);
    expect(plan.dropManual).toEqual(['gone']);
    expect(plan.reapply).toBe(true);
  });

  it('matches rows to Gateway keys with hyphens turned into underscores', () => {
    const plan = planSync(
      { my_weather: { url: 'http://kacp-mcp-my-weather--team1:8080/mcp' }, my_remote: { url: 'https://x.example.com/mcp' } },
      [
        { serverKey: 'my-weather', source: 'market', status: 'installed' },
        { serverKey: 'my-remote', source: 'manual', status: 'installed' },
      ],
    );
    expect(plan).toEqual({ addManual: [], dropManual: [], reapply: false });
  });

  it('spots Codex tool loading that is not "direct" (MCP tools hidden behind tool search)', () => {
    expect(codexHidesTools({ plugins: { entries: { codex: { enabled: true } } } })).toBe(true);
    expect(codexHidesTools({ plugins: { entries: { codex: { config: { codexDynamicToolsLoading: 'searchable' } } } } })).toBe(true);
    // The plugin is on by default, so no entry still means "searchable".
    expect(codexHidesTools({ plugins: { entries: { 'admin-http-rpc': { enabled: true } } } })).toBe(true);
    expect(codexHidesTools({})).toBe(true);
    expect(codexHidesTools({ plugins: { entries: { codex: { config: { codexDynamicToolsLoading: 'direct' } } } } })).toBe(false);
  });
});
