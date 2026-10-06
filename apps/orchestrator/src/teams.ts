import { chmod, chown, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import {
  config, GATEWAY_PORT, GWAGENT_PORT, SANDBOX_LISTENER_PORT, sandboxHost, sandboxOrigin, gwagentContainer, MAIN_WORKSPACE_DRIVE, OPENCLAW_UID, sandboxEnabled, sbxNetwork,
  sbxProxyContainer, STATE_DIR, TEAM_DRIVE_PATH, teamContainer, teamSharedDir, teamSharedRel, teamStateHostDir, teamStateVolume,
} from './config.js';
import { docker, DockerError } from './docker.js';
import { notifyProvision, notifyTeamStatus } from './events.js';
import { seedConfig } from './openclaw-config.js';
import { agentsMd, computePatch, withPlatformBlock, workspaceFor, type DesiredConfig } from './apply-config.js';
import { tar, tarFile } from './tar.js';
import { attachTeamNetwork, readSecrets, secretHeaders } from './mcp-runtime.js';

// Team container lifecycle (04-api.md §3: provision / ensure-running / stop / restart / apply-config /
// resources / delete, spike 06) plus the Gateway sidecar kacp-gwagent-{team} (spike 04).

export interface TeamRuntimeSpec {
  gatewayPassword: string;
  adminEmails: string[];
  resourceLimits: { cpu: number; memoryMb: number; diskGb: number };
  /** Extra env (model provider keys from A-10). */
  env: Record<string, string>;
  /** Group of the shared drive (teams.linux_gid). */
  linuxGid: number;
}

const START_TIMEOUT_MS = 120_000;
/** A force-removed Gateway leaves an owner lease for ~5 min; retry instead of failing (spike 06). */
const LEASE_RETRY_MS = 6 * 60_000;
const LEASE_PATTERN = /owner lease is still active/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Operations on one team run one at a time.
const queues = new Map<string, Promise<unknown>>();
function serial<T>(team: string, op: () => Promise<T>): Promise<T> {
  const prev = queues.get(team) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(op);
  queues.set(team, next);
  return next;
}

/** Per-team sidecar token: derived, never stored, useless for other teams (06-auth.md §6). */
const gwagentToken = (team: string) => createHmac('sha256', config.internalToken).update(`gwagent:${team}`).digest('hex');

function teamEnv(spec: TeamRuntimeSpec): string[] {
  const passthrough = config.teamEnvPassthrough.filter((k) => process.env[k] && !(k in spec.env))
    .map((k) => `${k}=${process.env[k]}`);
  return [
    `OPENCLAW_GATEWAY_PASSWORD=${spec.gatewayPassword}`,
    ...Object.entries(spec.env).map(([k, v]) => `${k}=${v}`),
    ...passthrough,
  ];
}

/** Bumped when the mount layout changes, so stopped containers are recreated with it. */
const LAYOUT_VERSION = 'sbx-v2';

function sandboxEnv(team: string): string[] {
  // TMPDIR inside the bind-mounted state dir: OpenClaw creates temp workspaces (e.g. Model Setup's
  // inference check) under os.tmpdir(), and sandbox mounts must come from a Gateway bind mount.
  return sandboxEnabled() ? [`DOCKER_HOST=tcp://${sbxProxyContainer(team)}:2375`, `TMPDIR=${STATE_DIR}/tmp`] : [];
}

/** Changes that need a new container (env, image). Limits are applied in place with docker update. */
const configHash = (team: string, spec: TeamRuntimeSpec) =>
  createHash('sha256')
    .update(JSON.stringify([config.openclawImage, LAYOUT_VERSION, sandboxEnabled(), teamEnv(spec).sort(), sandboxEnv(team)]))
    .digest('hex').slice(0, 16);

/** The shared drive is mounted twice: /team-drive for every agent, workspace/team-drive for `main`. */
function driveMounts(team: string) {
  const source = config.stateMode === 'bind'
    ? { Type: 'bind', Source: teamSharedDir(team) }
    : { Type: 'volume', Source: config.dataVolume, VolumeOptions: { Subpath: teamSharedRel(team) } };
  return [TEAM_DRIVE_PATH, MAIN_WORKSPACE_DRIVE].map((Target) => ({ ...source, Target }));
}

const memory = (limits: TeamRuntimeSpec['resourceLimits']) => limits.memoryMb * 1024 * 1024;

function containerSpec(team: string, spec: TeamRuntimeSpec) {
  const router = `team-claw-${team}`;
  const sbxRouter = `team-sbx-${team}`;
  const stateMount = config.stateMode === 'bind'
    ? { Type: 'bind', Source: teamStateHostDir(team), Target: STATE_DIR }
    : { Type: 'volume', Source: teamStateVolume(team), Target: STATE_DIR };
  return {
    Image: config.openclawImage,
    Env: [...teamEnv(spec), ...sandboxEnv(team)],
    Labels: {
      'kacp.kind': 'team',
      'kacp.team': team,
      'kacp.id': randomUUID(),
      'kacp.config-hash': configHash(team, spec),
      // Dynamic route (apps/proxy/LABELS.md). No tls labels: the wildcard cert lives on the entrypoint (spike 07).
      'traefik.enable': 'true',
      'traefik.docker.network': config.edgeNetwork,
      [`traefik.http.routers.${router}.rule`]: `Host(\`${team}.${config.baseDomain}\`) && PathPrefix(\`/claw\`)`,
      [`traefik.http.routers.${router}.priority`]: '70',
      [`traefik.http.routers.${router}.entrypoints`]: 'websecure',
      [`traefik.http.routers.${router}.middlewares`]: 'secure-headers@file,strip-identity@file,kacp-auth@file,claw-frame@file',
      [`traefik.http.routers.${router}.service`]: router,
      [`traefik.http.services.${router}.loadbalancer.server.port`]: String(GATEWAY_PORT),
      // Sandbox origin (HTML previews): no forward-auth by design — it serves only the isolated renderer;
      // the platform session cookie and identity headers are stripped (OpenClaw cli/mcp/apps.md).
      [`traefik.http.routers.${sbxRouter}.rule`]: `Host(\`${sandboxHost(team)}\`)`,
      [`traefik.http.routers.${sbxRouter}.priority`]: '65',
      [`traefik.http.routers.${sbxRouter}.entrypoints`]: 'websecure',
      [`traefik.http.routers.${sbxRouter}.middlewares`]: 'secure-headers@file,strip-identity@file,strip-session-cookie@file',
      [`traefik.http.routers.${sbxRouter}.service`]: sbxRouter,
      [`traefik.http.services.${sbxRouter}.loadbalancer.server.port`]: String(SANDBOX_LISTENER_PORT),
    },
    // The image default interval is 180 s, too slow for the 120 s start timeout (spike 01).
    Healthcheck: {
      Test: ['CMD', 'node', 'dist/docker-healthcheck.js'],
      Interval: 30e9,
      Timeout: 10e9,
      StartPeriod: 60e9,
      StartInterval: 5e9,
      Retries: 3,
    },
    HostConfig: {
      Mounts: [stateMount, ...driveMounts(team)],
      Memory: memory(spec.resourceLimits),
      MemorySwap: memory(spec.resourceLimits),
      NanoCpus: Math.round(spec.resourceLimits.cpu * 1e9),
      RestartPolicy: { Name: 'no' },
      // No published ports: the Gateway is reachable only through Traefik on kacp-edge.
    },
    NetworkingConfig: { EndpointsConfig: { [config.edgeNetwork]: {} } },
  };
}

// Bind mode: the orchestrator owns /data and writes the seed directly (uid 1000, 0700 — spike 06).
async function seedBind(team: string, spec: TeamRuntimeSpec) {
  const dir = teamStateHostDir(team);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chown(dir, OPENCLAW_UID, OPENCLAW_UID);
  await mkdir(`${dir}/tmp`, { recursive: true, mode: 0o700 });
  await chown(`${dir}/tmp`, OPENCLAW_UID, OPENCLAW_UID);
  const file = `${dir}/openclaw.json`;
  if (await stat(file).then(() => true, () => false)) return;
  await writeFile(file, JSON.stringify(seedConfig(team, spec.adminEmails), null, 2), { mode: 0o600 });
  await chown(file, OPENCLAW_UID, OPENCLAW_UID);
}

// Volume mode: the volume only exists through the container, so seed via the archive API.
async function seedVolume(team: string, spec: TeamRuntimeSpec) {
  const name = teamContainer(team);
  if (await docker.fileExists(name, `${STATE_DIR}/openclaw.json`)) return;
  const content = JSON.stringify(seedConfig(team, spec.adminEmails), null, 2);
  await docker.putArchive(name, STATE_DIR, tarFile({ name: 'openclaw.json', content, uid: OPENCLAW_UID, gid: OPENCLAW_UID }));
}

/**
 * Creates the state and the (stopped) container if missing. Never rewrites an existing openclaw.json.
 * A stopped container whose env/image changed is recreated (safe: no running Gateway, no lease).
 */
async function ensureCreated(team: string, spec: TeamRuntimeSpec, onStage?: (s: 'container') => Promise<void>) {
  await ensureDrive(team, spec);
  if (config.stateMode === 'bind') await seedBind(team, spec);
  const name = teamContainer(team);
  let existing = await docker.inspect(name);
  if (existing && existing.State.Status !== 'running' && existing.Config.Labels['kacp.config-hash'] !== configHash(team, spec)) {
    await docker.remove(name);
    existing = null;
  }
  if (!existing) {
    await onStage?.('container');
    await docker.create(name, containerSpec(team, spec));
    if (sandboxEnabled()) {
      await docker.networkEnsure(sbxNetwork(team), true);
      await docker.networkConnect(sbxNetwork(team), name);
    }
  }
  if (config.stateMode === 'volume') await seedVolume(team, spec);
}

async function waitHealthy(team: string): Promise<'healthy' | 'lease' | string> {
  const name = teamContainer(team);
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const c = await docker.inspect(name);
    if (!c) return '컨테이너가 사라졌어요.';
    if (c.State.Health?.Status === 'healthy') return 'healthy';
    if (c.State.Status === 'exited' || c.State.Status === 'dead') {
      const logs = await docker.logsTail(name);
      if (LEASE_PATTERN.test(logs)) return 'lease';
      if (c.State.OOMKilled) return '메모리가 부족해 멈췄어요.';
      return `시작 중 멈췄어요 (exit ${c.State.ExitCode}).`;
    }
    await sleep(1000);
  }
  return '시작 시간이 120초를 넘었어요.';
}

