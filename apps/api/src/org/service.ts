import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { departments, users } from '../db/schema.js';
import { ApiError } from '../lib/errors.js';
import { newId } from '../lib/crypto.js';
import { audit } from '../audit.js';
import { getSetting } from '../settings.js';
import { checkMove, childrenIndex, descendantIds, ltreeLabel } from './tree.js';

// Department (조직) operations — 03-data-model.md departments, 04-api.md 조직 API, A-12.

type DeptRow = typeof departments.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface DepartmentOut {
  id: string;
  code: string;
  name: string;
  pathNames: string[];
  parentId: string | null;
  depth: number;
  sortOrder: number;
  head: { id: string; name: string; email: string; departmentName: string | null } | null;
  status: 'active' | 'archived';
  memberCount: number;
  totalMemberCount: number;
}
export interface DepartmentNodeOut extends DepartmentOut { children: DepartmentNodeOut[] }

export const allDepartments = (tx: Pick<typeof db, 'select'> = db) => tx.select().from(departments);

function pathNamesOf(byId: Map<string, DeptRow>, d: DeptRow): string[] {
  const names: string[] = [];
  let cur: DeptRow | undefined = d;
  let guard = 0;
  while (cur && guard++ < 64) {
    names.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return names;
}

/** Department refs for many ids at once (user lists show department + path). */
export async function departmentRefs(ids: (string | null)[]) {
  const all = await allDepartments();
  const byId = new Map(all.map((d) => [d.id, d]));
  const out = new Map<string, { id: string; code: string; name: string; pathNames: string[] }>();
  for (const id of ids) {
    const d = id ? byId.get(id) : undefined;
    if (d) out.set(d.id, { id: d.id, code: d.code, name: d.name, pathNames: pathNamesOf(byId, d) });
  }
  return out;
}

async function decorate(all: DeptRow[]): Promise<Map<string, DepartmentOut>> {
  const byId = new Map(all.map((d) => [d.id, d]));
  const counts = await db
    .select({ departmentId: users.departmentId, n: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.status, 'active'))
    .groupBy(users.departmentId);
  const own = new Map(counts.map((c) => [c.departmentId, c.n]));
  const headIds = all.map((d) => d.headUserId).filter((x): x is string => !!x);
  const heads = headIds.length
    ? await db.select({ id: users.id, name: users.name, email: users.email, departmentId: users.departmentId })
      .from(users).where(inArray(users.id, headIds))
    : [];
  const headById = new Map(heads.map((h) => [h.id, h]));

  const out = new Map<string, DepartmentOut>();
  for (const d of all) {
    const total = [d.id, ...descendantIds(all, d.id)].reduce((s, id) => s + (own.get(id) ?? 0), 0);
    const h = d.headUserId ? headById.get(d.headUserId) : undefined;
    out.set(d.id, {
      id: d.id,
      code: d.code,
      name: d.name,
      pathNames: pathNamesOf(byId, d),
      parentId: d.parentId,
      depth: d.depth,
      sortOrder: d.sortOrder,
      head: h ? { id: h.id, name: h.name, email: h.email, departmentName: h.departmentId ? byId.get(h.departmentId)?.name ?? null : null } : null,
      status: d.status as 'active' | 'archived',
      memberCount: own.get(d.id) ?? 0,
      totalMemberCount: total,
    });
  }
  return out;
}

export async function departmentTree(includeArchived: boolean): Promise<DepartmentNodeOut[]> {
  const all = await allDepartments();
  const visible = includeArchived ? all : all.filter((d) => d.status === 'active');
  const decorated = await decorate(all);
  const byParent = childrenIndex(visible);
  const build = (parentId: string | null): DepartmentNodeOut[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ko'))
      .map((d) => ({ ...decorated.get(d.id)!, children: build(d.id) }));
  return build(null);
}

export async function departmentOut(id: string): Promise<DepartmentOut> {
  const out = (await decorate(await allDepartments())).get(id);
  if (!out) throw new ApiError(404, 'DEPARTMENT_NOT_FOUND');
  return out;
}

/** Next automatic code `D0001`, `D0002`, … (03: codes are generated when not given). */
async function nextCode(tx: Pick<typeof db, 'select'>): Promise<string> {
  const [row] = await tx
    .select({ n: sql<number>`coalesce(max(substring(${departments.code} from '^D([0-9]+)$')::int), 0)::int` })
    .from(departments);
  return `D${String((row?.n ?? 0) + 1).padStart(4, '0')}`;
}

export interface DepartmentInput {
  name?: string;
  code?: string;
  parentId?: string | null;
  headUserId?: string | null;
  sortOrder?: number;
}

/** Inserts inside a transaction (also used by the CSV importer). */
export async function insertDepartment(tx: Tx, input: DepartmentInput & { name: string }, source: 'manual' | 'csv') {
  const maxDepth = await getSetting('org.max_depth');
  let parent: DeptRow | undefined;
  if (input.parentId) {
    [parent] = await tx.select().from(departments).where(eq(departments.id, input.parentId));
    if (!parent) throw new ApiError(404, 'DEPARTMENT_NOT_FOUND');
    if (parent.status !== 'active') throw new ApiError(422, 'DEPARTMENT_ARCHIVED');
    if (parent.depth + 1 > maxDepth - 1) throw new ApiError(422, 'DEPARTMENT_TOO_DEEP');
  }
  const code = input.code?.trim() || (await nextCode(tx));
  const [taken] = await tx.select({ id: departments.id }).from(departments).where(eq(departments.code, code));
  if (taken) throw new ApiError(409, 'DEPARTMENT_CODE_TAKEN');
  const id = newId();
  await tx.insert(departments).values({
    id,
    code,
    name: input.name.trim(),
    parentId: parent?.id ?? null,
    path: parent ? `${parent.path}.${ltreeLabel(id)}` : ltreeLabel(id),
    depth: parent ? parent.depth + 1 : 0,
    sortOrder: input.sortOrder ?? 0,
    headUserId: input.headUserId ?? null,
    source,
  });
  return id;
}

export async function createDepartment(input: DepartmentInput, actorId: string) {
  if (!input.name?.trim()) throw new ApiError(400, 'VALIDATION_FAILED');
  const id = await db.transaction(async (tx) => {
    const id = await insertDepartment(tx, { ...input, name: input.name! }, 'manual');
    await audit({ actorId, action: 'department.create', targetType: 'department', targetId: id, detail: { name: input.name, code: input.code } }, tx);
    return id;
  });
  return departmentOut(id);
}

export async function updateDepartment(id: string, input: DepartmentInput, actorId: string) {
  const [d] = await db.select().from(departments).where(eq(departments.id, id));
  if (!d) throw new ApiError(404, 'DEPARTMENT_NOT_FOUND');
  const patch: Partial<DeptRow> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.code !== undefined && input.code.trim() !== d.code) {
    const [taken] = await db.select({ id: departments.id }).from(departments).where(eq(departments.code, input.code.trim()));
    if (taken) throw new ApiError(409, 'DEPARTMENT_CODE_TAKEN');
    patch.code = input.code.trim();
  }
  if (input.headUserId !== undefined) patch.headUserId = input.headUserId;
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
  if (Object.keys(patch).length) {
    await db.update(departments).set({ ...patch, source: 'manual', updatedAt: sql`now()` }).where(eq(departments.id, id));
    await audit({ actorId, action: 'department.update', targetType: 'department', targetId: id, detail: { before: { name: d.name, code: d.code }, after: patch } });
  }
  return departmentOut(id);
}

/** Re-parents a department and rewrites path/depth of its whole subtree. */
export async function moveDepartmentTx(tx: Tx, id: string, parentId: string | null, sortOrder?: number) {
  const all = await allDepartments(tx);
  const problem = checkMove(all, id, parentId, await getSetting('org.max_depth'));
  if (problem) throw new ApiError(problem === 'DEPARTMENT_NOT_FOUND' ? 404 : 422, problem);
  const byId = new Map(all.map((d) => [d.id, d]));
  const moved = byId.get(id)!;
  moved.parentId = parentId;
  const byParent = childrenIndex(all);
  const rewrite = async (d: DeptRow, parentPath: string | null, depth: number) => {
    const path = parentPath ? `${parentPath}.${ltreeLabel(d.id)}` : ltreeLabel(d.id);
    await tx.update(departments).set({
      parentId: d.parentId,
      path,
      depth,
      ...(d.id === id && sortOrder !== undefined ? { sortOrder } : {}),
      updatedAt: sql`now()`,
    }).where(eq(departments.id, d.id));
    for (const c of byParent.get(d.id) ?? []) if (c.id !== d.id) await rewrite(c, path, depth + 1);
  };
  const parent = parentId ? byId.get(parentId)! : null;
  await rewrite(moved, parent?.path ?? null, parent ? parent.depth + 1 : 0);
}

export async function moveDepartment(id: string, parentId: string | null, sortOrder: number | undefined, actorId: string) {
  const [before] = await db.select({ parentId: departments.parentId }).from(departments).where(eq(departments.id, id));
  await db.transaction(async (tx) => {
    await moveDepartmentTx(tx, id, parentId, sortOrder);
    await audit({ actorId, action: 'department.move', targetType: 'department', targetId: id, detail: { from: before?.parentId ?? null, to: parentId } }, tx);
  });
  return departmentOut(id);
}

export async function setArchived(id: string, archived: boolean, actorId: string) {
  const all = await allDepartments();
  const d = all.find((x) => x.id === id);
  if (!d) throw new ApiError(404, 'DEPARTMENT_NOT_FOUND');
  if (archived) {
    const activeChildren = all.some((x) => x.parentId === id && x.status === 'active');
    const [members] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.departmentId, id));
    if (activeChildren || (members?.n ?? 0) > 0) throw new ApiError(409, 'DEPARTMENT_NOT_EMPTY');
  } else if (d.parentId && all.find((x) => x.id === d.parentId)?.status !== 'active') {
    throw new ApiError(422, 'DEPARTMENT_ARCHIVED');
  }
  await db.update(departments).set({ status: archived ? 'archived' : 'active', updatedAt: sql`now()` }).where(eq(departments.id, id));
  await audit({ actorId, action: archived ? 'department.archive' : 'department.unarchive', targetType: 'department', targetId: id, detail: { name: d.name } });
  return departmentOut(id);
}

/** Department ids for a filter: the department itself, plus its subtree when asked. */
export async function departmentScope(id: string, includeDescendants: boolean): Promise<string[]> {
  if (!includeDescendants) return [id];
  return [id, ...descendantIds(await allDepartments(), id)];
}

export async function bulkSetDepartment(userIds: string[], departmentId: string, actorId: string) {
  const [d] = await db.select().from(departments).where(and(eq(departments.id, departmentId)));
  if (!d) throw new ApiError(404, 'DEPARTMENT_NOT_FOUND');
  if (d.status !== 'active') throw new ApiError(422, 'DEPARTMENT_ARCHIVED');
  if (userIds.length === 0) return;
  await db.transaction(async (tx) => {
    const before = await tx.select({ id: users.id, departmentId: users.departmentId }).from(users).where(inArray(users.id, userIds));
    await tx.update(users).set({ departmentId, updatedAt: sql`now()` }).where(inArray(users.id, userIds));
    for (const u of before) {
      await audit({ actorId, action: 'user.department_change', targetType: 'user', targetId: u.id, detail: { from: u.departmentId, to: departmentId } }, tx);
    }
  });
}
