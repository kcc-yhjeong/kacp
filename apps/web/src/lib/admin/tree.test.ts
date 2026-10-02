import { describe, expect, it } from 'vitest';
import {
  collapsePath,
  countDescendants,
  dropProblem,
  filterTree,
  findNode,
  flattenTree,
  levelOf,
  pathTo,
  searchTree,
  subtreeHeight,
  type TreeNode,
} from './tree';

const n = (id: string, children: TreeNode[] = [], name = id): TreeNode => ({ id, name, children });

// root: A(B(C(D)), E), F
const tree = [n('A', [n('B', [n('C', [n('D')])]), n('E', [], '인사팀')]), n('F', [], '신입채용셀')];

/** A straight chain of `len` nodes: L1 > L2 > ... */
function chain(len: number, prefix = 'L'): TreeNode {
  let node = n(`${prefix}${len}`);
  for (let i = len - 1; i >= 1; i--) node = n(`${prefix}${i}`, [node]);
  return node;
}

describe('flattenTree', () => {
  it('walks depth-first with levels', () => {
    expect(flattenTree(tree).map((r) => `${r.node.id}${r.level}`)).toEqual(['A1', 'B2', 'C3', 'D4', 'E2', 'F1']);
  });
  it('skips collapsed children', () => {
    expect(flattenTree(tree, new Set(['A'])).map((r) => r.node.id)).toEqual(['A', 'B', 'E', 'F']);
    expect(flattenTree(tree, new Set()).map((r) => r.node.id)).toEqual(['A', 'F']);
  });
  it('reports parent and children', () => {
    const rows = flattenTree(tree);
    expect(rows.find((r) => r.node.id === 'C')).toMatchObject({ parentId: 'B', hasChildren: true });
    expect(rows.find((r) => r.node.id === 'D')?.hasChildren).toBe(false);
  });
});

describe('lookups', () => {
  it('finds nodes, paths and levels', () => {
    expect(findNode(tree, 'D')?.id).toBe('D');
    expect(findNode(tree, 'X')).toBeNull();
    expect(pathTo(tree, 'D').map((x) => x.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(levelOf(tree, 'E')).toBe(2);
    expect(levelOf(tree, 'X')).toBe(0);
  });
  it('measures subtrees', () => {
    const a = findNode(tree, 'A');
    expect(a && subtreeHeight(a)).toBe(4);
    expect(a && countDescendants(a)).toBe(4);
    expect(subtreeHeight(n('leaf'))).toBe(1);
  });
});

describe('dropProblem', () => {
  it('blocks self and descendants (cycle)', () => {
    expect(dropProblem(tree, 'B', 'B')).toBe('self');
    expect(dropProblem(tree, 'A', 'D')).toBe('descendant');
    expect(dropProblem(tree, 'B', 'C')).toBe('descendant');
  });
  it('flags the current parent as a no-op', () => {
    expect(dropProblem(tree, 'B', 'A')).toBe('same_parent');
    expect(dropProblem(tree, 'A', null)).toBe('same_parent');
  });
  it('allows valid moves including to the top level', () => {
    expect(dropProblem(tree, 'C', 'F')).toBeNull();
    expect(dropProblem(tree, 'B', null)).toBeNull();
    expect(dropProblem(tree, 'F', 'D')).toBeNull();
  });
  it('enforces the 10-level limit with the whole subtree', () => {
    const deep = [chain(9), n('X', [n('Y')])];
    // L9 is level 9: X (height 2) under it → 11 levels.
    expect(dropProblem(deep, 'X', 'L9')).toBe('too_deep');
    // Y alone (height 1) under L9 → 10 levels, allowed.
    expect(dropProblem(deep, 'Y', 'L9')).toBeNull();
    expect(dropProblem(deep, 'X', 'L8')).toBeNull();
  });
});

describe('searchTree', () => {
  it('matches names and expands ancestors', () => {
    const r = searchTree(tree, '인사');
    expect([...r.matches]).toEqual(['E']);
    expect([...r.expand]).toEqual(['A']);
  });
  it('is case-insensitive and empty for blank queries', () => {
    expect([...searchTree(tree, 'd').matches]).toEqual(['D']);
    expect(searchTree(tree, '  ').matches.size).toBe(0);
  });
});

describe('filterTree', () => {
  it('drops a node with its subtree', () => {
    const out = filterTree(tree, (x) => x.id !== 'B');
    expect(flattenTree(out).map((r) => r.node.id)).toEqual(['A', 'E', 'F']);
  });
});

describe('collapsePath', () => {
  it('keeps up to five levels', () => {
    expect(collapsePath(['a', 'b', 'c', 'd', 'e'])).toHaveLength(5);
  });
  it('collapses the middle above five levels', () => {
    const c = collapsePath(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(c).toEqual([
      { kind: 'item', name: 'a', index: 0 },
      { kind: 'ellipsis', hidden: ['b', 'c', 'd', 'e'] },
      { kind: 'item', name: 'f', index: 5 },
    ]);
    expect(collapsePath(['a', 'b', 'c', 'd', 'e', 'f'], true)).toHaveLength(6);
  });
});
