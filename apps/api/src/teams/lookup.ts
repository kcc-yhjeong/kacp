import { and, eq, isNull } from 'drizzle-orm';
import type { TeamRole } from '@kacp/shared';
import { db } from '../db/client.js';
import { memberships, names, teams } from '../db/schema.js';
import type { NameOwner } from '../forward-auth/decide.js';

// Hot-path lookups for forward-auth: cached 10 s (06-auth.md §5), cleared on membership/team changes.
const TTL_MS = 10_000;

function cached<K, V>(load: (key: K) => Promise<V>) {
  const map = new Map<K, { v: V; at: number }>();
  const get = async (key: K) => {
    const hit = map.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
    const v = await load(key);
    map.set(key, { v, at: Date.now() });
    return v;
  };
  return Object.assign(get, { clear: () => map.clear() });
}

export const teamByName = cached(async (team: string) => {
  const [t] = await db.select().from(teams).where(and(eq(teams.name, team), isNull(teams.deletedAt)));
  return t ?? null;
});

export const nameOwner = cached(async (name: string): Promise<NameOwner> => {
  const [n] = await db.select().from(names).where(eq(names.name, name));
  if (!n) return null;
  if (n.kind === 'public_app') return { kind: 'public_app' };
  if (n.kind !== 'team') return null;
  const t = await teamByName(name);
  return t ? { kind: 'team', teamId: t.id, team: t.name } : null;
});

const roles = cached(async (key: string): Promise<TeamRole | null> => {
  const [teamId, userId] = key.split(':') as [string, string];
  const [m] = await db
    .select({ role: memberships.teamRole })
    .from(memberships)
    .where(and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)));
  return (m?.role as TeamRole | undefined) ?? null;
});

export const membershipRole = (teamId: string, userId: string) => roles(`${teamId}:${userId}`);

/** Call after any membership, team or name change. */
export function invalidateTeamCaches() {
  teamByName.clear();
  nameOwner.clear();
  roles.clear();
}
