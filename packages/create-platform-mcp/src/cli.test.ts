import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { fillTemplate, scaffold, TEMPLATE_DIR } from './create.js';
import { isPackable } from './pack.js';
import { validateDir } from './validate.js';

const temps: string[] = [];
async function copyTemplate() {
  const dir = await mkdtemp(path.join(tmpdir(), 'cpm-'));
  temps.push(dir);
  await cp(TEMPLATE_DIR, dir, { recursive: true });
  return dir;
}
afterEach(async () => {
  for (const d of temps.splice(0)) await rm(d, { recursive: true, force: true });
});

describe('validate', () => {
  it('passes on the template', async () => {
    const r = await validateDir(TEMPLATE_DIR);
    expect(r.problems).toEqual([]);
    expect(r.manifest?.name).toBe('example-mcp');
    expect(r.manifest?.secrets.map((s) => [s.name, s.required])).toEqual([['EXAMPLE_API_KEY', true], ['EXAMPLE_LANG', false]]);
  });

  it('reports a missing required file', async () => {
    const dir = await copyTemplate();
    await rm(path.join(dir, 'README.md'));
    expect((await validateDir(dir)).problems).toEqual(['README.md: 파일이 없어요.']);
  });

  it('reports a package.json name mismatch', async () => {
    const dir = await copyTemplate();
    const file = path.join(dir, 'package.json');
    await writeFile(file, (await readFile(file, 'utf8')).replace('"example-mcp"', '"other-mcp"'));
    const { problems, manifest } = await validateDir(dir);
    expect(manifest).toBeNull();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('name(other-mcp)');
  });

  it('rejects a user-scoped secret', async () => {
    const dir = await copyTemplate();
    const file = path.join(dir, 'platform-plugin.yaml');
    await writeFile(file, (await readFile(file, 'utf8')).replace('required: true ', 'scope: user\n    required: true '));
    const { problems } = await validateDir(dir);
    expect(problems.some((p) => p.includes('secrets.0.scope') && p.includes('팀 범위'))).toBe(true);
  });

  it('requires build/start scripts and src/tools', async () => {
    const dir = await copyTemplate();
    const file = path.join(dir, 'package.json');
    const pkg = JSON.parse(await readFile(file, 'utf8'));
    delete pkg.scripts.start;
    await writeFile(file, JSON.stringify(pkg));
    await rm(path.join(dir, 'src', 'tools'), { recursive: true });
    const { problems } = await validateDir(dir);
    expect(problems.some((p) => p.includes('scripts.start'))).toBe(true);
    expect(problems.some((p) => p.startsWith('src/tools/'))).toBe(true);
  });
});

describe('pack exclusion', () => {
  it.each([
    ['package.json', true],
    ['src/tools/hello.ts', true],
    ['.gitignore', true],
    ['node_modules/zod/index.js', false],
    ['dist/server.js', false],
    ['src/dist/x.ts', false],
    ['.git/HEAD', false],
    ['.env', false],
    ['.env.local', false],
    ['config/.env.production', false],
    ['example-mcp-0.1.0.zip', false],
    ['assets/DATA.ZIP', false],
  ])('%s -> %s', (rel, ok) => expect(isPackable(rel)).toBe(ok));
});

describe('scaffold', () => {
  it('substitutes name and displayName', () => {
    const yaml = 'name: example-mcp\nversion: 0.1.0\ndisplayName: 예제 MCP\n';
    expect(parseYaml(fillTemplate('platform-plugin.yaml', yaml, 'notion-tools', '노션: 도구'))).toEqual({
      name: 'notion-tools',
      version: '0.1.0',
      displayName: '노션: 도구',
    });
    expect(JSON.parse(fillTemplate('package.json', '{"name":"example-mcp","version":"0.1.0"}', 'notion-tools', 'x')).name).toBe('notion-tools');
    expect(fillTemplate('README.md', '# 예제 MCP\n\nbody', 'notion-tools', '노션 도구')).toBe('# 노션 도구\n\nbody');
  });

  it('creates a project that validates', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cpm-'));
    temps.push(root);
    const dir = path.join(root, 'my-tools');
    await scaffold(dir, 'my-tools', '내 도구');
    const r = await validateDir(dir);
    expect(r.problems).toEqual([]);
    expect(r.manifest).toMatchObject({ name: 'my-tools', displayName: '내 도구', version: '0.1.0' });
    await expect(scaffold(dir, 'my-tools')).rejects.toThrow('비어 있지 않아요');
    await expect(scaffold(path.join(root, 'x'), 'Bad--Name')).rejects.toThrow('쓸 수 없어요');
  });
});
