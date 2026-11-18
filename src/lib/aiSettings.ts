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
    return headers;
  }
  return {};
}

/** First message to send over /ws/live to announce the provider (voice = Gemini only). */
export function aiSocketAuthMessage(settings: AiSettings): {
  type: 'ai_auth';
  provider?: string;
  apiKey?: string;
  model?: string;
} {
  if (settings.provider === 'gemini' && settings.geminiKey.trim()) {
    return { type: 'ai_auth', provider: 'gemini', apiKey: settings.geminiKey.trim() };
  }
  return { type: 'ai_auth' };
}
