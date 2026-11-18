// How the UI reaches the local Shadow server (server.ts on port 3000).
//
// - Browser and `cargo tauri dev`: the page is served by the server itself,
//   so same-origin relative URLs ("/api/...") work as-is.
// - Packaged desktop app (`cargo tauri build`): the UI ships inside the
//   Tauri binary and is served from the tauri:// or http://tauri.localhost
//   asset origin, which cannot serve the API. In that context we address
//   the local server explicitly; server.ts grants CORS access to exactly
//   those origins.
export function computeApiOrigin(): string {
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

export const API_ORIGIN = computeApiOrigin();

// Host part for WebSocket URLs; empty means "same host as the page".
export const API_WS_HOST = API_ORIGIN ? API_ORIGIN.replace(/^https?:\/\//, '') : '';
