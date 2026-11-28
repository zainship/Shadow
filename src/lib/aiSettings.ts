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
  elevenlabsKey?: string;
  elevenlabsVoiceId?: string;
}

const AI_SETTINGS_KEY = 'shadow_ai_settings_v1';

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'server',
  geminiKey: '',
  openrouterKey: '',
  openrouterModel: '',
  elevenlabsKey: '',
  elevenlabsVoiceId: '',
};

/** Popular OpenRouter model ids as quick suggestions; any model id works. */
export const OPENROUTER_MODEL_SUGGESTIONS = [
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'anthropic/claude-3.5-haiku',
  'anthropic/claude-3.7-sonnet',
  'google/gemini-2.5-flash',
  'meta-llama/llama-3.3-70b-instruct',
  'deepseek/deepseek-chat',
  'qwen/qwen-2.5-72b-instruct',
];

export const ELEVENLABS_VOICE_SUGGESTIONS: Array<{ id: string; label: string }> = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', label: 'George — Warm British' },
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel — Calm Clear' },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam — Deep Crisp' },
  { id: '9BWtsMINqrJLrRacOk9x', label: 'Aria — Expressive' },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella — Soft Conversational' },
  { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni — Balanced' },
];

const SHADOW_TO_ELEVENLABS_VOICE: Record<string, string> = {
  Charon: 'JBFqnCBsd6RMkjVDRZzb', // George
  Fenrir: 'pNInz6obpgDQGcFmaJgB', // Adam
  Kore: '21m00Tcm4TlvDq8ikWAM',   // Rachel
  Zephyr: '9BWtsMINqrJLrRacOk9x', // Aria
  Puck: 'ErXwobaYiN019PkySvjV',   // Antoni
};

export function resolveElevenLabsVoiceId(voiceIdOrShadowVoice?: string): string {
  const trimmed = String(voiceIdOrShadowVoice || '').trim();
  if (!trimmed) return 'JBFqnCBsd6RMkjVDRZzb';
  if (SHADOW_TO_ELEVENLABS_VOICE[trimmed]) {
    return SHADOW_TO_ELEVENLABS_VOICE[trimmed];
  }
  return trimmed;
}

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
      elevenlabsKey: String(parsed.elevenlabsKey || '').trim().slice(0, 240),
      elevenlabsVoiceId: String(parsed.elevenlabsVoiceId || '').trim().slice(0, 100),
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
        elevenlabsKey: String(settings.elevenlabsKey || '').trim().slice(0, 240),
        elevenlabsVoiceId: String(settings.elevenlabsVoiceId || '').trim().slice(0, 100),
      } satisfies AiSettings)
    );
  } catch {
    // ignore storage errors
  }
}

/** Headers to attach to LLM-backed REST calls (command / research / tts / visuals). */
export function aiRequestHeaders(settings: AiSettings): Record<string, string> {
  const headers: Record<string, string> = {};
  if (settings.provider === 'gemini' && settings.geminiKey.trim()) {
    headers['x-shadow-provider'] = 'gemini';
    headers['x-shadow-key'] = settings.geminiKey.trim();
  } else if (settings.provider === 'openrouter' && settings.openrouterKey.trim()) {
    headers['x-shadow-provider'] = 'openrouter';
    headers['x-shadow-key'] = settings.openrouterKey.trim();
    if (settings.openrouterModel.trim()) {
      headers['x-shadow-model'] = settings.openrouterModel.trim();
    }
    if (settings.geminiKey.trim()) {
      headers['x-shadow-gemini-key'] = settings.geminiKey.trim();
    }
  } else if (settings.geminiKey.trim()) {
    headers['x-shadow-gemini-key'] = settings.geminiKey.trim();
  }

  const elevenKey = String(settings.elevenlabsKey || '').trim();
  if (elevenKey) {
    headers['x-shadow-elevenlabs-key'] = elevenKey;
    const elevenVoice = String(settings.elevenlabsVoiceId || '').trim();
    if (elevenVoice) {
      headers['x-shadow-elevenlabs-voice-id'] = elevenVoice;
    }
  }
  return headers;
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

const DIRECT_GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
] as const;

/**
 * Calls Google Gemini generateContent directly from the browser for BYOK standalone mode,
 * starting with gemini-3.8-flash and falling back cleanly if a model alias is unavailable/overloaded.
 */
export async function generateGeminiDirect(
  apiKey: string,
  body: Record<string, unknown>
): Promise<{ text: string; modelUsed: string }> {
  const cleanKey = apiKey.trim();
  let lastMessage = 'Gemini request failed.';
  let lastStatus = 500;

  for (let i = 0; i < DIRECT_GEMINI_MODELS.length; i++) {
    const model = DIRECT_GEMINI_MODELS[i];
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cleanKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    const data = (await res.json().catch(() => null)) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string; status?: string };
    } | null;

    if (res.ok && data?.candidates?.length) {
      const text =
        data.candidates[0]?.content?.parts
          ?.map((p) => p.text || '')
          .join('')
          .trim() || '';
      return { text, modelUsed: model };
    }

    lastStatus = res.status;
    lastMessage = data?.error?.message || `Gemini HTTP ${res.status}`;
    const shouldTryNext =
      i < DIRECT_GEMINI_MODELS.length - 1 &&
      (res.status === 404 ||
        res.status === 400 ||
        res.status === 429 ||
        res.status === 503 ||
        /no longer available|not found|not supported|high demand|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(
          lastMessage
        ));
    if (!shouldTryNext) {
      throw new Error(lastMessage);
    }
  }

  throw new Error(`${lastMessage} (HTTP ${lastStatus})`);
}

