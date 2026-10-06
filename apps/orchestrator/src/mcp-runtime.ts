import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  config, EGRESS_NETWORK, EGRESS_PORT, MCP_PORT, mcpContainer, mcpNetwork, mcpProxyContainer, mcpSecretsDir, teamContainer,
} from './config.js';
import { docker, DockerError } from './docker.js';
import { notifyMcpInstall } from './events.js';

// Market MCP servers per team (docs/README.md 6단계, 05 §6):
//   kacp-mcp-{key}--{team}       the package image, only on the team's internal network kacp-mcpnet-{team}
//   kacp-mcpproxy-{key}--{team}  egress proxy (this image, egress-proxy.js) on kacp-mcpnet-{team} + kacp-egress
// Containers live as long as the install; they start and stop with the team container.

export interface McpInstallSpec {
  pkg: string;
  version: string;
  image: string;
  network: string[];
  resources: { cpu: number; memoryMb: number };
}

/** Container spec shared by the build test and team installs, so a package is tested as it runs. */
export function mcpContainerSpec(o: {
  image: string; network: string; env: string[]; resources: { cpu: number; memoryMb: number }; labels: Record<string, string>;
}) {
  return {
    Image: o.image,
    Env: [`PORT=${MCP_PORT}`, ...o.env],
    Labels: o.labels,
    Healthcheck: {
      // -Y off: busybox wget ignores no_proxy and would ask the egress proxy (which refuses 127.0.0.1).
      Test: ['CMD', 'wget', '-q', '-Y', 'off', '-O', '/dev/null', `http://127.0.0.1:${MCP_PORT}/healthz`],
      Interval: 10e9, Timeout: 3e9, Retries: 3, StartPeriod: 30e9,
    },
    HostConfig: {
      Memory: o.resources.memoryMb * 1024 * 1024,
      MemorySwap: o.resources.memoryMb * 1024 * 1024,
      NanoCpus: Math.round(o.resources.cpu * 1e9),
      PidsLimit: 128,
      Init: true,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      ReadonlyRootfs: true,
      Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=64m' },
      RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 3 },
      NetworkMode: o.network,
    },
  };
}

const proxyEnv = (key: string, team: string) => {
  const url = `http://${mcpProxyContainer(key, team)}:${EGRESS_PORT}`;
  return [`HTTPS_PROXY=${url}`, `HTTP_PROXY=${url}`, `https_proxy=${url}`, `http_proxy=${url}`, 'NO_PROXY=localhost,127.0.0.1', 'no_proxy=localhost,127.0.0.1'];
};

// ── Secret Store: values never reach the api DB, logs or audit (CLAUDE.md) ──

const secretsFile = (team: string, key: string) => `${mcpSecretsDir(team, key)}/secrets.json`;

async function writeSecrets(team: string, key: string, secrets: Record<string, string>) {
  const dir = mcpSecretsDir(team, key);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  await writeFile(secretsFile(team, key), JSON.stringify(secrets), { mode: 0o600 });
  await chmod(secretsFile(team, key), 0o600);
}

