import { config } from './config.js';

// Minimal Docker Engine API client over plain fetch (CLAUDE.md: no dockerode). Every call goes
// through docker-socket-proxy, which only allows container endpoints (spike 06).

const API = '/v1.47';

export class DockerError extends Error {
  constructor(readonly status: number, readonly body: unknown, op: string) {
    super(`docker ${op} → ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
}

async function request(method: string, path: string, init: { json?: unknown; tar?: Buffer } = {}) {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  } else if (init.tar) {
    headers['content-type'] = 'application/x-tar';
    body = new Uint8Array(init.tar);
  }
  const res = await fetch(`${config.dockerUrl}${API}${path}`, { method, headers, body });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // plain-text body (logs, errors)
  }
  return { status: res.status, body: parsed, text };
}

export interface ContainerState {
  Status: 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead';
  ExitCode: number;
  OOMKilled: boolean;
  Health?: { Status: 'starting' | 'healthy' | 'unhealthy' | 'none' };
}

export interface ContainerStats {
  cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number };
  memory_stats: { usage?: number; limit?: number; stats?: { inactive_file?: number } };
}

export const docker = {
  async inspect(name: string): Promise<{ Id: string; State: ContainerState; Config: { Labels: Record<string, string> } } | null> {
    const r = await request('GET', `/containers/${name}/json`);
    if (r.status === 404) return null;
    if (r.status !== 200) throw new DockerError(r.status, r.body, 'inspect');
    return r.body as { Id: string; State: ContainerState; Config: { Labels: Record<string, string> } };
  },

  async create(name: string, spec: unknown): Promise<string> {
    const r = await request('POST', `/containers/create?name=${encodeURIComponent(name)}`, { json: spec });
    if (r.status !== 201) throw new DockerError(r.status, r.body, 'create');
    return (r.body as { Id: string }).Id;
  },

  async start(name: string) {
    const r = await request('POST', `/containers/${name}/start`);
    if (r.status !== 204 && r.status !== 304) throw new DockerError(r.status, r.body, 'start');
  },

  /** Graceful stop (SIGTERM, then kill after `timeoutS`). Never force-remove a running Gateway (spike 06). */
  async stop(name: string, timeoutS = 30) {
    const r = await request('POST', `/containers/${name}/stop?t=${timeoutS}`);
    if (r.status !== 204 && r.status !== 304 && r.status !== 404) throw new DockerError(r.status, r.body, 'stop');
  },

  /** Only for stopped containers or stateless sidecars — never a running Gateway (owner lease, spike 06). */
  async remove(name: string) {
    const r = await request('DELETE', `/containers/${name}?force=true`);
    if (r.status !== 204 && r.status !== 404) throw new DockerError(r.status, r.body, 'remove');
  },

  /** docker update: CPU/memory of a running container. */
  async update(name: string, body: unknown) {
    const r = await request('POST', `/containers/${name}/update`, { json: body });
    if (r.status !== 200) throw new DockerError(r.status, r.body, 'update');
  },

  /** One stats sample (Docker takes two readings ~1 s apart so cpu deltas are filled). */
  async stats(name: string): Promise<ContainerStats | null> {
    const r = await request('GET', `/containers/${name}/stats?stream=false`);
    if (r.status !== 200) return null;
    return r.body as ContainerStats;
  },

  async fileExists(name: string, path: string): Promise<boolean> {
    const r = await request('HEAD', `/containers/${name}/archive?path=${encodeURIComponent(path)}`);
    return r.status === 200;
  },

  /** Extracts a tar archive into `dir` inside the container (works on stopped containers and their volumes). */
  async putArchive(name: string, dir: string, tar: Buffer) {
    const r = await request('PUT', `/containers/${name}/archive?path=${encodeURIComponent(dir)}`, { tar });
    if (r.status !== 200) throw new DockerError(r.status, r.body, 'archive');
  },

  /** Last log lines (stdout+stderr, multiplexed frames stripped). */
  async logsTail(name: string, lines = 50): Promise<string> {
    const r = await request('GET', `/containers/${name}/logs?stdout=1&stderr=1&tail=${lines}`);
    if (r.status !== 200) return '';
    return r.text.replace(/[\x00-\x08\x0e-\x1f]/g, '');
  },

  async listByLabel(label: string): Promise<{ Names: string[]; State: string; Labels: Record<string, string> }[]> {
    const filters = encodeURIComponent(JSON.stringify({ label: [label] }));
    const r = await request('GET', `/containers/json?all=1&filters=${filters}`);
    if (r.status !== 200) throw new DockerError(r.status, r.body, 'list');
    return r.body as { Names: string[]; State: string; Labels: Record<string, string> }[];
  },
};
