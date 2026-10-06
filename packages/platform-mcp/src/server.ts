import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { tools } from './tools/index.js';

// platform-mcp (docs/README.md 5단계): one shared service for all teams. Team Gateways call it with
// `Authorization: Bearer {team MCP token}`; the token goes straight to the api, which decides.
// Stateless streamable HTTP: a fresh server + transport per request.

const PORT = Number(process.env.PORT ?? 5000);

function buildServer(token: string) {
  const server = new McpServer({ name: 'kacp-platform', version: '1.0.0' });
  for (const t of tools) {
    server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.input }, async (args: Record<string, unknown>) => {
      try {
        const result = await t.run(token, args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }] };
      }
    });
  }
  return server;
}

const http = createServer(async (req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    return;
  }
  if (!req.url?.startsWith('/mcp')) {
    res.writeHead(404).end();
    return;
  }
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ') || auth.length < 30) {
    res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"unauthorized"}');
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let body: unknown;
  try {
    body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
  } catch {
    res.writeHead(400).end();
    return;
  }
  const server = buildServer(auth.slice(7));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    if (!res.headersSent) res.writeHead(500).end(String(err));
  }
});

http.listen(PORT, '0.0.0.0', () => console.log(`platform-mcp listening on ${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => http.close(() => process.exit(0)));