async function readSecrets(team: string, key: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(secretsFile(team, key), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

// ── containers ──

const queues = new Map<string, Promise<unknown>>();
function serial<T>(k: string, op: () => Promise<T>): Promise<T> {
  const next = (queues.get(k) ?? Promise.resolve()).catch(() => undefined).then(op);
  queues.set(k, next);
  return next;
}

const describe = (err: unknown) =>
  err instanceof DockerError ? `Docker 오류 (${err.status})` : err instanceof Error ? err.message : String(err);

async function teamRunning(team: string) {
  return (await docker.inspect(teamContainer(team)))?.State.Status === 'running';
}

/** The team container joins its MCP network (on create and on every start: cheap and idempotent). */
export async function attachTeamNetwork(team: string) {
  await docker.networkEnsure(mcpNetwork(team), true, 'mcp-network');
  await docker.networkConnect(mcpNetwork(team), teamContainer(team));
}

async function createContainers(team: string, key: string, s: McpInstallSpec) {
  const secrets = await readSecrets(team, key);
  const hash = createHash('sha256').update(JSON.stringify([s, Object.entries(secrets).sort()])).digest('hex').slice(0, 16);
  const labels = { 'kacp.team': team, 'kacp.mcp.key': key, 'kacp.mcp.pkg': s.pkg, 'kacp.mcp.version': s.version, 'kacp.config-hash': hash };

  const existing = await docker.inspect(mcpContainer(key, team));
  if (existing?.Config.Labels['kacp.config-hash'] === hash) return;
  await docker.remove(mcpContainer(key, team));
  await docker.remove(mcpProxyContainer(key, team));

  await docker.networkEnsure(mcpNetwork(team), true, 'mcp-network');
  await docker.networkEnsure(EGRESS_NETWORK, false, 'egress-network');
  await docker.create(mcpProxyContainer(key, team), {
    Image: config.gwagentImage,
    Cmd: ['node', 'dist/egress-proxy.js'],
    User: 'node',
    Env: [`EGRESS_ALLOW=${s.network.join(',')}`, `EGRESS_PORT=${EGRESS_PORT}`, `EGRESS_LABEL=${key}--${team}`],
    Labels: { ...labels, 'kacp.kind': 'mcp-proxy' },
    HostConfig: {
      Memory: 64 * 1024 * 1024, MemorySwap: 64 * 1024 * 1024, NanoCpus: 0.25e9, PidsLimit: 64, Init: true,
      CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], ReadonlyRootfs: true,
      RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
      NetworkMode: EGRESS_NETWORK,
    },
  });
  await docker.networkConnect(mcpNetwork(team), mcpProxyContainer(key, team));
  await docker.create(mcpContainer(key, team), mcpContainerSpec({
    image: s.image,
    network: mcpNetwork(team),
    env: [...proxyEnv(key, team), ...Object.entries(secrets).map(([k, v]) => `${k}=${v}`)],
    resources: s.resources,
    labels: { ...labels, 'kacp.kind': 'mcp' },
  }));
}

async function startPair(team: string, key: string) {
  await docker.start(mcpProxyContainer(key, team));
  await docker.start(mcpContainer(key, team));
}

/** Install or update (new version / new secrets): recreate, then start if the team is running. */
export function installMcp(team: string, key: string, s: McpInstallSpec, secrets: Record<string, string> | null) {
  return serial(`${team}:${key}`, async () => {
    try {
      if (secrets) await writeSecrets(team, key, secrets);
      await createContainers(team, key, s);
      if (await teamRunning(team)) {
        await attachTeamNetwork(team);
        await startPair(team, key);
      }
      await notifyMcpInstall(team, key, 'installed');
    } catch (err) {
      await notifyMcpInstall(team, key, 'error', describe(err));
    }
  });
}

/** New secret values: merge (blank keeps the old value) and recreate the server container. */
export function updateMcpSecrets(team: string, key: string, s: McpInstallSpec, secrets: Record<string, string>) {
  return serial(`${team}:${key}`, async () => {
    try {
      const merged = { ...(await readSecrets(team, key)) };
      for (const [k, v] of Object.entries(secrets)) if (v !== '') merged[k] = v;
      await writeSecrets(team, key, merged);
      await createContainers(team, key, s);
      if (await teamRunning(team)) await startPair(team, key);
      await notifyMcpInstall(team, key, 'installed');
    } catch (err) {
      await notifyMcpInstall(team, key, 'error', describe(err));
    }
  });
}

export function removeMcp(team: string, key: string) {
  return serial(`${team}:${key}`, async () => {
    try {
      await docker.remove(mcpContainer(key, team));
      await docker.remove(mcpProxyContainer(key, team));
      await rm(mcpSecretsDir(team, key), { recursive: true, force: true });
      await notifyMcpInstall(team, key, 'removed');
    } catch (err) {
      await notifyMcpInstall(team, key, 'error', describe(err));
    }
  });
}

const namesOf = async (team: string) =>
  (await docker.listByLabel([`kacp.team=${team}`, 'kacp.mcp.key'])).map((c) => ({
    name: c.Names[0]!.replace(/^\//, ''), kind: c.Labels['kacp.kind'], state: c.State,
  }));

/** With the team container: proxies first, then servers. Failures are reported per install, not fatal. */
export async function startTeamMcp(team: string, log: (m: string) => void) {
  const list = await namesOf(team);
  if (!list.length) return;
  await attachTeamNetwork(team);
  for (const kind of ['mcp-proxy', 'mcp']) {
    for (const c of list.filter((x) => x.kind === kind && x.state !== 'running')) {
      await docker.start(c.name).catch((err) => log(`mcp start ${c.name}: ${describe(err)}`));
    }
  }
}

export async function stopTeamMcp(team: string) {
  for (const c of await namesOf(team)) if (c.state === 'running') await docker.stop(c.name, 5);
}

/** Team delete: containers and network go; secrets stay with the team data (moved to backups on the VM). */
export async function removeTeamMcp(team: string) {
  for (const c of await namesOf(team)) await docker.remove(c.name);
  await docker.networkRemove(mcpNetwork(team));
}
