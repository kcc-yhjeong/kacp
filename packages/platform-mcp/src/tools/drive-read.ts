import { z } from 'zod';
import { callApi, qs } from '../api.js';
import { defineTool } from './types.js';

export default defineTool({
  name: 'drive_read',
  title: '팀 드라이브 파일 읽기',
  description: '팀 공유 드라이브의 파일을 읽어요. 텍스트는 내용(최대 1MB), 그 밖의 파일은 크기와 종류만 알려줘요.',
  input: { path: z.string().describe('파일 경로, 예: /회의록.md') },
  run: (token, args) => callApi(token, 'GET', `/internal/mcp/drive/read?${qs({ path: String(args.path) })}`),
});
