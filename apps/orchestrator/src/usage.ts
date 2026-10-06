import { cpus, totalmem, freemem } from 'node:os';
import { statfs } from 'node:fs/promises';
import { config, teamContainer } from './config.js';
import { docker, type ContainerStats } from './docker.js';
import { sendUsage } from './events.js';
import { watchedTeams } from './teams.js';
import { runningAppContainers } from './apps.js';

// Usage collection (04-api.md §4, every minute): team containers via Docker stats, the VM via
// /proc-backed os counters (shared with the host in a container) and statfs on the data disk.

function containerCpuPct(s: ContainerStats): number {
  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
  const sysDelta = (s.cpu_stats.system_cpu_usage ?? 0) - (s.precpu_stats.system_cpu_usage ?? 0);
  const n = s.cpu_stats.online_cpus ?? 1;
  return sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * n * 100 : 0;
}

let lastCpu = cpus().map((c) => c.times);
function hostCpuPct(): number {
  const now = cpus().map((c) => c.times);
  let busy = 0;
  let total = 0;
  now.forEach((t, i) => {
    const p = lastCpu[i] ?? t;
    const idle = t.idle - p.idle;
    const all = (t.user - p.user) + (t.nice - p.nice) + (t.sys - p.sys) + (t.irq - p.irq) + idle;
    busy += all - idle;
    total += all;
  });
  lastCpu = now;
  return total > 0 ? (busy / total) * 100 : 0;
}

async function collect() {
  const samples: Record<string, unknown>[] = [];
  const disk = await statfs(config.dataRoot).catch(() => statfs('/'));
  samples.push({
    targetType: 'vm',
    targetId: 'host',
    cpuPct: hostCpuPct(),
    memBytes: totalmem() - freemem(),
    memLimitBytes: totalmem(),
    diskBytes: (disk.blocks - disk.bfree) * disk.bsize,
    diskLimitBytes: disk.blocks * disk.bsize,
  });
  for (const team of watchedTeams()) {
    const s = await docker.stats(teamContainer(team)).catch(() => null);
    if (!s) continue;
    samples.push({
      targetType: 'team',
      targetId: team,
      cpuPct: containerCpuPct(s),
      memBytes: (s.memory_stats.usage ?? 0) - (s.memory_stats.stats?.inactive_file ?? 0),
      memLimitBytes: s.memory_stats.limit ?? null,
    });
  }
  for (const c of await runningAppContainers().catch(() => [])) {
    const s = await docker.stats(c.name).catch(() => null);
    if (!s) continue;
    samples.push({
      targetType: 'app',
      targetId: `${c.appId}:${c.copy}`,
      cpuPct: containerCpuPct(s),
      memBytes: (s.memory_stats.usage ?? 0) - (s.memory_stats.stats?.inactive_file ?? 0),
      memLimitBytes: s.memory_stats.limit ?? null,
    });
  }
  await sendUsage(samples);
}

export function startUsageCollector(log: (msg: string) => void) {
  const timer = setInterval(() => collect().catch((err) => log(`usage collect failed: ${err}`)), 60_000);
  timer.unref();
}
