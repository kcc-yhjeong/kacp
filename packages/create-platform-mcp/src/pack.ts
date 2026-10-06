import { createWriteStream } from 'node:fs';
import { lstat, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { MCP_PACKAGE_MAX_BYTES } from '@kacp/shared';
import yazl from 'yazl';

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.git']);

/** Whether a project-relative path (posix separators) goes into the package zip. */
export function isPackable(relPath: string): boolean {
  const parts = relPath.split('/');
  if (parts.some((p) => EXCLUDED_DIRS.has(p))) return false;
  const base = parts[parts.length - 1] ?? '';
  return !base.startsWith('.env') && !base.toLowerCase().endsWith('.zip');
}

/** Packable regular files under `dir` (symlinks skipped), as sorted posix relative paths. */
export async function listPackFiles(dir: string): Promise<{ rel: string; size: number }[]> {
  const out: { rel: string; size: number }[] = [];
  const walk = async (abs: string, rel: string) => {
    for (const e of await readdir(abs)) {
      const r = rel ? `${rel}/${e}` : e;
      if (!isPackable(r)) continue;
      const st = await lstat(path.join(abs, e));
      if (st.isDirectory()) await walk(path.join(abs, e), r);
      else if (st.isFile()) out.push({ rel: r, size: st.size });
    }
  };
  await walk(dir, '');
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;

/** Writes `<name>-<version>.zip` into `dir` with the project files at the zip root. */
export async function packDir(dir: string, name: string, version: string): Promise<{ file: string; files: string[]; bytes: number }> {
  const files = await listPackFiles(dir);
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MCP_PACKAGE_MAX_BYTES) throw new Error(`파일이 너무 커요: ${mb(total)} (최대 ${mb(MCP_PACKAGE_MAX_BYTES)}).`);

  const file = path.join(dir, `${name}-${version}.zip`);
  const zip = new yazl.ZipFile();
  for (const f of files) zip.addFile(path.join(dir, f.rel), f.rel);
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(file));

  const bytes = (await stat(file)).size;
  if (bytes > MCP_PACKAGE_MAX_BYTES) {
    await rm(file, { force: true });
    throw new Error(`zip이 너무 커요: ${mb(bytes)} (최대 ${mb(MCP_PACKAGE_MAX_BYTES)}).`);
  }
  return { file, files: files.map((f) => f.rel), bytes };
}