async function startAndWait(team: string) {
  const name = teamContainer(team);
  const leaseDeadline = Date.now() + LEASE_RETRY_MS;
  for (;;) {
    const c = await docker.inspect(name);
    if (c?.State.Status === 'running' && c.State.Health?.Status === 'healthy') return;
    // An exited container (crash, OOM, VM reboot) is started again as-is — never recreated (spike 06).
    if (c?.State.Status !== 'running') await docker.start(name);
    const result = await waitHealthy(team);
    if (result === 'healthy') return;
    if (result === 'lease' && Date.now() < leaseDeadline) {
      await sleep(30_000);
      continue;
    }
    throw new Error(result === 'lease' ? '이전 실행이 아직 정리되지 않았어요.' : result);
  }
}

// ── drive (docs/README.md 4단계) ──

/** /data/teams/{team}/drive/{shared,personal} and .trash. Shared = 1000:{gid} 2770 so OpenClaw can write. */
async function ensureDrive(team: string, spec: TeamRuntimeSpec) {
  const base = `${config.dataRoot}/teams/${team}`;
  const shared = teamSharedDir(team);
  await mkdir(shared, { recursive: true });
  await mkdir(`${base}/drive/personal`, { recursive: true });
  await mkdir(`${base}/.trash`, { recursive: true, mode: 0o700 });
  await chown(shared, OPENCLAW_UID, spec.linuxGid).catch(() => undefined);
  await chmod(shared, 0o2770).catch(() => undefined);
}

