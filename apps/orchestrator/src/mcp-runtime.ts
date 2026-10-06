import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { mcpSecretHeader } from '@kacp/shared';
import {
  config, EGRESS_NETWORK, EGRESS_PORT, MCP_NETWORK, MCP_PORT, mcpContainer, mcpProxyContainer, mcpSecretsDir, teamContainer,
} from './config.js';
import { docker, DockerError } from './docker.js';
import { notifyMcpInstall } from './events.js';

// Market MCP servers (docs/README.md 6단계, 05 §6): ONE container per package for every team.
//   kacp-mcp-{pkg}       the package image, only on the internal network kacp-mcp
//   kacp-mcpproxy-{pkg}  egress proxy (this image, egress-proxy.js) on kacp-mcp + kacp-egress
// Team containers join kacp-mcp. A team's secrets stay in its Secret Store
// (/data/teams/{team}/mcp/{pkg}/secrets.json); apply-config puts them into that team's Gateway entry
// as X-KACP-Secret-* headers, so they reach the server per call (the template reads them per request).
// The server runs while at least one team has it installed (the api removes it after the last one).

export interface McpPackageSpec {
  pkg: string;
  version: string;
  image: string;
  network: string[];
  resources: { cpu: number; memoryMb: number };
}

/** Container spec shared by the build test and the package server, so a package is tested as it runs. */
export function mcpContainerSpec(o: {
  image: string; network: string; env: string[]; resources: { cpu: number; memoryMb: number }; labels: Record<string, string>;
  restart?: 'no' | 'unless-stopped';
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
      RestartPolicy: o.restart === 'unless-stopped' ? { Name: 'unless-stopped' } : { Name: 'no' },
      NetworkMode: o.network,
    },
  };
}

const proxyEnv = (pkg: string) => {
  const url = `http://${mcpProxyContainer(pkg)}:${EGRESS_PORT}`;
  return [`HTTPS_PROXY=${url}`, `HTTP_PROXY=${url}`, `https_proxy=${url}`, `http_proxy=${url}`, 'NO_PROXY=localhost,127.0.0.1', 'no_proxy=localhost,127.0.0.1'];
};

// ── Secret Store: values never reach the api DB, logs or audit (CLAUDE.md) ──

const secretsFile = (team: string, pkg: string) => `${mcpSecretsDir(team, pkg)}/secrets.json`;

async function writeSecrets(team: string, pkg: string, secrets: Record<string, string>) {
  const dir = mcpSecretsDir(team, pkg);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  await writeFile(secretsFile(team, pkg), JSON.stringify(secrets), { mode: 0o600 });
  await chmod(secretsFile(team, pkg), 0o600);
}

export async function readSecrets(team: string, pkg: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(secretsFile(team, pkg), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Gateway headers for one team's entry: one header per secret plus a revision marker, so apply-config
 * can tell whether the entry is current even if config.get hides header values.
 */
export function secretHeaders(secrets: Record<string, string>): Record<string, string> {
  const entries = Object.entries(secrets).filter(([, v]) => v !== '').sort(([a], [b]) => a.localeCompare(b));
  const rev = createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 12);
  return { ...Object.fromEntries(entries.map(([k, v]) => [mcpSecretHeader(k), v])), 'X-KACP-Secrets-Rev': rev };
}

// ── package servers ──

const queues = new Map<string, Promise<unknown>>();
function serial<T>(k: string, op: () => Promise<T>): Promise<T> {
  const next = (queues.get(k) ?? Promise.resolve()).catch(() => undefined).then(op);
  queues.set(k, next);
  return next;
}

const describe = (err: unknown) =>
  err instanceof DockerError ? `Docker 오류 (${err.status})` : err instanceof Error ? err.message : String(err);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The Gateway learns about a server once (apply-config or startup): wait until it answers /healthz. */
async function waitHealthy(name: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const c = await docker.inspect(name);
    if (!c || c.State.Status === 'exited' || c.State.Status === 'dead') {
      const tail = (await docker.logsTail(name, 10)).trim().split('\n').slice(-3).join(' / ');
      throw new Error(`MCP 서버가 시작 중 멈췄어요${c ? ` (exit ${c.State.ExitCode})` : ''}. ${tail}`.slice(0, 480));
    }
    if (c.State.Health?.Status === 'healthy') return;
    if (Date.now() > deadline) throw new Error(`${timeoutMs / 1000}초 안에 MCP 서버가 준비되지 않았어요(/healthz).`);
    await sleep(1000);
  }
}

/** Team containers join kacp-mcp (on every start and before every apply-config; idempotent). */
export async function attachTeamNetwork(team: string) {
  await docker.networkEnsure(MCP_NETWORK, true, 'mcp-network');
  await docker.networkConnect(MCP_NETWORK, teamContainer(team));
}

