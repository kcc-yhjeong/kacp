import { describe, expect, it } from 'vitest';
import { flattenEntries, sourcesFromInput, type DropEntry } from './dnd';
import { fileIconKind, previewKind, typeLabel } from './file-type';
import { historyLabel, sortHistory } from './labels';
import { daysLeft, daysLeftLabel, formatSize, usageLevel, usagePct } from './format';
import {
  baseName,
  breadcrumb,
  displayLocation,
  driveSplat,
  isSameOrInside,
  joinPath,
  nameProblem,
  normalizePath,
  parentPath,
  parseDriveSplat,
  splitExt,
} from './path';

describe('drive paths', () => {
  it('normalizes', () => {
    expect(normalizePath('')).toBe('/');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('a//b/')).toBe('/a/b');
    expect(normalizePath('/a/./../b')).toBe('/a/b');
  });
  it('joins', () => {
    expect(joinPath('/', 'a')).toBe('/a');
    expect(joinPath('/a', 'b c', 'd.md')).toBe('/a/b c/d.md');
    expect(joinPath('/a/', '/b/')).toBe('/a/b');
  });
  it('finds parent and base name', () => {
    expect(parentPath('/')).toBe('/');
    expect(parentPath('/a')).toBe('/');
    expect(parentPath('/a/b/c.txt')).toBe('/a/b');
    expect(baseName('/a/b/c.txt')).toBe('c.txt');
    expect(baseName('/')).toBe('');
  });
  it('checks containment', () => {
    expect(isSameOrInside('/a/b', '/a')).toBe(true);
    expect(isSameOrInside('/a', '/a')).toBe(true);
    expect(isSameOrInside('/ab', '/a')).toBe(false);
    expect(isSameOrInside('/x', '/')).toBe(true);
  });
  it('splits a breadcrumb from the space root', () => {
    expect(breadcrumb('shared', '/')).toEqual([{ label: '팀 공유', path: '/' }]);
    expect(breadcrumb('me', '/보고서/2026')).toEqual([
      { label: '내 드라이브', path: '/' },
      { label: '보고서', path: '/보고서' },
      { label: '2026', path: '/보고서/2026' },
    ]);
    expect(displayLocation('shared', '/캠페인 보고서')).toBe('/팀 공유/캠페인 보고서');
    expect(displayLocation('me', '/')).toBe('/내 드라이브');
  });
  it('parses and builds route splats', () => {
    expect(parseDriveSplat('shared')).toEqual({ kind: 'folder', space: 'shared', path: '/' });
    expect(parseDriveSplat('me/보고서/2026/')).toEqual({ kind: 'folder', space: 'me', path: '/보고서/2026' });
    expect(parseDriveSplat('trash')).toEqual({ kind: 'trash' });
    expect(parseDriveSplat('')).toBeNull();
    expect(parseDriveSplat('other/x')).toBeNull();
    expect(driveSplat('shared', '/')).toBe('shared');
    expect(driveSplat('me', '/a/b')).toBe('me/a/b');
  });
  it('splits extensions', () => {
    expect(splitExt('a.tar.gz')).toEqual(['a.tar', '.gz']);
    expect(splitExt('.env')).toEqual(['.env', '']);
    expect(splitExt('README')).toEqual(['README', '']);
  });
  it('validates names', () => {
    expect(nameProblem('')).not.toBeNull();
    expect(nameProblem('a/b')).not.toBeNull();
    expect(nameProblem('..')).not.toBeNull();
    expect(nameProblem('보고서 v2.md')).toBeNull();
  });
});

describe('formatSize', () => {
  it('auto-scales with one decimal', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(4300)).toBe('4.2 KB');
    expect(formatSize(2.4 * 1024 * 1024)).toBe('2.4 MB');
    expect(formatSize(12.4 * 1024 ** 3)).toBe('12.4 GB');
    expect(formatSize(20 * 1024 ** 3)).toBe('20 GB');
    expect(formatSize(1024 * 1024 - 1)).toBe('1 MB');
    expect(formatSize(null)).toBe('—');
  });
});

describe('usage', () => {
  it('colors only from 80% and 95%', () => {
    const gb = 1024 ** 3;
    expect(usageLevel(12.4 * gb, 20 * gb)).toBe('normal');
    expect(usageLevel(16 * gb, 20 * gb)).toBe('warn');
    expect(usageLevel(19 * gb, 20 * gb)).toBe('danger');
    expect(usageLevel(1, 0)).toBe('normal');
    expect(usagePct(30, 20)).toBe(100);
  });
});

describe('daysLeft', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  it('rounds up and never goes negative', () => {
    expect(daysLeft('2026-11-01T12:00:00Z', now)).toBe(30);
    expect(daysLeft('2026-10-05T11:00:00Z', now)).toBe(3);
    expect(daysLeft('2026-10-02T13:00:00Z', now)).toBe(1);
    expect(daysLeft('2026-10-01T00:00:00Z', now)).toBe(0);
    expect(daysLeft('nope', now)).toBe(0);
    expect(daysLeftLabel(0)).toBe('오늘');
    expect(daysLeftLabel(3)).toBe('3일');
  });
});

