import type { DriveSpace } from './types';

// Drive paths are relative to the space root: `/` is the root, folders have no trailing slash.

export const SPACE_LABEL: Record<DriveSpace, string> = { me: '내 드라이브', shared: '팀 공유' };

/** `/a//b/` → `/a/b`, `` → `/`. Drops `.` segments; `..` is never produced by the UI and is dropped too. */
export function normalizePath(path: string): string {
  const parts = path.split('/').filter((p) => p !== '' && p !== '.' && p !== '..');
  return parts.length ? `/${parts.join('/')}` : '/';
}

export function splitPath(path: string): string[] {
  return normalizePath(path).split('/').filter(Boolean);
}

export function joinPath(dir: string, ...names: string[]): string {
  return normalizePath([dir, ...names].join('/'));
}

/** Parent folder; the root's parent is the root. */
export function parentPath(path: string): string {
  const parts = splitPath(path);
  return parts.length <= 1 ? '/' : `/${parts.slice(0, -1).join('/')}`;
}

export function baseName(path: string): string {
  const parts = splitPath(path);
  return parts[parts.length - 1] ?? '';
}

/** True when `path` is `ancestor` itself or inside it. */
export function isSameOrInside(path: string, ancestor: string): boolean {
  const p = normalizePath(path);
  const a = normalizePath(ancestor);
  return a === '/' || p === a || p.startsWith(`${a}/`);
}

export interface PathCrumb {
  label: string;
  path: string;
}

/** Breadcrumb from the space root: [{내 드라이브, /}, {보고서, /보고서}, …]. */
export function breadcrumb(space: DriveSpace, path: string): PathCrumb[] {
  const parts = splitPath(path);
  return [
    { label: SPACE_LABEL[space], path: '/' },
    ...parts.map((label, i) => ({ label, path: `/${parts.slice(0, i + 1).join('/')}` })),
  ];
}

/** Human location of a folder: `/팀 공유/캠페인 보고서` (U-05 위치, U-06 원래 위치). */
export function displayLocation(space: DriveSpace, folder: string): string {
  const parts = splitPath(folder);
  return `/${[SPACE_LABEL[space], ...parts].join('/')}`;
}

/** Route splat → space + folder path. `trash` is the U-06 page. Unknown or empty → null. */
export type DriveLocation = { kind: 'folder'; space: DriveSpace; path: string } | { kind: 'trash' };

export function parseDriveSplat(splat: string | undefined): DriveLocation | null {
  const parts = (splat ?? '').split('/').filter(Boolean);
  const head = parts[0];
  if (head === 'trash' && parts.length === 1) return { kind: 'trash' };
  if (head !== 'me' && head !== 'shared') return null;
  return { kind: 'folder', space: head, path: parts.length > 1 ? `/${parts.slice(1).join('/')}` : '/' };
}

/** Route splat for a folder (`shared/보고서/2026`). */
export function driveSplat(space: DriveSpace, path: string): string {
  const parts = splitPath(path);
  return [space, ...parts].join('/');
}

/** `name.ext` → [`name`, `.ext`]. Dotfiles and names without an extension have an empty ext. */
export function splitExt(name: string): [string, string] {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return [name, ''];
  return [name.slice(0, i), name.slice(i)];
}

/** Client check before rename/new folder; the API is the authority (DRIVE_PATH_INVALID). */
export function nameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return '이름을 입력하세요.';
  if (n === '.' || n === '..') return '쓸 수 없는 이름이에요.';
  if (/[/\\\0]/.test(n)) return '이름에 / 와 \\ 는 쓸 수 없어요.';
  if (n.length > 255) return '이름이 너무 길어요.';
  return null;
}

/** "새 폴더", or "새 폴더 (n)" when that name is already in the folder. */
export function freeFolderName(existing: string[], base = '새 폴더'): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let i = 1; ; i++) if (!taken.has(`${base} (${i})`)) return `${base} (${i})`;
}
