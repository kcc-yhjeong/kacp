import { describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({ STATE_DIR: '/home/node/.openclaw' }));
const { agentEntry, computePatch } = await import('./apply-config.js');

/** What doctor (or the first apply) leaves in a multi-agent team. */
const OWNED = { ownership: 'explicit', defaults: { heartbeat: { agentId: 'main' }, systemAgent: { agentId: 'main' } } };

/** A team whose Codex loading is already "direct" — keeps that patch out of tests about other keys. */
const withCodex = (current: Record<string, unknown>) =>
  ({ ...current, plugins: { entries: { codex: { config: { codexDynamicToolsLoading: 'direct' } } } } });

const agent = (id: string, over: Partial<Parameters<typeof agentEntry>[0]> = {}) => ({
  id, name: '보고서 도우미', emoji: '📊', model: 'anthropic/claude-sonnet-4-5', thinking: 'medium' as const,
  instructions: '주간 보고서를 써요.', skills: [], tools: { allow: [], deny: ['shell.exec'] }, ...over,
});

describe('computePatch', () => {
  it('adds agents and team admins to an empty config', () => {
    const plan = computePatch(withCodex({}), { agents: [agent('kacp-a')], adminEmails: ['kim@kcc.co.kr'] });
    expect(plan?.patch).toEqual({
      agents: {
        // a fresh team becomes multi-agent: explicit ownership, `main` keeps the ambient owners
        ownership: 'explicit',
        entries: {
          'kacp-a': {
            name: '보고서 도우미', identity: { emoji: '📊' }, workspace: '/home/node/.openclaw/workspace-kacp-a',
            model: 'anthropic/claude-sonnet-4-5', thinkingDefault: 'medium', tools: { deny: ['shell.exec'] },
          },
          main: {},
        },
        defaults: { heartbeat: { agentId: 'main' }, systemAgent: { agentId: 'main' } },
      },
      gateway: { auth: { identityScopes: { 'kim@kcc.co.kr': ['operator.admin'] } } },
    });
    expect(plan?.replacePaths).toEqual([
      'agents.entries.kacp-a', 'gateway.auth.identityScopes.kim@kcc.co.kr',
      'agents.ownership', 'agents.defaults.heartbeat.agentId', 'agents.defaults.systemAgent.agentId',
    ]);
  });

  it('is a no-op when nothing changed (key order does not matter)', () => {
    const entry = agentEntry(agent('kacp-a'));
    const reordered = Object.fromEntries(Object.entries(entry).reverse());
    const current = { agents: { ...OWNED, entries: { 'kacp-a': reordered, main: { name: 'main' } } }, gateway: { auth: { identityScopes: { 'kim@kcc.co.kr': ['operator.admin'] } } } };
    expect(computePatch(withCodex(current), { agents: [agent('kacp-a')], adminEmails: ['kim@kcc.co.kr'] })).toBeNull();
  });

  it('removes unassigned managed agents and demoted admins with replacePaths, leaving others alone', () => {
    const current = {
      agents: { entries: { 'kacp-old': { name: 'x' }, main: { name: 'main' } } },
      gateway: { auth: { identityScopes: { 'lee@kcc.co.kr': ['operator.admin'] } } },
    };
    const plan = computePatch(withCodex(current), { agents: [], adminEmails: [] });
    expect(plan?.patch).toEqual({
      agents: { entries: { 'kacp-old': null } },
      gateway: { auth: { identityScopes: { 'lee@kcc.co.kr': null } } },
    });
    expect(plan?.replacePaths).toEqual(['agents.entries.kacp-old', 'gateway.auth.identityScopes.lee@kcc.co.kr']);
  });

  it('replaces a changed entry whole', () => {
    const current = { agents: { ...OWNED, entries: { 'kacp-a': agentEntry(agent('kacp-a')), main: {} } } };
    const plan = computePatch(withCodex(current), { agents: [agent('kacp-a', { tools: { allow: ['web.fetch'], deny: [] } })], adminEmails: [] });
    expect((plan?.patch.agents as { entries: Record<string, { tools: unknown }> }).entries['kacp-a']!.tools).toEqual({ allow: ['web.fetch', 'bundle-mcp'] });
    expect(plan?.replacePaths).toEqual(['agents.entries.kacp-a']);
  });
});

