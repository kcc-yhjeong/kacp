import { z } from 'zod';
import { defineTool } from '../platform/tool.js';

export default defineTool({
  name: 'hello',
  title: '인사하기',
  description: '이름을 받아 인사말을 돌려줘요.',
  input: { name: z.string().min(1).describe('인사할 사람 이름') },
  run: ({ name }) => `안녕하세요, ${name} 님!`,
});
