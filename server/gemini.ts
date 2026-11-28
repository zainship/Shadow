import { GoogleGenAI, ThinkingLevel } from '@google/genai';

let cachedClient: GoogleGenAI | null = null;
let cachedLiveClient: GoogleGenAI | null = null;
let cachedApiKey: string | null = null;
let cachedLiveApiKey: string | null = null;

const MODEL_DEFAULTS = {
  fastText: 'gemini-3.1-flash-lite',
  deepText: 'gemini-4-hydrogen',
  live: 'gemini-3.8-live',
  tts: 'gemini-3.8-flash-lite-tts',
  research: 'gemini-4-hydrogen',
} as const;

function envOr(name: string, fallback: string): string {
  const raw = (process.env[name] || '').trim();
  return raw || fallback;
}

/**
 * Model configuration, overridable via env so local runs can trade
 * depth for speed (the #1 latency lever for /api/assistant/command).
 */
export function getModelConfig() {
  return {
    fastText: envOr('SHADOW_FAST_MODEL', MODEL_DEFAULTS.fastText),
    deepText: envOr('SHADOW_DEEP_MODEL', MODEL_DEFAULTS.deepText),
    live: envOr('SHADOW_LIVE_MODEL', MODEL_DEFAULTS.live),
    tts: envOr('SHADOW_TTS_MODEL', MODEL_DEFAULTS.tts),
    research: envOr('SHADOW_RESEARCH_MODEL', MODEL_DEFAULTS.research),
  };
}

/** True when deep-model-first behaviour is explicitly requested for text commands. */
export function preferDeepCommandDefault(): boolean {
  return ['1', 'true', 'yes'].includes((process.env.SHADOW_USE_DEEP_COMMAND || '').toLowerCase());
}

/**
 * Thinking level for the Gemini Live voice session.
 * Note: `gemini-3.8-live` rejects `thinkingConfig` (closes with code 1007).
 * Only `gemini-3.8-live-extended-thinking` supports `thinkingConfig`
 * (LOW, MEDIUM, or HIGH — never MINIMAL).
 */
export function resolveLiveThinkingLevel(liveModel = getModelConfig().live): ThinkingLevel | null {
  if (!liveModel.includes('extended-thinking')) {
    return null;
  }
  const raw = (process.env.SHADOW_LIVE_THINKING || 'low').toLowerCase();
  if (['off', 'none', 'disabled', '0', 'minimal'].includes(raw)) return null;
  if (raw === 'medium') return ThinkingLevel.MEDIUM;
  if (raw === 'high') return ThinkingLevel.HIGH;
  return ThinkingLevel.LOW;
}

export function resolveServerGeminiKey(): string | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  return apiKey || null;
}

export function getGeminiClient(apiKeyOverride?: string): GoogleGenAI {
  const apiKey = (apiKeyOverride || resolveServerGeminiKey() || '').trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  if (!cachedClient || cachedApiKey !== apiKey) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        apiVersion: 'v1beta',
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedApiKey = apiKey;
  }
  return cachedClient;
}

export function getGeminiLiveClient(apiKeyOverride?: string): GoogleGenAI {
  const apiKey = (apiKeyOverride || resolveServerGeminiKey() || '').trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  if (!cachedLiveClient || cachedLiveApiKey !== apiKey) {
    cachedLiveClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        apiVersion: 'v1beta',
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedLiveApiKey = apiKey;
  }
  return cachedLiveClient;
}

export function sanitizeErrorSecrets(input: string): string {
  return String(input || '')
    .replace(/AIza[0-9A-Za-z_\-]{16,}/g, 'AIza[REDACTED]')
    .replace(/sk-(?:or-v1-)?[0-9A-Za-z_\-]{12,}/g, 'sk-[REDACTED]')
    .replace(/ya29\.[0-9A-Za-z_.\-]{16,}/g, 'ya29.[REDACTED]')
    .replace(/Bearer\s+[0-9A-Za-z_.\-~+/=]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/xox[baprs]-[0-9A-Za-z\-]{10,}/gi, 'xox-[REDACTED]');
}

export interface DetailedErrorPayload {
  source?: string;
  status: number;
  summary: string;
  rawMessage: string;
  code?: string;
  cause?: string;
  stack?: string;
  endpoint?: string;
  timestamp: number;
}

