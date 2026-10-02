// spike 05: 의존성 없는 echo MCP 서버 (streamable-http, JSON 응답). 들어온 헤더·_meta 를 모두 기록한다.
import http from 'node:http';
const log = (...a) => console.log(new Date().toISOString(), ...a);
const TOOLS = [{
  name: 'kacp_whoami',
  description: 'KACP 신원 확인용 도구. 호출하면 MCP 서버가 받은 요청 정보를 돌려준다. 사용자가 "whoami" 또는 "신원 확인"을 요청하면 호출하라.',
  inputSchema: { type: 'object', properties: { note: { type: 'string', description: '자유 메모' } } },
}];
http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    const hdr = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['content-length', 'accept-encoding', 'connection'].includes(k)));
    if (req.method !== 'POST') { log(req.method, req.url, JSON.stringify(hdr)); res.writeHead(405); return res.end(); }
    let msg; try { msg = JSON.parse(body); } catch { res.writeHead(400); return res.end(); }
    const msgs = Array.isArray(msg) ? msg : [msg];
    const out = [];
    for (const m of msgs) {
      log('RPC', m.method, 'id=' + m.id, 'headers=' + JSON.stringify(hdr), m.params?._meta ? '_meta=' + JSON.stringify(m.params._meta) : '');
      if (m.id === undefined) continue; // notification
      let result;
      if (m.method === 'initialize') result = { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'kacp-echo', version: '0.0.1' } };
      else if (m.method === 'tools/list') result = { tools: TOOLS };
      else if (m.method === 'tools/call') {
        log('CALL', JSON.stringify({ name: m.params?.name, arguments: m.params?.arguments, _meta: m.params?._meta, headers: hdr }));
        result = { content: [{ type: 'text', text: JSON.stringify({ receivedHeaders: hdr, receivedMeta: m.params?._meta ?? null, arguments: m.params?.arguments ?? {} }, null, 2) }] };
      } else if (m.method === 'ping') result = {};
      else { out.push({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not found' } }); continue; }
      out.push({ jsonrpc: '2.0', id: m.id, result });
    }
    if (!out.length) { res.writeHead(202); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': req.headers['mcp-session-id'] || 'kacp-echo-session' });
    res.end(JSON.stringify(Array.isArray(msg) ? out : out[0]));
  });
}).listen(7000, () => log('kacp-echo MCP listening :7000/mcp'));
