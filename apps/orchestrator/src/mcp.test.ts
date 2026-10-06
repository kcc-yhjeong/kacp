import { describe, expect, it } from 'vitest';

process.env.TRAEFIK_IP ??= '172.30.0.2';
process.env.BASE_DOMAIN ??= 'kacp.localhost';
process.env.INTERNAL_TOKEN ??= 'x'.repeat(32);

const { decide, isPrivateAddress } = await import('./egress-proxy.js');
const { parseRpcBody, summarizeScan } = await import('./mcp-build.js');

describe('egress proxy', () => {
  it('flags private, loopback and link-local addresses', () => {
    for (const ip of ['10.1.2.3', '127.0.0.1', '172.30.0.5', '192.168.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('refuses undeclared hosts, IP literals and other ports before resolving', async () => {
    const allow = ['api.example.com'];
    expect(await decide('evil.com', 443, allow)).toHaveProperty('deny', expect.stringContaining('network 목록에 없어요'));
    expect(await decide('1.2.3.4', 443, allow)).toHaveProperty('deny', expect.stringContaining('IP 주소'));
    expect(await decide('api.example.com', 22, allow)).toHaveProperty('deny', expect.stringContaining('포트 22'));
    // a declared name pointing at loopback is refused after resolution
    expect(await decide('localhost.localdomain', 443, ['localhost.localdomain'])).toHaveProperty('deny');
  });
});

describe('build helpers', () => {
  it('parses JSON and SSE replies', () => {
    expect(parseRpcBody('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}')).toEqual({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
    expect(parseRpcBody('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":1}}\n\n')?.result).toEqual({ ok: 1 });
    expect(parseRpcBody('nope')).toBeNull();
  });

  it('counts trivy findings once and sorts the most severe first', () => {
    const v = (id: string, Severity: string) => ({ VulnerabilityID: id, PkgName: 'lodash', InstalledVersion: '4.17.0', Severity, Title: 't' });
    const { summary, findings } = summarizeScan({ Results: [
      { Vulnerabilities: [v('CVE-1', 'LOW'), v('CVE-2', 'CRITICAL')] },
      { Vulnerabilities: [v('CVE-2', 'CRITICAL'), v('CVE-3', 'HIGH')] },
    ] });
    expect(summary).toEqual({ critical: 1, high: 1, medium: 0, low: 1 });
    expect(findings.map((f) => f.id)).toEqual(['CVE-2', 'CVE-3', 'CVE-1']);
    expect(findings[0]!.pkg).toBe('lodash@4.17.0');
  });
});
