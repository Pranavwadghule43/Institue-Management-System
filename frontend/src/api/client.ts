/* REST client for the FastAPI backend. All data comes from the server; nothing is computed or stored locally. */
import { useEffect, useState, useSyncExternalStore } from 'react';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000/api/v1';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields: Record<string, string> = {}) {
    super(message);
  }
}

const TOKEN_KEY = 'ims.token';
let token: string | null = (() => {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
})();
let onUnauthorized: () => void = () => {};

export const getToken = () => token;
export function setToken(t: string | null) {
  if (t !== token) clearQueryCache(); // sign-in / sign-out: never show one user's cached data to another
  token = t;
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: token lives for this tab only */
  }
}
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

type Query = Record<string, string | number | boolean | null | undefined>;
interface Opts { method?: string; body?: unknown; query?: Query; idempotencyKey?: string; signal?: AbortSignal }

const qs = (q?: Query) => {
  const p = new URLSearchParams();
  Object.entries(q ?? {}).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && p.set(k, String(v)));
  const s = p.toString();
  return s ? `?${s}` : '';
};

async function request(path: string, { method = 'GET', body, query, idempotencyKey, signal }: Opts = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(API_URL + path + qs(query), { method, headers, signal, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
  }
  if (!res.ok) {
    let err = { code: 'HTTP_ERROR', message: `Request failed (${res.status})`, field_errors: {} as Record<string, string> };
    try {
      err = (await res.json()).error ?? err;
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401 && path !== '/auth/login') onUnauthorized();
    throw new ApiError(res.status, err.code, err.message, err.field_errors);
  }
  return res;
}

export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  const res = await request(path, opts);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Authenticated file download (Excel exports, documents). */
export async function download(path: string, query?: Query, open = false) {
  const res = await request(path, { query });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (open) window.open(url, '_blank', 'noopener');
  else {
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'download';
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/* ------------------------------ refresh after writes ------------------------------ */

let version = 0;
const listeners = new Set<() => void>();
/** Call after any successful write: every mounted query refetches. */
export function refresh() {
  clearQueryCache(); // after a save, revisited screens load fresh data instead of showing pre-save copies
  version++;
  listeners.forEach((l) => l());
}
const useVersion = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => version);

/** Run a write and refresh all queries on success. */
export async function write<T>(p: Promise<T>): Promise<T> {
  const r = await p;
  refresh();
  return r;
}

/* ------------------------------ request sharing + recent-answer cache (performance) ------------------------------ */

// Identical GETs already on their way share ONE network request (React StrictMode's double mount in dev, or two
// components on one page asking for the same list). Keyed by token + write-version, so a request started before a
// save is never reused after it.
const inflight = new Map<string, Promise<unknown>>();
// Last answer per query, shown instantly when a screen is revisited while the fresh copy loads (stale-while-revalidate).
// Memory only (this tab), at most 5 minutes old, and wiped on every save and every sign-in / sign-out.
const CACHE_MAX_AGE_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 150;
const cache = new Map<string, { data: unknown; at: number }>();

export function clearQueryCache() {
  cache.clear();
  inflight.clear();
}

function cached<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_MAX_AGE_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.data as T;
}

function sharedGet<T>(key: string, path: string, query?: Query): Promise<T> {
  const k = `${token ?? ''}|${version}|${key}`;
  let p = inflight.get(k) as Promise<T> | undefined;
  if (!p) {
    const tokenAtStart = token, versionAtStart = version;
    p = api<T>(path, { query })
      .then((data) => {
        if (token === tokenAtStart && version === versionAtStart) { // nothing saved / no sign-out meanwhile
          cache.delete(key); // re-insert = most recent last (simple LRU)
          cache.set(key, { data, at: Date.now() });
          if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
        }
        return data;
      })
      .finally(() => inflight.delete(k));
    inflight.set(k, p);
  }
  return p;
}

/** GET with refetch on refresh(). `loading` is true only until the first answer for this exact query;
 *  refetches after writes keep showing the current data (no skeleton flicker). Pass path=null to skip.
 *  A screen revisited within a few minutes shows its last answer at once and updates when the fresh one arrives. */
export function useQuery<T>(path: string | null, query?: Query) {
  const v = useVersion();
  const key = path === null ? null : path + qs(query);
  const [state, setState] = useState<{ key?: string; data?: T; error?: ApiError }>({});
  useEffect(() => {
    if (key === null) return;
    let live = true;
    sharedGet<T>(key, path!, query)
      .then((data) => live && setState({ key, data }))
      .catch((error: ApiError) => live && setState((s) => ({ key, data: s.key === key ? s.data : undefined, error })));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, v]);
  const ready = key !== null && state.key === key;
  const recent = !ready && key !== null ? cached<T>(key) : undefined;
  return {
    data: ready ? state.data : recent,
    error: ready ? state.error : undefined,
    loading: key !== null && !ready && recent === undefined,
    reload: refresh,
  };
}

export interface Page<T> { items: T[]; page: number; page_size: number; total: number; pages: number }
