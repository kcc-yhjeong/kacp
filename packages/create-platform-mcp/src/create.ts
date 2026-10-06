import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAME_PATTERN } from '@kacp/shared';
import { isPackable } from './pack.js';

/** Same relative path from src/ (tests, tsx) and dist/ (built CLI). */
export const TEMPLATE_DIR = fileURLToPath(new URL('../template', import.meta.url));

const TEMPLATE_NAME = 'example-mcp';

/** Pure substitution of the template's name and display name in one file's text. */
export function fillTemplate(rel: string, text: string, name: string, displayName: string): string {
  switch (rel) {
    case 'package.json': {
      const pkg = JSON.parse(text) as Record<string, unknown>;
      return `${JSON.stringify({ ...pkg, name }, null, 2)}\n`;
    }
    case 'platform-plugin.yaml':
      return text
        .replace(/^name: .*$/m, `name: ${name}`)
        .replace(/^displayName: .*$/m, `displayName: ${JSON.stringify(displayName)}`);
    case 'README.md':
      return text.replace(/^# .*$/m, `# ${displayName}`).replaceAll(TEMPLATE_NAME, name);
    default:
      return text;
  }
}

export function checkPackageName(name: string): string | null {
  return NAME_PATTERN.test(name) ? null : `이름 "${name}"은(는) 쓸 수 없어요. 소문자·숫자·하이픈 3~30자, --는 안 돼요.`;
}

/** Copies the template into `dir` (must be missing or empty) and fills in the names. */
export async function scaffold(dir: string, name: string, displayName = name): Promise<void> {
  const problem = checkPackageName(name);
  if (problem) throw new Error(problem);
  const existing = await readdir(dir).catch(() => []);
  if (existing.length) throw new Error(`${dir} 폴더가 비어 있지 않아요.`);

  await cp(TEMPLATE_DIR, dir, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(TEMPLATE_DIR, src).split(path.sep).join('/');
      return rel === '' || isPackable(rel);
    },
  });
  for (const rel of ['package.json', 'platform-plugin.yaml', 'README.md']) {
    const file = path.join(dir, rel);
    await writeFile(file, fillTemplate(rel, await readFile(file, 'utf8'), name, displayName));
  }
}
