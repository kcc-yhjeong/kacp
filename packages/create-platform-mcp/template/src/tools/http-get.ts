import { z } from 'zod';
import { isBlockedByProxy, platformFetch } from '../platform/fetch.js';
import { defineTool } from '../platform/tool.js';

// Shows the network allowlist: only domains under `network` in platform-plugin.yaml are reachable
// on KACP. Any other URL is refused by the platform's egress proxy.
export default defineTool({
  name: 'http_get',
  title: '웹 주소 읽기',
  description: '허용된 도메인(platform-plugin.yaml network)의 웹 주소를 GET으로 읽어 앞부분을 돌려줘요.',
  input: { url: z.url().describe('읽을 https 주소') },
  run: async ({ url }) => {
    try {
      const res = await platformFetch(url, { signal: AbortSignal.timeout(10_000) });
      const text = await res.text();
      return { status: res.status, body: text.slice(0, 2000) };
    } catch (err) {
      if (isBlockedByProxy(err)) {
        throw new Error(`${new URL(url).hostname}는 이 MCP가 접속할 수 없는 도메인이에요. platform-plugin.yaml의 network에 있는 도메인만 열려요.`);
      }
      throw new Error(`읽지 못했어요: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});
