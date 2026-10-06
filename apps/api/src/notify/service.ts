import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { memberships, notifications, teams, users } from '../db/schema.js';
import { newId } from '../lib/crypto.js';
import { recipients, type NotificationType } from './logic.js';

// Notifications (C-06, docs/README.md 7단계). Created only here; a failure never blocks the action.

export interface NotificationInput {
  type: NotificationType;
  title: string;
  link?: string | null;
  payload?: Record<string, unknown>;
}

export async function notify(userIds: (string | null | undefined)[], n: NotificationInput, exclude?: string | null) {
  const to = recipients(userIds, exclude);
  if (!to.length) return;
  try {
    await db.insert(notifications).values(to.map((userId) => ({
      id: newId(), userId, type: n.type, title: n.title.slice(0, 300), link: n.link ?? null, payload: n.payload ?? null,
    })));
  } catch {
    // best effort (e.g. a user deleted meanwhile)
  }
}

const active = eq(users.status, 'active');

export async function teamAdminIds(teamId: string): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.teamId, teamId), eq(memberships.teamRole, 'team_admin'), active));
  return rows.map((r) => r.id);
}

export async function teamMemberIds(teamId: string): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.teamId, teamId), active));
  return rows.map((r) => r.id);
}

export async function platformAdminIds(): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users).where(and(eq(users.platformRole, 'admin'), active));
  return rows.map((r) => r.id);
}

export async function teamIdByName(name: string): Promise<string | null> {
  const [t] = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.name, name), isNull(teams.deletedAt)));
  return t?.id ?? null;
}

/** Daily: notifications older than 90 days go. */
export async function purgeOldNotifications() {
  const r = await db.delete(notifications).where(lt(notifications.createdAt, sql`now() - interval '90 days'`)).returning({ id: notifications.id });
  return r.length;
}

export async function markRead(userId: string, ids: string[] | 'all') {
  const where = ids === 'all'
    ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
    : and(eq(notifications.userId, userId), inArray(notifications.id, ids), isNull(notifications.readAt));
  await db.update(notifications).set({ readAt: sql`now()` }).where(where);
}
