// Department tree helpers (A-12, DepartmentTree, DepartmentSelect). Pure functions, tested.

export interface TreeNode {
  id: string;
  name: string;
  children: TreeNode[];
}

/** Safety limit for department depth (01-screens.md A-12). */
export const MAX_DEPARTMENT_DEPTH = 10;

export interface FlatRow<T extends TreeNode> {
  node: T;
  /** 1 = top level. */
  level: number;
  parentId: string | null;
  hasChildren: boolean;
}

/** Depth-first rows; children of collapsed nodes are skipped when `expanded` is given. */
export function flattenTree<T extends TreeNode>(roots: T[], expanded?: ReadonlySet<string>): FlatRow<T>[] {
  const out: FlatRow<T>[] = [];
  const walk = (nodes: T[], level: number, parentId: string | null) => {
    for (const node of nodes) {
      const children = node.children as T[];
      out.push({ node, level, parentId, hasChildren: children.length > 0 });
      if (!expanded || expanded.has(node.id)) walk(children, level + 1, node.id);
    }
  };
  walk(roots, 1, null);
  return out;
}

export function findNode<T extends TreeNode>(roots: T[], id: string): T | null {
  for (const node of roots) {
    if (node.id === id) return node;
    const hit = findNode(node.children as T[], id);
    if (hit) return hit;
  }
  return null;
}

/** Nodes from the top down to `id` (inclusive). Empty when not found. */
export function pathTo<T extends TreeNode>(roots: T[], id: string): T[] {
  for (const node of roots) {
    if (node.id === id) return [node];
    const sub = pathTo(node.children as T[], id);
    if (sub.length > 0) return [node, ...sub];
  }
  return [];
}

/** Level of `id` (1 = top level), 0 when not found. */
export function levelOf(roots: TreeNode[], id: string): number {
  return pathTo(roots, id).length;
}

/** Height of a subtree: a leaf is 1. */
export function subtreeHeight(node: TreeNode): number {
  let max = 0;
  for (const child of node.children) max = Math.max(max, subtreeHeight(child));
  return max + 1;
}

/** Number of departments below `node` (all levels). */
export function countDescendants(node: TreeNode): number {
  let n = 0;
  for (const child of node.children) n += 1 + countDescendants(child);
  return n;
}

/** True when `candidateId` is `ancestor` itself or anywhere below it. */
export function isSelfOrDescendant(ancestor: TreeNode, candidateId: string): boolean {
  if (ancestor.id === candidateId) return true;
  return ancestor.children.some((c) => isSelfOrDescendant(c, candidateId));
}

export type DropProblem = 'self' | 'descendant' | 'too_deep' | 'same_parent';

/**
 * Can `dragId` move under `targetId` (null = top level)?
 * Mirrors the api checks (DEPARTMENT_CYCLE, DEPARTMENT_TOO_DEEP) so the tree can show a ban before the call.
 */
export function dropProblem(roots: TreeNode[], dragId: string, targetId: string | null): DropProblem | null {
  const drag = findNode(roots, dragId);
  if (!drag) return 'self';
  if (targetId === dragId) return 'self';
  if (targetId !== null && isSelfOrDescendant(drag, targetId)) return 'descendant';
  const path = pathTo(roots, dragId);
  const currentParent = path.length > 1 ? (path[path.length - 2]?.id ?? null) : null;
  if (currentParent === targetId) return 'same_parent';
  const targetLevel = targetId === null ? 0 : levelOf(roots, targetId);
  if (targetLevel + subtreeHeight(drag) > MAX_DEPARTMENT_DEPTH) return 'too_deep';
  return null;
}

export const DROP_PROBLEM_MESSAGE: Record<DropProblem, string> = {
  self: '같은 부서 위로는 옮길 수 없어요',
  descendant: '자기 하위 부서 아래로는 옮길 수 없어요',
  too_deep: `부서는 ${MAX_DEPARTMENT_DEPTH}단계까지만 만들 수 있어요`,
  same_parent: '이미 이 부서 아래에 있어요',
};

export interface TreeSearch {
  /** Ids whose name matches. */
  matches: Set<string>;
  /** Ancestors of matches — expand these so every match is visible. */
  expand: Set<string>;
}

/** Case-insensitive name search. */
export function searchTree(roots: TreeNode[], query: string): TreeSearch {
  const q = query.trim().toLowerCase();
  const matches = new Set<string>();
  const expand = new Set<string>();
  if (!q) return { matches, expand };
  const walk = (nodes: TreeNode[], ancestors: string[]) => {
    for (const node of nodes) {
      if (node.name.toLowerCase().includes(q)) {
        matches.add(node.id);
        for (const a of ancestors) expand.add(a);
      }
      walk(node.children, [...ancestors, node.id]);
    }
  };
  walk(roots, []);
  return { matches, expand };
}

/** Keeps archived nodes out unless asked (the api returns them only with includeArchived). */
export function filterTree<T extends TreeNode>(roots: T[], keep: (node: T) => boolean): T[] {
  const out: T[] = [];
  for (const node of roots) {
    if (!keep(node)) continue;
    out.push({ ...node, children: filterTree(node.children as T[], keep) });
  }
  return out;
}

export type Crumb = { kind: 'item'; name: string; index: number } | { kind: 'ellipsis'; hidden: string[] };

/** Path display: more than 5 levels → first, …, last (02-design-system.md 부서 표기 규칙). */
export function collapsePath(names: string[], expanded = false, max = 5): Crumb[] {
  if (expanded || names.length <= max) return names.map((name, index) => ({ kind: 'item', name, index }));
  const last = names.length - 1;
  return [
    { kind: 'item', name: names[0] ?? '', index: 0 },
    { kind: 'ellipsis', hidden: names.slice(1, last) },
    { kind: 'item', name: names[last] ?? '', index: last },
  ];
}
