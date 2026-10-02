import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePlatformAdmin } from '../auth/guards.js';
import { invalidateUser } from '../auth/session.js';
import { audit } from '../audit.js';
import { db } from '../db/client.js';
import { departments, importJobs, users } from '../db/schema.js';
import { newId } from '../lib/crypto.js';
import { csvCell, parseCsv } from '../lib/csv.js';
import { ApiError } from '../lib/errors.js';
import { insertDepartment, moveDepartmentTx } from '../org/service.js';
import { getSetting } from '../settings.js';
import { insertUser } from '../admin/service.js';
import {
  departmentApplyOrder, planDepartments, planUsers, REQUIRED_COLUMNS, summarize, type PlannedRow,
} from './plan.js';

// A-13 CSV import: preview (stores an import_job) → apply (same job id). 03-data-model.md import_jobs.

type Kind = 'departments' | 'users';
const MAX_BYTES = 5 * 1024 * 1024;

async function snapshot(kind: Kind) {
  const depts = await db.select().from(departments);
  const deptCode = new Map(depts.map((d) => [d.id, d.code]));
  const allUsers = await db.select().from(users);
  const emailById = new Map(allUsers.map((u) => [u.id, u.email]));
  if (kind === 'departments') {
    const existing = depts.map((d) => ({
      code: d.code,
      name: d.name,
      parentCode: d.parentId ? deptCode.get(d.parentId) ?? null : null,
      headEmail: d.headUserId ? emailById.get(d.headUserId) ?? null : null,
      sortOrder: d.sortOrder,
    }));
    return { existing, emails: new Set(allUsers.map((u) => u.email)), depts, allUsers };
  }
  const existing = allUsers.map((u) => ({
    email: u.email,
    name: u.name,
    departmentCode: u.departmentId ? deptCode.get(u.departmentId) ?? null : null,
    title: u.title,
    employeeNo: u.employeeNo,
    platformRole: u.platformRole as 'admin' | 'user',
  }));
  return { existing, emails: new Set<string>(), depts, allUsers };
}

/** Fingerprint of the data a preview was computed against (apply refuses with 409 if it changed). */
const fingerprint = (data: unknown) =>
  createHash('sha256').update(JSON.stringify(data, (_k, v) => (v instanceof Date ? v.toISOString() : v))).digest('hex');

async function plan(kind: Kind, text: string) {
  const { header, rows } = parseCsv(text);
  const missing = REQUIRED_COLUMNS[kind].filter((c) => !header.includes(c));
  if (missing.length || rows.length === 0) throw new ApiError(422, 'IMPORT_INVALID_CSV', { missing });
  if (rows.length > 5000) throw new ApiError(422, 'IMPORT_INVALID_CSV', { tooManyRows: rows.length });
  const snap = await snapshot(kind);
  const planned = kind === 'departments'
    ? planDepartments(rows, snap.existing as Parameters<typeof planDepartments>[1], snap.emails, await getSetting('org.max_depth'))
    : planUsers(rows, snap.existing as Parameters<typeof planUsers>[1],
      new Set(snap.depts.filter((d) => d.status === 'active').map((d) => d.code)));
  return { planned, baseline: fingerprint(snap.existing) };
}

const jobOut = (j: typeof importJobs.$inferSelect) => ({
  id: j.id,
  kind: j.kind,
  status: j.status,
  fileName: j.fileName,
  summary: j.summary,
  rows: (j.rows as PlannedRow[]).map(({ values: _v, ...r }) => r),
});

