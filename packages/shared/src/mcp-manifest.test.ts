import { describe, expect, it } from 'vitest';
import { hostAllowed, manifestProblems } from './mcp-manifest.js';

const base = { name: 'notion-sync', version: '1.2.0', displayName: 'Notion 동기화', summary: '노션 페이지를 읽어요' };

describe('manifestProblems', () => {
  it('accepts a minimal manifest and fills defaults', () => {
    const { manifest, problems } = manifestProblems(base);
    expect(problems).toEqual([]);
    expect(manifest?.resources).toEqual({ cpu: 0.25, memoryMb: 256 });
    expect(manifest?.category).toBe('기타');
  });

  it('rejects user-scoped secrets, bad names and bad domains', () => {
    const { problems } = manifestProblems({
      ...base,
      name: 'Notion_Sync',
      version: 'v1',
      secrets: [{ name: 'NOTION_TOKEN', scope: 'user' }],
      network: ['https://api.notion.com'],
    });
    expect(problems.some((p) => p.startsWith('name'))).toBe(true);
    expect(problems.some((p) => p.startsWith('version'))).toBe(true);
    expect(problems.some((p) => p.includes('secrets.0.scope'))).toBe(true);
    expect(problems.some((p) => p.startsWith('network.0'))).toBe(true);
  });

  it('rejects unknown keys and duplicate secrets', () => {
    expect(manifestProblems({ ...base, dockerfile: 'x' }).problems.length).toBeGreaterThan(0);
    expect(manifestProblems({ ...base, secrets: [{ name: 'A' }, { name: 'A' }] }).problems[0]).toContain('겹쳐요');
  });
});

describe('hostAllowed', () => {
  it('matches exact hosts and wildcard subdomains only', () => {
    const allow = ['api.notion.com', '*.example.com'];
    expect(hostAllowed('api.notion.com', allow)).toBe(true);
    expect(hostAllowed('API.NOTION.COM.', allow)).toBe(true);
    expect(hostAllowed('evil-api.notion.com', allow)).toBe(false);
    expect(hostAllowed('a.example.com', allow)).toBe(true);
    expect(hostAllowed('example.com', allow)).toBe(false);
    expect(hostAllowed('example.com.evil.io', allow)).toBe(false);
    expect(hostAllowed('anything', [])).toBe(false);
  });
});
