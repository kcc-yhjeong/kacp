import { ERROR_MESSAGES, type ApiErrorBody } from '@kacp/shared';
import { api, ApiError, getCsrfToken, qs } from '@/lib/api';
import { apiBase } from '@/lib/host';
import type { DriveEntry, DriveMeta, DriveRef, DriveSpace, DriveUsage, TrashItem } from './types';

// Drive endpoints (04-api.md §2 드라이브). `path` is relative to the space root.

const base = (team: string) => `/teams/${encodeURIComponent(team)}/drive`;

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export const driveApi = {
  list: async (team: string, space: DriveSpace, path: string) =>
    (await api.get<{ path: string; items: DriveEntry[] }>(`${base(team)}/list${qs({ space, path })}`)).items,
  search: async (team: string, space: DriveSpace, q: string) =>
    (await api.get<{ items: DriveEntry[] }>(`${base(team)}/search${qs({ space, q })}`)).items,
  meta: (team: string, space: DriveSpace, path: string) =>
    api.get<DriveMeta>(`${base(team)}/meta${qs({ space, path })}`),
  usage: (team: string) => api.get<DriveUsage>(`${base(team)}/usage`),
  createFolder: (team: string, ref: DriveRef) => api.post<DriveEntry>(`${base(team)}/folder`, ref),
  rename: (team: string, ref: DriveRef, newName: string) =>
    api.post<DriveEntry>(`${base(team)}/rename`, { ...ref, newName }),
  move: (team: string, from: DriveRef[], to: DriveRef) =>
    api.post<{ items: DriveEntry[] } | undefined>(`${base(team)}/move`, { from, to }),
  copy: (team: string, from: DriveRef[], to: DriveRef) =>
    api.post<{ items: DriveEntry[] } | undefined>(`${base(team)}/copy`, { from, to }),
  trash: (team: string, space: DriveSpace, paths: string[]) => api.post<void>(`${base(team)}/trash`, { space, paths }),
  trashList: async (team: string) => (await api.get<{ items: TrashItem[] }>(`${base(team)}/trash`)).items,
  restore: (team: string, id: string) => api.post<DriveEntry>(`${base(team)}/trash/${encodeURIComponent(id)}/restore`),
  purge: (team: string, id: string) => api.delete<void>(`${base(team)}/trash/${encodeURIComponent(id)}`),
  emptyTrash: (team: string) => api.delete<void>(`${base(team)}/trash`),
};

/** GET download URL. `inline` serves with the right content-type for previews. */
export function downloadUrl(team: string, space: DriveSpace, path: string, inline = false): string {
  return `${apiBase}${base(team)}/download${qs({ space, path, inline: inline ? 1 : undefined })}`;
}

/** Plain download through a temporary anchor (same-site cookie travels with it). */
export function startDownload(url: string, filename?: string): void {
  const a = document.createElement('a');
  a.href = url;
  if (filename) a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function parseError(status: number, text: string): ApiError {
  let body: Partial<ApiErrorBody> | undefined;
  try {
    body = text ? (JSON.parse(text) as Partial<ApiErrorBody>) : undefined;
  } catch {
    body = undefined;
  }
  const err = body?.error;
  return new ApiError(
    status,
    err?.code ?? (status === 401 ? 'AUTH_REQUIRED' : status === 413 ? 'DRIVE_QUOTA_EXCEEDED' : 'INTERNAL'),
    err?.message ??
      (status === 401 ? ERROR_MESSAGES.AUTH_REQUIRED : status === 413 ? QUOTA_MESSAGE : ERROR_MESSAGES.INTERNAL),
    err?.details,
  );
}

export const QUOTA_MESSAGE = '업로드하지 못했어요. 팀 저장 공간이 가득 찼어요. 휴지통을 비우거나 필요 없는 파일을 지워 주세요.';
export const TOO_LARGE_MESSAGE = '업로드하지 못했어요. 파일이 500MB를 넘어요.';

/** Several items → zip (POST with JSON body), saved through an object URL. */
export async function downloadZip(team: string, space: DriveSpace, paths: string[], filename: string): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/zip' };
  const csrf = getCsrfToken();
  if (csrf) headers['X-KACP-CSRF'] = csrf;
  let res: Response;
  try {
    res = await fetch(`${apiBase}${base(team)}/download-zip`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ space, paths }),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', ERROR_MESSAGES.INTERNAL);
  }
  if (!res.ok) throw parseError(res.status, await res.text());
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    startDownload(url, filename);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

export interface UploadHandle {
  promise: Promise<DriveEntry[]>;
  abort: () => void;
}

export class UploadAborted extends Error {
  constructor() {
    super('aborted');
    this.name = 'UploadAborted';
  }
}

/** One file per request so each file has its own progress and cancel (XHR upload.onprogress). */
export function uploadFile(
  team: string,
  dest: DriveRef,
  file: File,
  relativePath: string | null,
  onProgress: (loaded: number, total: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<DriveEntry[]>((resolve, reject) => {
    xhr.open('POST', `${apiBase}${base(team)}/upload${qs({ space: dest.space, path: dest.path })}`);
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
          resolve((JSON.parse(xhr.responseText) as { items?: DriveEntry[] }).items ?? []);
        } catch {
          resolve([]);
        }
      } else {
        reject(parseError(xhr.status, xhr.responseText));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', '업로드하지 못했어요. 연결을 확인하고 다시 시도하세요.'));
    xhr.onabort = () => reject(new UploadAborted());
    // The api streams parts in order: `relativePaths` must come before its `files` part.
    // No Content-Type header — the browser sets the multipart boundary.
    const form = new FormData();
    if (relativePath) form.append('relativePaths', relativePath);
    form.append('files', file, file.name);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}
