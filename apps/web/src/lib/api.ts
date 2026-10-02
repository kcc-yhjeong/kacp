import { ERROR_MESSAGES, type ApiErrorBody } from '@kacp/shared';
import { apiBase } from './host';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-KACP-CSRF'] = csrfToken;

  let res: Response;
  try {
    res = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', ERROR_MESSAGES.INTERNAL);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }
  if (!res.ok) {
    const err = (data as Partial<ApiErrorBody> | undefined)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? (res.status === 401 ? 'AUTH_REQUIRED' : 'INTERNAL'),
      err?.message ?? (res.status === 401 ? ERROR_MESSAGES.AUTH_REQUIRED : ERROR_MESSAGES.INTERNAL),
      err?.details,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
  /** multipart/form-data upload (the browser sets the boundary). */
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
};

/** Query string from defined, non-empty values (leading `?` included when not empty). */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const out = sp.toString();
  return out ? `?${out}` : '';
}

export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : ERROR_MESSAGES.INTERNAL;
}