// ── sandbox socket proxy (bind/VM mode only — CLAUDE.md exception, spike 06) ──

async function startSandboxProxy(team: string) {
  if (!sandboxEnabled()) return;
  const name = sbxProxyContainer(team);
  await docker.networkEnsure(sbxNetwork(team), true);
  if (!(await docker.inspect(name))) {
    await docker.create(name, {
      Image: config.socketProxyImage,
      Env: ['CONTAINERS=1', 'POST=1', 'EXEC=1', 'IMAGES=1', 'INFO=1', 'VERSION=1', 'ALLOW_START=1', 'ALLOW_STOP=1', 'ALLOW_RESTARTS=1'],
      Labels: { 'kacp.kind': 'sbx-proxy', 'kacp.team': team },
      HostConfig: {
        Binds: ['/var/run/docker.sock:/var/run/docker.sock:ro'],
        NetworkMode: sbxNetwork(team),
        RestartPolicy: { Name: 'no' },
        Memory: 64 * 1024 * 1024,
      },
    });
  }
  await docker.start(name);
}

/** Stops the proxy and removes this team's sandboxes (OpenClaw label + kacp-sbx-{team}- prefix, 05 §6). */
async function stopSandboxes(team: string) {
  if (!sandboxEnabled()) return;
  const prefix = `/kacp-sbx-${team}-`;
  for (const c of await docker.listByLabel('openclaw.sandbox=1')) {
    const n = c.Names.find((x) => x.startsWith(prefix));
    if (n) await docker.remove(n.slice(1)).catch(() => undefined);
  }
  await docker.stop(sbxProxyContainer(team), 5);
}

