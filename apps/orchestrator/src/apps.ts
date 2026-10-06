import { config } from './config.js';
import { docker, DockerError } from './docker.js';
import { notifyApp } from './events.js';

// App copies (docs/README.md 5단계): work `kacp-app-{slug}--{team}`, public `kacp-pub-{name}-v{n}`.
// Source read-only at /src, data at /app-data; readiness = any HTTP answer on the port over kacp-edge.

export interface AppCopySpec {
  team: string;
  slug: string;
  copy: 'work' | 'public';
  publicName?: string;
  version?: number;
  sourceRel: string;
  dataRel: string;
  runtime: 'node' | 'python' | 'static';
  command: string;
  port: number;
  env: Record<string, string>;
  limits: { cpu: number; memoryMb: number };
}

const READY_TIMEOUT_MS = 90_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const appRuntimeImage = (runtime: AppCopySpec['runtime']) => `kacp/app-runtime-${runtime}:${config.appRuntimeTag}`;

function containerName(s: AppCopySpec) {
  return s.copy === 'work' ? `kacp-app-${s.slug}--${s.team}` : `kacp-pub-${s.publicName}-v${s.version}`;
}

function routerName(s: AppCopySpec) {
  return s.copy === 'work' ? `work-${s.slug}--${s.team}` : `public-${s.publicName}`;
}

function host(s: AppCopySpec) {
  return s.copy === 'work' ? `${s.slug}--${s.team}.${config.baseDomain}` : `${s.publicName}.${config.baseDomain}`;
}

function mount(rel: string, target: string, readOnly: boolean) {
  return config.stateMode === 'bind'
    ? { Type: 'bind', Source: `${config.dataRoot}/${rel}`, Target: target, ReadOnly: readOnly }
    : { Type: 'volume', Source: config.dataVolume, Target: target, ReadOnly: readOnly, VolumeOptions: { Subpath: rel } };
}

export function appContainerSpec(appId: string, s: AppCopySpec) {
  const router = routerName(s);
  const env = Object.entries(s.env).filter(([k]) => /^[A-Z][A-Z0-9_]*$/.test(k) && !k.startsWith('KACP_'));
  return {
    Image: appRuntimeImage(s.runtime),
    Env: [
      `KACP_RUNTIME=${s.runtime}`,
      `KACP_COMMAND=${s.command}`,
      `PORT=${s.port}`,
      ...env.map(([k, v]) => `${k}=${v}`),
    ],
    Labels: {
      'kacp.kind': s.copy === 'work' ? 'app-work' : 'app-public',
      'kacp.team': s.team,
      'kacp.id': appId,
      'kacp.copy': s.copy,
      ...(s.version ? { 'kacp.version': String(s.version) } : {}),
      // Dynamic route (apps/proxy/LABELS.md): session cookie stripped after forward-auth.
      'traefik.enable': 'true',
      'traefik.docker.network': config.edgeNetwork,
      [`traefik.http.routers.${router}.rule`]: `Host(\`${host(s)}\`)`,
      [`traefik.http.routers.${router}.priority`]: '60',
      [`traefik.http.routers.${router}.entrypoints`]: 'websecure',
      [`traefik.http.routers.${router}.middlewares`]: 'secure-headers@file,strip-identity@file,kacp-auth@file,strip-session-cookie@file',
      [`traefik.http.routers.${router}.service`]: router,
      [`traefik.http.services.${router}.loadbalancer.server.port`]: String(s.port),
    },
    HostConfig: {
      Mounts: [mount(s.sourceRel, '/src', true), mount(s.dataRel, '/app-data', false)],
      Memory: s.limits.memoryMb * 1024 * 1024,
      MemorySwap: s.limits.memoryMb * 1024 * 1024,
      NanoCpus: Math.round(s.limits.cpu * 1e9),
      PidsLimit: 256,
      // tini as PID 1 forwards SIGTERM: a bare `node server.js` ignores it and is killed after the timeout.
      Init: true,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      RestartPolicy: { Name: 'no' },
    },
    NetworkingConfig: { EndpointsConfig: { [config.edgeNetwork]: {} } },
  };
}