describe('withPlatformBlock', () => {
  it('adds the block on top once and refreshes it in place', async () => {
    const { withPlatformBlock, PLATFORM_INSTRUCTIONS } = await import('./apply-config.js');
    const original = '# AGENTS.md\n\nOpenClaw defaults\n';
    const once = withPlatformBlock(original);
    expect(once.startsWith('<!-- KACP:BEGIN')).toBe(true);
    expect(once.endsWith(original)).toBe(true);
    expect(withPlatformBlock(once)).toBe(once);
    expect(withPlatformBlock(null)).toContain(PLATFORM_INSTRUCTIONS);
  });
});

describe('sandbox prune', () => {
  it('enforces the prune policy only when asked and only if different', async () => {
    const { computePatch, SANDBOX_PRUNE } = await import('./apply-config.js');
    const empty = { agents: [], adminEmails: [] };
    expect(computePatch(withCodex({}), empty)).toBeNull();
    const plan = computePatch(withCodex({}), empty, { sandbox: true });
    expect(plan?.patch).toEqual({ agents: { defaults: { sandbox: { prune: SANDBOX_PRUNE } } } });
    expect(plan?.replacePaths).toEqual(['agents.defaults.sandbox.prune']);
    expect(computePatch(withCodex({ agents: { defaults: { sandbox: { prune: { maxAgeDays: 1, idleHours: 1 } } } } }), empty, { sandbox: true })).toBeNull();
  });
});

describe('platform mcp', () => {
  it('adds mcp.servers.platform with the team token and leaves it once present', async () => {
    const { computePatch } = await import('./apply-config.js');
    const desired = { agents: [], adminEmails: [], platformMcp: { url: 'http://platform-mcp:5000/mcp', token: 'team1.abcdefghijklmnopqrstuvwxyz' } };
    const plan = computePatch(withCodex({}), desired);
    expect(plan?.patch).toEqual({ mcp: { servers: { platform: {
      url: 'http://platform-mcp:5000/mcp', transport: 'streamable-http', headers: { Authorization: 'Bearer team1.abcdefghijklmnopqrstuvwxyz' },
    } } } });
    expect(plan?.replacePaths).toEqual(['mcp.servers.platform']);
    const current = { mcp: { servers: { platform: { url: 'http://platform-mcp:5000/mcp', transport: 'streamable-http', headers: { Authorization: '***' } } } } };
    expect(computePatch(withCodex(current), desired)).toBeNull();
  });
});

describe('market mcp servers', () => {
  it('adds installed servers and deletes only managed ones that are gone', async () => {
    const { computePatch } = await import('./apply-config.js');
    const current = { mcp: { servers: {
      platform: { url: 'http://platform-mcp:5000/mcp', transport: 'streamable-http' },
      'old-mcp': { url: 'http://kacp-mcp-old-mcp--team1:8080/mcp', transport: 'streamable-http' },
      'mine': { url: 'https://mcp.example.com/mcp', transport: 'streamable-http' },
      'notion-sync': { url: 'http://kacp-mcp-notion-sync--team1:8080/mcp', transport: 'streamable-http' },
    } } };
    const desired = {
      agents: [], adminEmails: [],
      mcpServers: [
        { key: 'notion-sync', url: 'http://kacp-mcp-notion-sync--team1:8080/mcp' },
        { key: 'weather', url: 'http://kacp-mcp-weather--team1:8080/mcp' },
      ],
    };
    const plan = computePatch(withCodex(current), desired);
    expect(plan?.patch).toEqual({ mcp: { servers: {
      'old-mcp': null,
      weather: { url: 'http://kacp-mcp-weather--team1:8080/mcp', transport: 'streamable-http' },
    } } });
    expect(plan?.replacePaths).toEqual(['mcp.servers.old-mcp', 'mcp.servers.weather']);
    // without mcpServers (older callers) market keys are left alone
    expect(computePatch(withCodex(current), { agents: [], adminEmails: [] })).toBeNull();
  });
});

