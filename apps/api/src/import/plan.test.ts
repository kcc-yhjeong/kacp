import { describe, expect, it } from 'vitest';
import { departmentApplyOrder, planDepartments, planUsers, summarize } from './plan.js';

const rows = (list: Record<string, string>[]) => list.map((values, i) => ({ line: i + 2, values }));

describe('planDepartments', () => {
  const existing = [
    { code: 'HQ', name: '경영지원본부', parentCode: null, headEmail: null, sortOrder: 0 },
    { code: 'HR', name: '인사팀', parentCode: 'HQ', headEmail: null, sortOrder: 0 },
  ];

  it('classifies add, update, unchanged and errors', () => {
    const plan = planDepartments(rows([
      { code: 'HQ', name: '경영지원본부', parent_code: '' },
      { code: 'HR', name: '인사·총무팀', parent_code: 'HQ' },
      { code: 'HR2', name: '채용파트', parent_code: 'HR', head_email: 'kim@kcc.co.kr' },
      { code: 'X', name: '고아', parent_code: 'NOPE' },
      { code: 'HR2', name: '중복', parent_code: '' },
      { code: '', name: '코드없음', parent_code: '' },
      { code: 'B', name: '노부서장', parent_code: '', head_email: 'ghost@kcc.co.kr' },
    ]), existing, new Set(['kim@kcc.co.kr']), 10);
    expect(plan.map((p) => p.action)).toEqual(['unchanged', 'update', 'add', 'error', 'error', 'error', 'error']);
    expect(plan[1]!.changes).toEqual({ name: ['인사팀', '인사·총무팀'] });
    expect(summarize(plan)).toEqual({ added: 1, updated: 1, unchanged: 1, errors: 4 });
  });

  it('detects cycles introduced by the file', () => {
    const plan = planDepartments(rows([
      { code: 'A', name: 'A', parent_code: 'B' },
      { code: 'B', name: 'B', parent_code: 'A' },
    ]), [], new Set(), 10);
    expect(plan.every((p) => p.action === 'error' && p.error?.includes('순환'))).toBe(true);
  });

  it('enforces the depth limit including existing children below a moved department', () => {
    // HQ(0) > HR(1). Moving HQ under new top T makes HR depth 2.
    const plan = planDepartments(rows([
      { code: 'T', name: '최상위', parent_code: '' },
      { code: 'HQ', name: '경영지원본부', parent_code: 'T' },
    ]), existing, new Set(), 2);
    expect(plan[1]!.action).toBe('error');
  });

  it('orders parents before children for apply', () => {
    const plan = planDepartments(rows([
      { code: 'C', name: 'C', parent_code: 'B' },
      { code: 'B', name: 'B', parent_code: 'A' },
      { code: 'A', name: 'A', parent_code: '' },
    ]), [], new Set(), 10);
    expect(departmentApplyOrder(plan).map((p) => p.key)).toEqual(['A', 'B', 'C']);
  });
});

describe('planUsers', () => {
  const existing = [
    { email: 'kim@kcc.co.kr', name: '김하늘', departmentCode: 'HR', title: null, employeeNo: 'E1', platformRole: 'user' as const },
  ];
  const depts = new Set(['HR', 'HQ']);

  it('classifies rows and keeps unset optional columns', () => {
    const plan = planUsers(rows([
      { email: 'KIM@kcc.co.kr', name: '김하늘', department_code: 'HR' },
      { email: 'lee@kcc.co.kr', name: '이준호', department_code: 'HQ', employee_no: 'E2' },
      { email: 'park@kcc.co.kr', name: '박소연', department_code: 'NOPE' },
      { email: 'bad', name: 'x', department_code: 'HR' },
      { email: 'choi@kcc.co.kr', name: '최', department_code: 'HR', employee_no: 'E1' },
      { email: 'kim@kcc.co.kr', name: '중복', department_code: 'HR' },
      { email: 'jung@kcc.co.kr', name: '정', department_code: 'HR', platform_role: 'root' },
    ]), existing, depts);
    expect(plan.map((p) => p.action)).toEqual(['unchanged', 'add', 'error', 'error', 'error', 'error', 'error']);
  });

  it('reports changed fields', () => {
    const [p] = planUsers(rows([{ email: 'kim@kcc.co.kr', name: '김하늘', department_code: 'HQ', platform_role: 'admin' }]), existing, depts);
    expect(p!.action).toBe('update');
    expect(p!.changes).toEqual({ departmentCode: ['HR', 'HQ'], platformRole: ['user', 'admin'] });
  });
});
