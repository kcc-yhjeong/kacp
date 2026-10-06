import { ERROR_MESSAGES, type ApiErrorBody } from '@kacp/shared';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, getCsrfToken, qs } from '@/lib/api';
import { apiBase } from '@/lib/host';
import { hasBusyInstall, isVersionBusy } from './status';
import type {
  AdminMcpInstall,
  AdminMcpVersionDetail,
  McpInstall,
  McpInstallSource,
  McpLogStage,
  McpPackageDetail,
  McpPackageSummary,
  McpVersion,
  McpVersionDetail,
  MyMcpPackage,
  TeamInstallsResponse,
} from './types';

// MCP API calls (04-api.md §2 MCP 마켓 · 관리자 mcp) and their query keys.

const enc = encodeURIComponent;

export type MarketSort = 'popular' | 'recent';

export interface MarketFilter {
  q?: string;
  category?: string;
  sort?: MarketSort;
  team?: string;
}

export const mcpKeys = {
  all: ['mcp'] as const,
  packages: (f: MarketFilter) => ['mcp', 'packages', f] as const,
  packagesAll: ['mcp', 'packages'] as const,
  pkg: (pkg: string, team?: string) => ['mcp', 'package', pkg, team ?? null] as const,
  pkgAll: (pkg: string) => ['mcp', 'package', pkg] as const,
  installs: (team: string) => ['mcp', 'installs', team] as const,
  mine: ['mcp', 'mine'] as const,
  version: (pkg: string, ver: string) => ['mcp', 'version', pkg, ver] as const,
  logs: (pkg: string, ver: string, stage: McpLogStage) => ['mcp', 'version', pkg, ver, 'logs', stage] as const,
  adminAll: ['admin', 'mcp'] as const,
  adminReviews: ['admin', 'mcp', 'reviews'] as const,
  adminVersion: (id: string) => ['admin', 'mcp', 'version', id] as const,
  adminPackages: ['admin', 'mcp', 'packages'] as const,
  adminInstalls: (f: { team?: string; source?: McpInstallSource }) => ['admin', 'mcp', 'installs', f] as const,
};

export const mcpApi = {
  packages: (f: MarketFilter) =>
    api.get<{ items: McpPackageSummary[] }>(`/mcp/packages${qs({ q: f.q, category: f.category, sort: f.sort, team: f.team })}`),
  pkg: (pkg: string, team?: string) => api.get<McpPackageDetail>(`/mcp/packages/${enc(pkg)}${qs({ team })}`),
  installs: (team: string) => api.get<TeamInstallsResponse>(`/teams/${enc(team)}/mcp/installs`),
  install: (team: string, body: { packageName: string; version?: string; secrets: Record<string, string> }) =>
    api.post<McpInstall>(`/teams/${enc(team)}/mcp/installs`, body),
  putSecrets: (team: string, id: string, secrets: Record<string, string>) =>
    api.put<void>(`/teams/${enc(team)}/mcp/installs/${enc(id)}/secrets`, { secrets }),
  remove: (team: string, id: string) => api.delete<void>(`/teams/${enc(team)}/mcp/installs/${enc(id)}`),
  addManual: (team: string, body: { name: string; url: string; headers?: Record<string, string> }) =>
    api.post<McpInstall>(`/teams/${enc(team)}/mcp/manual`, body),
  mine: () => api.get<{ items: MyMcpPackage[] }>('/me/mcp/packages'),
  version: (pkg: string, ver: string) => api.get<McpVersionDetail>(`/mcp/packages/${enc(pkg)}/versions/${enc(ver)}`),
  logs: (pkg: string, ver: string, stage: McpLogStage) =>
    api.get<{ text: string }>(`/mcp/packages/${enc(pkg)}/versions/${enc(ver)}/logs${qs({ stage })}`),
};

export const adminMcpApi = {
  reviews: () => api.get<{ items: McpVersion[] }>('/admin/mcp/reviews'),
  version: (id: string) => api.get<AdminMcpVersionDetail>(`/admin/mcp/versions/${enc(id)}`),
  approve: (id: string, note?: string) => api.post<McpVersion>(`/admin/mcp/versions/${enc(id)}/approve`, note ? { note } : {}),
  reject: (id: string, note: string) => api.post<McpVersion>(`/admin/mcp/versions/${enc(id)}/reject`, { note }),
  packages: () => api.get<{ items: McpPackageSummary[] }>('/admin/mcp/packages'),
  suspend: (pkg: string, removeInstalls: boolean) =>
    api.post<McpPackageSummary>(`/admin/mcp/packages/${enc(pkg)}/suspend`, { removeInstalls }),
  resume: (pkg: string) => api.post<McpPackageSummary>(`/admin/mcp/packages/${enc(pkg)}/resume`, {}),
  setDefault: (pkg: string, isDefault: boolean) =>
    api.put<McpPackageSummary>(`/admin/mcp/packages/${enc(pkg)}/default`, { isDefault }),
  installs: (f: { team?: string; source?: McpInstallSource }) =>
    api.get<{ items: AdminMcpInstall[] }>(`/admin/mcp/installs${qs({ team: f.team, source: f.source })}`),
};

