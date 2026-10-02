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
});
