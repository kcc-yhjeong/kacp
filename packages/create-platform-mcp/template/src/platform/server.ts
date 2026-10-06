// 플랫폼 고정 영역 — 수정하지 마세요.
//
// Stateless streamable HTTP MCP server: POST /mcp (fresh server + transport per request) and
// GET /healthz. The platform starts it with PORT=8080 and calls http://<container>:8080/mcp.
import './fetch.js';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { tools } from '../tools/index.js';
import type { ToolDef } from './tool.js';

const PORT = Number(process.env.PORT ?? 8080);
// Same path from src/platform (tsx) and dist/platform (node).
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { name: string; version: string };

function buildServer() {
  const server = new McpServer({ name: pkg.name, version: pkg.version });
  for (const t of tools as ToolDef[]) {
    server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.input }, async (args: Record<string, unknown>) => {
      try {
        const result = await t.run(args);
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${t.name}] ${message}`);
        return { isError: true, content: [{ type: 'text' as const, text: message }] };
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
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let body: unknown;
  try {
    body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
  } catch {
    res.writeHead(400).end();
    return;
  }
  const server = buildServer();
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

http.listen(PORT, '0.0.0.0', () => console.log(`MCP server: http://localhost:${PORT}/mcp (tools: ${tools.length})`));
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => http.close(() => process.exit(0)));
