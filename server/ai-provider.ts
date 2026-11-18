import type { Content, FunctionDeclaration, FunctionCall } from '@google/genai';

/**
 * BYOK (Bring Your Own Key) AI provider layer.
 *
 * Supports two providers:
 *  - "gemini"     → Google Gemini API (default; powers Live voice, TTS, images, research grounding)
 *  - "openrouter" → OpenRouter's OpenAI-compatible API (powers text chat, tool calling, research)
 *
 * Keys are resolved per request (BYOK headers) and never persisted server-side.
 */

export type AiProvider = 'gemini' | 'openrouter';

export interface AiRuntime {
  provider: AiProvider;
  apiKey: string;
  /** Model id for openrouter; empty for gemini (callers pick per-task Gemini models). */
  model: string;
  /** True when the key came from the client request rather than the server env. */
  byok: boolean;
}

export interface NormalizedAiTurn {
  text: string;
  functionCalls: Array<FunctionCall>;
  /** Full model content, for building follow-up turns (Gemini Content shape). */
  modelContent: Content | null;
  /** Raw web-plugin annotations (URL citations) when webSearch was enabled. */
  annotations?: unknown;
}

export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_TIMEOUT_MS = 120_000;

type HeaderBag = Record<string, string | string[] | undefined>;

function firstString(...values: Array<unknown>): string {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function headerValue(headers: HeaderBag | undefined, name: string): string {
  if (!headers) return '';
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] || '';
  return raw || '';
}

/**
 * Resolve which provider/key a request should use.
 * Priority: explicit client headers/body (BYOK) → AI_PROVIDER env → server GEMINI_API_KEY.
 * Returns null when the chosen provider has no usable key (caller returns a clear error).
 */
export function resolveAiRuntime(input: {
  headers?: HeaderBag;
  body?: { aiProvider?: unknown; aiKey?: unknown; aiModel?: unknown };
  queryProvider?: string;
}): AiRuntime | null {
  const hint = firstString(
    headerValue(input.headers, 'x-shadow-provider'),
    input.queryProvider,
    input.body?.aiProvider
  ).toLowerCase();
  const byokKey = firstString(headerValue(input.headers, 'x-shadow-key'), input.body?.aiKey);
  const modelHint = firstString(headerValue(input.headers, 'x-shadow-model'), input.body?.aiModel);

  const envProvider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
  const envOpenRouterKey = (process.env.OPENROUTER_API_KEY || '').trim();
  const envOpenRouterModel = (process.env.OPENROUTER_MODEL || '').trim();

  let provider: AiProvider;
  if (hint === 'gemini' || hint === 'openrouter') {
    provider = hint;
  } else if (envProvider === 'openrouter' && envOpenRouterKey) {
    provider = 'openrouter';
  } else {
    provider = 'gemini';
  }

  if (provider === 'openrouter') {
    const apiKey = byokKey || envOpenRouterKey;
    if (!apiKey) return null;
    return { provider, apiKey, model: modelHint || envOpenRouterModel || DEFAULT_OPENROUTER_MODEL, byok: Boolean(byokKey) };
  }

  const apiKey = byokKey || (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  return { provider: 'gemini', apiKey, model: modelHint, byok: Boolean(byokKey) };
}

export function describeAiRuntime(runtime: AiRuntime | null): string {
  if (!runtime) return 'none';
  if (runtime.provider === 'openrouter') {
    return `openrouter:${runtime.model}${runtime.byok ? ' (BYOK)' : ' (server key)'}`;
  }
  return `gemini${runtime.byok ? ' (BYOK)' : ' (server key)'}`;
}

/* ------------------------------------------------------------------ */
/* Gemini ↔ OpenAI schema conversion                                   */
/* ------------------------------------------------------------------ */

const TYPE_MAP: Record<string, string> = {
  STRING: 'string',
  NUMBER: 'number',
  INTEGER: 'integer',
  BOOLEAN: 'boolean',
  ARRAY: 'array',
  OBJECT: 'object',
};

/** Convert a Gemini-style JSON schema into a plain OpenAI-compatible JSON schema. */
function toOpenAiSchema(schema: unknown): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== 'object') return undefined;
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const type = typeof src.type === 'string' ? TYPE_MAP[src.type.toUpperCase()] || src.type : undefined;
  if (type) out.type = type;
  if (typeof src.description === 'string') out.description = src.description;
  if (Array.isArray(src.enum)) out.enum = src.enum;
  if (Array.isArray(src.required) && src.required.length > 0) out.required = src.required;
  if (src.items) {
    const items = toOpenAiSchema(src.items);
    if (items) out.items = items;
  }
  if (src.properties && typeof src.properties === 'object') {
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(src.properties as Record<string, unknown>)) {
      const converted = toOpenAiSchema(value);
      if (converted) props[key] = converted;
    }
    out.properties = props;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Convert Gemini function declarations into OpenAI tools entries. */