describe('file types', () => {
  it('maps to a preview kind', () => {
    expect(previewKind('a.PNG')).toBe('image');
    expect(previewKind('photo', 'image/jpeg')).toBe('image');
    expect(previewKind('doc.pdf')).toBe('pdf');
    expect(previewKind('notes.md')).toBe('text');
    expect(previewKind('clean_data.py')).toBe('text');
    expect(previewKind('Dockerfile')).toBe('text');
    expect(previewKind('data', 'application/json')).toBe('text');
    expect(previewKind('report.docx')).toBe('none');
    expect(previewKind('video.mov', 'video/quicktime')).toBe('none');
  });
  it('maps to an icon and label', () => {
    expect(fileIconKind({ name: 'x', isDir: true })).toBe('folder');
    expect(fileIconKind({ name: 'a.py', isDir: false })).toBe('code');
    expect(fileIconKind({ name: 'a.md', isDir: false })).toBe('text');
    expect(fileIconKind({ name: 'a.jpg', isDir: false })).toBe('image');
    expect(fileIconKind({ name: 'a.xlsx', isDir: false })).toBe('file');
    expect(typeLabel({ name: 'a.md', isDir: false })).toBe('마크다운');
    expect(typeLabel({ name: 'a.png', isDir: false })).toBe('PNG 이미지');
    expect(typeLabel({ name: 'a', isDir: true })).toBe('폴더');
    expect(typeLabel({ name: 'a.xyz', isDir: false })).toBe('XYZ 파일');
  });
});

describe('drop flattening', () => {
  const file = (name: string): DropEntry => ({ kind: 'file', name, getFile: async () => new File(['x'], name) });
  const dir = (name: string, children: DropEntry[]): DropEntry => ({
    kind: 'dir',
    name,
    readChildren: async () => children,
  });

  it('keeps loose files without a relative path and nests folders', async () => {
    const out = await flattenEntries([
      file('a.txt'),
      dir('photos', [file('1.jpg'), dir('2026', [file('b.jpg')]), dir('empty', [])]),
    ]);
    expect(out.map((s) => [s.file.name, s.relativePath])).toEqual([
      ['a.txt', null],
      ['1.jpg', 'photos/1.jpg'],
      ['b.jpg', 'photos/2026/b.jpg'],
    ]);
  });

  it('skips entries that fail to read', async () => {
    const broken: DropEntry = { kind: 'file', name: 'x', getFile: () => Promise.reject(new Error('no')) };
    const brokenDir: DropEntry = { kind: 'dir', name: 'd', readChildren: () => Promise.reject(new Error('no')) };
    const out = await flattenEntries([broken, brokenDir, file('ok.md')]);
    expect(out.map((s) => s.file.name)).toEqual(['ok.md']);
  });

  it('reads webkitRelativePath from a folder picker', () => {
    const f = new File(['x'], 'a.jpg');
    Object.defineProperty(f, 'webkitRelativePath', { value: 'photos/a.jpg' });
    const g = new File(['y'], 'b.txt');
    expect(sourcesFromInput([f, g]).map((s) => s.relativePath)).toEqual(['photos/a.jpg', null]);
  });
});

describe('history labels', () => {
  const user = { kind: 'user' as const, user: { id: 'u1', name: '김하늘' } };
  const agent = { kind: 'agent' as const, user: null };
  it('words each action in Korean', () => {
    expect(historyLabel({ action: 'create', actor: user, path: '/a.md', prevPath: null })).toBe('업로드');
    expect(historyLabel({ action: 'create', actor: agent, path: '/a.md', prevPath: null })).toBe('에이전트가 새로 저장');
    expect(historyLabel({ action: 'update', actor: agent, path: '/a.md', prevPath: null })).toBe('에이전트가 내용을 고쳐 저장');
    expect(historyLabel({ action: 'rename', actor: user, path: '/r/b.md', prevPath: '/r/a.md' })).toBe('이름 변경 · a.md → b.md');
    expect(historyLabel({ action: 'move', actor: user, path: '/x/a.md', prevPath: '/a.md' })).toBe('이동 · / → /x');
    expect(historyLabel({ action: 'trash', actor: user, path: '/a.md', prevPath: null })).toBe('휴지통으로');
    expect(historyLabel({ action: 'restore', actor: user, path: '/a.md', prevPath: null })).toBe('복원');
    expect(historyLabel({ action: 'weird', actor: user, path: '/a.md', prevPath: null })).toBe('변경');
  });
  it('sorts newest first', () => {
    const out = sortHistory([{ at: '2026-01-01T00:00:00Z' }, { at: '2026-03-01T00:00:00Z' }, { at: '2026-02-01T00:00:00Z' }]);
    expect(out.map((h) => h.at.slice(5, 7))).toEqual(['03', '02', '01']);
  });
});

describe('freeFolderName', () => {
  it('picks the first free default folder name', async () => {
    const { freeFolderName } = await import('./path');
    expect(freeFolderName([])).toBe('새 폴더');
    expect(freeFolderName(['새 폴더', '새 폴더 (1)'])).toBe('새 폴더 (2)');
  });
});
