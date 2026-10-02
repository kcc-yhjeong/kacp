import { and, count, eq, gt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { loginAttempts } from '../db/schema.js';

// 06-auth.md §4: 5 failures per email or 30 per IP within 15 minutes → locked for 15 minutes.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_EMAIL = 5;
const MAX_PER_IP = 30;

export async function isLocked(email: string, ip: string | null): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  const [byEmail] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since)));
  if ((byEmail?.n ?? 0) >= MAX_PER_EMAIL) return true;
  if (!ip) return false;
  const [byIp] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ip, ip), eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since)));
  return (byIp?.n ?? 0) >= MAX_PER_IP;
}

export async function recordAttempt(email: string, ip: string | null, success: boolean) {
  await db.insert(loginAttempts).values({ email, ip, success });
}
