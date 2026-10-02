import type { CsvRow } from '../lib/csv.js';

// CSV import planning (A-13, 01-screens.md): pure functions that turn parsed rows plus the current
// data into per-row actions. Rows absent from the file are never touched.

export type RowAction = 'add' | 'update' | 'unchanged' | 'error';

export interface PlannedRow {
  line: number;
  action: RowAction;
  key: string;
  changes: Record<string, [unknown, unknown]>;
  error: string | null;
  /** Normalised values used by apply. */
  values: Record<string, string | number | null>;
}

export interface Summary { added: number; updated: number; unchanged: number; errors: number }

export function summarize(rows: PlannedRow[]): Summary {
  return {
    added: rows.filter((r) => r.action === 'add').length,
    updated: rows.filter((r) => r.action === 'update').length,
    unchanged: rows.filter((r) => r.action === 'unchanged').length,
    errors: rows.filter((r) => r.action === 'error').length,
  };
}

export const DEPARTMENT_COLUMNS = ['code', 'name', 'parent_code', 'head_email', 'sort_order'] as const;
export const USER_COLUMNS = ['email', 'name', 'department_code', 'title', 'employee_no', 'platform_role'] as const;
export const REQUIRED_COLUMNS = { departments: ['code', 'name', 'parent_code'], users: ['email', 'name', 'department_code'] } as const;

// ── departments ───────────────────────────────────────────────────────────────

export interface ExistingDept { code: string; name: string; parentCode: string | null; headEmail: string | null; sortOrder: number }

export function planDepartments(
  rows: CsvRow[],
  existing: ExistingDept[],
  knownEmails: Set<string>,
  maxDepth: number,
): PlannedRow[] {
  const byCode = new Map(existing.map((d) => [d.code, d]));
  const seen = new Map<string, number>();
  const planned: PlannedRow[] = rows.map((r) => {
    const v = r.values;
    const code = v.code ?? '';
    const row: PlannedRow = {
      line: r.line, action: 'unchanged', key: code, changes: {}, error: null,
      values: {
        code,
        name: v.name ?? '',
        parent_code: v.parent_code || null,
        head_email: v.head_email ? v.head_email.toLowerCase() : null,
        sort_order: v.sort_order ? Number(v.sort_order) : null,
      },
    };
    const fail = (msg: string) => ({ ...row, action: 'error' as const, error: msg });
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(code)) return fail('부서 코드가 비었거나 형식이 맞지 않아요.');
    if (!row.values.name) return fail('부서명이 비었어요.');
    if (seen.has(code)) return fail(`코드가 ${seen.get(code)}행과 겹쳐요.`);
    seen.set(code, r.line);
    if (row.values.parent_code === code) return fail('자기 자신을 상위 부서로 지정했어요.');
    if (row.values.sort_order !== null && !Number.isInteger(row.values.sort_order)) return fail('정렬 순서는 정수여야 해요.');
    if (row.values.head_email && !knownEmails.has(row.values.head_email as string)) return fail('부서장 이메일의 사용자가 없어요.');
    return row;
  });

  // Combined graph: file rows override existing departments.
  const parentOf = new Map<string, string | null>(existing.map((d) => [d.code, d.parentCode]));
  for (const p of planned) if (p.action !== 'error') parentOf.set(p.key, p.values.parent_code as string | null);

  const depthCache = new Map<string, number>();
  const depth = (code: string): number => {
    const seenPath = new Set<string>();
    let d = 0;
    let cur: string | null | undefined = code;
    while (cur) {
      if (seenPath.has(cur)) return Number.POSITIVE_INFINITY; // cycle
      seenPath.add(cur);
      const parent = parentOf.get(cur);
      if (parent === undefined) return Number.NaN; // unknown parent
      if (parent === null) break;
      cur = parent;
      d++;
    }
    return d;
  };
  const maxBelow = (code: string): number => {
    let best = depth(code);
    for (const [c, p] of parentOf) if (p === code) best = Math.max(best, maxBelow(c));
    return best;
  };

  for (const p of planned) {
    if (p.action === 'error') continue;
    const parent = p.values.parent_code as string | null;
    if (parent && !parentOf.has(parent)) {
      Object.assign(p, { action: 'error', error: `상위 부서 코드 ${parent}가 없어요.` });
      continue;
    }
    const d = depth(p.key);
    if (d === Number.POSITIVE_INFINITY) {
      Object.assign(p, { action: 'error', error: '상위 부서 지정이 순환해요.' });
      continue;
    }
    if (!depthCache.has(p.key)) depthCache.set(p.key, maxBelow(p.key));
    if (d > maxDepth - 1 || (depthCache.get(p.key) ?? 0) > maxDepth - 1) {
      Object.assign(p, { action: 'error', error: `부서는 ${maxDepth}단계까지만 만들 수 있어요.` });
      continue;
    }
    const before = byCode.get(p.key);
    if (!before) {
      p.action = 'add';
      continue;
    }
    const after = {
      name: p.values.name,
      parentCode: parent,
      headEmail: p.values.head_email ?? before.headEmail,
      sortOrder: p.values.sort_order ?? before.sortOrder,
    };
    for (const k of ['name', 'parentCode', 'headEmail', 'sortOrder'] as const) {
      if (before[k] !== after[k]) p.changes[k] = [before[k], after[k]];
    }
    p.action = Object.keys(p.changes).length ? 'update' : 'unchanged';
  }
  return planned;
}

