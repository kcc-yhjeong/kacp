import { config } from './config.js';
import { demuxLogs } from './logs.js';

// Minimal Docker Engine API client over plain fetch (CLAUDE.md: no dockerode). Every call goes
// through docker-socket-proxy, which only allows container endpoints (spike 06).

const API = '/v1.47';

export class DockerError extends Error {
  constructor(readonly status: number, readonly body: unknown, op: string) {
    super(`docker ${op} → ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
}

async function request(method: string, path: string, init: { json?: unknown; tar?: Buffer; base?: string; timeoutMs?: number } = {}) {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  } else if (init.tar) {
    headers['content-type'] = 'application/x-tar';
    body = new Uint8Array(init.tar);
  }
  const res = await fetch(`${init.base ?? config.dockerUrl}${API}${path}`, {
    method, headers, body, ...(init.timeoutMs ? { signal: AbortSignal.timeout(init.timeoutMs) } : {}),
  });
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

  // Networks (bind/VM mode only: per-team sandbox network). Needs NETWORKS=1 on the socket proxy.
  async networkEnsure(name: string, internal: boolean, kind = 'sbx-network') {
    const r = await request('GET', `/networks/${name}`);
    if (r.status === 200) return;
    const c = await request('POST', '/networks/create', { json: { Name: name, Internal: internal, Labels: { 'kacp.kind': kind } } });
    if (c.status !== 201 && c.status !== 409) throw new DockerError(c.status, c.body, 'network create');
  },

  async networkConnect(network: string, container: string) {
    const r = await request('POST', `/networks/${network}/connect`, { json: { Container: container } });
    // 403 "already exists in network" is fine.
    if (r.status !== 200 && !(r.status === 403 && /already exists/i.test(r.text))) throw new DockerError(r.status, r.body, 'network connect');
  },

  async networkRemove(name: string) {
    const r = await request('DELETE', `/networks/${name}`);
    if (r.status !== 204 && r.status !== 404) throw new DockerError(r.status, r.body, 'network remove');
  },

  /** Contents of one regular file via GET /archive (a tar with a single entry), or null if missing. */
  async readFile(name: string, path: string): Promise<string | null> {
    const res = await fetch(`${config.dockerUrl}${API}/containers/${name}/archive?path=${encodeURIComponent(path)}`);
    if (res.status === 404) return null;
    if (res.status !== 200) throw new DockerError(res.status, await res.text(), 'archive get');
    const tar = Buffer.from(await res.arrayBuffer());
    // ustar size field: 12 bytes of NUL/space-terminated octal at offset 124.
    const size = parseInt(tar.subarray(124, 136).toString('ascii').split(String.fromCharCode(0))[0]!.trim() || '0', 8);
    return tar.subarray(512, 512 + size).toString('utf8');
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
  async logsTail(name: string, lines: number | 'all' = 50): Promise<string> {
    const res = await fetch(`${config.dockerUrl}${API}/containers/${name}/logs?stdout=1&stderr=1&timestamps=0&tail=${lines}`);
    if (res.status !== 200) return '';
    return demuxLogs(Buffer.from(await res.arrayBuffer()));
  },

  /** Blocks until the container exits; returns its exit code. */
  async wait(name: string, timeoutMs: number): Promise<number> {
    const r = await request('POST', `/containers/${name}/wait`, { timeoutMs });
    if (r.status !== 200) throw new DockerError(r.status, r.body, 'wait');
    return (r.body as { StatusCode: number }).StatusCode;
  },

  // ── build socket proxy (BUILD IMAGES POST) ──

  async imageExists(ref: string): Promise<boolean> {
    const r = await request('GET', `/images/${encodeURIComponent(ref)}/json`, { base: config.buildDockerUrl });
    return r.status === 200;
  },

  async pull(ref: string) {
    const i = ref.lastIndexOf(':');
    const q = `fromImage=${encodeURIComponent(ref.slice(0, i))}&tag=${encodeURIComponent(ref.slice(i + 1))}`;
    const r = await request('POST', `/images/create?${q}`, { base: config.buildDockerUrl, timeoutMs: 10 * 60_000 });
    if (r.status !== 200 || /"error"/.test(r.text)) throw new DockerError(r.status, r.text.slice(-300), 'pull');
  },

  /**
   * POST /build with a tar context. Returns the build output (stream lines joined) and the error, if any.
   * The classic builder runs RUN steps on the default bridge, so `npm ci` reaches the registry.
   */
  async build(context: Buffer, tag: string, opts: { memoryMb: number; labels: Record<string, string> }): Promise<{ log: string; error: string | null }> {
    const q = new URLSearchParams({
      t: tag, rm: '1', forcerm: '1', pull: '1', memory: String(opts.memoryMb * 1024 * 1024), labels: JSON.stringify(opts.labels),
    });
    const r = await request('POST', `/build?${q}`, { tar: context, base: config.buildDockerUrl, timeoutMs: 15 * 60_000 });
    let log = '';
    let error: string | null = r.status === 200 ? null : `Docker 오류 (${r.status})`;
    for (const line of r.text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const m = JSON.parse(line) as { stream?: string; status?: string; error?: string };
        if (m.stream) log += m.stream;
        else if (m.status) log += `${m.status}\n`;
        if (m.error) error = m.error;
      } catch {
        log += `${line}\n`;
      }
    }
    return { log, error };
  },

  async removeImage(ref: string) {
    await request('DELETE', `/images/${encodeURIComponent(ref)}?force=1`, { base: config.buildDockerUrl });
  },

  async listByLabel(label: string | string[]): Promise<{ Names: string[]; State: string; Labels: Record<string, string> }[]> {
    const filters = encodeURIComponent(JSON.stringify({ label: Array.isArray(label) ? label : [label] }));
    const r = await request('GET', `/containers/json?all=1&filters=${filters}`);
    if (r.status !== 200) throw new DockerError(r.status, r.body, 'list');
    return r.body as { Names: string[]; State: string; Labels: Record<string, string> }[];
  },
};