function toOpenAiTools(declarations: FunctionDeclaration[]): Array<Record<string, unknown>> {
  return declarations
    .filter((d) => Boolean(d.name))
    .map((d) => ({
      type: 'function',
      function: {
        name: d.name,
        description: d.description || '',
        ...(d.parameters ? { parameters: toOpenAiSchema(d.parameters) || { type: 'object', properties: {} } } : {}),
      },
    }));
}

/**
 * Convert Gemini-style contents into OpenAI chat messages,
 * including function-call / function-response round trips.
 */
function toOpenAiMessages(
  contents: Content[],
  systemInstruction?: string
): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  if (systemInstruction?.trim()) {
    messages.push({ role: 'system', content: systemInstruction.trim() });
  }

  let toolCallCounter = 0;
  const pendingToolCallIds: string[] = [];

  for (const content of contents) {
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const isModel = content?.role === 'model';
    const textChunks: string[] = [];
    const toolCalls: Array<Record<string, unknown>> = [];
    const toolResults: Array<Record<string, unknown>> = [];

    for (const part of parts) {
      const p = part as {
        text?: string;
        functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
        functionResponse?: { id?: string; name?: string; response?: Record<string, unknown> };
      };
      if (typeof p.text === 'string' && p.text.trim()) {
        textChunks.push(p.text);
      }
      if (p.functionCall?.name) {
        const callId = p.functionCall.id || `call_${toolCallCounter++}`;
        pendingToolCallIds.push(callId);
        toolCalls.push({
          id: callId,
          type: 'function',
          function: {
            name: p.functionCall.name,
            arguments: JSON.stringify(p.functionCall.args ?? {}),
          },
        });
      }
      if (p.functionResponse?.name) {
        const responseId = p.functionResponse.id || pendingToolCallIds.shift() || `call_${toolCallCounter++}`;
        toolResults.push({
          role: 'tool',
          tool_call_id: responseId,
          content: JSON.stringify(p.functionResponse.response ?? { ok: true }),
        });
      }
    }

    if (toolResults.length > 0) {
      messages.push(...toolResults);
    } else if (toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: textChunks.join('\n').trim() || null,
        tool_calls: toolCalls,
      });
    } else if (textChunks.length > 0) {
      messages.push({ role: isModel ? 'assistant' : 'user', content: textChunks.join('\n') });
    }
  }

  return messages;
}

/* ------------------------------------------------------------------ */
/* OpenRouter chat completion                                          */
/* ------------------------------------------------------------------ */

export interface OpenRouterGenerateOptions {
  apiKey: string;
  model: string;
  systemInstruction?: string;
  contents: Content[];
  /** Gemini-style function declarations; converted to OpenAI tools. */
  tools?: FunctionDeclaration[];
  /** Gemini-style responseSchema; converted to OpenAI json_schema response format. */
  jsonSchema?: Record<string, unknown>;
  webSearch?: boolean;
  temperature?: number;
  maxTokens?: number;
}

async function openRouterFetch(apiKey: string, payload: Record<string, unknown>): Promise<Response> {
  return fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Shadow Desktop',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
  });
}

