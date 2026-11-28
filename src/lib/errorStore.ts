import { useSyncExternalStore } from 'react';

export interface ShadowErrorEntry {
  id: string;
  timestamp: number;
  source: string;
  title: string;
  message: string;
  rawDetail?: string;
  statusCode?: number;
  endpoint?: string;
  stack?: string;
}

const MAX_ERROR_ENTRIES = 60;
const SESSION_KEY = 'shadow_error_log_v2';

let entries: ShadowErrorEntry[] = (() => {
  if (typeof window === 'undefined') return [];
  try {
    window.sessionStorage.removeItem('shadow_error_log_v1');
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ShadowErrorEntry[]).slice(0, MAX_ERROR_ENTRIES) : [];
  } catch {
    return [];
  }
})();

const listeners = new Set<() => void>();
let globalsInstalled = false;

export function redactSecrets(input: string): string {
  return String(input || '')
    .replace(/AIza[0-9A-Za-z_\-]{16,}/g, 'AIza[REDACTED]')
    .replace(/sk-(?:or-v1-)?[0-9A-Za-z_\-]{12,}/g, 'sk-[REDACTED]')
    .replace(/ya29\.[0-9A-Za-z_.\-]{16,}/g, 'ya29.[REDACTED]')
    .replace(/Bearer\s+[0-9A-Za-z_.\-~+/=]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/xox[baprs]-[0-9A-Za-z\-]{10,}/gi, 'xox-[REDACTED]')
    .replace(/(apiKey|api_key|token|secret|password)["']?\s*[:=]\s*["']?([^"',\s}]+)/gi, '$1=[REDACTED]');
}

function persistEntries(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(entries.slice(0, MAX_ERROR_ENTRIES)));
  } catch {
    // ignore storage quota
  }
}

function emit(): void {
  persistEntries();
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // ignore subscriber failure
    }
  }
}

export function extractErrorMessage(err: unknown, fallback = 'Unexpected error occurred.'): string {
  if (!err) return fallback;
  if (typeof err === 'string') return redactSecrets(err.trim() || fallback);
  if (err instanceof Error) {
    const raw = err.message || err.name || fallback;
    // Unwrap Firestore JSON error payloads cleanly
    if (raw.startsWith('{') && raw.includes('"operationType"')) {
      try {
        const parsed = JSON.parse(raw) as { error?: string; operationType?: string; path?: string };
        if (parsed.error) {
          return redactSecrets(
            `Firestore ${parsed.operationType || 'operation'} failed on "${parsed.path || 'collection'}": ${parsed.error}`
          );
        }
      } catch {
        // fallback
      }
    }
    return redactSecrets(raw);
  }
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message.trim()) return redactSecrets(obj.message);
    if (typeof obj.error === 'string' && obj.error.trim()) return redactSecrets(obj.error);
    if (obj.reason) return extractErrorMessage(obj.reason, fallback);
    try {
      return redactSecrets(JSON.stringify(obj));
    } catch {
      return fallback;
    }
  }
  return redactSecrets(String(err));
}

export function extractErrorRawDetail(err: unknown): { rawDetail?: string; stack?: string } {
  if (!err) return {};
  if (err instanceof Error) {
    const parts: string[] = [];
    if (err.name && err.name !== 'Error') parts.push(`Type: ${err.name}`);
    const withExtra = err as Error & {
      code?: string | number;
      status?: number;
      cause?: unknown;
      rawDetail?: string;
    };
    if (withExtra.code !== undefined) parts.push(`Code: ${String(withExtra.code)}`);
    if (withExtra.status !== undefined) parts.push(`Status: ${String(withExtra.status)}`);
    if (withExtra.rawDetail) parts.push(String(withExtra.rawDetail));
    if (withExtra.cause) {
      parts.push(`Cause: ${extractErrorMessage(withExtra.cause, String(withExtra.cause))}`);
    }
    return {
      rawDetail: parts.length > 0 ? redactSecrets(parts.join('\n')) : undefined,
      stack: err.stack ? redactSecrets(err.stack) : undefined,
    };
  }
  if (typeof err === 'object') {
    try {
      const serialized = JSON.stringify(err, null, 2);
      if (serialized && serialized !== '{}') {
        return { rawDetail: redactSecrets(serialized) };
      }
    } catch {
      // ignore circular
    }
  }
  return {};
}