const queues = new Map<string, Promise<unknown>>();
function serial<T>(key: string, op: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(op);
  queues.set(key, next);
  return next;
}

async function containersOf(appId: string, copy: 'work' | 'public') {
  const list = await docker.listByLabel(`kacp.id=${appId}`);
  return list.filter((c) => c.Labels['kacp.copy'] === copy).map((c) => ({ name: c.Names[0]!.replace(/^\//, ''), state: c.State }));
}

/** Waits until the app answers HTTP on its port (any status). Fails fast if the container exits. */
async function waitReady(name: string, port: number): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const c = await docker.inspect(name);
    if (!c || c.State.Status === 'exited' || c.State.Status === 'dead') {
      const tail = (await docker.logsTail(name, 15)).trim().split('\n').slice(-5).join(' / ');
      throw new Error(`앱이 시작 중 멈췄어요${c ? ` (exit ${c.State.ExitCode})` : ''}. ${tail}`.slice(0, 480));
    }
    try {
      await fetch(`http://${name}:${port}/`, { signal: AbortSignal.timeout(2000), redirect: 'manual' });
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`${READY_TIMEOUT_MS / 1000}초 안에 포트 ${port}에서 응답이 없어요. 서버가 0.0.0.0:${port}에서 듣는지 확인하세요.`);
}

const describe = (err: unknown) =>
  err instanceof DockerError ? `Docker 오류 (${err.status})` : err instanceof Error ? err.message : String(err);

/**
 * Runs a copy. Work: replace the container. Public: start the new version next to the old one
 * (same router/service labels → Traefik balances both), then remove the old ones (zero downtime).
 */
export function runApp(appId: string, s: AppCopySpec) {
  return serial(`${appId}:${s.copy}`, async () => {
    const name = containerName(s);
    try {
      const existing = await containersOf(appId, s.copy);
      if (s.copy === 'work') for (const c of existing) await docker.remove(c.name);
      else if (existing.some((c) => c.name === name)) await docker.remove(name);
      await docker.create(name, appContainerSpec(appId, s));
      await docker.start(name);
      await waitReady(name, s.port);
      if (s.copy === 'public') for (const c of existing) if (c.name !== name) await docker.remove(c.name);
      await notifyApp(appId, s.copy, 'running');
    } catch (err) {
      await notifyApp(appId, s.copy, 'error', null, describe(err));
    }
  });
}

/** Stop keeps the container for logs; it is replaced on the next run. */
export function stopApp(appId: string, copy: 'work' | 'public') {
  return serial(`${appId}:${copy}`, async () => {
    for (const c of await containersOf(appId, copy)) await docker.stop(c.name, 10);
  });
}

export function removeApp(appId: string, copy: 'work' | 'public') {
  return serial(`${appId}:${copy}`, async () => {
    for (const c of await containersOf(appId, copy)) await docker.remove(c.name);
  });
}

export async function appLogs(appId: string, copy: 'work' | 'public', tail: number) {
  const list = await containersOf(appId, copy);
  const pick = list.find((c) => c.state === 'running') ?? list[0];
  if (!pick) return { lines: [] };
  const text = await docker.logsTail(pick.name, tail);
  return { lines: text.split('\n').filter((l, i, a) => l !== '' || i < a.length - 1) };
}

/** Running app copies for the usage collector. */
export async function runningAppContainers() {
  const out: { name: string; appId: string; copy: string }[] = [];
  for (const kind of ['app-work', 'app-public']) {
    for (const c of await docker.listByLabel(`kacp.kind=${kind}`)) {
      if (c.State === 'running') out.push({ name: c.Names[0]!.replace(/^\//, ''), appId: c.Labels['kacp.id']!, copy: c.Labels['kacp.copy']! });
    }
  }
  return out;
}
