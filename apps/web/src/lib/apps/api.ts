import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import type { AdminDeployRequest, App, AppCopy, AppCopyKind, AppDetail, AppHostInfo, DeployRequest, SeriesPoint, TeamAppsResponse } from './types';

// App API calls (04-api.md §2 앱·배포, 관리자 deploy-requests · apps) and their query keys.

const enc = encodeURIComponent;

export type CopyAction = 'start' | 'stop' | 'restart';

export const appKeys = {
  all: ['apps'] as const,
  team: (team: string) => ['apps', 'team', team] as const,
  detail: (id: string) => ['apps', 'detail', id] as const,
  stats: (id: string, target: AppCopyKind) => ['apps', 'detail', id, 'stats', target] as const,
  logs: (id: string, target: AppCopyKind) => ['apps', 'detail', id, 'logs', target] as const,
  host: (host: string) => ['app-hosts', host] as const,
  adminAll: ['admin', 'deploy'] as const,
  adminRequests: (status: 'pending' | 'decided') => ['admin', 'deploy', 'requests', status] as const,
  adminApps: (filter: { public?: boolean; team?: string }) => ['admin', 'deploy', 'apps', filter] as const,
};

export const appApi = {
  teamApps: (team: string) => api.get<TeamAppsResponse>(`/teams/${enc(team)}/apps`),
  detail: (id: string) => api.get<AppDetail>(`/apps/${enc(id)}`),
  control: (id: string, target: AppCopyKind, action: CopyAction) =>
    api.post<AppCopy>(`/apps/${enc(id)}/${target}/${action}`),
  remove: (id: string, confirmName?: string) =>
    api.delete<void>(`/apps/${enc(id)}`, confirmName === undefined ? undefined : { confirmName }),
  requestPublish: (id: string, body: { name: string; reason: string } | { reason: string }) =>
    api.post<DeployRequest>(`/apps/${enc(id)}/public-request`, body),
  cancelRequest: (id: string) => api.delete<void>(`/apps/${enc(id)}/public-request`),
  unpublish: (id: string) => api.post<void>(`/apps/${enc(id)}/unpublish`),
  logs: (id: string, target: AppCopyKind, tail = 500) =>
    api.get<{ lines: string[] }>(`/apps/${enc(id)}/logs${qs({ target, tail })}`),
  stats: (id: string, target: AppCopyKind) =>
    api.get<{ points: SeriesPoint[] }>(`/apps/${enc(id)}/stats${qs({ target, range: '1h' })}`),
  host: (host: string) => api.get<AppHostInfo>(`/app-hosts/${enc(host)}`),
  wake: (host: string) => api.post<void>(`/app-hosts/${enc(host)}/wake`),
  checkName: (name: string) => api.get<{ available: boolean; reason: string | null }>(`/names/check${qs({ name })}`),
};

export const adminDeployApi = {
  requests: (status: 'pending' | 'decided') =>
    api.get<{ items: AdminDeployRequest[] }>(`/admin/deploy-requests${qs({ status })}`),
  approve: (id: string, note?: string) =>
    api.post<DeployRequest>(`/admin/deploy-requests/${enc(id)}/approve`, note ? { note } : {}),
  reject: (id: string, note: string) => api.post<DeployRequest>(`/admin/deploy-requests/${enc(id)}/reject`, { note }),
  apps: (filter: { public?: boolean; team?: string }) =>
    api.get<{ items: App[] }>(`/admin/apps${qs({ public: filter.public, team: filter.team })}`),
  forceStop: (id: string, reason: string) => api.post<void>(`/admin/apps/${enc(id)}/public/force-stop`, { reason }),
  resume: (id: string) => api.post<void>(`/admin/apps/${enc(id)}/public/resume`),
};

/** Team apps. `poll` = refetch every 10 s while the tab is visible (U-02). */
export function useTeamApps(team: string, opts: { enabled?: boolean; poll?: boolean } = {}) {
  return useQuery({
    queryKey: appKeys.team(team),
    queryFn: () => appApi.teamApps(team),
    enabled: opts.enabled ?? true,
    refetchInterval: opts.poll ? 10_000 : false,
  });
}

export function useAppDetail(id: string, enabled = true) {
  return useQuery({
    queryKey: appKeys.detail(id),
    queryFn: () => appApi.detail(id),
    enabled,
    // Keep transitional states fresh (a copy starting, a stop in flight).
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      return d.work.status === 'starting' || d.public?.status === 'starting' ? 2_000 : 15_000;
    },
  });
}

export function usePendingDeployRequests(enabled = true) {
  return useQuery({
    queryKey: appKeys.adminRequests('pending'),
    queryFn: async () => (await adminDeployApi.requests('pending')).items,
    enabled,
    refetchInterval: 30_000,
  });
}

/** Refresh everything that shows this app (team list, detail, admin lists). */
export async function invalidateApp(qc: QueryClient, app: { id: string; team: string }): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: appKeys.team(app.team) }),
    qc.invalidateQueries({ queryKey: appKeys.detail(app.id) }),
    qc.invalidateQueries({ queryKey: appKeys.adminAll }),
  ]);
}