export async function importRoutes(app: FastifyInstance) {
  app.post('/api/v1/admin/import/:kind/preview', { preHandler: requirePlatformAdmin },
    async (req: FastifyRequest<{ Params: { kind: string } }>) => {
      const kind = z.enum(['departments', 'users']).parse(req.params.kind);
      const file = await req.file({ limits: { fileSize: MAX_BYTES, files: 1 } });
      if (!file) throw new ApiError(422, 'IMPORT_INVALID_CSV');
      const buf = await file.toBuffer();
      const { planned, baseline } = await plan(kind, buf.toString('utf8'));
      const [job] = await db.insert(importJobs).values({
        id: newId(),
        kind,
        fileName: file.filename.slice(0, 200),
        summary: summarize(planned),
        rows: planned,
        baseline,
        createdBy: req.session!.user.id,
      }).returning();
      return jobOut(job!);
    });

  app.post('/api/v1/admin/import/:kind/apply', { preHandler: requirePlatformAdmin },
    async (req: FastifyRequest<{ Params: { kind: string } }>) => {
      const kind = z.enum(['departments', 'users']).parse(req.params.kind);
      const body = z.object({ jobId: z.uuid(), skipErrors: z.boolean().default(false) }).parse(req.body);
      const [job] = await db.select().from(importJobs).where(eq(importJobs.id, body.jobId));
      if (!job || job.kind !== kind || job.status !== 'previewed') throw new ApiError(404, 'NOT_FOUND');
      const planned = job.rows as PlannedRow[];
      if (!body.skipErrors && planned.some((r) => r.action === 'error')) throw new ApiError(422, 'IMPORT_HAS_ERRORS');
      if (fingerprint((await snapshot(kind)).existing) !== job.baseline) throw new ApiError(409, 'IMPORT_STALE');

      const actorId = req.session!.user.id;
      const passwords: string[] = [];
      await db.transaction(async (tx) => {
        if (kind === 'departments') {
          const idByCode = async (code: string | null) => {
            if (!code) return null;
            const [d] = await tx.select({ id: departments.id }).from(departments).where(eq(departments.code, code));
            return d?.id ?? null;
          };
          const idByEmail = async (email: string | null) => {
            if (!email) return undefined;
            const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
            return u?.id ?? null;
          };
          for (const r of departmentApplyOrder(planned)) {
            const v = r.values as { code: string; name: string; parent_code: string | null; head_email: string | null; sort_order: number | null };
            const parentId = await idByCode(v.parent_code);
            const headUserId = await idByEmail(v.head_email);
            if (r.action === 'add') {
              await insertDepartment(tx, {
                code: v.code, name: v.name, parentId, headUserId: headUserId ?? null, sortOrder: v.sort_order ?? 0,
              }, 'csv');
            } else {
              const [d] = await tx.select().from(departments).where(eq(departments.code, v.code));
              if (!d) continue;
              if ('parentCode' in r.changes) await moveDepartmentTx(tx, d.id, parentId);
              await tx.update(departments).set({
                name: v.name,
                ...(headUserId !== undefined ? { headUserId } : {}),
                ...(v.sort_order !== null ? { sortOrder: v.sort_order } : {}),
                source: 'csv',
                updatedAt: sql`now()`,
              }).where(eq(departments.id, d.id));
            }
          }
        } else {
          const deptId = new Map((await tx.select().from(departments)).map((d) => [d.code, d.id]));
          for (const r of planned) {
            const v = r.values as { email: string; name: string; department_code: string; title: string | null; employee_no: string | null; platform_role: 'admin' | 'user' | null };
            if (r.action === 'add') {
              const created = await insertUser(tx, {
                email: v.email, name: v.name, departmentId: deptId.get(v.department_code) ?? null,
                title: v.title, employeeNo: v.employee_no, platformRole: v.platform_role ?? 'user',
              }, actorId);
              passwords.push([v.email, v.name, created.initialPassword].map(csvCell).join(','));
            } else if (r.action === 'update') {
              const [u] = await tx.update(users).set({
                name: v.name,
                departmentId: deptId.get(v.department_code) ?? null,
                ...(v.title !== null ? { title: v.title } : {}),
                ...(v.employee_no !== null ? { employeeNo: v.employee_no } : {}),
                ...(v.platform_role !== null ? { platformRole: v.platform_role } : {}),
                updatedAt: sql`now()`,
              }).where(eq(users.email, v.email)).returning({ id: users.id });
              if (u) invalidateUser(u.id);
            }
          }
        }
        await tx.update(importJobs).set({ status: 'applied', appliedAt: sql`now()` }).where(eq(importJobs.id, job.id));
        await audit({ actorId, action: 'import.apply', targetType: 'import', targetId: job.id, detail: { kind, ...(job.summary as object), skipErrors: body.skipErrors } }, tx);
      });

      const [done] = await db.select().from(importJobs).where(eq(importJobs.id, job.id));
      return {
        ...jobOut(done!),
        // New accounts' initial passwords: only in this response, never stored (03 import_jobs).
        initialPasswordsCsv: kind === 'users' && passwords.length ? ['email,name,initial_password', ...passwords].join('\n') + '\n' : null,
      };
    });
}
