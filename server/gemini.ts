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

export function isOverloadOrQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('high demand') ||
    msg.includes('quota')
  );
}

export function parseGeminiHttpError(
  err: unknown,
  fallback = 'Gemini request failed'
): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err || fallback);
  // OpenRouter errors are thrown as "OpenRouter <status>: <message>"
  const openRouterMatch = raw.match(/^OpenRouter\s+(\d{3}):\s*([\s\S]{0,280})/);
  if (openRouterMatch) {
    return { status: Number(openRouterMatch[1]), message: `OpenRouter: ${openRouterMatch[2]}` };
  }
  if (raw.includes('GEMINI_API_KEY is not configured')) {
    return { status: 500, message: 'Server Gemini API key is not configured.' };
  }
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED') || raw.includes('quota')) {
    return {
      status: 429,
      message: 'Gemini API quota exceeded for the active key. Please retry shortly or update your plan/key in Settings > Secrets.',
    };
  }
  if (raw.includes('403') || raw.includes('PERMISSION_DENIED')) {
    return {
      status: 403,
      message: 'Gemini API permission denied for the active key. Please check Settings > Secrets.',
    };
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.includes('high demand')) {
    return {
      status: 503,
      message: 'Gemini model is temporarily busy. Please try again in a moment.',
    };
  }
  return { status: 500, message: raw.slice(0, 280) || fallback };
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
