import { describe, expect, it } from 'vitest';
import { joinDeny, joinSkills, KNOWN_SKILLS, SKILL_GROUPS, splitDeny, splitSkills, TOOL_BLOCKS, TOOL_IDS } from './agent-catalog';

describe('tool blocks', () => {
  it('round-trips checked blocks and extra entries', () => {
    const deny = joinDeny(['명령·코드 실행', '파일 만들기·고치기'], ['group:memory']);
    expect(deny).toEqual(['group:runtime', 'write', 'edit', 'apply_patch', 'group:memory']);
    expect(splitDeny(deny)).toEqual({ checked: ['명령·코드 실행', '파일 만들기·고치기'], rest: ['group:memory'] });
  });

  it('round-trips every single block', () => {
    for (const b of TOOL_BLOCKS) {
      expect(splitDeny(joinDeny([b.label], []))).toEqual({ checked: [b.label], rest: [] });
    }
  });

  it('keeps a partial block under 고급 and drops duplicates', () => {
    expect(splitDeny(['write', 'exec'])).toEqual({ checked: [], rest: ['write', 'exec'] });
    expect(joinDeny(['웹 검색·가져오기'], ['group:web', 'exec'])).toEqual(['group:web', 'exec']);
    expect(splitDeny([])).toEqual({ checked: [], rest: [] });
  });

  it('only offers tool ids that are not duplicated', () => {
    expect(new Set(TOOL_IDS).size).toBe(TOOL_IDS.length);
    for (const b of TOOL_BLOCKS) for (const d of b.deny) expect(TOOL_IDS).toContain(d);
  });
});

describe('skills', () => {
  it('splits catalog skills, custom bundled names and uploads', () => {
    const upload = { name: 'my-skill', source: 'upload' as const, ref: 'r1' };
    const split = splitSkills([
      { name: 'summarize', source: 'bundled' as const },
      { name: 'obscure-skill', source: 'bundled' as const },
      { name: 'github', source: 'bundled' as const },
      upload,
    ]);
    expect(split).toEqual({ known: ['summarize', 'github'], custom: ['obscure-skill'], uploaded: [upload] });
  });

  it('joins in catalog order, keeps custom names and uploads', () => {
    const upload = { name: 'my-skill', source: 'upload' as const, ref: 'r1' };
    expect(joinSkills(['github', 'summarize'], ['obscure-skill', 'summarize'], [upload])).toEqual([
      { name: 'summarize', source: 'bundled' },
      { name: 'github', source: 'bundled' },
      { name: 'obscure-skill', source: 'bundled' },
      upload,
    ]);
    expect(joinSkills([], [], [])).toEqual([]);
  });

  it('round-trips a stored list', () => {
    const stored = [
      { name: 'weather', source: 'bundled' as const },
      { name: 'legacy-x', source: 'bundled' as const },
    ];
    const s = splitSkills(stored);
    expect(joinSkills(s.known, s.custom, s.uploaded)).toEqual(stored);
  });

  it('has unique skill names', () => {
    expect(KNOWN_SKILLS.size).toBe(SKILL_GROUPS.flatMap((g) => g.skills).length);
  });
});