/**
 * Ultra-fast direct ElevenLabs TTS synthesis in browser (eleven_flash_v2_5).
 */
export async function synthesizeElevenLabsDirect(
  text: string,
  apiKey: string,
  voiceIdOrShadowVoice?: string
): Promise<{ audioBase64: string; mimeType: string }> {
  const cleanText = text.trim().slice(0, 1000);
  const voiceId = resolveElevenLabsVoiceId(voiceIdOrShadowVoice);
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey.trim(),
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: 'eleven_flash_v2_5',
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.78,
        },
      }),
    }
  );
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as {
      detail?: { message?: string } | string;
    } | null;
    const detailMsg =
      typeof errBody?.detail === 'string'
        ? errBody.detail
        : errBody?.detail?.message || `ElevenLabs HTTP ${res.status}`;
    throw new Error(detailMsg);
  }
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return { audioBase64: btoa(binary), mimeType: 'audio/mpeg' };
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
  const elevenlabsKey = String(settings.elevenlabsKey || '').trim();
  const elevenlabsVoiceId = String(settings.elevenlabsVoiceId || '').trim();
  const model = settings.openrouterModel.trim() || 'openai/gpt-4o-mini';

  const verifyElevenLabsDirect = async (key: string): Promise<{ ok: boolean; detail: string }> => {
    try {
      await synthesizeElevenLabsDirect('Ready.', key, elevenlabsVoiceId || 'Charon');
      return { ok: true, detail: 'eleven_flash_v2_5' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ElevenLabs verification failed';
      return { ok: false, detail: msg };
    }
  };

  const verifyGeminiDirect = async (key: string): Promise<{ ok: boolean; detail: string }> => {
    try {
      const result = await generateGeminiDirect(key, {
        contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }],
        generationConfig: { maxOutputTokens: 12 },
      });
      return { ok: true, detail: result.modelUsed };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gemini verification failed';
      // Fallback to listing models if key only permits metadata check or newer model name shifts
      if (/404|not found|no longer available/i.test(msg)) {
        const listRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`
        );
        if (listRes.ok) {
          return { ok: true, detail: 'Google AI Studio key verified' };
        }
      }
      return { ok: false, detail: msg };
    }
  };

  const verifyOptionalVoiceKeys = async (primarySummary: string): Promise<{ ok: boolean; text: string }> => {
    const extras: string[] = [];
    if (settings.provider === 'openrouter' && geminiKey) {
      const gemCheck = await verifyGeminiDirect(geminiKey);
      if (!gemCheck.ok) {
        return {
          ok: false,
          text: `${primarySummary}, but optional Gemini key failed: ${gemCheck.detail}`,
        };
      }
      extras.push('Gemini key verified');
    }
    if (elevenlabsKey) {
      const elCheck = await verifyElevenLabsDirect(elevenlabsKey);
      if (!elCheck.ok) {
        return {
          ok: false,
          text: `${primarySummary}, but ElevenLabs TTS key failed: ${elCheck.detail}`,
        };
      }
      extras.push(`ElevenLabs (${elCheck.detail})`);
    }
    return {
      ok: true,
      text: extras.length > 0 ? `${primarySummary} + ${extras.join(' + ')}` : primarySummary,
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
    return verifyOptionalVoiceKeys(`Connected directly via OpenRouter (${resolvedModel})`);
  }

  if (settings.provider === 'gemini') {
    if (!geminiKey) {
      return { ok: false, text: 'Enter your Gemini API key first.' };
    }
    const gemCheck = await verifyGeminiDirect(geminiKey);
    if (!gemCheck.ok) {
      return { ok: false, text: `Gemini key verification failed: ${gemCheck.detail}` };
    }
    return verifyOptionalVoiceKeys(`Connected directly via Gemini (${gemCheck.detail})`);
  }

  if (elevenlabsKey) {
    const elCheck = await verifyElevenLabsDirect(elevenlabsKey);
    if (!elCheck.ok) {
      return { ok: false, text: `ElevenLabs key verification failed: ${elCheck.detail}` };
    }
    return {
      ok: true,
      text: `ElevenLabs TTS connected directly (${elCheck.detail})`,
    };
  }

  return {
    ok: false,
    text: 'Static PWA mode: no Shadow backend at this origin. Enter a Shadow Server URL above (e.g. http://127.0.0.1:3000) or select OpenRouter (BYOK) / Gemini (BYOK).',
  };
}

