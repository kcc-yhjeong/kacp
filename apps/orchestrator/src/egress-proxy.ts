import http from 'node:http';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { hostAllowed } from '@kacp/shared';

// Egress proxy for one market MCP install (docs/README.md 6단계 ⚠️ 해소). Runs from the orchestrator
// image as `node dist/egress-proxy.js`, on kacp-mcpnet-{team} + kacp-egress. The MCP container has no
// other way out (internal network); it finds this proxy through HTTPS_PROXY / HTTP_PROXY.
//   CONNECT host:443  → tunnel if `host` matches the manifest `network` list
//   GET http://host/… → forwarded under the same rule
// Destinations that resolve to private, loopback or link-local addresses are refused, so a declared
// domain cannot be pointed at platform services.

const allow = (process.env.EGRESS_ALLOW ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const port = Number(process.env.EGRESS_PORT ?? 3128);
const label = process.env.EGRESS_LABEL ?? '';
const PORTS = new Set([80, 443]);

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9')
    || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

/** Returns an address to connect to, or a Korean reason for refusing. */
export async function decide(host: string, p: number, allowList = allow): Promise<{ ip: string } | { deny: string }> {
  if (!PORTS.has(p)) return { deny: `포트 ${p}는 쓸 수 없어요(80·443만).` };
  if (net.isIP(host)) return { deny: 'IP 주소로는 접속할 수 없어요. 도메인을 platform-plugin.yaml network에 적으세요.' };
  if (!hostAllowed(host, allowList)) return { deny: `${host}는 이 MCP의 network 목록에 없어요(platform-plugin.yaml).` };
  try {
    const { address } = await lookup(host);
    if (isPrivateAddress(address)) return { deny: `${host}가 내부 주소(${address})를 가리켜 막았어요.` };
    return { ip: address };
  } catch {
    return { deny: `${host} 주소를 찾지 못했어요.` };
  }
}

const log = (verdict: 'allow' | 'deny', what: string, why = '') =>
  console.log(`${new Date().toISOString()} ${label} ${verdict} ${what}${why ? ` — ${why}` : ''}`);

function splitHostPort(target: string, fallback: number): [string, number] {
  const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(target);
  return [m?.[1]?.toLowerCase() ?? '', m?.[2] ? Number(m[2]) : fallback];
}

function start() {
  const server = http.createServer(async (req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '');
    } catch {
      res.writeHead(400).end('absolute URL required');
      return;
    }
    if (url.protocol !== 'http:') {
      res.writeHead(400).end('use CONNECT for https');
      return;
    }
    const host = url.hostname.toLowerCase();
    const p = Number(url.port || 80);
    const d = await decide(host, p);
    if ('deny' in d) {
      log('deny', `${req.method} ${host}:${p}`, d.deny);
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end(`KACP egress: ${d.deny}`);
      return;
    }
    log('allow', `${req.method} ${host}:${p}`);
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    const up = http.request({ host: d.ip, port: p, method: req.method, path: `${url.pathname}${url.search}`, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on('error', () => res.headersSent ? res.destroy() : res.writeHead(502).end());
    req.pipe(up);
  });

  server.on('connect', async (req, client: net.Socket, head: Buffer) => {
    client.on('error', () => undefined);
    const [host, p] = splitHostPort(req.url ?? '', 443);
    const d = await decide(host, p);
    if ('deny' in d) {
      log('deny', `CONNECT ${host}:${p}`, d.deny);
      const body = Buffer.from(`KACP egress: ${d.deny}`);
      client.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: ${body.length}\r\n\r\n${body}`);
      return;
    }
    log('allow', `CONNECT ${host}:${p}`);
    const up = net.connect(p, d.ip, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) up.write(head);
      up.pipe(client);
      client.pipe(up);
    });
    up.on('error', () => client.destroy());
    up.setTimeout(10 * 60_000, () => up.destroy());
  });

  server.listen(port, '0.0.0.0', () => console.log(`egress proxy ${label} on :${port}, allow [${allow.join(', ')}]`));
}

if (process.argv[1]?.endsWith('egress-proxy.js')) start();