/** Removes per-team containers from the first 6단계 layout (kacp-mcp-{pkg}--{team}). */
async function removeLegacy(pkg: string) {
  for (const c of await docker.listByLabel([`kacp.mcp.pkg=${pkg}`, 'kacp.team'])) {
    await docker.remove(c.Names[0]!.replace(/^\//, ''));
  }
}

/** Creates (or replaces, when the version, allowlist or limits changed) and starts the package server. */
export function ensurePackage(s: McpPackageSpec) {
  return serial(`pkg:${s.pkg}`, async () => {
    await removeLegacy(s.pkg);
    const hash = createHash('sha256').update(JSON.stringify(s)).digest('hex').slice(0, 16);
    const labels = { 'kacp.mcp.pkg': s.pkg, 'kacp.mcp.version': s.version, 'kacp.config-hash': hash };
    const existing = await docker.inspect(mcpContainer(s.pkg));
    if (existing?.Config.Labels['kacp.config-hash'] !== hash) {
      await docker.remove(mcpContainer(s.pkg));
      await docker.remove(mcpProxyContainer(s.pkg));
      await docker.networkEnsure(MCP_NETWORK, true, 'mcp-network');
      await docker.networkEnsure(EGRESS_NETWORK, false, 'egress-network');
      await docker.create(mcpProxyContainer(s.pkg), {
        Image: config.gwagentImage,
        Cmd: ['node', 'dist/egress-proxy.js'],
        User: 'node',
        Env: [`EGRESS_ALLOW=${s.network.join(',')}`, `EGRESS_PORT=${EGRESS_PORT}`, `EGRESS_LABEL=${s.pkg}`],
        Labels: { ...labels, 'kacp.kind': 'mcp-proxy' },
        HostConfig: {
          Memory: 64 * 1024 * 1024, MemorySwap: 64 * 1024 * 1024, NanoCpus: 0.25e9, PidsLimit: 64, Init: true,
          CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], ReadonlyRootfs: true,
          RestartPolicy: { Name: 'unless-stopped' },
          NetworkMode: EGRESS_NETWORK,
        },
      });
      await docker.networkConnect(MCP_NETWORK, mcpProxyContainer(s.pkg));
      await docker.create(mcpContainer(s.pkg), mcpContainerSpec({
        image: s.image, network: MCP_NETWORK, env: proxyEnv(s.pkg), resources: s.resources,
        labels: { ...labels, 'kacp.kind': 'mcp' }, restart: 'unless-stopped',
      }));
    }
    await docker.start(mcpProxyContainer(s.pkg));
    await docker.start(mcpContainer(s.pkg));
    await waitHealthy(mcpContainer(s.pkg));
  });
}

/** After the last team removed it (the api decides). */
export function removePackage(pkg: string) {
  return serial(`pkg:${pkg}`, async () => {
    await removeLegacy(pkg);
    await docker.remove(mcpContainer(pkg));
    await docker.remove(mcpProxyContainer(pkg));
  });
}

// ── team installs: Secret Store + the package server; the Gateway entry follows via apply-config ──

/** Install or upgrade for one team. `secrets: null` keeps the Secret Store (version upgrade). */
export function installMcp(team: string, pkg: string, s: McpPackageSpec, secrets: Record<string, string> | null) {
  return serial(`${team}:${pkg}`, async () => {
    try {
      if (secrets) await writeSecrets(team, pkg, secrets);
      await ensurePackage(s);
      await notifyMcpInstall(team, pkg, 'installed');
    } catch (err) {
      await notifyMcpInstall(team, pkg, 'error', describe(err));
    }
  });
}

/** New values: merge (blank keeps the old value). The api re-applies the team config afterwards. */
export function updateMcpSecrets(team: string, pkg: string, secrets: Record<string, string>) {
  return serial(`${team}:${pkg}`, async () => {
    try {
      const merged = { ...(await readSecrets(team, pkg)) };
      for (const [k, v] of Object.entries(secrets)) if (v !== '') merged[k] = v;
      await writeSecrets(team, pkg, merged);
      await notifyMcpInstall(team, pkg, 'installed');
    } catch (err) {
      await notifyMcpInstall(team, pkg, 'error', describe(err));
    }
  });
}

export function removeMcp(team: string, pkg: string) {
  return serial(`${team}:${pkg}`, async () => {
    try {
      await rm(mcpSecretsDir(team, pkg), { recursive: true, force: true });
      await notifyMcpInstall(team, pkg, 'removed');
    } catch (err) {
      await notifyMcpInstall(team, pkg, 'error', describe(err));
    }
  });
}

/** Running package servers for the usage collector: `{name, pkg}`. */
export async function runningPackageServers() {
  return (await docker.listByLabel('kacp.kind=mcp'))
    .filter((c) => c.State === 'running' && !c.Labels['kacp.team'])
    .map((c) => ({ name: c.Names[0]!.replace(/^\//, ''), pkg: c.Labels['kacp.mcp.pkg']! }));
}
