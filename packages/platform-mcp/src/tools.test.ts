import { describe, expect, it } from 'vitest';
import { tools } from './tools/index.js';

describe('platform-mcp tools', () => {
  it('registers the seven v1 tools with unique names and Korean descriptions', () => {
    const names = tools.map((t) => t.name);
    expect(names.sort()).toEqual(['deploy_app', 'drive_list', 'drive_read', 'drive_write', 'list_apps', 'run_app', 'stop_app']);
    for (const t of tools) expect(/[가-힣]/.test(t.description)).toBe(true);
  });
});
