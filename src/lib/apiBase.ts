// How the UI reaches the Shadow server (server.ts).
//
// - Same-origin server (dev, Cloud Run, self-hosted Node): relative URLs ("/api/...") work as-is.
// - Static Firebase Hosting PWA (e.g. shadow-solodev.web.app): no /api or /ws backend runs on
//   Firebase Hosting itself, so callers can configure a Shadow Server URL in AI Keys (saved in
//   localStorage) or build with VITE_API_BASE. When no backend is reachable, the PWA seamlessly
//   uses browser-native voice & local actions instead of throwing WebSocket errors.
// - Packaged desktop app (Tauri): defaults to http://127.0.0.1:3000.

const SERVER_URL_STORAGE_KEY = 'shadow_server_url_v1';

export function normalizeServerUrl(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  try {
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(trimmed)
        ? `http://${trimmed}`
        : `https://${trimmed}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

export function loadSavedServerUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    return normalizeServerUrl(window.localStorage.getItem(SERVER_URL_STORAGE_KEY) || '');
  } catch {
    return '';
  }
}

export function saveServerUrl(raw: string): string {
  const normalized = normalizeServerUrl(raw);
  if (typeof window !== 'undefined') {
    try {
      if (normalized) {
        window.localStorage.setItem(SERVER_URL_STORAGE_KEY, normalized);
      } else {
        window.localStorage.removeItem(SERVER_URL_STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }
  return normalized;
}

export function getApiOrigin(): string {
  const saved = loadSavedServerUrl();
  if (saved) return saved;

  const envBase = normalizeServerUrl(
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE || ''
  );
  if (envBase) return envBase;

  if (typeof window === 'undefined') return '';
  const w = window as unknown as Record<string, unknown>;
  const { protocol, hostname } = window.location;
  const inTauri =
    '__TAURI_INTERNALS__' in w ||
    protocol === 'tauri:' ||
    protocol === 'asset:' ||
    protocol === 'ipc:' ||
    hostname === 'tauri.localhost';
  if (!inTauri) return '';
  return 'http://127.0.0.1:3000';
}

export function computeApiOrigin(): string {
  return getApiOrigin();
}

export function getApiWsBase(): string {
  const origin = getApiOrigin();
  if (origin) {
    return origin.replace(/^http(s?):/, 'ws$1:');
  }
  if (typeof window !== 'undefined') {
    return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
  }
  return '';
}

export async function parseJsonSafely<T>(res: Response): Promise<T | null> {
  const ct = res.headers.get('content-type') || '';
  if (!ct.toLowerCase().includes('application/json')) {
    return null;
  }
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function checkShadowBackendHealth(originOverride?: string): Promise<boolean> {
  const origin = originOverride !== undefined ? normalizeServerUrl(originOverride) : getApiOrigin();
  const base = origin || '';
  try {
    const res = await fetch(`${base}/api/health?t=${Date.now()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return false;
    const data = await parseJsonSafely<{ ok?: boolean; service?: string }>(res);
    return Boolean(data?.ok && data?.service === 'shadow-desktop-server');
  } catch {
    return false;
  }
}

export const API_ORIGIN = computeApiOrigin();

// Host part for WebSocket URLs; empty means "same host as the page".
export const API_WS_HOST = API_ORIGIN ? API_ORIGIN.replace(/^https?:\/\//, '') : '';

// Full WebSocket origin ("ws://127.0.0.1:3000" in packaged Tauri, or matching page origin in browser/dev).
export const API_WS_BASE = getApiWsBase();
