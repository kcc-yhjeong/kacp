import { describe, expect, it } from 'vitest';
import { tarFile } from './tar.js';

describe('tarFile', () => {
  it('builds a valid single-file ustar archive', () => {
    const tar = tarFile({ name: 'openclaw.json', content: '{"a":1}', mode: 0o600, uid: 1000, gid: 1000 });
    expect(tar.length % 512).toBe(0);
    expect(tar.subarray(0, 13).toString()).toBe('openclaw.json');
    expect(tar.subarray(257, 262).toString()).toBe('ustar');
    expect(parseInt(tar.subarray(124, 135).toString(), 8)).toBe(7);
    expect(parseInt(tar.subarray(108, 115).toString(), 8)).toBe(1000);

    // checksum: sum of header bytes with the checksum field read as spaces
    const header = Buffer.from(tar.subarray(0, 512));
    const stored = parseInt(header.subarray(148, 154).toString(), 8);
    header.fill(0x20, 148, 156);
    expect(header.reduce((a, b) => a + b, 0)).toBe(stored);
    expect(tar.subarray(512, 519).toString()).toBe('{"a":1}');
  });

  it('splits long names into the ustar prefix field', () => {
    const long = `${'a'.repeat(60)}/${'b'.repeat(60)}/file.txt`;
    const t = tarFile({ name: long, content: 'x' });
    expect(t.subarray(0, 8).toString()).toBe('file.txt');
    expect(t.subarray(345, 345 + 121).toString()).toBe(`${'a'.repeat(60)}/${'b'.repeat(60)}`);
    expect(() => tarFile({ name: 'c'.repeat(120), content: 'x' })).toThrow(/too long/);
  });
});

describe('tar', () => {
  it('writes directory entries before files', async () => {
    const { tar } = await import('./tar.js');
    const t = tar([{ name: 'workspace-x', uid: 1000, gid: 1000 }, { name: 'workspace-x/AGENTS.md', content: 'hi', uid: 1000, gid: 1000 }]);
    expect(t.subarray(0, 12).toString()).toBe('workspace-x/');
    expect(String.fromCharCode(t[156]!)).toBe('5');
    expect(t.subarray(512, 533).toString()).toBe('workspace-x/AGENTS.md');
    expect(String.fromCharCode(t[512 + 156]!)).toBe('0');
  });
});

describe('demuxLogs', () => {
  it('strips docker stream frame headers', async () => {
    const { demuxLogs } = await import('./logs.js');
    const frame = (stream: number, text: string) => {
      const body = Buffer.from(text);
      const h = Buffer.alloc(8);
      h[0] = stream;
      h.writeUInt32BE(body.length, 4);
      return Buffer.concat([h, body]);
    };
    expect(demuxLogs(Buffer.concat([frame(1, 'hello\n'), frame(2, '에러\n')]))).toBe('hello\n에러\n');
    expect(demuxLogs(Buffer.from('plain text'))).toBe('plain text');
  });
});
