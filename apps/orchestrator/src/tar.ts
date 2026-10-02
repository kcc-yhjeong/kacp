// POSIX ustar archive builder, enough for PUT /containers/{id}/archive (files and directories).
// Directory entries matter: Docker creates missing parents as root:root, which the node user
// (uid 1000) inside the team container could not write to.

export interface TarEntry {
  name: string;
  /** Omit for a directory. */
  content?: string | Buffer;
  mode?: number;
  uid?: number;
  gid?: number;
}

function header(entry: TarEntry, size: number, isDir: boolean): Buffer {
  const h = Buffer.alloc(512, 0);
  const field = (value: string, offset: number, length: number) => h.write(value, offset, length, 'ascii');
  const octal = (n: number, length: number) => `${n.toString(8).padStart(length - 1, '0')}\0`;
  const name = isDir && !entry.name.endsWith('/') ? `${entry.name}/` : entry.name;
  if (Buffer.byteLength(name) > 100) throw new Error(`tar name too long: ${name}`);

  field(name, 0, 100);
  field(octal(entry.mode ?? (isDir ? 0o700 : 0o600), 8), 100, 8);
  field(octal(entry.uid ?? 0, 8), 108, 8);
  field(octal(entry.gid ?? 0, 8), 116, 8);
  field(octal(size, 12), 124, 12);
  field(octal(Math.floor(Date.now() / 1000), 12), 136, 12);
  field(' '.repeat(8), 148, 8); // checksum is computed over spaces
  field(isDir ? '5' : '0', 156, 1);
  field('ustar\0', 257, 6);
  field('00', 263, 2);

  let sum = 0;
  for (const byte of h) sum += byte;
  field(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return h;
}

export function tar(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const isDir = e.content === undefined;
    const data = isDir ? Buffer.alloc(0) : typeof e.content === 'string' ? Buffer.from(e.content, 'utf8') : e.content!;
    parts.push(header(e, data.length, isDir), data, Buffer.alloc((512 - (data.length % 512)) % 512, 0));
  }
  parts.push(Buffer.alloc(1024, 0));
  return Buffer.concat(parts);
}

/** Single file archive (kept for the openclaw.json seed). */
export const tarFile = (file: TarEntry & { content: string | Buffer }) => tar([file]);
