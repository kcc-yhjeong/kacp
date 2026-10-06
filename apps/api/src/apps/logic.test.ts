import { describe, expect, it } from 'vitest';
import {
  canWake, detectRuntime, diffTrees, mcpToken, publicFilter, slugFrom, uniqueSlug, verifyMcpToken, workFilter,
} from './logic.js';

describe('detectRuntime', () => {
  it('detects node with start script or entry file', () => {
    expect(detectRuntime(['package.json'], { scripts: { start: 'node s.js' } })).toEqual({ runtime: 'node', command: 'npm start' });
    expect(detectRuntime(['package.json', 'server.js'], {})).toEqual({ runtime: 'node', command: 'node server.js' });
    expect(detectRuntime(['package.json'], {})).toBeNull();
    expect(detectRuntime(['server.js'], null)).toEqual({ runtime: 'node', command: 'node server.js' });
  });
  it('detects python and static', () => {
    expect(detectRuntime(['requirements.txt', 'app.py'], null)).toEqual({ runtime: 'python', command: 'python app.py' });
    expect(detectRuntime(['index.html', 'style.css'], null)?.runtime).toBe('static');
    expect(detectRuntime(['notes.md'], null)).toBeNull();
  });
  it('honours requested runtime and command', () => {
    expect(detectRuntime(['x.js'], null, { runtime: 'node', command: 'node x.js' })).toEqual({ runtime: 'node', command: 'node x.js' });
  });
});

describe('slugs', () => {
  it('turns folder names into host-safe slugs', () => {
    expect(slugFrom('Lunch Vote')).toBe('lunch-vote');
    expect(slugFrom('budget__calc--v2')).toBe('budget-calc-v2');
    expect(slugFrom('점심')).toBeNull();
    expect(slugFrom('ab')).toBeNull();
  });
  it('picks a free slug', () => {
    expect(uniqueSlug('calc', new Set(['calc', 'calc-2']))).toBe('calc-3');
    expect(uniqueSlug('calc', new Set())).toBe('calc');
  });
});

describe('diffTrees', () => {
  it('lists added, modified and removed files', () => {
    const cur = new Map([['a.js', '1'], ['b.js', '1'], ['c.js', '1']]);
    const next = new Map([['a.js', '1'], ['b.js', '2'], ['d.js', '1']]);
    expect(diffTrees(cur, next)).toEqual({ added: ['d.js'], modified: ['b.js'], removed: ['c.js'] });
  });
});

describe('filters', () => {
  it('derives work and public filter values', () => {
    expect(workFilter('stopped', 'idle')).toBe('sleeping');
    expect(workFilter('stopped', 'limit')).toBe('sleeping');
    expect(workFilter('stopped', 'manual')).toBe('stopped');
    expect(workFilter('starting', null)).toBe('running');
    expect(publicFilter(null, null)).toBe('none');
    expect(publicFilter(null, 'publish')).toBe('publish_pending');
    expect(publicFilter(2, 'update')).toBe('update_pending');
    expect(publicFilter(2, null)).toBe('live');
  });
  it('wakes only idle/limit copies', () => {
    expect(canWake('stopped', 'idle')).toBe(true);
    expect(canWake('stopped', 'admin')).toBe(false);
    expect(canWake('stopped', 'manual')).toBe(false);
    expect(canWake('running', null)).toBe(false);
  });
});

describe('mcp token', () => {
  it('round-trips and rejects tampering', () => {
    const t = mcpToken('secret', 'team1');
    expect(verifyMcpToken('secret', t)).toBe('team1');
    expect(verifyMcpToken('secret', t.replace('team1', 'team2'))).toBeNull();
    expect(verifyMcpToken('other', t)).toBeNull();
    expect(verifyMcpToken('secret', 'garbage')).toBeNull();
  });
});