// ── sidecar ──

/** (Re)creates the sidecar. It shares the team container's network namespace, so it must be
 *  recreated whenever the team container starts (a new namespace). It holds no state. */
async function startSidecar(team: string, spec: TeamRuntimeSpec) {
  const name = gwagentContainer(team);
  await docker.remove(name);
  await docker.create(name, {
    Image: config.gwagentImage,
    Cmd: ['node', 'dist/gwagent.js'],
    Env: [
      `GWAGENT_PORT=${GWAGENT_PORT}`,
      `GWAGENT_TOKEN=${gwagentToken(team)}`,
      `OPENCLAW_GATEWAY_PASSWORD=${spec.gatewayPassword}`,
    ],
    Labels: { 'kacp.kind': 'gwagent', 'kacp.team': team },
    HostConfig: {
      NetworkMode: `container:${teamContainer(team)}`,
      Memory: 64 * 1024 * 1024,
      MemorySwap: 64 * 1024 * 1024,
      NanoCpus: 0.25e9,
      RestartPolicy: { Name: 'no' },
      ReadonlyRootfs: true,
    },
  });
  await docker.start(name);
}

/** Calls admin-http-rpc through the sidecar (the only path that may use the Gateway password). */
export async function gatewayRpc(team: string, method: string, params: unknown = {}) {
  // The sidecar listens inside the team container's namespace, i.e. on the team container's address.
  const url = `http://${teamContainer(team)}:${GWAGENT_PORT}/rpc`;
  let last: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${gwagentToken(team)}`, 'content-type': 'application/json' },
        body: JSON.stringify({ method, params }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await r.json().catch(() => ({})) as Record<string, unknown>;
      if (!r.ok) throw Object.assign(new Error(`rpc ${method} → ${r.status}: ${JSON.stringify(body).slice(0, 300)}`), { status: r.status, body });
      return body;
    } catch (err) {
      last = err;
      // The sidecar may still be starting right after a (re)start.
      if ((err as { status?: number }).status) throw err;
      await sleep(1000);
    }
  }
  throw last;
}

// ── operations ──

const describe = (err: unknown) =>
  err instanceof DockerError ? `Docker 오류 (${err.status})` : err instanceof Error ? err.message : String(err);

async function bringUp(team: string, spec: TeamRuntimeSpec) {
  await ensureCreated(team, spec);
  await startSandboxProxy(team);
  // Shared market MCP servers live on kacp-mcp (they run independently of teams).
  await attachTeamNetwork(team).catch((err) => console.error(`mcp network ${team}: ${describe(err)}`));
  await startAndWait(team);
  await startSidecar(team, spec);
  watched.add(team);
  await notifyTeamStatus(team, 'running');
}

/** 202 from the handler; stages go to the api as team.provision events (A-04 progress). */
export function provision(team: string, spec: TeamRuntimeSpec) {
  return serial(team, async () => {
    try {
      await ensureCreated(team, spec, (s) => notifyProvision(team, s));
      // default_mcp: platform-mcp is installed here from stage 5/6 on.
      await notifyProvision(team, 'default_mcp');
      await notifyProvision(team, 'done');
    } catch (err) {
      await notifyProvision(team, 'failed', describe(err));
    }
  });
}

/** Fire-and-forget from the HTTP handler; the outcome goes to the api as team.status. */
export function ensureRunning(team: string, spec: TeamRuntimeSpec) {
  return serial(team, async () => {
    try {
      await bringUp(team, spec);
    } catch (err) {
      await notifyTeamStatus(team, 'error', describe(err));
    }
  });
}

async function stopContainers(team: string) {
  watched.delete(team);
  await docker.stop(gwagentContainer(team), 5);
  await docker.stop(teamContainer(team));
  await stopSandboxes(team);
}

export function stop(team: string) {
  return serial(team, async () => {
    try {
      await stopContainers(team);
      await notifyTeamStatus(team, 'stopped');
    } catch (err) {
      await notifyTeamStatus(team, 'error', describe(err));
    }
  });
}

/** Graceful stop + start. Picks up env changes (recreate) and the current limits. */
export function restart(team: string, spec: TeamRuntimeSpec) {
  return serial(team, async () => {
    try {
      await stopContainers(team);
      await bringUp(team, spec);
    } catch (err) {
      await notifyTeamStatus(team, 'error', describe(err));
    }
  });
}

/**
 * Applies assigned agents + team admins to the running Gateway: writes each agent's AGENTS.md,
 * then config.get → config.patch with baseHash (retried once on a hash conflict).
 */
export function applyConfig(team: string, desired: DesiredConfig) {
  return serial(team, async () => {
    const c = await docker.inspect(teamContainer(team));
    if (c?.State.Status !== 'running') throw new Error('팀 에이전트가 꺼져 있어요.');

    // The default agent `main` keeps OpenClaw's own AGENTS.md; only the platform block on top is ours.
    const mainMd = `${STATE_DIR}/workspace/AGENTS.md`;
    const current = await docker.readFile(teamContainer(team), mainMd);
    const next = withPlatformBlock(current);
    if (next !== current) {
      await docker.putArchive(teamContainer(team), STATE_DIR, tar([
        { name: 'workspace', uid: OPENCLAW_UID, gid: OPENCLAW_UID, mode: 0o700 },
        { name: 'workspace/AGENTS.md', content: next, uid: OPENCLAW_UID, gid: OPENCLAW_UID, mode: 0o600 },
      ]));
    }

    if (desired.agents.length) {
      const entries = desired.agents.flatMap((a) => {
        const dir = workspaceFor(a.id).slice(STATE_DIR.length + 1);
        return [
          { name: dir, uid: OPENCLAW_UID, gid: OPENCLAW_UID, mode: 0o700 },
          { name: `${dir}/AGENTS.md`, content: agentsMd(a), uid: OPENCLAW_UID, gid: OPENCLAW_UID, mode: 0o600 },
        ];
      });
      await docker.putArchive(teamContainer(team), STATE_DIR, tar(entries));
    }

    // Market MCP entries carry this team's secrets (Secret Store → X-KACP-Secret-* headers).
    if (desired.mcpServers?.length) await attachTeamNetwork(team);
    const withSecrets: DesiredConfig = desired.mcpServers
      ? {
        ...desired,
        mcpServers: await Promise.all(desired.mcpServers.map(async (m) => ({
          key: m.key, url: m.url, ...(m.pkg ? { headers: secretHeaders(await readSecrets(team, m.pkg)) } : {}),
        }))),
      }
      : desired;

    for (let attempt = 0; attempt < 2; attempt++) {
      const got = await gatewayRpc(team, 'config.get') as { payload?: { config?: Record<string, unknown>; parsed?: Record<string, unknown>; hash?: string } };
      const current = got.payload?.config ?? got.payload?.parsed ?? {};
      const plan = computePatch(current, withSecrets, { sandbox: sandboxEnabled(), sandboxOrigin: sandboxOrigin(team) });
      if (!plan) return { changed: false };
      try {
        await gatewayRpc(team, 'config.patch', {
          raw: JSON.stringify(plan.patch),
          baseHash: got.payload?.hash,
          replacePaths: plan.replacePaths,
          note: 'kacp apply-config',
        });
        return { changed: true, paths: plan.replacePaths };
      } catch (err) {
        if (attempt === 0 && /config changed since last load/i.test(String((err as Error).message))) continue;
        throw err;
      }
    }
    throw new Error('설정이 계속 바뀌고 있어 반영하지 못했어요.');
  });
}

/**
 * "직접 추가" MCP (U-15): writes or deletes one `mcp.servers.{key}` entry on the running Gateway.
 * Headers (tokens) go straight to the Gateway config and are never stored by the api.
 */
export function patchManualMcp(team: string, key: string, server: { url: string; headers?: Record<string, string> } | null) {
  return serial(team, async () => {
    const c = await docker.inspect(teamContainer(team));
    if (c?.State.Status !== 'running') throw new Error('팀 에이전트가 꺼져 있어요.');
    for (let attempt = 0; attempt < 2; attempt++) {
      const got = await gatewayRpc(team, 'config.get') as { payload?: { hash?: string } };
      const entry = server ? { url: server.url, transport: 'streamable-http', ...(server.headers && Object.keys(server.headers).length ? { headers: server.headers } : {}) } : null;
      try {
        await gatewayRpc(team, 'config.patch', {
          raw: JSON.stringify({ mcp: { servers: { [key]: entry } } }),
          baseHash: got.payload?.hash,
          replacePaths: [`mcp.servers.${key}`],
          note: 'kacp manual mcp',
        });
        return { changed: true };
      } catch (err) {
        if (attempt === 0 && /config changed since last load/i.test(String((err as Error).message))) continue;
        throw err;
      }
    }
    throw new Error('설정이 계속 바뀌고 있어 반영하지 못했어요.');
  });
}

/** docker update on a running container (A-05 리소스). Stopped containers get the limits at next create. */
export async function updateResources(team: string, limits: TeamRuntimeSpec['resourceLimits']) {
  const c = await docker.inspect(teamContainer(team));
  if (!c) return;
  await docker.update(teamContainer(team), {
    Memory: memory(limits),
    MemorySwap: memory(limits),
    NanoCpus: Math.round(limits.cpu * 1e9),
  });
}

/** Team delete: graceful stop, remove containers, keep the data (bind: moved to backups/deleted-teams). */
export function removeTeam(team: string) {
  return serial(team, async () => {
    await stopContainers(team);
    await docker.remove(gwagentContainer(team));
    await docker.remove(teamContainer(team));
    if (sandboxEnabled()) {
      await docker.remove(sbxProxyContainer(team));
      await docker.networkRemove(sbxNetwork(team));
    }
    if (config.stateMode === 'bind') {
      const src = `${config.dataRoot}/teams/${team}`;
      const dst = `${config.dataRoot}/backups/deleted-teams/${team}-${new Date().toISOString().slice(0, 10)}`;
      if (await stat(src).then(() => true, () => false)) {
        await mkdir(`${config.dataRoot}/backups/deleted-teams`, { recursive: true });
        await rename(src, dst);
      }
    }
    // Volume mode (local): the socket proxy blocks the volume API, so kacp-team-{team}-state stays.
  });
}

// Health watch (04-api.md §4, every 30 s): a team we reported running that is no longer healthy → error.
const watched = new Set<string>();
export const watchedTeams = () => [...watched];

export function startHealthWatch(log: (msg: string) => void) {
  const timer = setInterval(async () => {
    for (const team of watched) {
      const c = await docker.inspect(teamContainer(team)).catch(() => null);
      const ok = c?.State.Status === 'running' && c.State.Health?.Status !== 'unhealthy';
      if (ok) continue;
      watched.delete(team);
      log(`team ${team} unhealthy`);
      await notifyTeamStatus(team, 'error', c?.State.OOMKilled ? '메모리가 부족해 멈췄어요.' : '팀 에이전트가 응답하지 않아요.');
    }
  }, 30_000);
  timer.unref();
}

/** On orchestrator start: re-adopt running teams so health watch and stats include them. */
export async function adoptRunning() {
  const list = await docker.listByLabel('kacp.kind=team');
  for (const c of list) if (c.State === 'running' && c.Labels['kacp.team']) watched.add(c.Labels['kacp.team']);
}
