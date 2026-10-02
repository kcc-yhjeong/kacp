import type {
  HostKind,
  ListResponse,
  Me,
  MyTeam,
  SessionInfo,
  TeamDetail,
  TeamStatus,
} from '@kacp/shared';
import { QueryCache, QueryClient, useQuery } from '@tanstack/react-query';
import { api, ApiError, setCsrfToken } from './api';
import { appOrigin, loginUrl } from './host';

export const keys = {
  me: ['me'] as const,
  myTeams: ['me', 'teams'] as const,
  sessions: ['me', 'sessions'] as const,
  team: (team: string) => ['teams', team] as const,
  teamStatus: (team: string) => ['teams', team, 'status'] as const,
  name: (name: string) => ['names', name] as const,
};

let redirecting = false;

/** Global auth handling for queries (C-05): 401 → login, password-setup-only session → C-02. */
function onQueryError(err: unknown): void {
  if (!(err instanceof ApiError) || redirecting) return;
  if (err.status === 401) {
    redirecting = true;
    location.href = loginUrl();
  } else if (err.code === 'AUTH_PASSWORD_CHANGE_REQUIRED') {
    redirecting = true;
    location.href = `${appOrigin}/password/setup`;
  }
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: onQueryError }),
    defaultOptions: {
      queries: {
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
        refetchOnWindowFocus: false,
        staleTime: 10_000,
      },
    },
  });
}

export async function fetchMe(): Promise<Me> {
  const me = await api.get<Me>('/auth/me');
  setCsrfToken(me.csrfToken);
  return me;
}

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: fetchMe, staleTime: 60_000 });
}

export function useMyTeams(enabled = true) {
  return useQuery({
    queryKey: keys.myTeams,
    queryFn: async () => (await api.get<ListResponse<MyTeam>>('/me/teams')).items,
    enabled,
  });
}

export function useMySessions() {
  return useQuery({
    queryKey: keys.sessions,
    queryFn: async () => (await api.get<ListResponse<SessionInfo>>('/me/sessions')).items,
  });
}

export function useTeam(team: string, enabled = true) {
  return useQuery({ queryKey: keys.team(team), queryFn: () => api.get<TeamDetail>(`/teams/${team}`), enabled });
}

export function useHostKind(name: string | null) {
  return useQuery({
    queryKey: keys.name(name ?? ''),
    queryFn: () => api.get<{ hostKind: HostKind; running: boolean }>(`/names/${encodeURIComponent(name ?? '')}`),
    enabled: name !== null,
    staleTime: Infinity,
  });
}

export const teamApi = {
  status: (team: string) => api.get<TeamStatus>(`/teams/${team}/status`),
  startSession: (team: string) => api.post<TeamStatus>(`/teams/${team}/session`),
  heartbeat: (team: string) => api.post<void>(`/teams/${team}/heartbeat`),
};

export const authApi = {
  login: (email: string, password: string) => api.post<Me>('/auth/login', { email, password }),
  logout: () => api.post<void>('/auth/logout'),
  changePassword: (newPassword: string, currentPassword?: string) =>
    api.post<void>('/auth/password', currentPassword === undefined ? { newPassword } : { currentPassword, newPassword }),
  logoutOtherSessions: () => api.delete<void>('/me/sessions'),
};

/** Log out and land on the login page of the app host. */
export async function logoutAndLeave(): Promise<void> {
  await authApi.logout();
  setCsrfToken(null);
  location.href = `${appOrigin}/login`;
}