export function extractRawErrorDetail(err: unknown): {
  rawMessage: string;
  code?: string;
  cause?: string;
  stack?: string;
} {
  if (!err) return { rawMessage: 'Unknown error' };
  if (typeof err === 'string') return { rawMessage: sanitizeErrorSecrets(err) };
  if (err instanceof Error) {
    const ext = err as Error & { code?: string | number; status?: number; cause?: unknown };
    return {
      rawMessage: sanitizeErrorSecrets(err.message || err.name || 'Error'),
      code: ext.code !== undefined ? String(ext.code) : ext.status !== undefined ? String(ext.status) : undefined,
      cause: ext.cause ? sanitizeErrorSecrets(ext.cause instanceof Error ? ext.cause.message : String(ext.cause)) : undefined,
      stack: err.stack ? sanitizeErrorSecrets(err.stack.split('\n').slice(0, 8).join('\n')) : undefined,
    };
  }
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    const nestedErr = obj.error as Record<string, unknown> | string | undefined;
    const msg =
      (typeof obj.message === 'string' && obj.message) ||
      (typeof nestedErr === 'string' && nestedErr) ||
      (nestedErr && typeof nestedErr === 'object' && typeof nestedErr.message === 'string' && nestedErr.message) ||
      (() => {
        try {
          return JSON.stringify(obj);
        } catch {
          return String(err);
        }
      })();
    const code = obj.code ?? obj.status ?? (nestedErr && typeof nestedErr === 'object' ? nestedErr.code ?? nestedErr.status : undefined);
    return {
      rawMessage: sanitizeErrorSecrets(String(msg)),
      code: code !== undefined ? String(code) : undefined,
    };
  }
  return { rawMessage: sanitizeErrorSecrets(String(err)) };
}

export function isOverloadOrQuotaError(err: unknown): boolean {
  const { rawMessage } = extractRawErrorDetail(err);
  return (
    rawMessage.includes('503') ||
    rawMessage.includes('429') ||
    rawMessage.includes('UNAVAILABLE') ||
    rawMessage.includes('RESOURCE_EXHAUSTED') ||
    rawMessage.includes('high demand') ||
    rawMessage.includes('quota')
  );
}

export function parseGeminiHttpError(
  err: unknown,
  fallback = 'Gemini request failed',
  source = 'Gemini API'
): { status: number; message: string; detail: DetailedErrorPayload } {
  const extracted = extractRawErrorDetail(err);
  const raw = extracted.rawMessage || fallback;
  const makeDetail = (status: number, summary: string): DetailedErrorPayload => ({
    source,
    status,
    summary,
    rawMessage: raw.slice(0, 1800),
    code: extracted.code,
    cause: extracted.cause,
    stack: extracted.stack,
    timestamp: Date.now(),
  });

  // OpenRouter errors are thrown as "OpenRouter <status>: <message>"
  const openRouterMatch = raw.match(/^OpenRouter\s+(\d{3}):\s*([\s\S]{0,600})/);
  if (openRouterMatch) {
    const st = Number(openRouterMatch[1]);
    const msg = `OpenRouter (${st}): ${openRouterMatch[2]}`;
    return { status: st, message: msg, detail: { ...makeDetail(st, msg), source: 'OpenRouter API' } };
  }
  if (raw.includes('GEMINI_API_KEY is not configured')) {
    const msg = 'Server Gemini API key is not configured (GEMINI_API_KEY missing).';
    return { status: 500, message: msg, detail: makeDetail(500, msg) };
  }
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED') || raw.includes('quota')) {
    const msg = `Gemini API quota exceeded (429): ${raw.slice(0, 320)}`;
    return { status: 429, message: msg, detail: makeDetail(429, msg) };
  }
  if (raw.includes('403') || raw.includes('PERMISSION_DENIED')) {
    const msg = `Gemini API permission denied (403): ${raw.slice(0, 320)}`;
    return { status: 403, message: msg, detail: makeDetail(403, msg) };
  }
  if (raw.includes('404') || raw.includes('NOT_FOUND')) {
    const msg = `Gemini model/endpoint not found (404): ${raw.slice(0, 320)}`;
    return { status: 404, message: msg, detail: makeDetail(404, msg) };
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.includes('high demand')) {
    const msg = `Gemini upstream unavailable (503): ${raw.slice(0, 320)}`;
    return { status: 503, message: msg, detail: makeDetail(503, msg) };
  }
  const msg = raw.slice(0, 500) || fallback;
  return { status: 500, message: msg, detail: makeDetail(500, msg) };
}

export async function withGeminiRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 2
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('high demand');
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      // Short snappy backoff: local voice flows should fail over fast, not hang.
      const delayMs = 300 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
