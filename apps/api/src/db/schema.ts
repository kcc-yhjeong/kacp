import { sql } from 'drizzle-orm';
import {
  bigint, bigserial, doublePrecision, boolean, check, customType, index, inet, integer, jsonb, pgTable, primaryKey, text,
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
  provisionStage: text('provision_stage').notNull().default('name'),
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
  check('teams_provision_stage_check',
    sql`${t.provisionStage} in ('name', 'storage', 'container', 'default_mcp', 'done', 'failed')`),
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

export const importJobs = pgTable('import_jobs', {
  id: uuid('id').primaryKey(),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('previewed'),
  fileName: text('file_name').notNull(),
  summary: jsonb('summary').notNull(),
  rows: jsonb('rows').notNull(),
  /** Fingerprint of the rows the preview was computed against; apply refuses if it changed (409). */
  baseline: text('baseline').notNull(),
  createdBy: uuid('created_by'),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  check('import_jobs_kind_check', sql`${t.kind} in ('departments', 'users')`),
  check('import_jobs_status_check', sql`${t.status} in ('previewed', 'applied', 'cancelled')`),
]);

export const agentTemplates = pgTable('agent_templates', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('🤖'),
  description: text('description').notNull().default(''),
  version: integer('version').notNull().default(1),
  spec: jsonb('spec').notNull(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const teamAgents = pgTable('team_agents', {
  teamId: uuid('team_id').notNull().references(() => teams.id),
  templateId: uuid('template_id').notNull().references(() => agentTemplates.id),
  appliedVersion: integer('applied_version'),
  applyStatus: text('apply_status').notNull().default('pending'),
  applyError: text('apply_error'),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  assignedBy: uuid('assigned_by'),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.teamId, t.templateId] }),
  check('team_agents_apply_status_check', sql`${t.applyStatus} in ('pending', 'applied', 'failed')`),
]);

export const usageSamples = pgTable('usage_samples', {
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  cpuPct: doublePrecision('cpu_pct').notNull(),
  memBytes: bigint('mem_bytes', { mode: 'number' }).notNull(),
  memLimitBytes: bigint('mem_limit_bytes', { mode: 'number' }),
  diskBytes: bigint('disk_bytes', { mode: 'number' }),
  diskLimitBytes: bigint('disk_limit_bytes', { mode: 'number' }),
}, (t) => [index('usage_samples_target_ts').on(t.targetType, t.targetId, t.ts)]);

// ── drive (03-data-model.md 드라이브) — files live on disk, the DB only keeps records ──

export const driveEvents = pgTable('drive_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  teamId: uuid('team_id').notNull(),
  space: text('space').notNull(),
  ownerUserId: uuid('owner_user_id'),
  path: text('path').notNull(),
  prevPath: text('prev_path'),
  action: text('action').notNull(),
  actorKind: text('actor_kind').notNull(),
  actorUserId: uuid('actor_user_id'),
  createdAt: createdAt(),
}, (t) => [
  index('drive_events_path').on(t.teamId, t.space, t.path),
  check('drive_events_space_check', sql`${t.space} in ('me', 'shared')`),
  check('drive_events_action_check', sql`${t.action} in ('create', 'update', 'rename', 'move', 'copy', 'trash', 'restore', 'delete')`),
  check('drive_events_actor_check', sql`${t.actorKind} in ('user', 'agent', 'system')`),
]);

export const trashItems = pgTable('trash_items', {
  id: uuid('id').primaryKey(),
  teamId: uuid('team_id').notNull(),
  space: text('space').notNull(),
  ownerUserId: uuid('owner_user_id'),
  originalPath: text('original_path').notNull(),
  isDir: boolean('is_dir').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  deletedBy: uuid('deleted_by').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
  purgeAfter: timestamp('purge_after', { withTimezone: true }).notNull(),
}, (t) => [index('trash_items_team').on(t.teamId), check('trash_items_space_check', sql`${t.space} in ('me', 'shared')`)]);

// ── apps (03-data-model.md 앱): one app = work copy + optional public copy ──

