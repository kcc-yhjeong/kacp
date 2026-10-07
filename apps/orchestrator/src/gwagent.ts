import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

// kacp-gwagent-{team}: Gateway sidecar (06-auth.md §6, spike 04). Runs in the team container's
// network namespace so admin-http-rpc sees a loopback caller and accepts the Gateway password.
// Relays only config.get / config.patch / health, authenticated with a per-team token.

const PORT = Number(process.env.GWAGENT_PORT ?? 18800);
const TOKEN = process.env.GWAGENT_TOKEN ?? '';
const PASSWORD = process.env.OPENCLAW_GATEWAY_PASSWORD ?? '';
const GATEWAY = process.env.GATEWAY_URL ?? 'http://127.0.0.1:18789';
const ALLOWED = new Set(['config.get', 'config.patch', 'health', 'models.list', 'agents.delete']);

if (TOKEN.length < 32 || PASSWORD.length < 16) {
  console.error('gwagent: GWAGENT_TOKEN and OPENCLAW_GATEWAY_PASSWORD are required');
  process.exit(1);
}
const expected = Buffer.from(`Bearer ${TOKEN}`);

const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'GET' && req.url === '/healthz') return send(200, { ok: true });
  const got = Buffer.from(req.headers.authorization ?? '');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return send(401, { message: 'unauthorized' });
  if (req.method !== 'POST' || req.url !== '/rpc') return send(404, { message: 'not found' });

  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let body: { method?: string; params?: unknown };
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return send(400, { message: 'invalid json' });
  }
  if (!body.method || !ALLOWED.has(body.method)) return send(403, { message: `method not allowed: ${body.method}` });

  try {
    // Loopback, no X-Forwarded-*: the only path where the Gateway password is accepted (spike 04).
    const r = await fetch(`${GATEWAY}/api/v1/admin/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${PASSWORD}` },
      body: JSON.stringify({ method: body.method, params: body.params ?? {} }),
      signal: AbortSignal.timeout(30_000),
    });
    res.writeHead(r.status, { 'content-type': 'application/json' });
    res.end(await r.text());
  } catch (err) {
    send(502, { message: `gateway unreachable: ${(err as Error).message}` });
  }
});

server.listen(PORT, '0.0.0.0');
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => server.close(() => process.exit(0)));
