import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkName, inlineType, nextFreeName, normalizePath, parentOf, resolveInside } from './paths.js';

describe('normalizePath', () => {
  it('normalises', () => {
    expect(normalizePath(undefined)).toBe('/');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('a//b/./c/')).toBe('/a/b/c');
    expect(parentOf('/a/b')).toBe('/a');
    expect(parentOf('/a')).toBe('/');
  });
  it.each(['/a/../b', '..', '/a\0b', 'a\\b'])('rejects %s', (p) => {
    expect(() => normalizePath(p)).toThrow();
  });
});

describe('checkName', () => {
  it.each(['a/b', '..', '.', '', 'x\\y', 'bad\nname'])('rejects %j', (n) => expect(() => checkName(n)).toThrow());
  it('accepts Korean and spaces', () => expect(checkName(' 보고서 v2.md ')).toBe('보고서 v2.md'));
});

describe('nextFreeName', () => {
  it('appends (n) before the extension', () => {
    const taken = new Set(['a.txt', 'a (1).txt', 'folder']);
    expect(nextFreeName('a.txt', (n) => taken.has(n))).toBe('a (2).txt');
    expect(nextFreeName('folder', (n) => taken.has(n))).toBe('folder (1)');
    expect(nextFreeName('b.txt', (n) => taken.has(n))).toBe('b.txt');
    expect(nextFreeName('.env', (n) => n === '.env')).toBe('.env (1)');
  });
});

describe('resolveInside', () => {
  it('blocks symlink escapes and follows nothing', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'kacp-drive-'));
    const root = path.join(base, 'shared');
    await mkdir(path.join(root, 'docs'), { recursive: true });
    await writeFile(path.join(root, 'docs', 'a.txt'), 'x');
    await writeFile(path.join(base, 'secret.txt'), 'no');
    expect(await resolveInside(root, '/docs/a.txt')).toBe(path.join(root, 'docs', 'a.txt'));
    await expect(resolveInside(root, '/missing.txt')).rejects.toMatchObject({ code: 'DRIVE_NOT_FOUND' });
    await expect(resolveInside(root, '/docs/new.txt', false)).resolves.toBe(path.join(root, 'docs', 'new.txt'));
    try {
      await symlink(path.join(base, 'secret.txt'), path.join(root, 'link.txt'));
      await symlink(base, path.join(root, 'linkdir'), 'dir');
    } catch {
      return; // symlinks need privileges on Windows; covered on Linux CI/containers
    }
    await expect(resolveInside(root, '/link.txt')).rejects.toMatchObject({ code: 'DRIVE_PATH_INVALID' });
    await expect(resolveInside(root, '/linkdir/secret.txt')).rejects.toMatchObject({ code: 'DRIVE_PATH_INVALID' });
    await expect(resolveInside(root, '/linkdir/new.txt', false)).rejects.toMatchObject({ code: 'DRIVE_PATH_INVALID' });
  });
});

describe('inlineType', () => {
  it('never serves active content inline', () => {
    expect(inlineType('x.html')).toBe('text/plain; charset=utf-8');
    expect(inlineType('x.svg')).toBe('text/plain; charset=utf-8');
    expect(inlineType('x.png')).toBe('image/png');
    expect(inlineType('x.md')).toBe('text/plain; charset=utf-8');
    expect(inlineType('x.docx')).toBeNull();
  });
});