export function reportShadowError(input: {
  source: string;
  title?: string;
  message: string;
  rawDetail?: string;
  statusCode?: number;
  endpoint?: string;
  stack?: string;
}): ShadowErrorEntry {
  const cleanMsg = redactSecrets(String(input.message || 'Unknown error').trim());
  const cleanRaw = input.rawDetail ? redactSecrets(String(input.rawDetail).trim()) : undefined;
  const cleanStack = input.stack ? redactSecrets(String(input.stack).trim()) : undefined;
  const cleanSource = String(input.source || 'System').trim();
  const now = Date.now();

  // De-duplicate identical consecutive errors fired within 2.5 seconds (e.g. fetch wrapper + stage catch)
  const latest = entries[0];
  if (
    latest &&
    now - latest.timestamp < 2500 &&
    latest.message === cleanMsg &&
    (latest.endpoint === input.endpoint || !input.endpoint || !latest.endpoint)
  ) {
    const merged: ShadowErrorEntry = {
      ...latest,
      source: latest.source === 'Network / API' && cleanSource !== 'Network / API' ? cleanSource : latest.source,
      title: input.title || latest.title,
      rawDetail: cleanRaw && (!latest.rawDetail || cleanRaw.length > latest.rawDetail.length) ? cleanRaw : latest.rawDetail,
      statusCode: input.statusCode ?? latest.statusCode,
      endpoint: input.endpoint || latest.endpoint,
      stack: cleanStack || latest.stack,
    };
    entries = [merged, ...entries.slice(1)];
    emit();
    return merged;
  }

  const entry: ShadowErrorEntry = {
    id: `err-${now}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: now,
    source: cleanSource,
    title: redactSecrets(String(input.title || `${cleanSource} Error`).trim()),
    message: cleanMsg,
    rawDetail: cleanRaw,
    statusCode: input.statusCode,
    endpoint: input.endpoint ? redactSecrets(input.endpoint) : undefined,
    stack: cleanStack,
  };

  entries = [entry, ...entries].slice(0, MAX_ERROR_ENTRIES);
  emit();
  return entry;
}

export function reportExceptionError(
  source: string,
  err: unknown,
  fallbackMessage = 'Operation failed.',
  extra?: { title?: string; endpoint?: string; statusCode?: number; rawDetail?: string }
): ShadowErrorEntry {
  const message = extractErrorMessage(err, fallbackMessage);
  const { rawDetail, stack } = extractErrorRawDetail(err);
  return reportShadowError({
    source,
    title: extra?.title || `${source} Error`,
    message,
    rawDetail: extra?.rawDetail || rawDetail,
    statusCode: extra?.statusCode,
    endpoint: extra?.endpoint,
    stack,
  });
}

export function dismissShadowError(id: string): void {
  entries = entries.filter((e) => e.id !== id);
  emit();
}

export function clearShadowErrors(): void {
  if (entries.length === 0) return;
  entries = [];
  emit();
}

export function getShadowErrors(): ShadowErrorEntry[] {
  return entries;
}

export function subscribeShadowErrors(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useShadowErrors(): ShadowErrorEntry[] {
  return useSyncExternalStore(subscribeShadowErrors, getShadowErrors, getShadowErrors);
}

/**
 * Installs global runtime error listeners + a transparent fetch wrapper so every
 * API failure, unhandled promise rejection, and runtime exception is captured in detail.
 */
export function installGlobalErrorListeners(): void {
  if (typeof window === 'undefined' || globalsInstalled) return;
  globalsInstalled = true;

  window.addEventListener('error', (event) => {
    // Ignore benign ResizeObserver warnings
    if (typeof event.message === 'string' && event.message.includes('ResizeObserver loop')) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target && target !== (window as unknown as HTMLElement) && 'tagName' in target) {
      const srcAttr =
        (target as HTMLScriptElement).src || (target as HTMLLinkElement).href || '';
      if (srcAttr) {
        reportShadowError({
          source: 'Resource Load',
          title: `Failed to load ${target.tagName.toLowerCase()}`,
          message: `Failed loading resource: ${srcAttr}`,
          endpoint: srcAttr,
        });
        return;
      }
    }
    const loc = event.filename
      ? `${event.filename}:${event.lineno || 0}:${event.colno || 0}`
      : undefined;
    const { rawDetail, stack } = extractErrorRawDetail(event.error);
    reportShadowError({
      source: 'Runtime Exception',
      title: 'Unhandled Runtime Error',
      message: extractErrorMessage(event.error || event.message, 'Uncaught runtime error'),
      rawDetail: [loc ? `Location: ${loc}` : '', rawDetail].filter(Boolean).join('\n') || undefined,
      endpoint: loc,
      stack,
    });
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = extractErrorMessage(reason, 'Unhandled promise rejection');
    // Skip benign browser media/abort interruptions
    if (
      reason instanceof DOMException &&
      (reason.name === 'AbortError' || reason.name === 'NotAllowedError') &&
      message.includes('play()')
    ) {
      return;
    }
    const { rawDetail, stack } = extractErrorRawDetail(reason);
    reportShadowError({
      source: 'Async Promise',
      title: 'Unhandled Promise Rejection',
      message,
      rawDetail,
      stack,
    });
  });

  // Wrap fetch safely to automatically capture detailed HTTP errors & network failures on Shadow API / Agent calls.
  // Some browser/iframe sandboxes define window.fetch with a getter only; use defineProperty + try/catch so startup never fails.
  try {
    if (typeof window.fetch !== 'function') return;
    const origFetch = window.fetch.bind(window);
    const wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = (init?.method || (typeof input === 'object' && 'method' in input ? input.method : 'GET') || 'GET').toUpperCase();
      const isMonitored =
        rawUrl.includes('/api/') ||
        rawUrl.startsWith('http://127.0.0.1:4789') ||
        rawUrl.startsWith('http://localhost:4789');

      try {
        const response = await origFetch(input, init);
        const isSilentHealthProbe = rawUrl.includes('/api/health') || rawUrl.includes('127.0.0.1:4789/health');
        if (isMonitored && !isSilentHealthProbe) {
          const ct = (response.headers.get('content-type') || '').toLowerCase();
          if (!response.ok || ct.includes('application/json')) {
            const clone = response.clone();
            void (async () => {
              try {
                const text = await clone.text();
                if (!response.ok) {
                  let message = `HTTP ${response.status} ${response.statusText || ''}`.trim();
                  let rawDetail = text ? text.slice(0, 2000) : undefined;
                  let source = rawUrl.includes('4789') ? 'Laptop Agent' : 'Server API';
                  if (ct.includes('application/json') && text) {
                    try {
                      const parsed = JSON.parse(text) as {
                        error?: string;
                        message?: string;
                        errorDetail?: {
                          source?: string;
                          rawMessage?: string;
                          code?: string;
                          cause?: string;
                          stack?: string;
                        };
                      };
                      if (parsed.error || parsed.message) {
                        message = String(parsed.error || parsed.message);
                      }
                      if (parsed.errorDetail?.source) {
                        source = parsed.errorDetail.source;
                      }
                      const detailParts: string[] = [];
                      if (parsed.errorDetail?.code) detailParts.push(`Code: ${parsed.errorDetail.code}`);
                      if (parsed.errorDetail?.rawMessage) {
                        detailParts.push(`Upstream: ${parsed.errorDetail.rawMessage}`);
                      }
                      if (parsed.errorDetail?.cause) detailParts.push(`Cause: ${parsed.errorDetail.cause}`);
                      if (parsed.errorDetail?.stack) detailParts.push(`Server Stack:\n${parsed.errorDetail.stack}`);
                      rawDetail = detailParts.length > 0 ? detailParts.join('\n') : JSON.stringify(parsed, null, 2);
                    } catch {
                      // keep raw text
                    }
                  }
                  reportShadowError({
                    source,
                    title: `${method} ${rawUrl.split('?')[0]} (${response.status})`,
                    message,
                    rawDetail,
                    statusCode: response.status,
                    endpoint: `${method} ${rawUrl}`,
                  });
                } else if (ct.includes('application/json') && text) {
                  const parsed = JSON.parse(text) as {
                    ok?: boolean;
                    error?: string;
                    errorDetail?: {
                      source?: string;
                      status?: number;
                      rawMessage?: string;
                      code?: string;
                      cause?: string;
                      stack?: string;
                    };
                  };
                  if (parsed && parsed.ok === false && (parsed.error || parsed.errorDetail)) {
                    const detailParts: string[] = [];
                    if (parsed.errorDetail?.code) detailParts.push(`Code: ${parsed.errorDetail.code}`);
                    if (parsed.errorDetail?.rawMessage) detailParts.push(`Upstream: ${parsed.errorDetail.rawMessage}`);
                    if (parsed.errorDetail?.cause) detailParts.push(`Cause: ${parsed.errorDetail.cause}`);
                    if (parsed.errorDetail?.stack) detailParts.push(`Server Stack:\n${parsed.errorDetail.stack}`);
                    reportShadowError({
                      source: parsed.errorDetail?.source || (rawUrl.includes('4789') ? 'Laptop Agent' : 'Server API'),
                      title: `${method} ${rawUrl.split('?')[0]} failed`,
                      message: String(parsed.error || parsed.errorDetail?.rawMessage || 'Operation returned ok: false'),
                      rawDetail: detailParts.length > 0 ? detailParts.join('\n') : JSON.stringify(parsed, null, 2),
                      statusCode: parsed.errorDetail?.status,
                      endpoint: `${method} ${rawUrl}`,
                    });
                  }
                }
              } catch {
                // ignore body read issues
              }
            })();
          }
        }
        return response;
      } catch (err) {
        const isSilentHealthProbe = rawUrl.includes('/api/health') || rawUrl.includes('127.0.0.1:4789/health');
        const isAbort = err instanceof DOMException && err.name === 'AbortError';
        if (isMonitored && !isSilentHealthProbe && !isAbort) {
          const { rawDetail, stack } = extractErrorRawDetail(err);
          reportShadowError({
            source: rawUrl.includes('4789') ? 'Laptop Agent' : 'Network / API',
            title: `${method} ${rawUrl.split('?')[0]} unreachable`,
            message: extractErrorMessage(err, `Network error reaching ${rawUrl}`),
            rawDetail: rawDetail || `Request failed before receiving an HTTP response for ${method} ${rawUrl}`,
            endpoint: `${method} ${rawUrl}`,
            stack,
          });
        }
        throw err;
      }
    };

    const ownDesc = Object.getOwnPropertyDescriptor(window, 'fetch');
    if (!ownDesc || ownDesc.configurable) {
      Object.defineProperty(window, 'fetch', {
        value: wrappedFetch,
        writable: true,
        configurable: true,
        enumerable: ownDesc ? ownDesc.enumerable : true,
      });
    } else if (ownDesc.writable) {
      window.fetch = wrappedFetch;
    }
  } catch {
    // Host environment locks window.fetch as non-configurable/getter-only; explicit route & error handlers remain active.
  }
}
