// Drive copy helpers (02-design-system.md §8).

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** `4.2 KB`, `12.4 GB`, `20 GB`, `512 B`. One decimal, `.0` dropped, thousands separators. */
export function formatSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  // Rounding can carry to 1024.0 (e.g. 1023.96 KB) — show it in the next unit.
  if (i > 0 && Math.round(v * 10) / 10 >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const text =
    i === 0
      ? Math.round(v).toLocaleString('en-US')
      : (Math.round(v * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
  return `${text} ${UNITS[i]}`;
}

export type UsageLevel = 'normal' | 'warn' | 'danger';

/** Bar color only at ≥ 80% (warn) and ≥ 95% (danger). */
export function usageLevel(used: number, limit: number): UsageLevel {
  if (!(limit > 0)) return 'normal';
  const pct = (used / limit) * 100;
  if (pct >= 95) return 'danger';
  if (pct >= 80) return 'warn';
  return 'normal';
}

export function usagePct(used: number, limit: number): number {
  if (!(limit > 0)) return 0;
  return Math.min(100, Math.max(0, (used / limit) * 100));
}

const DAY_MS = 24 * 3600 * 1000;

/** Whole days until auto delete, rounded up, never negative. */
export function daysLeft(purgeAfter: string, now: Date = new Date()): number {
  const t = new Date(purgeAfter).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.ceil((t - now.getTime()) / DAY_MS));
}

export function daysLeftLabel(days: number): string {
  return days <= 0 ? '오늘' : `${days}일`;
}

/** Warning dot in U-06 when ≤ 3 days remain. */
export const PURGE_WARN_DAYS = 3;
