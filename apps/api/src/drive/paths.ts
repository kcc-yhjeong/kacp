import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from '../lib/errors.js';

// Drive path rules (04-api.md §2 드라이브, docs/README.md 4단계 결정): `path` is relative to the space
// root, starts with `/`, no `..`, no NUL. Every filesystem access goes through `resolveInside`, which
// refuses anything whose real path leaves the root and never follows symbolic links.

const MAX_NAME = 255;
const MAX_PATH = 4096;

/** Normalises an API path to `/a/b` form (root = `/`). Throws DRIVE_PATH_INVALID. */
export function normalizePath(input: string | undefined): string {
  const raw = input ?? '/';
  if (raw.length > MAX_PATH || raw.includes('\0') || raw.includes('\\')) throw invalid();
  const parts = raw.split('/').filter((p) => p !== '' && p !== '.');
  for (const p of parts) if (p === '..' || p.length > MAX_NAME) throw invalid();
  return `/${parts.join('/')}`;
}

/** A single new name (rename, folder, upload): no separators, not `.`/`..`, no control chars. */
export function checkName(name: string): string {
  const n = name.trim();
  // eslint-disable-next-line no-control-regex
  if (!n || n === '.' || n === '..' || n.length > MAX_NAME || /[/\\\0\x01-\x1f]/.test(n)) throw invalid();
  return n;
}

export const joinPath = (dir: string, name: string) => (dir === '/' ? `/${name}` : `${dir}/${name}`);
export const parentOf = (p: string) => (p === '/' ? '/' : p.slice(0, p.lastIndexOf('/')) || '/');
export const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** `a.txt` → `a (1).txt`, `a (1).txt` → `a (2).txt`, `folder` → `folder (1)`. */
export function nextFreeName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0;
  const stem = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : '';
  const base = stem.replace(/ \(\d+\)$/, '');
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken(candidate)) return candidate;
  }
  throw new ApiError(409, 'DRIVE_EXISTS');
}

function invalid() {
  return new ApiError(400, 'DRIVE_PATH_INVALID');
}

/**
 * Maps an API path to an absolute filesystem path inside `root`.
 * - `mustExist`: the target must exist and must not be a symbolic link.
 * - otherwise: the parent must exist (real path inside root); the target may be missing.
 */
export async function resolveInside(root: string, apiPath: string, mustExist = true): Promise<string> {
  const rel = normalizePath(apiPath);
  const abs = path.join(root, rel);
  const realRoot = await realpath(root);
  const checkInside = (p: string) => {
    if (p !== realRoot && !p.startsWith(realRoot + path.sep)) throw invalid();
  };
  if (mustExist) {
    const st = await lstat(abs).catch(() => null);
    if (!st) throw new ApiError(404, 'DRIVE_NOT_FOUND');
    if (st.isSymbolicLink()) throw invalid();
    checkInside(await realpath(abs));
  } else {
    const parent = await realpath(path.dirname(abs)).catch(() => null);
    if (!parent) throw new ApiError(404, 'DRIVE_NOT_FOUND');
    checkInside(parent);
    const st = await lstat(abs).catch(() => null);
    if (st?.isSymbolicLink()) throw invalid();
  }
  return abs;
}

// Preview / download content types by extension (U-05 미리보기).
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', ts: 'text/plain', py: 'text/x-python',
  xml: 'application/xml', yaml: 'text/yaml', yml: 'text/yaml', log: 'text/plain', sh: 'text/plain', sql: 'text/plain',
  zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp4: 'video/mp4', mp3: 'audio/mpeg',
};
export const mimeOf = (name: string) => MIME[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';

/**
 * Types that may be served inline. HTML and SVG can run script in the app origin, so they are
 * always served as text/plain or as attachments.
 */
export function inlineType(name: string): string | null {
  const m = mimeOf(name);
  if (m === 'text/html' || m === 'image/svg+xml') return 'text/plain; charset=utf-8';
  if (m.startsWith('image/') || m === 'application/pdf') return m;
  if (m.startsWith('text/') || m === 'application/json' || m === 'application/xml') return `${m === 'text/markdown' ? 'text/plain' : m}; charset=utf-8`;
  return null;
}