export const apps = pgTable('apps', {
  id: uuid('id').primaryKey(),
  teamId: uuid('team_id').notNull().references(() => teams.id),
  creatorId: uuid('creator_id'),
  slug: text('slug').notNull(),
  sourceSpace: text('source_space').notNull().default('shared'),
  sourcePath: text('source_path').notNull(),
  runSpec: jsonb('run_spec').notNull().$type<{ command: string; port: number; runtime: 'node' | 'python' | 'static'; env?: Record<string, string> }>(),
  resourceLimits: jsonb('resource_limits').$type<{ cpu: number; memoryMb: number }>(),
  workStatus: text('work_status').notNull().default('stopped'),
  workStopReason: text('work_stop_reason'),
  workStatusDetail: text('work_status_detail'),
  workContainerId: text('work_container_id'),
  workLastAccessedAt: timestamp('work_last_accessed_at', { withTimezone: true }),
  workStartedAt: timestamp('work_started_at', { withTimezone: true }),
  publicName: text('public_name'),
  publicVersion: integer('public_version'),
  publicStatus: text('public_status'),
  publicStopReason: text('public_stop_reason'),
  publicStatusDetail: text('public_status_detail'),
  publicContainerId: text('public_container_id'),
  publicSnapshotPath: text('public_snapshot_path'),
  publicPublishedAt: timestamp('public_published_at', { withTimezone: true }),
  publicApprovedBy: uuid('public_approved_by'),
  publicLastAccessedAt: timestamp('public_last_accessed_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('apps_team_slug').on(t.teamId, t.slug).where(sql`${t.deletedAt} is null`),
  uniqueIndex('apps_team_source').on(t.teamId, t.sourceSpace, t.sourcePath).where(sql`${t.deletedAt} is null`),
  check('apps_work_status_check', sql`${t.workStatus} in ('starting', 'running', 'stopped', 'error')`),
  check('apps_public_status_check', sql`${t.publicStatus} is null or ${t.publicStatus} in ('starting', 'running', 'stopped', 'error')`),
  check('apps_work_stop_reason_check', sql`${t.workStopReason} is null or ${t.workStopReason} in ('idle', 'limit', 'manual')`),
  check('apps_public_stop_reason_check', sql`${t.publicStopReason} is null or ${t.publicStopReason} in ('idle', 'manual', 'admin')`),
]);

export const deployRequests = pgTable('deploy_requests', {
  id: uuid('id').primaryKey(),
  appId: uuid('app_id').notNull().references(() => apps.id),
  kind: text('kind').notNull(),
  requestedBy: uuid('requested_by'),
  requestedName: text('requested_name'),
  reason: text('reason').notNull(),
  fromVersion: integer('from_version'),
  diffSummary: jsonb('diff_summary').$type<{ added: string[]; modified: string[]; removed: string[] }>(),
  status: text('status').notNull().default('pending'),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  approvedVersion: integer('approved_version'),
  createdAt: createdAt(),
}, (t) => [
  // One pending request per app (03-data-model.md).
  uniqueIndex('deploy_requests_one_pending').on(t.appId).where(sql`${t.status} = 'pending'`),
  check('deploy_requests_kind_check', sql`${t.kind} in ('publish', 'update')`),
  check('deploy_requests_status_check', sql`${t.status} in ('pending', 'approved', 'rejected', 'cancelled')`),
]);

export const appVersions = pgTable('app_versions', {
  appId: uuid('app_id').notNull().references(() => apps.id),
  version: integer('version').notNull(),
  snapshotPath: text('snapshot_path').notNull(),
  requestId: uuid('request_id'),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.appId, t.version] })]);

// ── MCP market (03-data-model.md MCP, docs/README.md 6단계). Secret values are never stored. ──

export const mcpPackages = pgTable('mcp_packages', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull().unique(),
  /** null = platform-mcp (seeded). */
  ownerId: uuid('owner_id').references(() => users.id),
  displayName: text('display_name').notNull(),
  summary: text('summary').notNull(),
  category: text('category').notNull(),
  icon: text('icon'),
  status: text('status').notNull().default('active'),
  isDefault: boolean('is_default').notNull().default(false),
  isPlatform: boolean('is_platform').notNull().default(false),
  latestVersionId: uuid('latest_version_id'),
  installCount: integer('install_count').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [check('mcp_packages_status_check', sql`${t.status} in ('active', 'suspended')`)]);

