import { z } from 'zod';
import { callApi } from '../api.js';
import { defineTool } from './types.js';

export default defineTool({
  name: 'stop_app',
  title: '웹 앱 중지',
  description: '실행 중인 작업본을 멈춰요. 공개본은 건드리지 않아요.',
  input: { app: z.string().describe('앱 이름 또는 id') },
  run: (token, args) => callApi(token, 'POST', '/internal/mcp/apps/stop', args),
});
