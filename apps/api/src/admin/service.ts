import { eq, sql } from 'drizzle-orm';
import { checkName, RESERVED_NAMES, type PlatformRole, type TeamRole } from '@kacp/shared';
import { audit } from '../audit.js';
import { db } from '../db/client.js';
import { authIdentities, memberships, names, teams, users } from '../db/schema.js';
import { encrypt, newId, randomToken } from '../lib/crypto.js';
import { ApiError } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { orchestrator } from '../orchestrator.js';
import { getSetting } from '../settings.js';
import { invalidateTeamCaches } from '../teams/lookup.js';
import { runtimeSpec } from '../teams/runtime.js';

// Admin operations shared by the stage 2 seed CLI and the stage 3 admin API.

const FIRST_UID = 20000;
const FIRST_GID = 30000;

export async function seedReservedNames() {
  const extra = await getSetting('names.reserved_extra');
  const rows = [...RESERVED_NAMES, ...extra].map((name) => ({ name, kind: 'reserved' }));
  await db.insert(names).values(rows).onConflictDoNothing();
}

export interface CreateUserInput {
  email: string;
  name: string;
  platformRole?: PlatformRole;
  /** Omitted → a 16-char password is generated and returned once (06-auth.md §2). */
  password?: string;
  title?: string;
}

export async function createUser(input: CreateUserInput, actorId: string | null) {
  const email = input.email.trim().toLowerCase();
  const password = input.password ?? randomToken(12).slice(0, 16);
  const passwordHash = await hashPassword(password);
  const id = newId();
  await db.transaction(async (tx) => {
    // Serialise uid allocation; the unique constraint is the backstop.
    await tx.execute(sql`lock table users in share row exclusive mode`);
    const [{ next } = { next: FIRST_UID }] = await tx
      .select({ next: sql<number>`coalesce(max(${users.linuxUid}) + 1, ${FIRST_UID})::int` })
      .from(users);
    await tx.insert(users).values({
      id,
      email,
      name: input.name,
      platformRole: input.platformRole ?? 'user',
      title: input.title ?? null,
      passwordHash,
      mustChangePassword: true,
      linuxUid: next,
      createdBy: actorId,
    });
    await tx.insert(authIdentities).values({ id: newId(), userId: id, provider: 'local', subject: email });
    await audit({ actorId, action: 'user.create', targetType: 'user', targetId: id, detail: { email } }, tx);
  });
  return { id, email, initialPassword: password };
}

export interface CreateTeamInput {
  name: string;
  displayName: string;
  admins: string[];
  members?: string[];
}

/** Reserves the name, stores the team and memberships, then asks the orchestrator to provision. */
export async function createTeam(input: CreateTeamInput, actorId: string | null) {
  const extra = await getSetting('names.reserved_extra');
  const problem = checkName(input.name, extra);
  if (problem) throw new ApiError(422, problem);
  const id = newId();

  await db.transaction(async (tx) => {
    const reserved = await tx.insert(names).values({ name: input.name, kind: 'team', ownerId: id })
      .onConflictDoNothing().returning();
    if (reserved.length === 0) throw new ApiError(409, 'NAME_TAKEN');
    await tx.execute(sql`lock table teams in share row exclusive mode`);
    const [{ next } = { next: FIRST_GID }] = await tx
      .select({ next: sql<number>`coalesce(max(${teams.linuxGid}) + 1, ${FIRST_GID})::int` })
      .from(teams);
    await tx.insert(teams).values({
      id,
      name: input.name,
      displayName: input.displayName,
      linuxGid: next,
      gatewayPasswordEnc: encrypt(randomToken(32)),
    });
    await audit({ actorId, action: 'team.create', targetType: 'team', targetId: id, teamId: id, detail: { name: input.name } }, tx);

    const roles: [string, TeamRole][] = [
      ...input.admins.map((e) => [e, 'team_admin'] as [string, TeamRole]),
      ...(input.members ?? []).map((e) => [e, 'member'] as [string, TeamRole]),
    ];
    for (const [email, teamRole] of roles) {
      const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase()));
      if (!u) throw new ApiError(404, 'NOT_FOUND', { email });
      await tx.insert(memberships).values({ teamId: id, userId: u.id, teamRole, addedBy: actorId });
      await audit({ actorId, action: 'membership.add', targetType: 'team', targetId: id, teamId: id, detail: { userId: u.id, teamRole } }, tx);
    }
  });
  invalidateTeamCaches();

  const [team] = await db.select().from(teams).where(eq(teams.id, id));
  await orchestrator.provision(input.name, await runtimeSpec(team!));
  return { id, name: input.name };
}
