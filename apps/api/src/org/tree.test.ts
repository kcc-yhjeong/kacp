import { describe, expect, it } from 'vitest';
import { checkMove, depthOf, descendantIds, subtreeHeight } from './tree.js';

// a ─ b ─ c ─ d
//  └ e
const depts = [
  { id: 'a', parentId: null },
  { id: 'b', parentId: 'a' },
  { id: 'c', parentId: 'b' },
  { id: 'd', parentId: 'c' },
  { id: 'e', parentId: 'a' },
];

describe('department tree', () => {
  it('computes depth, height and descendants', () => {
    expect(depthOf(depts, 'a')).toBe(0);
    expect(depthOf(depts, 'd')).toBe(3);
    expect(subtreeHeight(depts, 'b')).toBe(2);
    expect([...descendantIds(depts, 'b')].sort()).toEqual(['c', 'd']);
  });

  it('refuses moving under itself or a descendant', () => {
    expect(checkMove(depts, 'b', 'b', 10)).toBe('DEPARTMENT_CYCLE');
    expect(checkMove(depts, 'b', 'd', 10)).toBe('DEPARTMENT_CYCLE');
  });

  it('counts the whole moved subtree against the depth limit', () => {
    // b (height 2) under e (depth 1) → deepest d at depth 4
    expect(checkMove(depts, 'b', 'e', 5)).toBeNull();
    expect(checkMove(depts, 'b', 'e', 4)).toBe('DEPARTMENT_TOO_DEEP');
    expect(checkMove(depts, 'd', null, 1)).toBeNull();
  });

  it('reports unknown departments', () => {
    expect(checkMove(depts, 'x', null, 10)).toBe('DEPARTMENT_NOT_FOUND');
    expect(checkMove(depts, 'b', 'x', 10)).toBe('DEPARTMENT_NOT_FOUND');
  });

  it('detects cycles in data while walking up', () => {
    expect(depthOf([{ id: 'p', parentId: 'q' }, { id: 'q', parentId: 'p' }], 'p')).toBe(-1);
  });
});
