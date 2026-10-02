import { eq, sql } from 'drizzle-orm';
import { checkName, RESERVED_NAMES, type PlatformRole, type TeamRole } from '@kacp/shared';
import { audit } from '../audit.js';
import { db } from '../db/client.js';
import { authIdentities, memberships, names, teams, users } from '../db/schema.js';
import { randomBytes } from 'node:crypto';
import { encrypt, newId, randomToken } from '../lib/crypto.js';
import { ApiError } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { orchestrator } from '../orchestrator.js';
import { getSetting } from '../settings.js';
import { invalidateTeamCaches } from '../teams/lookup.js';
import { runtimeSpec, scheduleApply } from '../teams/runtime.js';

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
  title?: string | null;
  employeeNo?: string | null;
  departmentId?: string | null;
  teams?: { team: string; teamRole: TeamRole }[];
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Temporary passwords: 16 chars from an unambiguous alphabet, always with a letter and a digit. */
export function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (;;) {
    const bytes = randomBytes(16);
    const pw = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    if (/[A-Za-z]/.test(pw) && /[0-9]/.test(pw)) return pw;
  }
}

/** Inserts a user inside a transaction (shared by the admin API, the CSV importer and the CLI). */
export async function insertUser(tx: Tx, input: CreateUserInput, actorId: string | null) {
  const email = input.email.trim().toLowerCase();
  const [exists] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (exists) throw new ApiError(409, 'USER_EMAIL_TAKEN');
  if (input.employeeNo) {
    const [dup] = await tx.select({ id: users.id }).from(users).where(eq(users.employeeNo, input.employeeNo));
    if (dup) throw new ApiError(409, 'USER_EMPLOYEE_NO_TAKEN');
  }
  const password = input.password ?? generatePassword();
  const passwordHash = await hashPassword(password);
  const id = newId();
  // Serialise uid allocation; the unique constraint is the backstop.
  await tx.execute(sql`lock table users in share row exclusive mode`);
  const [{ next } = { next: FIRST_UID }] = await tx
    .select({ next: sql<number>`coalesce(max(${users.linuxUid}) + 1, ${FIRST_UID})::int` })
    .from(users);
  await tx.insert(users).values({
    id,
    email,
    name: input.name.trim(),
    platformRole: input.platformRole ?? 'user',
    title: input.title ?? null,
    employeeNo: input.employeeNo || null,
    departmentId: input.departmentId ?? null,
    passwordHash,
    mustChangePassword: true,
    linuxUid: next,
    createdBy: actorId,
  });
  await tx.insert(authIdentities).values({ id: newId(), userId: id, provider: 'local', subject: email });
  await audit({ actorId, action: 'user.create', targetType: 'user', targetId: id, detail: { email } }, tx);
  for (const m of input.teams ?? []) {
    const [t] = await tx.select({ id: teams.id }).from(teams).where(eq(teams.name, m.team));
    if (!t) throw new ApiError(404, 'TEAM_NOT_FOUND');
    await tx.insert(memberships).values({ teamId: t.id, userId: id, teamRole: m.teamRole, addedBy: actorId });
    await audit({ actorId, action: 'membership.add', targetType: 'team', targetId: t.id, teamId: t.id, detail: { userId: id, teamRole: m.teamRole } }, tx);
  }
  return { id, email, initialPassword: password };
}

export async function createUser(input: CreateUserInput, actorId: string | null) {
  const out = await db.transaction((tx) => insertUser(tx, input, actorId));
  if (input.teams?.length) {
    invalidateTeamCaches();
    for (const m of input.teams) if (m.teamRole === 'team_admin') await scheduleApply(m.team);
  }
  return out;
}

export interface CreateTeamInput {
  name: string;
  displayName: string;
  /** Team admins by email (A-04 UserPicker / CLI). */
  admins: string[];
  /** Initial members by email or id. */
  members?: string[];
  memberUserIds?: string[];
  resourceLimits?: { cpu: number; memoryMb: number; diskGb: number } | null;
}

/**
 * Reserves the name, stores the team and memberships, then asks the orchestrator to provision.
 * Progress (A-04): name → storage → container → default_mcp → done, the rest via team.provision events.
 */
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
      resourceLimits: input.resourceLimits ?? null,
      gatewayPasswordEnc: encrypt(randomToken(32)),
      provisionStage: 'name',
    });
    await audit({ actorId, action: 'team.create', targetType: 'team', targetId: id, teamId: id, detail: { name: input.name } }, tx);

    const seen = new Set<string>();
    const add = async (where: ReturnType<typeof eq>, teamRole: TeamRole, label: string) => {
      const [u] = await tx.select({ id: users.id }).from(users).where(where);
      if (!u) throw new ApiError(404, 'USER_NOT_FOUND', { user: label });
      if (seen.has(u.id)) return;
      seen.add(u.id);
      await tx.insert(memberships).values({ teamId: id, userId: u.id, teamRole, addedBy: actorId });
      await audit({ actorId, action: 'membership.add', targetType: 'team', targetId: id, teamId: id, detail: { userId: u.id, teamRole } }, tx);
    };
    for (const e of input.admins) await add(eq(users.email, e.toLowerCase()), 'team_admin', e);
    for (const e of input.members ?? []) await add(eq(users.email, e.toLowerCase()), 'member', e);
    for (const uid of input.memberUserIds ?? []) await add(eq(users.id, uid), 'member', uid);
  });
  invalidateTeamCaches();

  const [team] = await db.select().from(teams).where(eq(teams.id, id));
  await db.update(teams).set({ provisionStage: 'storage' }).where(eq(teams.id, id));
  try {
    await orchestrator.provision(input.name, await runtimeSpec(team!));
  } catch (err) {
    await db.update(teams).set({ provisionStage: 'failed', containerError: '프로비저닝을 시작하지 못했어요.' }).where(eq(teams.id, id));
    throw err;
  }
  return { id, name: input.name };
}
