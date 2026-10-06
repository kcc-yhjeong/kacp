import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  config, MCP_PORT, MCP_TEST_NETWORK, mcpImage, mcpVersionRel, TRIVY_CACHE_VOLUME,
} from './config.js';
import { docker, DockerError } from './docker.js';
import { notifyMcpBuild, type McpBuildEvent } from './events.js';
import { dataMount } from './apps.js';
import { mcpContainerSpec } from './mcp-runtime.js';
import { tar, type TarEntry } from './tar.js';

// MCP build pipeline (docs/README.md 6단계): build → scan → test, one version at a time.
// The api validated the manifest and extracted the zip to /data/mcp/{pkg}/{ver}/src; it dispatches
// the next queued version and records each stage from the `mcp.build` events sent here.

export interface BuildJob {
  versionId: string;
  pkg: string;
  version: string;
  resources: { cpu: number; memoryMb: number };
}

const TEST_READY_MS = 60_000;
const SCAN_TIMEOUT_MS = 10 * 60_000;
/** Never sent to the builder: the platform Dockerfile replaces the developer's (README 6단계). */
const SKIP = new Set(['node_modules', 'dist', '.git', 'Dockerfile', '.dockerignore']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let chain: Promise<unknown> = Promise.resolve();
export function enqueueBuild(job: BuildJob) {
  chain = chain.catch(() => undefined).then(() => runBuild(job));
  return chain;
}

/** The platform Dockerfile: copied into the image at /app/platform, or read from the repo in dev. */
async function platformDockerfile(): Promise<string> {
  const candidates = [
    '/app/platform/Dockerfile',
    fileURLToPath(new URL('../../../packages/create-platform-mcp/platform/Dockerfile', import.meta.url)),
  ];
  for (const p of candidates) if (existsSync(p)) return readFile(p, 'utf8');
  throw new Error('플랫폼 Dockerfile을 찾지 못했어요.');
}

/** Source tree → build context entries. Symlinks are refused (the api already rejects them on upload). */
export async function contextEntries(root: string, rel = ''): Promise<TarEntry[]> {
  const out: TarEntry[] = [];
  for (const name of (await readdir(`${root}/${rel}`)).sort()) {
    if (!rel && SKIP.has(name)) continue;
    if (name === 'node_modules' || name === '.git') continue;
    const r = rel ? `${rel}/${name}` : name;
    const st = await lstat(`${root}/${r}`);
    if (st.isSymbolicLink()) throw new Error(`심볼릭 링크는 쓸 수 없어요: ${r}`);
    if (st.isDirectory()) {
      out.push({ name: r, mode: 0o755 });
      out.push(...(await contextEntries(root, r)));
    } else if (st.isFile()) {
      out.push({ name: r, content: await readFile(`${root}/${r}`), mode: 0o644 });
    }
  }
  return out;
}

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

interface TrivyReport {
  Results?: { Target?: string; Vulnerabilities?: { VulnerabilityID: string; PkgName: string; Severity: string; Title?: string; InstalledVersion?: string; FixedVersion?: string }[] }[];
}

/** Trivy JSON → counts + the most severe findings (top 200). */
export function summarizeScan(report: TrivyReport) {
  const summary = { critical: 0, high: 0, medium: 0, low: 0 };
  const findings: NonNullable<McpBuildEvent['findings']> = [];
  const seen = new Set<string>();
  for (const r of report.Results ?? []) {
    for (const v of r.Vulnerabilities ?? []) {
      const key = `${v.VulnerabilityID}:${v.PkgName}:${v.InstalledVersion ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sev = v.Severity.toLowerCase();
      if (sev in summary) summary[sev as keyof typeof summary]++;
      findings.push({
        severity: sev,
        pkg: `${v.PkgName}${v.InstalledVersion ? `@${v.InstalledVersion}` : ''}`,
        id: v.VulnerabilityID,
        title: `${v.Title ?? ''}${v.FixedVersion ? ` (수정 버전 ${v.FixedVersion})` : ''}`.trim(),
      });
    }
  }
  findings.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity.toUpperCase()) - SEVERITY_ORDER.indexOf(b.severity.toUpperCase()));
  return { summary, findings: findings.slice(0, 200) };
}

/** JSON-RPC over streamable HTTP: the reply is JSON or a single SSE `data:` event. */
export function parseRpcBody(text: string): { result?: unknown; error?: { message: string } } | null {
  const trimmed = text.trim();
  const candidates = trimmed.startsWith('{') ? [trimmed]
    : trimmed.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
  for (const c of candidates) {
    try {
      const m = JSON.parse(c) as { result?: unknown; error?: { message: string } };
      if ('result' in m || 'error' in m) return m;
    } catch {
      // keep looking
    }
  }
  return null;
}

async function rpc(url: string, id: number, method: string, params: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = parseRpcBody(await res.text());
  if (!res.ok || !body) throw new Error(`${method} → HTTP ${res.status}`);
  if (body.error) throw new Error(`${method} → ${body.error.message}`);
  return body.result;
}

class StageError extends Error {
  constructor(readonly stage: 'validate' | 'build' | 'scan' | 'test', message: string) {
    super(message);
  }
}

const describe = (err: unknown) =>
  err instanceof DockerError ? `Docker 오류 (${err.status}): ${String(err.body).slice(0, 300)}` : err instanceof Error ? err.message : String(err);

async function runBuild(job: BuildJob) {
  const rel = mcpVersionRel(job.pkg, job.version);
  const dir = `${config.dataRoot}/${rel}`;
  const image = mcpImage(job.pkg, job.version);
  const tag = `${job.pkg}-${job.version}`.replace(/[^a-z0-9-]/g, '-');
  const writeLog = (stage: string, text: string) => writeFile(`${dir}/${stage}.log`, text.slice(-1_000_000)).catch(() => undefined);
  try {
    // ── build ──
    await notifyMcpBuild(job.versionId, { status: 'building' });
    let entries: TarEntry[];
    try {
      entries = await contextEntries(`${dir}/src`);
    } catch (err) {
      throw new StageError('validate', describe(err));
    }
    entries.push({ name: 'Dockerfile', content: await platformDockerfile(), mode: 0o644 });
    entries.push({ name: '.dockerignore', content: 'node_modules\ndist\n.git\n.env*\n', mode: 0o644 });
    const built = await docker.build(tar(entries), image, {
      memoryMb: 2048,
      labels: { 'kacp.kind': 'mcp-image', 'kacp.mcp.pkg': job.pkg, 'kacp.mcp.version': job.version },
    }).catch((err) => ({ log: '', error: describe(err) }));
    await writeLog('build', `${built.log}${built.error ? `\n[실패] ${built.error}\n` : '\n[완료]\n'}`);
    if (built.error) throw new StageError('build', `빌드에 실패했어요: ${built.error}`.slice(0, 500));

    // ── scan: dependency vulnerabilities of the uploaded source (lockfile) ──
    await notifyMcpBuild(job.versionId, { status: 'scanning', imageRef: image });
    const scanName = `kacp-mcpscan-${tag}`;
    let scanLog = '';
    try {
      if (!(await docker.imageExists(config.trivyImage))) await docker.pull(config.trivyImage);
      await docker.remove(scanName);
      await docker.create(scanName, {
        Image: config.trivyImage,
        Cmd: ['fs', '--scanners', 'vuln', '--format', 'json', '--output', '/out/scan.json', '--cache-dir', '/cache', '--quiet', '/src'],
        Labels: { 'kacp.kind': 'mcp-scan' },
        HostConfig: {
          Mounts: [
            dataMount(`${rel}/src`, '/src', true),
            dataMount(rel, '/out', false),
            { Type: 'volume', Source: TRIVY_CACHE_VOLUME, Target: '/cache' },
          ],
          Memory: 1024 * 1024 * 1024,
          NanoCpus: 1e9,
          NetworkMode: 'bridge', // vulnerability DB download
        },
      });
      await docker.start(scanName);
      const code = await docker.wait(scanName, SCAN_TIMEOUT_MS);
      scanLog = await docker.logsTail(scanName, 'all');
      if (code !== 0) throw new Error(`trivy exit ${code}`);
    } catch (err) {
      await writeLog('scan', `${scanLog}\n[실패] ${describe(err)}\n`);
      throw new StageError('scan', `보안 스캔을 실행하지 못했어요: ${describe(err)}`.slice(0, 500));
    } finally {
      await docker.remove(scanName).catch(() => undefined);
    }
    const report = JSON.parse(await readFile(`${dir}/scan.json`, 'utf8')) as TrivyReport;
    const { summary, findings } = summarizeScan(report);
    const lockfile = existsSync(`${dir}/src/package-lock.json`);
    await writeLog('scan', [
      scanLog.trim(),
      lockfile ? '' : '[주의] package-lock.json이 없어 의존성 버전을 확인하지 못했어요. npm install 후 lock 파일을 함께 올리세요.',
      `Critical ${summary.critical} · High ${summary.high} · Medium ${summary.medium} · Low ${summary.low}`,
      ...findings.slice(0, 50).map((f) => `${f.severity.toUpperCase()} ${f.id} ${f.pkg} ${f.title}`),
    ].filter(Boolean).join('\n'));
    if (summary.critical > 0) {
      await docker.removeImage(image).catch(() => undefined);
      await notifyMcpBuild(job.versionId, {
        status: 'failed', failedStage: 'scan', scanSummary: summary, findings,
        detail: `Critical 취약점 ${summary.critical}개가 있어요. 의존성을 올린 뒤 새 버전으로 다시 올리세요.`,
      });
      return;
    }

    // ── test: run it like a team install (internal network, no egress) and list its tools ──
    await notifyMcpBuild(job.versionId, { status: 'testing', scanSummary: summary, findings });
    const testName = `kacp-mcptest-${tag}`;
    let tools: NonNullable<McpBuildEvent['tools']> = [];
    const lines: string[] = [];
    try {
      await docker.remove(testName);
      await docker.create(testName, mcpContainerSpec({
        image, network: MCP_TEST_NETWORK, env: [], resources: job.resources, labels: { 'kacp.kind': 'mcp-test' },
      }));
      await docker.start(testName);
      const base = `http://${testName}:${MCP_PORT}`;
      const deadline = Date.now() + TEST_READY_MS;
      for (;;) {
        const c = await docker.inspect(testName);
        if (!c || c.State.Status === 'exited' || c.State.Status === 'dead') throw new Error(`서버가 시작 중 멈췄어요 (exit ${c?.State.ExitCode ?? '?'}).`);
        const ok = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);
        if (ok) break;
        if (Date.now() > deadline) throw new Error(`${TEST_READY_MS / 1000}초 안에 /healthz가 응답하지 않았어요.`);
        await sleep(1000);
      }
      lines.push('GET /healthz → 200');
      const init = await rpc(`${base}/mcp`, 1, 'initialize', {
        protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'kacp-build-test', version: '1' },
      }) as { serverInfo?: { name?: string; version?: string } };
      lines.push(`initialize → ${init.serverInfo?.name ?? '?'} ${init.serverInfo?.version ?? ''}`);
      const listed = await rpc(`${base}/mcp`, 2, 'tools/list', {}) as { tools?: { name: string; title?: string; description?: string; inputSchema?: unknown }[] };
      tools = (listed.tools ?? []).slice(0, 100).map((t) => ({
        name: t.name, ...(t.title ? { title: t.title } : {}), description: t.description ?? '', inputSchema: t.inputSchema ?? {},
      }));
      lines.push(`tools/list → ${tools.length}개: ${tools.map((t) => t.name).join(', ')}`);
      if (!tools.length) throw new Error('tools/list가 비어 있어요. src/tools/index.ts에 도구를 등록하세요.');
    } catch (err) {
      const logs = await docker.logsTail(testName, 100).catch(() => '');
      await writeLog('test', `${lines.join('\n')}\n[실패] ${describe(err)}\n\n--- 서버 로그 ---\n${logs}`);
      throw new StageError('test', `테스트에 실패했어요: ${describe(err)}`.slice(0, 500));
    } finally {
      await docker.remove(testName).catch(() => undefined);
    }
    await writeLog('test', `${lines.join('\n')}\n[완료]\n`);
    await notifyMcpBuild(job.versionId, { status: 'in_review', imageRef: image, scanSummary: summary, findings, tools });
  } catch (err) {
    const stage = err instanceof StageError ? err.stage : 'build';
    await docker.removeImage(image).catch(() => undefined);
    await notifyMcpBuild(job.versionId, { status: 'failed', failedStage: stage, detail: describe(err).slice(0, 500) });
  }
}

/** Rejected or failed version: drop its image (uploads and logs stay for the review history). */
export async function removeVersionImage(pkg: string, version: string) {
  await docker.removeImage(mcpImage(pkg, version)).catch(() => undefined);
}
