import { config, sandboxEnabled, SANDBOX_LISTENER_PORT, sandboxOrigin, TEAM_DRIVE_PATH, teamSharedDir } from './config.js';
import { SANDBOX_PRUNE } from './apply-config.js';

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
    tools: {
      sessions: { visibility: 'tree' },
      // Without this, MCP tools vanish from sandboxed turns (spike 06).
      ...(sandboxEnabled() ? { sandbox: { tools: { alsoAllow: ['bundle-mcp'] } } } : {}),
    },
    plugins: { entries: { 'admin-http-rpc': { enabled: true } } },
    // HTML previews / Canvas render on the separate sandbox listener (MCP Apps stay disabled).
    mcp: { apps: { sandboxOrigin: sandboxOrigin(team), sandboxPort: SANDBOX_LISTENER_PORT } },
    ...(sandboxEnabled() ? { agents: { defaults: { sandbox: sandboxConfig(team) } } } : {}),
  };
}

/** 05-urls-and-storage.md §5 sandbox values + the shared drive bind (host path as-is, docs/README.md 4단계). */
export function sandboxConfig(team: string) {
  return {
    mode: 'all',
    backend: 'docker',
    scope: 'session',
    workspaceAccess: 'rw',
    prune: SANDBOX_PRUNE,
    docker: {
      image: config.sandboxImage,
      containerPrefix: `kacp-sbx-${team}-`,
      network: 'none',
      user: '1000:1000',
      readOnlyRoot: true,
      capDrop: ['ALL'],
      pidsLimit: 256,
      memory: '1g',
      cpus: 1,
      binds: [`${teamSharedDir(team)}:${TEAM_DRIVE_PATH}:rw`],
      dangerouslyAllowExternalBindSources: true,
    },
  };
}
