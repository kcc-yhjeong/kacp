// Department tree rules (03-data-model.md departments): no cycles, depth 0..maxDepth-1.
// Pure functions over a flat list so the api, the CSV importer and tests share them.

export interface FlatDept {
  id: string;
  parentId: string | null;
}

export type MoveProblem = 'DEPARTMENT_CYCLE' | 'DEPARTMENT_TOO_DEEP' | 'DEPARTMENT_NOT_FOUND';

export function childrenIndex<T extends FlatDept>(depts: T[]): Map<string | null, T[]> {
  const byParent = new Map<string | null, T[]>();
  for (const d of depts) {
    const list = byParent.get(d.parentId) ?? [];
    list.push(d);
    byParent.set(d.parentId, list);
  }
  return byParent;
}

export function descendantIds(depts: FlatDept[], rootId: string): Set<string> {
  const byParent = childrenIndex(depts);
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const c of byParent.get(id) ?? []) {
      if (out.has(c.id)) continue;
      out.add(c.id);
      stack.push(c.id);
    }
  }
  return out;
}

/** Depth of `id` (root = 0), or -1 if a cycle or a missing parent is found. */
export function depthOf(depts: FlatDept[], id: string): number {
  const byId = new Map(depts.map((d) => [d.id, d]));
  let depth = 0;
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur?.parentId) {
    if (seen.has(cur.id)) return -1;
    seen.add(cur.id);
    const parent = byId.get(cur.parentId);
    if (!parent) return -1;
    cur = parent;
    depth++;
  }
  return cur ? depth : -1;
}

/** Height of the subtree under `id` (a leaf = 0). */
export function subtreeHeight(depts: FlatDept[], id: string): number {
  const byParent = childrenIndex(depts);
  const walk = (n: string, guard: number): number => {
    if (guard > depts.length) return 0;
    let h = 0;
    for (const c of byParent.get(n) ?? []) h = Math.max(h, 1 + walk(c.id, guard + 1));
    return h;
  };
  return walk(id, 0);
}

/** Validates moving `id` under `newParentId` (null = top level). */
export function checkMove(depts: FlatDept[], id: string, newParentId: string | null, maxDepth: number): MoveProblem | null {
  if (!depts.some((d) => d.id === id)) return 'DEPARTMENT_NOT_FOUND';
  if (newParentId !== null) {
    if (!depts.some((d) => d.id === newParentId)) return 'DEPARTMENT_NOT_FOUND';
    if (newParentId === id || descendantIds(depts, id).has(newParentId)) return 'DEPARTMENT_CYCLE';
  }
  const parentDepth = newParentId === null ? -1 : depthOf(depts, newParentId);
  // The deepest department of the moved subtree must stay within depth maxDepth-1.
  if (parentDepth + 1 + subtreeHeight(depts, id) > maxDepth - 1) return 'DEPARTMENT_TOO_DEEP';
  return null;
}

/** ltree label for a department id (uuid → letters/digits/underscore only). */
export const ltreeLabel = (id: string) => `d${id.replace(/-/g, '')}`;
