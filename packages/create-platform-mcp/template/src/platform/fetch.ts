// 플랫폼 고정 영역 — 수정하지 마세요.
//
// On KACP the MCP container has no direct internet access. The platform runs an egress proxy and
// sets HTTPS_PROXY / HTTP_PROXY / NO_PROXY; EnvHttpProxyAgent makes fetch follow those variables.
// The proxy only allows the domains listed under `network` in platform-plugin.yaml. Any other
// domain is refused with 403 and fetch throws. Locally, without those variables, fetch goes direct.
import { EnvHttpProxyAgent, setGlobalDispatcher, fetch as undiciFetch } from 'undici';

setGlobalDispatcher(new EnvHttpProxyAgent());

/** Proxy-aware fetch. Global `fetch` also follows the proxy once this module is loaded. */
export const platformFetch = undiciFetch;

/**
 * True when a fetch error is the egress proxy refusing an https domain. undici nests it as
 * TypeError → DOMException → "Proxy response (403) !== 200 when HTTP Tunneling".
 * (Plain http:// requests get the proxy's 403 as a normal response instead.)
 */
export function isBlockedByProxy(err: unknown): boolean {
  for (let e = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    if (/Proxy response \(403\)/.test(e.message)) return true;
  }
  return false;
}
