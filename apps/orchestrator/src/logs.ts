// Docker log helpers (no config import, so they are unit-testable).
/**
 * Docker log stream without a TTY: frames of [stream(1) 0 0 0 size(4, BE)] + payload.
 * Falls back to plain text when the stream is not multiplexed.
 */
export function demuxLogs(buf: Buffer): string {
  const parts: Buffer[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const stream = buf[i]!;
    if (stream > 2 || buf[i + 1] !== 0 || buf[i + 2] !== 0 || buf[i + 3] !== 0) return buf.toString('utf8');
    const size = buf.readUInt32BE(i + 4);
    parts.push(buf.subarray(i + 8, i + 8 + size));
    i += 8 + size;
  }
  return Buffer.concat(parts).toString('utf8');
}
