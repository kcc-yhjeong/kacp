import { chown, mkdir, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  config, GATEWAY_PORT, OPENCLAW_UID, STATE_DIR, teamContainer, teamStateHostDir, teamStateVolume,
} from './config.js';
import { docker, DockerError } from './docker.js';
import { notifyTeamStatus } from './events.js';
import { seedConfig } from './openclaw-config.js';
import { tarFile } from './tar.js';

// Team container lifecycle (04-api.md §3 provision / ensure-running / stop, spike 06).

export interface TeamRuntimeSpec {
  gatewayPassword: string;
  adminEmails: string[];
  resourceLimits: { cpu: number; memoryMb: number; diskGb: number };
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

function containerSpec(team: string, spec: TeamRuntimeSpec) {
  const name = teamContainer(team);
  const router = `team-claw-${team}`;
  const stateMount = config.stateMode === 'bind'
    ? { Type: 'bind', Source: teamStateHostDir(team), Target: STATE_DIR }
    : { Type: 'volume', Source: teamStateVolume(team), Target: STATE_DIR };
  const passthrough = config.teamEnvPassthrough
    .filter((k) => process.env[k])
    .map((k) => `${k}=${process.env[k]}`);
  return {
    Image: config.openclawImage,
    Env: [`OPENCLAW_GATEWAY_PASSWORD=${spec.gatewayPassword}`, ...passthrough],
    Labels: {
      'kacp.kind': 'team',
      'kacp.team': team,
      'kacp.id': randomUUID(),
      // Dynamic route (apps/proxy/LABELS.md). No tls labels: the wildcard cert lives on the entrypoint (spike 07).
      'traefik.enable': 'true',
      'traefik.docker.network': config.edgeNetwork,
      [`traefik.http.routers.${router}.rule`]: `Host(\`${team}.${config.baseDomain}\`) && PathPrefix(\`/claw\`)`,
      [`traefik.http.routers.${router}.priority`]: '70',
      [`traefik.http.routers.${router}.entrypoints`]: 'websecure',
      [`traefik.http.routers.${router}.middlewares`]: 'secure-headers@file,strip-identity@file,kacp-auth@file,claw-frame@file',
      [`traefik.http.routers.${router}.service`]: router,
      [`traefik.http.services.${router}.loadbalancer.server.port`]: String(GATEWAY_PORT),
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
      Mounts: [stateMount],
      Memory: spec.resourceLimits.memoryMb * 1024 * 1024,
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
  const file = `${dir}/openclaw.json`;
  const exists = await stat(file).then(() => true, () => false);
  if (exists) return;
  await writeFile(file, JSON.stringify(seedConfig(team, spec.adminEmails), null, 2), { mode: 0o600 });
  await chown(file, OPENCLAW_UID, OPENCLAW_UID);
}

// Volume mode: the volume only exists through the container, so seed via the archive API.
async function seedVolume(team: string, spec: TeamRuntimeSpec) {
  const name = teamContainer(team);
  if (await docker.fileExists(name, `${STATE_DIR}/openclaw.json`)) return;
  const content = JSON.stringify(seedConfig(team, spec.adminEmails), null, 2);
  await docker.putArchive(name, STATE_DIR, tarFile({
    name: 'openclaw.json', content, mode: 0o600, uid: OPENCLAW_UID, gid: OPENCLAW_UID,
  }));
}

/** Creates the state and the (stopped) container if missing. Never rewrites an existing openclaw.json. */
async function ensureCreated(team: string, spec: TeamRuntimeSpec) {
  if (config.stateMode === 'bind') await seedBind(team, spec);
  if (!(await docker.inspect(teamContainer(team)))) {
    await docker.create(teamContainer(team), containerSpec(team, spec));
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

const describe = (err: unknown) =>
  err instanceof DockerError ? `Docker 오류 (${err.status})` : err instanceof Error ? err.message : String(err);

export function provision(team: string, spec: TeamRuntimeSpec) {
  return serial(team, () => ensureCreated(team, spec));
}

/** Fire-and-forget from the HTTP handler; the outcome goes to the api as team.status. */
export function ensureRunning(team: string, spec: TeamRuntimeSpec) {
  return serial(team, async () => {
    try {
      await ensureCreated(team, spec);
      await startAndWait(team);
      watched.add(team);
      await notifyTeamStatus(team, 'running');
    } catch (err) {
      await notifyTeamStatus(team, 'error', describe(err));
    }
  });
}

export function stop(team: string) {
  return serial(team, async () => {
    watched.delete(team);
    try {
      await docker.stop(teamContainer(team));
      await notifyTeamStatus(team, 'stopped');
    } catch (err) {
      await notifyTeamStatus(team, 'error', describe(err));
    }
  });
}

// Health watch (04-api.md §4, every 30 s): a team we reported running that is no longer healthy → error.
const watched = new Set<string>();
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