async function readOpenRouterError(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string; code?: number }; message?: string };
    detail = body?.error?.message || body?.message || '';
  } catch {
    try {
      detail = await res.text();
    } catch {
      detail = '';
    }
  }
  detail = (detail || res.statusText || 'request failed').slice(0, 300);
  return `OpenRouter ${res.status}: ${detail}`;
}

/**
 * Run one turn through OpenRouter's OpenAI-compatible chat completions API and
 * normalize the result back into the Gemini shapes the rest of the server uses.
 */
export async function openRouterGenerate(options: OpenRouterGenerateOptions): Promise<NormalizedAiTurn> {
  const {
    apiKey,
    model,
    systemInstruction,
    contents,
    tools,
    jsonSchema,
    webSearch,
    temperature,
    maxTokens,
  } = options;

  if (!apiKey) {
    throw new Error('OpenRouter API key is missing. Add your key in AI Settings (BYOK) or set OPENROUTER_API_KEY on the server.');
  }

  const payload: Record<string, unknown> = {
    model,
    messages: toOpenAiMessages(contents, systemInstruction),
  };
  const toolsConverted = tools && tools.length > 0 ? toOpenAiTools(tools) : null;
  if (toolsConverted) {
    payload.tools = toolsConverted;
    payload.tool_choice = 'auto';
  }
  if (jsonSchema) {
    const schema = toOpenAiSchema(jsonSchema);
    if (schema) {
      payload.response_format = {
        type: 'json_schema',
        json_schema: { name: 'response', strict: false, schema },
      };
    }
  }
  if (webSearch) {
    // OpenRouter's web search plugin grounds the answer with live citations.
    payload.plugins = [{ id: 'web', max_results: 6 }];
  }
  if (typeof temperature === 'number') payload.temperature = temperature;
  if (typeof maxTokens === 'number') payload.max_tokens = maxTokens;

  let res: Response;
  try {
    res = await openRouterFetch(apiKey, payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`OpenRouter 502: could not reach openrouter.ai (${msg.slice(0, 160)})`);
  }

  if (!res.ok) {
    throw new Error(await readOpenRouterError(res));
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  };

  const message = data.choices?.[0]?.message ?? {};
  const annotations = (message as { annotations?: unknown }).annotations;
  let text = '';
  if (typeof message.content === 'string') {
    text = message.content;
  } else if (Array.isArray(message.content)) {
    text = message.content
      .map((c) => (typeof c?.text === 'string' ? c.text : ''))
      .join('')
      .trim();
  }

  const functionCalls: FunctionCall[] = (message.tool_calls ?? [])
    .filter((tc) => tc?.function?.name)
    .map((tc) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function?.arguments || '{}') as Record<string, unknown>;
      } catch {
        args = {};
      }
      const call: FunctionCall = { name: tc.function?.name as string, args };
      if (tc.id) call.id = tc.id;
      return call;
    });

  const modelParts: Array<Record<string, unknown>> = [];
  if (text.trim()) modelParts.push({ text });
  for (const call of functionCalls) {
    modelParts.push({ functionCall: call });
  }

  return {
    text: text.trim(),
    functionCalls,
    modelContent: modelParts.length > 0 ? ({ role: 'model', parts: modelParts } as Content) : null,
    annotations,
  };
}

/** Harvest OpenRouter web-plugin URL citations from the raw annotation list. */
export function extractOpenRouterCitations(raw: unknown): Array<{ url: string; title: string }> {
  if (!raw || typeof raw !== 'object') return [];
  const annotations = (raw as { annotations?: unknown }).annotations;
  if (!Array.isArray(annotations)) return [];
  const out: Array<{ url: string; title: string }> = [];
  for (const a of annotations) {
    const citation = (a as { url_citation?: { url?: string; title?: string } })?.url_citation;
    if (citation?.url && /^https?:\/\//i.test(citation.url)) {
      out.push({ url: citation.url, title: (citation.title || citation.url).slice(0, 200) });
    }
  }
  return out;
}
