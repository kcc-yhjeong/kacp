import { z } from 'zod';
import { callApi } from '../api.js';
import { defineTool } from './types.js';

export default defineTool({
  name: 'run_app',
  title: '웹 앱 실행',
  description:
    '팀 공유 드라이브의 앱 폴더를 웹 앱(작업본)으로 실행하고 팀원만 열 수 있는 주소를 돌려줘요. ' +
    '같은 폴더로 다시 부르면 새 앱이 아니라 작업본을 다시 시작해요. 서버는 0.0.0.0과 PORT 환경변수에서 들어야 해요. ' +
    '데이터는 APP_DATA_DIR(/app-data)에 저장해요.',
  input: {
    folder: z.string().describe('팀 공유 드라이브 안 앱 폴더, 예: /lunch-vote (또는 /team-drive/lunch-vote)'),
    port: z.number().int().min(1024).max(65535).describe('앱이 듣는 포트, 예: 3000'),
    command: z.string().optional().describe('실행 명령(생략하면 package.json start, server.js, app.py, index.html로 판단)'),
    runtime: z.enum(['node', 'python', 'static']).optional().describe('런타임(생략하면 자동 판별)'),
    name: z.string().optional().describe('앱 이름(영문 소문자·숫자·하이픈, 생략하면 폴더 이름)'),
  },
  run: (token, args) => callApi(token, 'POST', '/internal/mcp/apps/run', args),
});