describe('shared market mcp with team secret headers', () => {
  it('rewrites an entry only when the url or the secrets revision changes', async () => {
    const { computePatch } = await import('./apply-config.js');
    const headers = { 'X-KACP-Secret-API-KEY': 'v1', 'X-KACP-Secrets-Rev': 'aaa' };
    const desired = { agents: [], adminEmails: [], mcpServers: [{ key: 'my_weather', url: 'http://kacp-mcp-my-weather:8080/mcp', headers }] };
    const plan = computePatch(withCodex({}), desired);
    expect(plan?.patch).toEqual({ mcp: { servers: { my_weather: { url: 'http://kacp-mcp-my-weather:8080/mcp', transport: 'streamable-http', headers } } } });
    // values hidden by config.get, same revision → nothing to do
    const current = { mcp: { servers: { my_weather: { url: 'http://kacp-mcp-my-weather:8080/mcp', transport: 'streamable-http', headers: { 'X-KACP-Secret-API-KEY': '***', 'X-KACP-Secrets-Rev': 'aaa' } } } } };
    expect(computePatch(withCodex(current), desired)).toBeNull();
    // new secrets → new revision → rewrite
    const next = { ...desired, mcpServers: [{ ...desired.mcpServers[0]!, headers: { ...headers, 'X-KACP-Secrets-Rev': 'bbb' } }] };
    expect(computePatch(withCodex(current), next)?.replacePaths).toEqual(['mcp.servers.my_weather']);
    // the old per-team URL is managed too: replaced by the shared server
    const legacy = { mcp: { servers: { my_weather: { url: 'http://kacp-mcp-my-weather--team1:8080/mcp', transport: 'streamable-http' } } } };
    expect(computePatch(withCodex(legacy), desired)?.replacePaths).toEqual(['mcp.servers.my_weather']);
  });

  it('secret headers: one per secret, blank values dropped, stable revision', async () => {
    const { secretHeaders } = await import('./mcp-runtime.js');
    const a = secretHeaders({ EXAMPLE_API_KEY: 'k', EXAMPLE_LANG: '' });
    expect(Object.keys(a)).toEqual(['X-KACP-Secret-EXAMPLE-API-KEY', 'X-KACP-Secrets-Rev']);
    expect(secretHeaders({ EXAMPLE_API_KEY: 'k' })['X-KACP-Secrets-Rev']).toBe(a['X-KACP-Secrets-Rev']);
    expect(secretHeaders({ EXAMPLE_API_KEY: 'k2' })['X-KACP-Secrets-Rev']).not.toBe(a['X-KACP-Secrets-Rev']);
  });
});

describe('codex harness', () => {
  it('loads dynamic (MCP) tools directly, with or without a codex plugin entry', async () => {
    const { computePatch } = await import('./apply-config.js');
    const empty = { agents: [], adminEmails: [] };
    // The plugin is on by default: a team with no entry still needs "direct".
    expect(computePatch({}, empty)?.patch).toEqual({ plugins: { entries: { codex: { config: { codexDynamicToolsLoading: 'direct' } } } } });
    const plan = computePatch({ plugins: { entries: { codex: { enabled: true } } } }, empty);
    expect(plan?.patch).toEqual({ plugins: { entries: { codex: { config: { codexDynamicToolsLoading: 'direct' } } } } });
    expect(plan?.replacePaths).toEqual(['plugins.entries.codex.config.codexDynamicToolsLoading']);
    expect(computePatch({ plugins: { entries: { codex: { config: { codexDynamicToolsLoading: 'direct' } } } } }, empty)).toBeNull();
  });
});

describe('sandbox origin', () => {
  it('sets mcp.apps.sandboxOrigin next to the platform server and is idempotent', async () => {
    const { computePatch } = await import('./apply-config.js');
    const desired = { agents: [], adminEmails: [] };
    const plan = computePatch(withCodex({}), desired, { sandboxOrigin: 'http://team1--sbx.kacp.localhost' });
    expect(plan?.patch).toEqual({ mcp: { apps: { sandboxOrigin: 'http://team1--sbx.kacp.localhost', sandboxPort: 18790 } } });
    const current = { mcp: { apps: { sandboxOrigin: 'http://team1--sbx.kacp.localhost', sandboxPort: 18790 } } };
    expect(computePatch(withCodex(current), desired, { sandboxOrigin: 'http://team1--sbx.kacp.localhost' })).toBeNull();
  });
});

describe('tool allow list', () => {
  it('keeps MCP tools when a template uses an allow list', () => {
    expect(agentEntry(agent('kacp-a', { tools: { allow: ['web_search'], deny: [] } })).tools).toEqual({ allow: ['web_search', 'bundle-mcp'] });
    expect(agentEntry(agent('kacp-a', { tools: { allow: ['group:plugins'], deny: [] } })).tools).toEqual({ allow: ['group:plugins'] });
    expect(agentEntry(agent('kacp-a', { tools: { allow: [], deny: ['group:runtime'] } })).tools).toEqual({ deny: ['group:runtime'] });
  });
});
