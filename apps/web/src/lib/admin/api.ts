import type { TeamRole, TeamStatus } from '@kacp/shared';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import type {
  AdminTeam,
  AdminTeamDetail,
  AdminUser,
  AdminUserDetail,
  AgentTemplate,
  AgentTemplateInput,
  AuditEvent,
  CreateTeamInput,
  CreateUserInput,
  Dashboard,
  Department,
  DepartmentInput,
  DepartmentNode,
  ImportApplyResult,
  ImportJob,
  ImportKind,
  Member,
  Page,
  PlatformSettings,
  ResourceLimits,
  Series,
  TeamAgent,
  UpdateUserInput,
  UserRef,
  UserStatusFilter,
} from './types';

// Admin API calls (04-api.md §2 관리자) and their query keys.

export const adminKeys = {
  all: ['admin'] as const,
  dashboard: ['admin', 'dashboard'] as const,
  metrics: (range: string) => ['admin', 'metrics', 'vm', range] as const,
  users: (filters: UserFilters) => ['admin', 'users', 'list', filters] as const,
  usersAll: ['admin', 'users'] as const,
  user: (id: string) => ['admin', 'users', 'detail', id] as const,
  departments: (includeArchived: boolean) => ['departments', { includeArchived }] as const,
  departmentsAll: ['departments'] as const,
  deptMembers: (id: string, includeDescendants: boolean) => ['admin', 'dept-members', id, includeDescendants] as const,
  deptMembersAll: ['admin', 'dept-members'] as const,
  teams: (q: string) => ['admin', 'teams', 'list', q] as const,
  teamsAll: ['admin', 'teams'] as const,
  team: (team: string) => ['admin', 'teams', 'detail', team] as const,
  templates: ['admin', 'templates'] as const,
  template: (id: string) => ['admin', 'templates', id] as const,
  settings: ['admin', 'settings'] as const,
  audit: (filters: AuditFilters) => ['admin', 'audit', filters] as const,
  auditAll: ['admin', 'audit'] as const,
  userSearch: (q: string, departmentId?: string) => ['users', 'search', q, departmentId ?? null] as const,
};

export interface UserFilters {
  q?: string;
  role?: 'admin' | 'user';
  status?: UserStatusFilter;
  team?: string;
  departmentId?: string;
  includeDescendants?: boolean;
}

export interface AuditFilters {
  from?: string;
  to?: string;
  actor?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  team?: string;
}

const enc = encodeURIComponent;

