import { sql } from 'drizzle-orm';
import {
  bigserial, boolean, check, customType, index, inet, integer, jsonb, pgTable, primaryKey, text,
  timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

// Stage 2 subset of docs/design/03-data-model.md. Status values are text + check (03 §공통 규칙).

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const ltree = customType<{ data: string }>({ dataType: () => 'ltree' });

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const departments = pgTable('departments', {
  id: uuid('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  parentId: uuid('parent_id'),
  path: ltree('path').notNull(),
  depth: integer('depth').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  headUserId: uuid('head_user_id'),
  status: text('status').notNull().default('active'),
  source: text('source').notNull().default('manual'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check('departments_status_check', sql`${t.status} in ('active', 'archived')`),
  check('departments_source_check', sql`${t.source} in ('manual', 'csv', 'sso')`),
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  departmentId: uuid('department_id').references(() => departments.id),
  title: text('title'),
  employeeNo: text('employee_no').unique(),
  platformRole: text('platform_role').notNull().default('user'),
  status: text('status').notNull().default('active'),
  passwordHash: text('password_hash'),
  mustChangePassword: boolean('must_change_password').notNull().default(true),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
  linuxUid: integer('linux_uid').notNull().unique(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check('users_platform_role_check', sql`${t.platformRole} in ('admin', 'user')`),
  check('users_status_check', sql`${t.status} in ('active', 'disabled')`),
  check('users_email_lower_check', sql`${t.email} = lower(${t.email})`),
]);

export const authIdentities = pgTable('auth_identities', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  provider: text('provider').notNull(),
  subject: text('subject').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('auth_identities_provider_subject').on(t.provider, t.subject)]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  tokenHash: bytea('token_hash').notNull().unique(),
  userId: uuid('user_id').notNull().references(() => users.id),
  createdAt: createdAt(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => [index('sessions_user').on(t.userId)]);

export const loginAttempts = pgTable('login_attempts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  email: text('email').notNull(),
  ip: inet('ip'),
  success: boolean('success').notNull(),
  createdAt: createdAt(),
}, (t) => [
  index('login_attempts_email_time').on(t.email, t.createdAt),
  index('login_attempts_ip_time').on(t.ip, t.createdAt),
]);

export const names = pgTable('names', {
  name: text('name').primaryKey(),
  kind: text('kind').notNull(),
  ownerId: uuid('owner_id'),
  createdAt: createdAt(),
}, (t) => [check('names_kind_check', sql`${t.kind} in ('team', 'public_app', 'reserved')`)]);

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name').notNull(),
  containerStatus: text('container_status').notNull().default('stopped'),
  containerStatusAt: timestamp('container_status_at', { withTimezone: true }).notNull().defaultNow(),
  containerError: text('container_error'),
  containerId: text('container_id'),
  linuxGid: integer('linux_gid').notNull().unique(),
  resourceLimits: jsonb('resource_limits').$type<{ cpu: number; memoryMb: number; diskGb: number }>(),
  gatewayPasswordEnc: bytea('gateway_password_enc').notNull(),
  configVersion: integer('config_version').notNull().default(0),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check('teams_container_status_check',
    sql`${t.containerStatus} in ('stopped', 'starting', 'running', 'stopping', 'error')`),
]);

export const memberships = pgTable('memberships', {
  teamId: uuid('team_id').notNull().references(() => teams.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  teamRole: text('team_role').notNull(),
  addedBy: uuid('added_by'),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.teamId, t.userId] }),
  index('memberships_user').on(t.userId),
  check('memberships_team_role_check', sql`${t.teamRole} in ('team_admin', 'member')`),
]);

export const teamPresence = pgTable('team_presence', {
  teamId: uuid('team_id').notNull().references(() => teams.id),
  sessionId: uuid('session_id').notNull().references(() => sessions.id),
  userId: uuid('user_id').notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.teamId, t.sessionId] })]);

export const auditEvents = pgTable('audit_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  teamId: uuid('team_id'),
  detail: jsonb('detail'),
  ip: inet('ip'),
  createdAt: createdAt(),
}, (t) => [index('audit_events_time').on(t.createdAt)]);

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value'),
  valueEnc: bytea('value_enc'),
  updatedBy: uuid('updated_by'),
  updatedAt: updatedAt(),
});