/** Apply order: parents before children (by depth in the combined graph). */
export function departmentApplyOrder(planned: PlannedRow[]): PlannedRow[] {
  const parentOf = new Map(planned.map((p) => [p.key, p.values.parent_code as string | null]));
  const level = (code: string) => {
    let n = 0;
    let cur = parentOf.get(code);
    while (cur && parentOf.has(cur) && n < 64) {
      cur = parentOf.get(cur);
      n++;
    }
    return n;
  };
  return planned.filter((p) => p.action === 'add' || p.action === 'update').sort((a, b) => level(a.key) - level(b.key));
}

// ── users ─────────────────────────────────────────────────────────────────────

export interface ExistingUser {
  email: string; name: string; departmentCode: string | null; title: string | null;
  employeeNo: string | null; platformRole: 'admin' | 'user';
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function planUsers(rows: CsvRow[], existing: ExistingUser[], activeDeptCodes: Set<string>): PlannedRow[] {
  const byEmail = new Map(existing.map((u) => [u.email, u]));
  const empOwner = new Map(existing.filter((u) => u.employeeNo).map((u) => [u.employeeNo!, u.email]));
  const seen = new Map<string, number>();
  const seenEmp = new Map<string, number>();
  return rows.map((r) => {
    const v = r.values;
    const email = (v.email ?? '').toLowerCase();
    const row: PlannedRow = {
      line: r.line, action: 'unchanged', key: email, changes: {}, error: null,
      values: {
        email,
        name: v.name ?? '',
        department_code: v.department_code ?? '',
        title: v.title || null,
        employee_no: v.employee_no || null,
        platform_role: v.platform_role ? v.platform_role.toLowerCase() : null,
      },
    };
    const fail = (msg: string): PlannedRow => ({ ...row, action: 'error', error: msg });
    if (!EMAIL.test(email)) return fail('이메일 형식이 맞지 않아요.');
    if (seen.has(email)) return fail(`이메일이 ${seen.get(email)}행과 겹쳐요.`);
    seen.set(email, r.line);
    if (!row.values.name) return fail('이름이 비었어요.');
    if (!activeDeptCodes.has(row.values.department_code as string)) return fail(`부서 코드 ${row.values.department_code || '(빈 값)'}가 없어요.`);
    const role = row.values.platform_role;
    if (role !== null && role !== 'admin' && role !== 'user') return fail('플랫폼 역할은 admin 또는 user여야 해요.');
    const emp = row.values.employee_no as string | null;
    if (emp) {
      if (seenEmp.has(emp)) return fail(`사번이 ${seenEmp.get(emp)}행과 겹쳐요.`);
      seenEmp.set(emp, r.line);
      const owner = empOwner.get(emp);
      if (owner && owner !== email) return fail('다른 사용자가 쓰고 있는 사번이에요.');
    }

    const before = byEmail.get(email);
    if (!before) return { ...row, action: 'add' };
    const after = {
      name: row.values.name,
      departmentCode: row.values.department_code,
      title: row.values.title ?? before.title,
      employeeNo: emp ?? before.employeeNo,
      platformRole: (role as 'admin' | 'user' | null) ?? before.platformRole,
    };
    for (const k of ['name', 'departmentCode', 'title', 'employeeNo', 'platformRole'] as const) {
      if (before[k] !== after[k]) row.changes[k] = [before[k], after[k]];
    }
    return { ...row, action: Object.keys(row.changes).length ? 'update' : 'unchanged' };
  });
}
