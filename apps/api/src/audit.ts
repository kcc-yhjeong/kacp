import { db } from './db/client.js';
import { auditEvents } from './db/schema.js';

// Every admin action lands here (CLAUDE.md rule). Never put secrets in `detail`.
export interface AuditInput {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string;
  teamId?: string;
  detail?: Record<string, unknown>;
  ip?: string | null;
}

export async function audit(e: AuditInput, tx: Pick<typeof db, 'insert'> = db) {
  await tx.insert(auditEvents).values({
    actorId: e.actorId,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId ?? null,
    teamId: e.teamId ?? null,
    detail: e.detail ?? null,
    ip: e.ip ?? null,
  });
}
