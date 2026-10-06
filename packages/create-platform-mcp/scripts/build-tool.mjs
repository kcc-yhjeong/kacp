// Builds the downloadable CLI (docs/README.md 7단계 "스캐폴딩 배포"):
//   node scripts/build-tool.mjs <out-dir>   [env TOOL_URL=https://app.kacp.cloud/tools/create-platform-mcp.tgz]
// → <out-dir>/create-platform-mcp.tgz, a self-contained npm package (every dependency bundled, so it
// installs from the platform without a registry): `npx <TOOL_URL> create my-mcp`.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.resolve(process.argv[2] ?? path.join(root, 'tool-dist'));
const stage = path.join(root, '.tool-stage');
const own = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

await rm(stage, { recursive: true, force: true });
await mkdir(path.join(stage, 'dist'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/cli.ts')],
  outfile: path.join(stage, 'dist/cli.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // CJS dependencies (yazl) call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __kacpRequire } from 'node:module'; const require = __kacpRequire(import.meta.url);" },
  // `#!/usr/bin/env node` comes from src/cli.ts and is kept by esbuild.
  logLevel: 'warning',
});

// Same layout as the workspace package: dist/cli.js finds ../template and ../platform.
await cp(path.join(root, 'template'), path.join(stage, 'template'), { recursive: true });
await cp(path.join(root, 'platform'), path.join(stage, 'platform'), { recursive: true });
// npm never packs files named .gitignore; scaffold() renames it back.
if (existsSync(path.join(stage, 'template/.gitignore'))) {
  await rename(path.join(stage, 'template/.gitignore'), path.join(stage, 'template/gitignore'));
}
// Where this tool is served from: scaffolded projects install it as a devDependency.
if (process.env.TOOL_URL) await writeFile(path.join(stage, 'tool.json'), JSON.stringify({ url: process.env.TOOL_URL }));

await writeFile(path.join(stage, 'package.json'), JSON.stringify({
  name: 'create-platform-mcp',
  version: own.version === '0.0.0' ? '1.0.0' : own.version,
  description: 'KACP 마켓용 MCP 서버 만들기·검사·패키징 도구',
  type: 'module',
  bin: { 'create-platform-mcp': 'dist/cli.js' },
  files: ['dist', 'template', 'platform', 'tool.json'],
  engines: { node: '>=22' },
}, null, 2));

await mkdir(out, { recursive: true });
const tgz = execFileSync('npm', ['pack', '--silent', '--pack-destination', out], { cwd: stage, shell: process.platform === 'win32' }).toString().trim().split('\n').pop();
await rename(path.join(out, tgz), path.join(out, 'create-platform-mcp.tgz'));
await rm(stage, { recursive: true, force: true });
console.log(`built ${path.join(out, 'create-platform-mcp.tgz')}${process.env.TOOL_URL ? ` (tool url ${process.env.TOOL_URL})` : ''}`);
