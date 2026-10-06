import { z } from 'zod';
import { callApi } from '../api.js';
import { defineTool } from './types.js';

export default defineTool({
  name: 'deploy_app',
  title: '공개 요청',
  description:
    '앱을 회사 전체에 공개해 달라고(이미 공개 중이면 공개본을 지금 작업본 내용으로 갱신해 달라고) 관리자에게 요청해요. ' +
    '승인 전에는 공개본이 바뀌지 않아요. 앱마다 검토 중인 요청은 하나만 둘 수 있어요.',
  input: {
    app: z.string().describe('앱 이름 또는 id'),
    reason: z.string().describe('공개 이유(첫 공개) 또는 변경 내용(업데이트)'),
    name: z.string().optional().describe('첫 공개일 때 공개 주소 이름(생략하면 앱 이름)'),
  },
  run: (token, args) => callApi(token, 'POST', '/internal/mcp/apps/deploy', args),
});