export const adminApi = {
  dashboard: () => api.get<Dashboard>('/admin/dashboard'),
  metrics: (range: '24h' | '7d') => api.get<Series>(`/admin/metrics${qs({ target: 'vm', range })}`),

  users: (f: UserFilters, cursor?: string) =>
    api.get<Page<AdminUser>>(`/admin/users${qs({ ...f, cursor, limit: 50 })}`),
  user: (id: string) => api.get<AdminUserDetail>(`/admin/users/${enc(id)}`),
  createUser: (body: CreateUserInput) =>
    api.post<{ user: AdminUser; initialPassword: string }>('/admin/users', body),
  updateUser: (id: string, body: UpdateUserInput) => api.patch<AdminUser>(`/admin/users/${enc(id)}`, body),
  resetPassword: (id: string) => api.post<{ temporaryPassword: string }>(`/admin/users/${enc(id)}/reset-password`),
  disableUser: (id: string, restartTeams: boolean) =>
    api.post<AdminUser>(`/admin/users/${enc(id)}/disable`, { restartTeams }),
  enableUser: (id: string) => api.post<AdminUser>(`/admin/users/${enc(id)}/enable`, {}),
  bulkDepartment: (userIds: string[], departmentId: string) =>
    api.post<void>('/admin/users/bulk-department', { userIds, departmentId }),
  searchUsers: (q: string, departmentId?: string) =>
    api.get<{ items: UserRef[] }>(`/users/search${qs({ q, departmentId })}`),

  departments: (includeArchived: boolean) =>
    api.get<{ items: DepartmentNode[] }>(`/departments${qs({ includeArchived: includeArchived || undefined })}`),
  createDepartment: (body: DepartmentInput) => api.post<Department>('/admin/departments', body),
  updateDepartment: (id: string, body: DepartmentInput) => api.patch<Department>(`/admin/departments/${enc(id)}`, body),
  moveDepartment: (id: string, parentId: string | null, sortOrder?: number) =>
    api.post<Department>(`/admin/departments/${enc(id)}/move`, sortOrder === undefined ? { parentId } : { parentId, sortOrder }),
  archiveDepartment: (id: string, archive: boolean) =>
    api.post<Department>(`/admin/departments/${enc(id)}/${archive ? 'archive' : 'unarchive'}`),
  departmentMembers: (id: string, includeDescendants: boolean) =>
    api.get<{ items: AdminUser[] }>(`/admin/departments/${enc(id)}/members${qs({ includeDescendants })}`),

  importPreview: (kind: ImportKind, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.upload<ImportJob>(`/admin/import/${kind}/preview`, form);
  },
  importApply: (kind: ImportKind, jobId: string, skipErrors: boolean) =>
    api.post<ImportApplyResult>(`/admin/import/${kind}/apply`, { jobId, skipErrors }),

  teams: (q = '') => api.get<{ items: AdminTeam[] }>(`/admin/teams${qs({ q })}`),
  createTeam: (body: CreateTeamInput) => api.post<AdminTeam>('/admin/teams', body),
  team: (team: string) => api.get<AdminTeamDetail>(`/admin/teams/${enc(team)}`),
  renameTeam: (team: string, displayName: string) => api.patch<AdminTeam>(`/admin/teams/${enc(team)}`, { displayName }),
  deleteTeam: (team: string) => api.delete<void>(`/admin/teams/${enc(team)}`, { confirmName: team }),
  container: (team: string, action: 'start' | 'stop' | 'restart') =>
    api.post<TeamStatus>(`/admin/teams/${enc(team)}/container/${action}`),
  resources: (team: string, limits: ResourceLimits) =>
    api.put<ResourceLimits>(`/admin/teams/${enc(team)}/resources`, limits),
  assignAgents: (team: string, templateIds: string[]) =>
    api.post<{ items: TeamAgent[] }>(`/admin/teams/${enc(team)}/agents`, { templateIds }),
  unassignAgent: (team: string, templateId: string) =>
    api.delete<void>(`/admin/teams/${enc(team)}/agents/${enc(templateId)}`),
  checkName: (name: string) =>
    api.get<{ available: boolean; reason: string | null }>(`/names/check${qs({ name })}`),

  addMembers: (team: string, userIds: string[], teamRole: TeamRole = 'member') =>
    api.post<Member>(`/teams/${enc(team)}/members`, { userIds, teamRole }),
  setMemberRole: (team: string, userId: string, teamRole: TeamRole) =>
    api.patch<Member>(`/teams/${enc(team)}/members/${enc(userId)}`, { teamRole }),
  removeMember: (team: string, userId: string) => api.delete<void>(`/teams/${enc(team)}/members/${enc(userId)}`),

  templates: () => api.get<{ items: AgentTemplate[] }>('/admin/agent-templates'),
  template: (id: string) => api.get<AgentTemplate>(`/admin/agent-templates/${enc(id)}`),
  createTemplate: (body: AgentTemplateInput) => api.post<AgentTemplate>('/admin/agent-templates', body),
  updateTemplate: (id: string, body: AgentTemplateInput) => api.put<AgentTemplate>(`/admin/agent-templates/${enc(id)}`, body),
  deleteTemplate: (id: string) => api.delete<void>(`/admin/agent-templates/${enc(id)}`),

  settings: () => api.get<PlatformSettings>('/admin/settings'),
  saveSettings: (body: PlatformSettings) => api.put<PlatformSettings>('/admin/settings', body),
  setApiKey: (provider: string, key: string) => api.put<void>(`/admin/settings/api-keys/${enc(provider)}`, { key }),

  audit: (f: AuditFilters, cursor?: string, limit = 50) =>
    api.get<Page<AuditEvent>>(`/admin/audit-events${qs({ ...f, cursor, limit })}`),
};

// ── hooks ──

export function useDepartments(includeArchived = false) {
  return useQuery({
    queryKey: adminKeys.departments(includeArchived),
    queryFn: async () => (await adminApi.departments(includeArchived)).items,
    staleTime: 30_000,
  });
}

export function useAdminTeams(q = '') {
  return useQuery({
    queryKey: adminKeys.teams(q),
    queryFn: async () => (await adminApi.teams(q)).items,
    placeholderData: keepPreviousData,
  });
}

export function useAdminSettings() {
  return useQuery({ queryKey: adminKeys.settings, queryFn: adminApi.settings, staleTime: 30_000 });
}

export function useTemplates() {
  return useQuery({ queryKey: adminKeys.templates, queryFn: async () => (await adminApi.templates()).items });
}

export function useDepartmentMembers(id: string | null, includeDescendants: boolean) {
  return useQuery({
    queryKey: adminKeys.deptMembers(id ?? '', includeDescendants),
    queryFn: async () => (await adminApi.departmentMembers(id ?? '', includeDescendants)).items,
    enabled: id !== null,
  });
}

export function useAdminUsers(filters: UserFilters) {
  return useInfiniteQuery({
    queryKey: adminKeys.users(filters),
    queryFn: ({ pageParam }) => adminApi.users(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useAuditEvents(filters: AuditFilters) {
  return useInfiniteQuery({
    queryKey: adminKeys.audit(filters),
    queryFn: ({ pageParam }) => adminApi.audit(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}
