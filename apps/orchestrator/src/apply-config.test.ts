import { describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({ STATE_DIR: '/home/node/.openclaw' }));
const { agentEntry, computePatch } = await import('./apply-config.js');

const agent = (id: string, over: Partial<Parameters<typeof agentEntry>[0]> = {}) => ({
  id, name: '보고서 도우미', emoji: '📊', model: 'anthropic/claude-sonnet-4-5', thinking: 'medium' as const,
  instructions: '주간 보고서를 써요.', skills: [], tools: { allow: [], deny: ['shell.exec'] }, ...over,
});

describe('computePatch', () => {
  it('adds agents and team admins to an empty config', () => {
    const plan = computePatch({}, { agents: [agent('kacp-a')], adminEmails: ['kim@kcc.co.kr'] });
    expect(plan?.patch).toEqual({
      agents: { entries: { 'kacp-a': {
        name: '보고서 도우미', identity: { emoji: '📊' }, workspace: '/home/node/.openclaw/workspace-kacp-a',
        model: 'anthropic/claude-sonnet-4-5', thinkingDefault: 'medium', tools: { deny: ['shell.exec'] },
      } } },
      gateway: { auth: { identityScopes: { 'kim@kcc.co.kr': ['operator.admin'] } } },
    });
    expect(plan?.replacePaths).toEqual(['agents.entries.kacp-a', 'gateway.auth.identityScopes.kim@kcc.co.kr']);
  });

  it('is a no-op when nothing changed (key order does not matter)', () => {
    const entry = agentEntry(agent('kacp-a'));
    const reordered = Object.fromEntries(Object.entries(entry).reverse());
    const current = { agents: { entries: { 'kacp-a': reordered, main: { name: 'main' } } }, gateway: { auth: { identityScopes: { 'kim@kcc.co.kr': ['operator.admin'] } } } };
    expect(computePatch(current, { agents: [agent('kacp-a')], adminEmails: ['kim@kcc.co.kr'] })).toBeNull();
  });

  it('removes unassigned managed agents and demoted admins with replacePaths, leaving others alone', () => {
    const current = {
      agents: { entries: { 'kacp-old': { name: 'x' }, main: { name: 'main' } } },
      gateway: { auth: { identityScopes: { 'lee@kcc.co.kr': ['operator.admin'] } } },
    };
    const plan = computePatch(current, { agents: [], adminEmails: [] });
    expect(plan?.patch).toEqual({
      agents: { entries: { 'kacp-old': null } },
      gateway: { auth: { identityScopes: { 'lee@kcc.co.kr': null } } },
    });
    expect(plan?.replacePaths).toEqual(['agents.entries.kacp-old', 'gateway.auth.identityScopes.lee@kcc.co.kr']);
  });

  it('replaces a changed entry whole', () => {
    const current = { agents: { entries: { 'kacp-a': agentEntry(agent('kacp-a')) } } };
    const plan = computePatch(current, { agents: [agent('kacp-a', { tools: { allow: ['web.fetch'], deny: [] } })], adminEmails: [] });
    expect((plan?.patch.agents as { entries: Record<string, { tools: unknown }> }).entries['kacp-a']!.tools).toEqual({ allow: ['web.fetch'] });
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
    expect(computePatch({}, empty)).toBeNull();
    const plan = computePatch({}, empty, { sandbox: true });
    expect(plan?.patch).toEqual({ agents: { defaults: { sandbox: { prune: SANDBOX_PRUNE } } } });
    expect(plan?.replacePaths).toEqual(['agents.defaults.sandbox.prune']);
    expect(computePatch({ agents: { defaults: { sandbox: { prune: { maxAgeDays: 1, idleHours: 1 } } } } }, empty, { sandbox: true })).toBeNull();
  });
});
