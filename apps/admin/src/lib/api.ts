// Browser-side client: talks only to this app's own origin (/api/proxy/*); tokens live in httpOnly cookies.
import { CSRF_HEADER_NAME } from './csrf';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
  const res = await fetch(`/api/proxy/${path.replace(/^\//, '')}`, {
    method,
    headers: {
      [CSRF_HEADER_NAME]: '1',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  }).catch(() => {
    throw new ApiError(0, 'NETWORK', 'Tarmoq xatosi');
  });
  if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.code ?? 'ERROR', data.message ?? `HTTP ${res.status}`, data.details);
  }
  if (res.status === 204) return undefined as T;
  if (raw) return (await res.blob()) as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
  blob: (path: string) => request<Blob>('GET', path, undefined, true),
};

export const qs = (params: Record<string, string | number | boolean | undefined | null>): string => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
};
