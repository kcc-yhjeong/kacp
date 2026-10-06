import type { Member, PlatformRole, TeamRole, TeamStatus, UserRef } from '@kacp/shared';

// Admin response shapes. Mirrors docs/design/openapi.yaml components (admin + org).

export type { Member, UserRef };

export interface Page<T> {
  items: T[];
  nextCursor?: string | null;
}

export interface DepartmentRef {
  id: string;
  code: string;
  name: string;
  /** From the top, e.g. ["경영지원본부", "인사팀"]. */
  pathNames: string[];
}

export type DepartmentStatus = 'active' | 'archived';

export interface Department extends DepartmentRef {
  parentId: string | null;
  depth: number;
  sortOrder: number;
  head: UserRef | null;
  status: DepartmentStatus;
  /** This department only. */
  memberCount: number;
  /** Including descendants. */
  totalMemberCount: number;
}

export interface DepartmentNode extends Department {
  children: DepartmentNode[];
}

export interface DepartmentInput {
  name?: string;
  code?: string;
  parentId?: string | null;
  headUserId?: string | null;
  sortOrder?: number;
}

export type UserStatus = 'active' | 'disabled';
export type UserStatusFilter = UserStatus | 'must_change_password';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  department: DepartmentRef | null;
  title: string | null;
  employeeNo: string | null;
  platformRole: PlatformRole;
  status: UserStatus;
  mustChangePassword: boolean;
  teams: { name: string; teamRole: TeamRole }[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminUserDetail extends AdminUser {
  recentLogins: { at: string; ip: string; success: boolean }[];
}

export interface CreateUserInput {
  email: string;
  name: string;
  departmentId?: string;
  title?: string;
  employeeNo?: string;
  platformRole?: PlatformRole;
  initialPassword?: string;
  teams?: { team: string; teamRole: TeamRole }[];
}

export interface UpdateUserInput {
  name?: string;
  departmentId?: string | null;
  title?: string | null;
  employeeNo?: string | null;
  platformRole?: PlatformRole;
}

export interface ResourceLimits {
  cpu: number;
  memoryMb: number;
  diskGb: number;
}

export type ProvisionStage = 'name' | 'storage' | 'container' | 'default_mcp' | 'done' | 'failed';

export interface AdminTeam {
  name: string;
  displayName: string;
  memberCount: number;
  admins: UserRef[];
  agentCount: number;
  status: TeamStatus;
  provisionStage: ProvisionStage;
  resourceLimits: ResourceLimits;
  createdAt: string;
}

export type ApplyStatus = 'pending' | 'applied' | 'failed';

export interface AgentTemplateSummary {
  id: string;
  name: string;
  icon: string;
  description: string;
  version: number;
}

export interface TeamAgent {
  template: AgentTemplateSummary;
  templateVersion: number;
  appliedVersion: number | null;
  applyStatus: ApplyStatus;
  applyError: string | null;
  /** `team_agents.applied_at` (03-data-model). Not in openapi.yaml yet — shown when present. */
  appliedAt?: string | null;
}

export interface AdminTeamDetail extends AdminTeam {
  members: Member[];
  agents: TeamAgent[];
  usage?: { cpuPct: number; memBytes: number; diskBytes: number } | null;
  /** Stage 6 (MCP). Only counted here. */
  mcpInstalls?: unknown[];
  /** Stage 5 (apps). Only counted here. */
  apps?: unknown[];
}

export interface CreateTeamInput {
  name: string;
  displayName: string;
  adminEmails?: string[];
  memberUserIds?: string[];
  resourceLimits?: ResourceLimits;
}

export type Reasoning = 'low' | 'medium' | 'high';

export interface AgentSkill {
  name: string;
  source: 'bundled' | 'upload';
  ref?: string;
}

export interface AgentSpec {
  /** No `model` = team defaults. `id` is legacy (pre-stage 7): shown read-only and dropped on save. */
  model?: { id?: string; reasoning?: Reasoning };
  instructions?: string;
  skills?: AgentSkill[];
  defaultMcp?: string[];
  tools?: { allow?: string[]; deny?: string[] };
}

export interface AgentTemplateInput {
  name: string;
  icon?: string;
  description?: string;
  spec: AgentSpec;
}

export interface AgentTemplate extends AgentTemplateSummary {
  spec: AgentSpec;
  assignedTeams: { name: string; applyStatus: ApplyStatus }[];
  updatedAt: string;
  updatedBy?: UserRef | null;
}

export type CapacityResource = 'cpu' | 'memory' | 'disk';

export interface Dashboard {
  teams: { total: number; running: number };
  activeUsers: number;
  runningApps: { work: number; public: number };
  pending: { deployRequests: number; mcpReviews: number };
  vm: { cpuPct: number; memPct: number; diskPct: number };
  warnings: { level: 'warn' | 'danger'; resource: CapacityResource; message: string }[];
  teamContainers: {
    team: string;
    status: TeamStatus['status'];
    activeUsers: number;
    cpuPct: number;
    memBytes: number;
    memLimitBytes: number;
    lastActiveAt: string | null;
  }[];
}

export interface Series {
  points: { ts: string; cpuPct: number; memBytes: number; diskBytes: number }[];
}

export interface CapacityThresholds {
  cpu: number;
  memory: number;
  disk: number;
}

export interface PlatformSettings {
  limits: { teamDefault: ResourceLimits; appDefault: ResourceLimits; mcpDefault: ResourceLimits };
  ops: {
    idleStopMinutes: number;
    appIdleStopMinutes: { work: number; public: number };
    maxRunningWorkAppsPerTeam: number;
    capacityWarn: { warn: CapacityThresholds; danger: CapacityThresholds };
    trashRetentionDays: number;
  };
  names: {
    /** Read-only built-in list. */
    reserved?: string[];
    reservedExtra: string[];
  };
}

export interface AuditEvent {
  id: number;
  at: string;
  actor: UserRef | null;
  action: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  team: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
}

export type ImportKind = 'departments' | 'users';
export type ImportRowAction = 'add' | 'update' | 'unchanged' | 'error';

export interface ImportRow {
  line: number;
  action: ImportRowAction;
  key: string;
  /** `{field: [before, after]}` for the cells that change. */
  changes?: Record<string, [unknown, unknown]> | null;
  error: string | null;
}

export interface ImportJob {
  id: string;
  kind: ImportKind;
  status: 'previewed' | 'applied' | 'cancelled';
  fileName: string;
  summary: { added: number; updated: number; unchanged: number; errors: number };
  rows: ImportRow[];
}

export interface ImportApplyResult extends ImportJob {
  initialPasswordsCsv?: string | null;
}
