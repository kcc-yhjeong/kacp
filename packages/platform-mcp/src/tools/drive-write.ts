import { z } from 'zod';
import { callApi } from '../api.js';
import { defineTool } from './types.js';

export default defineTool({
  name: 'drive_write',
  title: '팀 드라이브에 저장',
  description: '팀 공유 드라이브에 텍스트 파일을 저장해요(없는 폴더는 만들어요). 저장한 사람은 "에이전트 · 팀"으로 기록돼요.',
  input: {
    path: z.string().describe('저장할 경로, 예: /보고서/주간.md'),
    content: z.string().describe('파일 내용(텍스트)'),
  },
  run: (token, args) => callApi(token, 'POST', '/internal/mcp/drive/write', args),
});