export interface McpFinding { severity: string; pkg: string; id: string; title: string }
export interface McpToolInfo { name: string; title?: string; description: string; inputSchema: unknown }

export const mcpVersions = pgTable('mcp_versions', {
  id: uuid('id').primaryKey(),
  packageId: uuid('package_id').notNull().references(() => mcpPackages.id),
  version: text('version').notNull(),
  uploadedBy: uuid('uploaded_by'),
  status: text('status').notNull().default('uploaded'),
  failedStage: text('failed_stage'),
  statusDetail: text('status_detail'),
  /** When the current stage started: the dispatcher fails builds stuck longer than its timeout. */
  stageAt: timestamp('stage_at', { withTimezone: true }).notNull().defaultNow(),
  manifest: jsonb('manifest').notNull(),
  readme: text('readme').notNull().default(''),
  tools: jsonb('tools').$type<McpToolInfo[]>(),
  scanSummary: jsonb('scan_summary').$type<{ critical: number; high: number; medium: number; low: number }>(),
  scanFindings: jsonb('scan_findings').$type<McpFinding[]>(),
  imageRef: text('image_ref'),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNote: text('review_note'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('mcp_versions_package_version').on(t.packageId, t.version),
  index('mcp_versions_status').on(t.status, t.createdAt),
  check('mcp_versions_status_check', sql`${t.status} in ('uploaded', 'validating', 'building', 'scanning', 'testing', 'in_review', 'published', 'failed', 'rejected', 'superseded')`),
  check('mcp_versions_failed_stage_check', sql`${t.failedStage} is null or ${t.failedStage} in ('validate', 'build', 'scan', 'test')`),
]);

export const mcpInstalls = pgTable('mcp_installs', {
  id: uuid('id').primaryKey(),
  teamId: uuid('team_id').notNull().references(() => teams.id),
  source: text('source').notNull(),
  packageId: uuid('package_id').references(() => mcpPackages.id),
  versionId: uuid('version_id').references(() => mcpVersions.id),
  manualName: text('manual_name'),
  manualUrl: text('manual_url'),
  serverKey: text('server_key').notNull(),
  status: text('status').notNull().default('installing'),
  statusDetail: text('status_detail'),
  secretNames: text('secret_names').array().notNull().default(sql`'{}'::text[]`),
  installedBy: uuid('installed_by'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('mcp_installs_team_key').on(t.teamId, t.serverKey),
  index('mcp_installs_package').on(t.packageId),
  check('mcp_installs_source_check', sql`${t.source} in ('default', 'market', 'manual')`),
  check('mcp_installs_status_check', sql`${t.status} in ('installing', 'installed', 'error', 'removing')`),
]);

// ── community and notifications (03-data-model.md, docs/README.md 7단계) ──

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey(),
  authorId: uuid('author_id').notNull().references(() => users.id),
  category: text('category').notNull(),
  title: text('title').notNull(),
  bodyMd: text('body_md').notNull(),
  attachedPackageId: uuid('attached_package_id').references(() => mcpPackages.id),
  attachedAppId: uuid('attached_app_id').references(() => apps.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  index('posts_time').on(t.createdAt),
  check('posts_category_check', sql`${t.category} in ('notice', 'question', 'tip', 'mcp_share', 'app_share')`),
]);

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  type: text('type').notNull(),
  title: text('title').notNull(),
  link: text('link'),
  payload: jsonb('payload'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index('notifications_user_time').on(t.userId, t.createdAt),
  check('notifications_type_check', sql`${t.type} in ('deploy_approved', 'deploy_rejected', 'mcp_build_succeeded', 'mcp_build_failed', 'mcp_approved', 'mcp_rejected', 'team_container_error', 'agent_assignment_changed', 'admin_review_requested', 'app_force_stopped')`),
]);
