/**
 * BYOK (Bring Your Own Key) AI settings — stored only in this browser's
 * localStorage, never synced to Firestore. Keys are attached per request
 * via headers (x-shadow-*) and per WS session via an ai_auth message.
 */

export type AiProviderChoice = 'server' | 'gemini' | 'openrouter';

export interface AiSettings {
  /** 'server' = use whatever the backend is configured with (default). */
  provider: AiProviderChoice;
  geminiKey: string;
  openrouterKey: string;
  openrouterModel: string;
}

const AI_SETTINGS_KEY = 'shadow_ai_settings_v1';

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'server',
  geminiKey: '',
  openrouterKey: '',
  openrouterModel: '',
};

/** Popular OpenRouter model ids as quick suggestions; any model id works. */
export const OPENROUTER_MODEL_SUGGESTIONS = [
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'anthropic/claude-3.5-haiku',
  'anthropic/claude-3.7-sonnet',
  'google/gemini-2.0-flash-001',
  'meta-llama/llama-3.3-70b-instruct',
  'deepseek/deepseek-chat',
  'qwen/qwen-2.5-72b-instruct',
];

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_AI_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    const provider: AiProviderChoice =
      parsed.provider === 'gemini' || parsed.provider === 'openrouter' ? parsed.provider : 'server';
    return {
      provider,
      geminiKey: String(parsed.geminiKey || '').trim().slice(0, 200),
      openrouterKey: String(parsed.openrouterKey || '').trim().slice(0, 300),
      openrouterModel: String(parsed.openrouterModel || '').trim().slice(0, 120),
    };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export function saveAiSettings(settings: AiSettings): void {
  try {
    localStorage.setItem(
      AI_SETTINGS_KEY,
      JSON.stringify({
        provider: settings.provider,
        geminiKey: settings.geminiKey.trim().slice(0, 200),
        openrouterKey: settings.openrouterKey.trim().slice(0, 300),
        openrouterModel: settings.openrouterModel.trim().slice(0, 120),
      } satisfies AiSettings)
    );
  } catch {
    // ignore storage errors
  }
}

/** Headers to attach to LLM-backed REST calls (command / research / tts / visuals). */
export function aiRequestHeaders(settings: AiSettings): Record<string, string> {
  if (settings.provider === 'gemini' && settings.geminiKey.trim()) {
    return { 'x-shadow-provider': 'gemini', 'x-shadow-key': settings.geminiKey.trim() };
  }
  if (settings.provider === 'openrouter' && settings.openrouterKey.trim()) {
    const headers: Record<string, string> = {
      'x-shadow-provider': 'openrouter',
      'x-shadow-key': settings.openrouterKey.trim(),
    };
    if (settings.openrouterModel.trim()) {
      headers['x-shadow-model'] = settings.openrouterModel.trim();
    }
    if (settings.geminiKey.trim()) {
      headers['x-shadow-gemini-key'] = settings.geminiKey.trim();
    }
    return headers;
  }
  if (settings.geminiKey.trim()) {
    return { 'x-shadow-gemini-key': settings.geminiKey.trim() };
  }
  return {};
}

/** First message to send over /ws/live to announce the provider (voice = Gemini only). */
export function aiSocketAuthMessage(settings: AiSettings): {
  type: 'ai_auth';
  provider?: string;
  apiKey?: string;
  geminiKey?: string;
  model?: string;
} {
  const geminiKey = settings.geminiKey.trim() || undefined;
  if (settings.provider === 'gemini' && geminiKey) {
    return { type: 'ai_auth', provider: 'gemini', apiKey: geminiKey, geminiKey };
  }
  if (settings.provider === 'openrouter' && settings.openrouterKey.trim()) {
    return {
      type: 'ai_auth',
      provider: 'openrouter',
      apiKey: settings.openrouterKey.trim(),
      ...(geminiKey ? { geminiKey } : {}),
    };
  }
  return geminiKey ? { type: 'ai_auth', geminiKey } : { type: 'ai_auth' };
}

/**
 * Verifies BYOK API keys directly from the browser (no Shadow backend required).
 * Used automatically in Static PWA / Standalone mode (e.g. Firebase Hosting).
 */
export async function verifyByokSettingsDirectly(
  settings: AiSettings
): Promise<{ ok: boolean; text: string }> {
  const geminiKey = settings.geminiKey.trim();
  const openrouterKey = settings.openrouterKey.trim();
  const model = settings.openrouterModel.trim() || 'openai/gpt-4o-mini';

  const verifyGeminiDirect = async (key: string): Promise<{ ok: boolean; detail: string }> => {
    const genRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }],
          generationConfig: { maxOutputTokens: 12 },
        }),
      }
    );
    const genBody = await genRes.json().catch(() => null) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string; status?: string };
    } | null;
    if (genRes.ok && genBody?.candidates?.length) {
      return { ok: true, detail: 'gemini-2.5-flash' };
    }
    if (genRes.status === 404) {
      const listRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`
      );
      if (listRes.ok) {
        return { ok: true, detail: 'Google AI Studio key verified' };
      }
      const listErr = await listRes.json().catch(() => null) as { error?: { message?: string } } | null;
      return {
        ok: false,
        detail: listErr?.error?.message || `Gemini HTTP ${listRes.status}`,
      };
    }
    return {
      ok: false,
      detail: genBody?.error?.message || `Gemini HTTP ${genRes.status}`,
    };
  };

  if (settings.provider === 'openrouter') {
    if (!openrouterKey) {
      return { ok: false, text: 'Enter your OpenRouter API key first.' };
    }
    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openrouterKey}`,
        'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://shadow-solodev.web.app',
        'X-Title': 'Shadow',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 12,
      }),
    });
    const orData = await orRes.json().catch(() => null) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      error?: { message?: string };
    } | null;
    if (!orRes.ok) {
      return {
        ok: false,
        text: orData?.error?.message || `OpenRouter verification failed (HTTP ${orRes.status})`,
      };
    }
    const resolvedModel = orData?.model || model;
    if (geminiKey) {
      const gemCheck = await verifyGeminiDirect(geminiKey);
      if (!gemCheck.ok) {
        return {
          ok: false,
          text: `OpenRouter key connected (${resolvedModel}), but optional Gemini key failed: ${gemCheck.detail}`,
        };
      }
      return {
        ok: true,
        text: `Connected directly via OpenRouter (${resolvedModel}) + Gemini key verified`,
      };
    }
    return {
      ok: true,
      text: `Connected directly via OpenRouter (${resolvedModel})`,
    };
  }

  if (settings.provider === 'gemini') {
    if (!geminiKey) {
      return { ok: false, text: 'Enter your Gemini API key first.' };
    }
    const gemCheck = await verifyGeminiDirect(geminiKey);
    if (!gemCheck.ok) {
      return { ok: false, text: `Gemini key verification failed: ${gemCheck.detail}` };
    }
    return {
      ok: true,
      text: `Connected directly via Gemini (${gemCheck.detail})`,
    };
  }

  return {
    ok: false,
    text: 'Static PWA mode: no Shadow backend at this origin. Enter a Shadow Server URL above (e.g. http://127.0.0.1:3000) or select OpenRouter (BYOK) / Gemini (BYOK).',
  };
}

