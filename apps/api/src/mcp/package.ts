import yauzl from 'yauzl';
import { parse as parseYaml } from 'yaml';
import { MCP_PACKAGE_REQUIRED_FILES, manifestProblems, platformSecretsProblem, type McpManifest } from '@kacp/shared';

// Upload check for MCP package zips (docs/README.md 6단계). Same rules and wording as
// `create-platform-mcp validate`, plus zip safety (paths, symlinks, size).

export const MANIFEST_FILE = 'platform-plugin.yaml';
const MAX_ENTRIES = 5000;
const MAX_UNPACKED = 200 * 1024 * 1024;
/** Never needed by the platform build; skipped if someone zipped them anyway. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

export interface PackageFile { path: string; data: Buffer }
export type ReadResult =
  | { ok: true; manifest: McpManifest; readme: string; files: PackageFile[] }
  | { ok: false; problems: string[] };

/** Rejects absolute paths, `..`, backslashes and control characters. */
export function safeEntryPath(name: string): boolean {
  if (!name || name.startsWith('/') || name.includes('\\') || /[\u0000-\u001f]/.test(name)) return false;
  return !name.split('/').some((s) => s === '..' || s === '.');
}

function unzip(buf: Buffer): Promise<{ files: PackageFile[]; problems: string[] }> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('zip'));
      const files: PackageFile[] = [];
      const problems: string[] = [];
      let count = 0;
      let total = 0;
      zip.on('error', reject);
      zip.on('end', () => resolve({ files, problems }));
      zip.on('entry', (e: yauzl.Entry) => {
        count++;
        const name = e.fileName;
        const mode = (e.externalFileAttributes >>> 16) & 0o170000;
        if (count > MAX_ENTRIES) {
          problems.push(`zip: 파일이 너무 많아요(${MAX_ENTRIES}개까지).`);
          zip.close();
          return resolve({ files, problems });
        }
        if (!safeEntryPath(name.replace(/\/$/, ''))) {
          problems.push(`zip: 쓸 수 없는 경로예요 (${name}).`);
          return zip.readEntry();
        }
        if (mode === 0o120000) {
          problems.push(`zip: 심볼릭 링크는 쓸 수 없어요 (${name}).`);
          return zip.readEntry();
        }
        if (name.endsWith('/') || name.split('/').some((s) => SKIP_DIRS.has(s))) return zip.readEntry();
        total += e.uncompressedSize;
        if (total > MAX_UNPACKED) {
          problems.push('zip: 압축을 푼 크기가 200MB를 넘어요.');
          zip.close();
          return resolve({ files, problems });
        }
        zip.openReadStream(e, (rerr, stream) => {
          if (rerr || !stream) return reject(rerr ?? new Error('read'));
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('error', reject);
          stream.on('end', () => {
            files.push({ path: name, data: Buffer.concat(chunks) });
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

/** A zip made by "compress folder" has one top folder around the package; strip it. */
export function stripWrapper(files: PackageFile[]): PackageFile[] {
  if (files.some((f) => f.path === MANIFEST_FILE)) return files;
  const tops = new Set(files.map((f) => f.path.split('/')[0]));
  if (tops.size !== 1) return files;
  const top = [...tops][0]!;
  if (!files.some((f) => f.path === `${top}/${MANIFEST_FILE}`)) return files;
  return files.map((f) => ({ ...f, path: f.path.slice(top.length + 1) })).filter((f) => f.path);
}

/** Layout + manifest rules over already-unpacked files (pure; shared wording with the CLI). */
export function checkPackage(files: PackageFile[]): ReadResult {
  const problems: string[] = [];
  const byPath = new Map(files.map((f) => [f.path, f.data]));
  for (const f of MCP_PACKAGE_REQUIRED_FILES) if (!byPath.has(f)) problems.push(`${f}: 파일이 없어요.`);
  if (!files.some((f) => f.path.startsWith('src/tools/'))) problems.push('src/tools/: 폴더가 없어요. 도구는 src/tools/에 파일 하나씩 둬요.');

  let manifest: McpManifest | null = null;
  const yamlText = byPath.get(MANIFEST_FILE)?.toString('utf8');
  if (yamlText !== undefined) {
    let raw: unknown;
    try {
      raw = parseYaml(yamlText);
    } catch (err) {
      problems.push(`${MANIFEST_FILE}: YAML 형식이 잘못됐어요 (${err instanceof Error ? err.message.split('\n')[0] : String(err)})`);
    }
    if (raw !== undefined) {
      const r = manifestProblems(raw);
      manifest = r.manifest;
      problems.push(...r.problems.map((p) => `${MANIFEST_FILE} ${p}`));
    }
  }
  const oldPlatform = manifest && platformSecretsProblem(manifest, byPath.get('src/platform/secrets.ts')?.toString('utf8') ?? null);
  if (oldPlatform) problems.push(oldPlatform);
  if (manifest && ['platform', 'platform-mcp'].includes(manifest.name)) problems.push(`${MANIFEST_FILE} name: ${manifest.name}은 플랫폼이 쓰는 이름이에요.`);

  const pkgText = byPath.get('package.json')?.toString('utf8');
  if (pkgText !== undefined) {
    let pkg: { name?: unknown; version?: unknown; scripts?: Record<string, unknown> } | null = null;
    try {
      pkg = JSON.parse(pkgText);
    } catch {
      problems.push('package.json: JSON 형식이 잘못됐어요.');
    }
    if (pkg) {
      if (manifest && pkg.name !== manifest.name) problems.push(`package.json name(${String(pkg.name)})이 매니페스트 name(${manifest.name})과 달라요.`);
      if (manifest && pkg.version !== manifest.version) problems.push(`package.json version(${String(pkg.version)})이 매니페스트 version(${manifest.version})과 달라요.`);
      for (const s of ['build', 'start'] as const) {
        if (typeof pkg.scripts?.[s] !== 'string') problems.push(`package.json: scripts.${s}가 없어요. 플랫폼은 npm run build 후 node dist/server.js로 실행해요.`);
      }
    }
  }
  if (problems.length || !manifest) return { ok: false, problems: problems.length ? problems : ['패키지를 읽지 못했어요.'] };
  return { ok: true, manifest, readme: byPath.get('README.md')!.toString('utf8').slice(0, 200_000), files };
}

export async function readPackage(buf: Buffer): Promise<ReadResult> {
  let unpacked: { files: PackageFile[]; problems: string[] };
  try {
    unpacked = await unzip(buf);
  } catch {
    return { ok: false, problems: ['zip: 압축 파일을 읽지 못했어요. create-platform-mcp pack으로 만든 zip을 올리세요.'] };
  }
  if (unpacked.problems.length) return { ok: false, problems: unpacked.problems };
  return checkPackage(stripWrapper(unpacked.files));
}
