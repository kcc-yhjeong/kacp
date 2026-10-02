import { config } from './config.js';

// openclaw.json seed (06-auth.md §6, spikes 01–04). Written once, before the first start, only if
// the file is absent; later changes go through config.patch (stage 3 apply-config).

export function seedConfig(team: string, adminEmails: string[]) {
  return {
    gateway: {
      mode: 'local',
      bind: 'lan',
      trustedProxies: [config.traefikIp],
      controlUi: {
        basePath: '/claw',
        allowedOrigins: [`${config.scheme}://${team}.${config.baseDomain}`],
      },
      auth: {
        mode: 'trusted-proxy',
        // Platform-internal admin RPC only (loopback via the stage 3 gwagent sidecar). Never a Gateway token.
        password: { source: 'env', provider: 'default', id: 'OPENCLAW_GATEWAY_PASSWORD' },
        // Team admins get operator.admin per connection; deviceAutoApprove keeps the member default.
        identityScopes: Object.fromEntries(adminEmails.map((e) => [e, ['operator.admin']])),
        trustedProxy: {
          userHeader: 'x-forwarded-user',
          allowLoopback: false,
          deviceAutoApprove: { enabled: true },
        },
      },
      // One role: shared sessions = team chat (read/write), drafts = private chats hidden from others.
      roles: {
        default: 'member',
        definitions: {
          member: { sessions: { others: 'write' }, agents: '*', scopes: ['operator.admin'] },
        },
      },
    },
    tools: { sessions: { visibility: 'tree' } },
    plugins: { entries: { 'admin-http-rpc': { enabled: true } } },
  };
}
