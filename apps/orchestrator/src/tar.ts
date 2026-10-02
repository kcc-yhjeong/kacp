// Single-file POSIX ustar archive, enough for PUT /containers/{id}/archive.

export interface TarFile {
  name: string;
  content: string | Buffer;
  mode?: number;
  uid?: number;
  gid?: number;
}

export function tarFile(file: TarFile): Buffer {
  const data = typeof file.content === 'string' ? Buffer.from(file.content, 'utf8') : file.content;
  const header = Buffer.alloc(512, 0);
  const field = (value: string, offset: number, length: number) => header.write(value, offset, length, 'ascii');
  const octal = (n: number, length: number) => `${n.toString(8).padStart(length - 1, '0')}\0`;

  field(file.name, 0, 100);
  field(octal(file.mode ?? 0o600, 8), 100, 8);
  field(octal(file.uid ?? 0, 8), 108, 8);
  field(octal(file.gid ?? 0, 8), 116, 8);
  field(octal(data.length, 12), 124, 12);
  field(octal(Math.floor(Date.now() / 1000), 12), 136, 12);
  field(' '.repeat(8), 148, 8); // checksum is computed over spaces
  field('0', 156, 1); // regular file
  field('ustar\0', 257, 6);
  field('00', 263, 2);

  let sum = 0;
  for (const byte of header) sum += byte;
  field(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);

  const padding = Buffer.alloc((512 - (data.length % 512)) % 512, 0);
  return Buffer.concat([header, data, padding, Buffer.alloc(1024, 0)]);
}
