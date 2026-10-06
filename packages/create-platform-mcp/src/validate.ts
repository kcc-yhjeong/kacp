import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { MCP_PACKAGE_REQUIRED_FILES, manifestProblems, type McpManifest } from '@kacp/shared';
import { parse as parseYaml } from 'yaml';

export const MANIFEST_FILE = 'platform-plugin.yaml';

export interface ValidateResult {
  manifest: McpManifest | null;
  problems: string[];
}

const exists = (p: string) => stat(p).then(() => true, () => false);
const isDir = (p: string) => stat(p).then((s) => s.isDirectory(), () => false);

/** Same manifest rules as the api upload check, plus the package layout the platform build needs. */
export async function validateDir(dir: string): Promise<ValidateResult> {
  const problems: string[] = [];
  for (const f of MCP_PACKAGE_REQUIRED_FILES) {
    if (!(await exists(path.join(dir, f)))) problems.push(`${f}: 파일이 없어요.`);
  }
  if (!(await isDir(path.join(dir, 'src', 'tools')))) problems.push('src/tools/: 폴더가 없어요. 도구는 src/tools/에 파일 하나씩 둬요.');

  let manifest: McpManifest | null = null;
  const yamlText = await readFile(path.join(dir, MANIFEST_FILE), 'utf8').catch(() => null);
  if (yamlText !== null) {
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

  const pkgText = await readFile(path.join(dir, 'package.json'), 'utf8').catch(() => null);
  if (pkgText !== null) {
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
  return { manifest: problems.length ? null : manifest, problems };
}
