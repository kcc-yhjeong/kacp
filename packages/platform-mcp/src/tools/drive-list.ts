import { z } from 'zod';
import { callApi, qs } from '../api.js';
import { defineTool } from './types.js';

export default defineTool({
  name: 'drive_list',
  title: '팀 드라이브 목록',
  description: '팀 공유 드라이브의 폴더 내용을 보여줘요(개인 "내 드라이브"는 볼 수 없어요).',
  input: { path: z.string().default('/').describe('폴더 경로, 예: / 또는 /보고서') },
  run: (token, args) => callApi(token, 'GET', `/internal/mcp/drive/list?${qs({ path: String(args.path ?? '/') })}`),
});
