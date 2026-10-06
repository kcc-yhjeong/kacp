#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { MCP_SERVER_PORT } from '@kacp/shared';
import { scaffold } from './create.js';
import { packDir } from './pack.js';
import { validateDir } from './validate.js';

const HELP = `create-platform-mcp — KACP 마켓용 MCP 서버 도구

사용법:
  create-platform-mcp create <폴더> [--name <이름>] [--display-name <표시 이름>]
      템플릿으로 새 MCP 프로젝트를 만들어요. 이름을 안 주면 폴더 이름을 써요.
  create-platform-mcp validate [폴더]
      platform-plugin.yaml과 프로젝트 구조를 업로드 때와 같은 규칙으로 검사해요.
  create-platform-mcp pack [폴더]
      검사 후 <이름>-<버전>.zip을 만들어요(node_modules·dist·.git·.env*·*.zip 제외, 50MB 이하).
  create-platform-mcp dev [폴더]
      로컬에서 서버를 켜요(파일을 고치면 다시 시작). 먼저 npm install이 필요해요.

옵션:
  -h, --help   이 도움말
`;

async function validate(dir: string) {
  const { manifest, problems } = await validateDir(dir);
  if (problems.length) {
    console.error(`문제 ${problems.length}개를 찾았어요:`);
    for (const p of problems) console.error(`  - ${p}`);
    return null;
  }
  console.log(`검사 통과: ${manifest!.name}@${manifest!.version}`);
  return manifest;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { name: { type: 'string' }, 'display-name': { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });
  const [cmd, target] = positionals;
  if (values.help || !cmd) {
    console.log(HELP);
    return values.help ? 0 : 1;
  }
  const dir = path.resolve(target ?? '.');

  switch (cmd) {
    case 'create': {
      if (!target) {
        console.error('만들 폴더를 적어 주세요. 예: create-platform-mcp create my-mcp');
        return 1;
      }
      const name = values.name ?? path.basename(dir);
      await scaffold(dir, name, values['display-name'] ?? name);
      console.log(`${dir}에 ${name}을(를) 만들었어요.\n\n  cd ${target}\n  npm install\n  npm run dev\n`);
      return 0;
    }
    case 'validate':
      return (await validate(dir)) ? 0 : 1;
    case 'pack': {
      const manifest = await validate(dir);
      if (!manifest) return 1;
      const r = await packDir(dir, manifest.name, manifest.version);
      console.log(`${r.file} (${r.files.length}개 파일, ${(r.bytes / 1024).toFixed(1)}KB)`);
      console.log('KACP 웹의 마켓 → 내 배포에서 이 파일을 올리세요.');
      return 0;
    }
    case 'dev': {
      if (!existsSync(path.join(dir, 'node_modules'))) {
        console.error('node_modules가 없어요. 먼저 npm install을 실행하세요.');
        return 1;
      }
      const port = process.env.PORT ?? String(MCP_SERVER_PORT);
      console.log(`MCP 주소: http://localhost:${port}/mcp`);
      console.log('확인하려면 다른 터미널에서: npx @modelcontextprotocol/inspector  (Transport: Streamable HTTP)\n');
      const child = spawn('npx tsx watch src/server.ts', { cwd: dir, stdio: 'inherit', shell: true, env: { ...process.env, PORT: port } });
      return await new Promise<number>((resolve) => child.on('exit', (code) => resolve(code ?? 0)));
    }
    default:
      console.error(`알 수 없는 명령이에요: ${cmd}\n`);
      console.log(HELP);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
