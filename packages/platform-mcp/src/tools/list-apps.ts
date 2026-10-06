import { callApi } from '../api.js';
import { defineTool } from './types.js';

export default defineTool({
  name: 'list_apps',
  title: '팀 앱 목록',
  description: '이 팀의 웹 앱과 작업본·공개본 상태, 주소를 보여줘요.',
  input: {},
  run: (token) => callApi(token, 'GET', '/internal/mcp/apps'),
});