function parseXhrError(status: number, text: string): ApiError {
  let body: Partial<ApiErrorBody> | undefined;
  try {
    body = text ? (JSON.parse(text) as Partial<ApiErrorBody>) : undefined;
  } catch {
    body = undefined;
  }
  const err = body?.error;
  return new ApiError(
    status,
    err?.code ?? (status === 401 ? 'AUTH_REQUIRED' : 'INTERNAL'),
    err?.message ?? (status === 401 ? ERROR_MESSAGES.AUTH_REQUIRED : ERROR_MESSAGES.INTERNAL),
    err?.details,
  );
}

export interface McpUploadHandle {
  promise: Promise<McpVersion>;
  abort: () => void;
}

/** `POST /mcp/uploads` (multipart `file`) with progress (XHR upload.onprogress). */
export function uploadMcpZip(file: File, onProgress: (loaded: number, total: number) => void): McpUploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<McpVersion>((resolve, reject) => {
    xhr.open('POST', `${apiBase}/mcp/uploads`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    const csrf = getCsrfToken();
    if (csrf) xhr.setRequestHeader('X-KACP-CSRF', csrf);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as McpVersion);
        } catch {
          reject(new ApiError(xhr.status, 'INTERNAL', ERROR_MESSAGES.INTERNAL));
        }
      } else reject(parseXhrError(xhr.status, xhr.responseText));
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', '올리지 못했어요. 연결을 확인하고 다시 시도하세요.'));
    xhr.onabort = () => reject(new ApiError(0, 'ABORTED', '업로드를 취소했어요.'));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

/** A-07 source zip: fetch → blob → temporary object URL. */
export async function downloadVersionSource(id: string, filename: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${apiBase}/admin/mcp/versions/${enc(id)}/source`, {
      credentials: 'include',
      headers: { Accept: 'application/zip' },
    });
  } catch {
    throw new ApiError(0, 'NETWORK', ERROR_MESSAGES.INTERNAL);
  }
  if (!res.ok) throw parseXhrError(res.status, await res.text());
  const url = URL.createObjectURL(await res.blob());
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

// ── hooks

export function useMcpPackages(f: MarketFilter) {
  return useQuery({ queryKey: mcpKeys.packages(f), queryFn: async () => (await mcpApi.packages(f)).items, staleTime: 15_000 });
}

export function useMcpPackage(pkg: string, team?: string) {
  return useQuery({ queryKey: mcpKeys.pkg(pkg, team), queryFn: () => mcpApi.pkg(pkg, team) });
}

/** Team installs; polls every 3 s while a row is installing/removing. */
export function useTeamInstalls(team: string | undefined, enabled = true) {
  return useQuery({
    queryKey: mcpKeys.installs(team ?? ''),
    queryFn: () => mcpApi.installs(team ?? ''),
    enabled: enabled && !!team,
    refetchInterval: (q) => (q.state.data && hasBusyInstall(q.state.data.items) ? 3_000 : false),
  });
}

export function useMyMcpPackages() {
  return useQuery({
    queryKey: mcpKeys.mine,
    queryFn: async () => (await mcpApi.mine()).items,
    refetchInterval: (q) => (q.state.data?.some((p) => p.versions.some((v) => isVersionBusy(v.status))) ? 5_000 : false),
  });
}

/** Version detail; polls every 3 s while the pipeline runs. */
export function useMcpVersion(pkg: string, ver: string) {
  return useQuery({
    queryKey: mcpKeys.version(pkg, ver),
    queryFn: () => mcpApi.version(pkg, ver),
    refetchInterval: (q) => (q.state.data && isVersionBusy(q.state.data.status) ? 3_000 : false),
  });
}

export function usePendingMcpReviews(enabled = true) {
  return useQuery({
    queryKey: mcpKeys.adminReviews,
    queryFn: async () => (await adminMcpApi.reviews()).items,
    enabled,
    refetchInterval: 30_000,
  });
}

export function useAdminMcpPackages() {
  return useQuery({ queryKey: mcpKeys.adminPackages, queryFn: async () => (await adminMcpApi.packages()).items });
}

export function useAdminMcpInstalls(f: { team?: string; source?: McpInstallSource }, enabled = true) {
  return useQuery({
    queryKey: mcpKeys.adminInstalls(f),
    queryFn: async () => (await adminMcpApi.installs(f)).items,
    enabled,
    refetchInterval: (q) => (q.state.data && hasBusyInstall(q.state.data) ? 3_000 : false),
  });
}
