// Admin formatting helpers (02-design-system.md §8: sizes KB/MB/GB with one decimal, thousands separators).

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const text = i === 0 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
  return `${text}${UNITS[i]}`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${Math.round(n)}%`;
}

/** "2코어 · 4GB · 20GB" */
export function formatLimits(l: { cpu: number; memoryMb: number; diskGb: number } | null | undefined): string {
  if (!l) return '—';
  return `${l.cpu}코어 · ${formatMb(l.memoryMb)} · ${l.diskGb}GB`;
}

export function formatMb(mb: number): string {
  return mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10}GB` : `${mb}MB`;
}

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/**
 * Readable initial password like `tR8m-q4Kx-2vxP` (14 chars, letters and digits).
 * Satisfies passwordProblems() for any email whose local part is longer than 3 characters.
 */
export function generatePassword(random: (n: number) => number = cryptoRandom): string {
  for (;;) {
    const chars = Array.from({ length: 12 }, () => PASSWORD_ALPHABET[random(PASSWORD_ALPHABET.length)] ?? 'a');
    const pw = `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`;
    if (/[A-Za-z]/.test(pw) && /[0-9]/.test(pw)) return pw;
  }
}

function cryptoRandom(n: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 0) % n;
}

/** `<input type="date">` value → ISO at local start of day (or end of day for `to`). */
export function dateInputToIso(value: string, endOfDay = false): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const t = endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d);
  return t.toISOString();
}
