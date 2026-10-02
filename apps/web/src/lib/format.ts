// Time copy rule (02-design-system.md §8): relative within 24h, then `YYYY-MM-DD HH:mm`.

const pad = (n: number) => String(n).padStart(2, '0');

export function formatTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '—';
  const diffSec = Math.floor((now.getTime() - t.getTime()) / 1000);
  if (diffSec >= 0 && diffSec < 24 * 3600) {
    if (diffSec < 60) return '방금 전';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
    return `${Math.floor(diffSec / 3600)}시간 전`;
  }
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

/** "Chrome · Windows" from a user agent string. */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return '알 수 없는 기기';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : '브라우저';
  const os = /iPad/.test(ua)
    ? 'iPadOS'
    : /iPhone/.test(ua)
      ? 'iOS'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'macOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  return os ? `${browser} · ${os}` : browser;
}

export function initialOf(name: string): string {
  return Array.from(name.trim())[0] ?? '?';
}
