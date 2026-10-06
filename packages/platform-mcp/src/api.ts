// Thin client for the api internal MCP endpoints (04-api.md §3). The team MCP token from the
// Gateway's request is passed through as-is: the api is the only place that decides permissions.

export const API_URL = process.env.API_URL ?? 'http://api:3000';

export class ApiCallError extends Error {}

export async function callApi(token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // keep text
  }
  if (!res.ok) {
    const msg = (json as { error?: { message?: string } } | null)?.error?.message ?? text.slice(0, 300);
    throw new ApiCallError(msg || `요청이 실패했어요 (${res.status}).`);
  }
  return json;
}

export const qs = (params: Record<string, string>) => new URLSearchParams(params).toString();
