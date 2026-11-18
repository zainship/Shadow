import fs from 'node:fs';
import path from 'node:path';
import { ThinkingLevel, Type } from '@google/genai';
import { openRouterGenerate, resolveAiRuntime, type AiRuntime } from './ai-provider.ts';
import { getGeminiClient, getModelConfig, withGeminiRetry } from './gemini.ts';
import { runJarvisResearch } from './research.ts';
import { synthesizeJarvisSpeech } from './automation.ts';

// ---------------------------------------------------------------------------
// Morning Brief — scheduled daily digest.
// Server-side scheduler ticks every 30s; when the configured time is reached
// (or caught up on startup), it gathers quick research per topic, composes a
// 60-second spoken brief with the resolved AI runtime, synthesizes audio, and
// persists it. Clients fetch /api/brief/today on mount, unlock and on a soft
// poll — no standing push channel exists in this architecture.
// ---------------------------------------------------------------------------

export interface BriefSourceRef {
  title: string;
  url: string;
}

export interface MorningBriefSection {
  title: string;
  bullets: string[];
  sources: BriefSourceRef[];
}

export interface MorningBrief {
  id: string;
  date: string;
  generatedAt: number;
  headline: string;
  sections: MorningBriefSection[];
  action: string;
  spokenSummary: string;
  audioBase64?: string | null;
  topics: string[];
  provider: string;
}

export interface MorningBriefConfig {
  enabled: boolean;
  time: string;
  topics: string[];
  voiceName: string;
  speakOnUnlock: boolean;
  lastRunDate?: string;
  lastAttemptAt?: number;
}

type ResearchResult = Awaited<ReturnType<typeof runJarvisResearch>>;

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'brief-store.json');
const HISTORY_LIMIT = 30;
const AUDIO_RETENTION = 2; // keep audio only on the newest N briefs
const RERUN_COOLDOWN_MS = 15 * 60 * 1000;
const BRIEF_VOICES = ['Charon', 'Fenrir', 'Zephyr', 'Kore', 'Puck'] as const;

export const DEFAULT_BRIEF_CONFIG: MorningBriefConfig = {
  enabled: false,
  time: '08:00',
  topics: ['top technology & AI news', 'weather today'],
  voiceName: 'Charon',
  speakOnUnlock: true,
};

interface BriefStore {
  config: MorningBriefConfig;
  history: MorningBrief[];
}

function localDateKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseConfigMinutes(time: string): number {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return 8 * 60;
  return Number(match[1]) * 60 + Number(match[2]);
}

function sanitizeConfig(raw: unknown): MorningBriefConfig {
  const r = (raw ?? {}) as Partial<MorningBriefConfig>;
  const topics = Array.isArray(r.topics)
    ? r.topics
        .map((t) => String(t).trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 4)
    : [];
  return {
    enabled: Boolean(r.enabled),
    time:
      typeof r.time === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(r.time)
        ? r.time
        : DEFAULT_BRIEF_CONFIG.time,
    topics: topics.length > 0 ? topics : DEFAULT_BRIEF_CONFIG.topics,
    voiceName: BRIEF_VOICES.includes(r.voiceName as (typeof BRIEF_VOICES)[number])
      ? (r.voiceName as string)
      : DEFAULT_BRIEF_CONFIG.voiceName,
    speakOnUnlock: r.speakOnUnlock !== false,
    lastRunDate: typeof r.lastRunDate === 'string' ? r.lastRunDate : undefined,
    lastAttemptAt: typeof r.lastAttemptAt === 'number' ? r.lastAttemptAt : undefined,
  };
}

function sanitizeHistory(raw: unknown): MorningBrief[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (b): b is MorningBrief =>
        Boolean(b && typeof (b as MorningBrief).id === 'string' && typeof (b as MorningBrief).date === 'string')
    )
    .slice(0, HISTORY_LIMIT);
}

function loadStore(): BriefStore {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BriefStore>;
    return {
      config: sanitizeConfig(parsed.config),
      history: sanitizeHistory(parsed.history),
    };
  } catch {
    return { config: { ...DEFAULT_BRIEF_CONFIG, topics: [...DEFAULT_BRIEF_CONFIG.topics] }, history: [] };
  }
}

function saveStore(store: BriefStore): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, STORE_PATH);
}

export function loadBriefConfig(): MorningBriefConfig {
  return loadStore().config;
}

export function saveBriefConfig(patch: unknown): MorningBriefConfig {
  const store = loadStore();
  const merged = sanitizeConfig({ ...store.config, ...(patch as Partial<MorningBriefConfig>) });
  store.config = merged;
  saveStore(store);
  return merged;
}

export function getTodayBrief(): MorningBrief | null {
  const today = localDateKey();
  return loadStore().history.find((b) => b.date === today) ?? null;
}

export function getBriefHistory(limit = 20): MorningBrief[] {
  const capped = Number.isFinite(limit) ? Math.max(1, Math.min(60, Math.floor(limit))) : 20;
  return loadStore()
    .history.slice(0, capped)
    .map((b) => ({ ...b, audioBase64: null }));
}

export function shouldRunNow(config: MorningBriefConfig, now = new Date()): boolean {
  if (!config.enabled) return false;
  if (config.lastRunDate === localDateKey(now)) return false;
  if (now.getHours() * 60 + now.getMinutes() < parseConfigMinutes(config.time)) return false;
  if (config.lastAttemptAt && Date.now() - config.lastAttemptAt < RERUN_COOLDOWN_MS) return false;
  return true;
}

function markAttempt(): void {
  const store = loadStore();
  store.config = { ...store.config, lastAttemptAt: Date.now() };
  saveStore(store);
}

function persistBrief(brief: MorningBrief): void {
  const store = loadStore();
  store.config = { ...store.config, lastRunDate: brief.date };
  const history = [brief, ...store.history.filter((b) => b.id !== brief.id)];
  store.history = history
    .slice(0, HISTORY_LIMIT)
    .map((b, idx) => (idx >= AUDIO_RETENTION ? { ...b, audioBase64: null } : b));
  saveStore(store);
}

const COMPOSE_SYSTEM = `You are Shadow, a precise personal intelligence chief compiling a morning brief.
You receive a verified research digest, one block per topic. Compose the brief as JSON:
- headline: one sharp sentence (max 110 chars) summarizing the day's most important thread.
- sections: exactly one section per topic, in the SAME order as given; 2-4 crisp bullets each,
  concrete and information-dense (numbers, names, dates when available). No markdown, no URLs.
- action: the single highest-leverage thing the user should do first today (max 200 chars).
- spokenSummary: a 45-60 second natural spoken briefing covering every section, written to be
  heard aloud: warm, confident, no markdown, no URLs, no stage directions.`;

const composeSchema = {
  type: Type.OBJECT,
  properties: {
    headline: { type: Type.STRING },
    sections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['title', 'bullets'],
      },
    },
    action: { type: Type.STRING },
    spokenSummary: { type: Type.STRING },
  },
  required: ['headline', 'sections', 'action', 'spokenSummary'],
};

interface ComposedBrief {
  headline: string;
  sections: Array<{ title: string; bullets: string[] }>;
  action: string;
  spokenSummary: string;
}

function parseCompose(text: string): ComposedBrief {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned || '{}') as Record<string, unknown>;
    const sections = Array.isArray(parsed.sections)
      ? (parsed.sections as Array<Record<string, unknown>>).map((s) => ({
          title: String(s?.title ?? '').slice(0, 90),
          bullets: Array.isArray(s?.bullets) ? s.bullets.map((b) => String(b)) : [],
        }))
      : [];
    return {
      headline: String(parsed.headline ?? 'Morning Brief').slice(0, 140),
      sections,
      action: String(parsed.action ?? '').slice(0, 220),
      spokenSummary:
        String(parsed.spokenSummary ?? '').slice(0, 900) ||
        'Your morning brief is ready. Open the Brief stage to read it.',
    };
  } catch {
    throw new Error('The model returned a malformed brief. Try again.');
  }
}

async function composeBrief(
  topics: string[],
  digest: string,
  runtime: AiRuntime | null
): Promise<ComposedBrief> {
  const userText = `Today is ${new Date().toDateString()}.\nCompose the morning brief from this verified research digest.\n\n${digest}\n\nTopics (keep this exact order): ${topics.join(' | ')}`;

  if (runtime?.provider === 'openrouter') {
    const turn = await openRouterGenerate({
      apiKey: runtime.apiKey,
      model: runtime.model,
      systemInstruction: COMPOSE_SYSTEM,
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      jsonSchema: composeSchema as unknown as Record<string, unknown>,
      temperature: 0.4,
    });
    return parseCompose(turn.text);
  }

  const ai = getGeminiClient(runtime?.apiKey);
  const response = await withGeminiRetry(() =>
    ai.models.generateContent({
      model: getModelConfig().fastText,
      contents: userText,
      config: {
        systemInstruction: COMPOSE_SYSTEM,
        responseMimeType: 'application/json',
        responseSchema: composeSchema,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    })
  );
  return parseCompose(response.text ?? '');
}

let running = false;

export async function runMorningBrief(
  input: { runtime?: AiRuntime | null; voiceName?: string } = {}
): Promise<MorningBrief> {
  if (running) {
    throw new Error('A Morning Brief is already being generated.');
  }
  running = true;
  try {
    const config = loadBriefConfig();
    markAttempt();
    const topics = config.topics.map((t) => String(t).trim()).filter(Boolean).slice(0, 4);
    if (topics.length === 0) {
      throw new Error('No topics configured. Add at least one topic in Brief settings.');
    }

    const research = await Promise.allSettled(
      topics.map((topic) => runJarvisResearch({ query: topic, depth: 'quick', runtime: input.runtime ?? null }))
    );
    const reportFor = (i: number): ResearchResult | null =>
      research[i].status === 'fulfilled' ? (research[i] as PromiseFulfilledResult<ResearchResult>).value : null;

    const digest = topics
      .map((topic, i) => {
        const report = reportFor(i);
        if (!report) {
          const reason = research[i].status === 'rejected' ? String((research[i] as PromiseRejectedResult).reason?.message || research[i]) : 'unavailable';
          return `TOPIC: ${topic}\nRESEARCH FAILED: ${reason.slice(0, 200)}`;
        }
        const findings = (report.keyFindings || []).slice(0, 4).map((f) => `- ${f}`).join('\n');
        const sources = (report.sources || []).slice(0, 3).map((s) => `- ${s.title} (${s.url})`).join('\n');
        return [
          `TOPIC: ${topic}`,
          `SUMMARY: ${(report.executiveSummary || '').slice(0, 700)}`,
          `FINDINGS:\n${findings || '- none'}`,
          `SOURCES:\n${sources || '- none'}`,
        ].join('\n');
      })
      .join('\n\n');

    const composed = await composeBrief(topics, digest, input.runtime ?? null);
    const voiceName = input.voiceName?.trim() || config.voiceName || 'Charon';
    const audioBase64 = await synthesizeJarvisSpeech(
      composed.spokenSummary,
      voiceName,
      input.runtime?.provider === 'gemini' ? input.runtime.apiKey : undefined
    );

    const brief: MorningBrief = {
      id: `brief-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date: localDateKey(),
      generatedAt: Date.now(),
      headline: composed.headline,
      sections: topics.map((topic, i) => {
        const composedSection = composed.sections[i];
        const report = reportFor(i);
        const bullets = (
          composedSection?.bullets?.length
            ? composedSection.bullets
            : (report?.keyFindings || []).slice(0, 3).length > 0
              ? (report?.keyFindings || []).slice(0, 3)
              : ['Research unavailable for this topic right now.']
        ).map((b) => String(b).slice(0, 240));
        return {
          title: String(composedSection?.title || topic).slice(0, 90),
          bullets,
          sources: (report?.sources || []).slice(0, 3).map((s) => ({ title: s.title, url: s.url })),
        };
      }),
      action: composed.action,
      spokenSummary: composed.spokenSummary,
      audioBase64: audioBase64 || null,
      topics,
      provider:
        input.runtime?.provider === 'openrouter'
          ? `openrouter (${input.runtime.model})`
          : input.runtime?.provider === 'gemini'
            ? 'gemini (BYOK)'
            : 'gemini (server key)',
    };
    persistBrief(brief);
    return brief;
  } finally {
    running = false;
  }
}

export function startBriefScheduler(): void {
  const tick = async (): Promise<void> => {
    try {
      const config = loadBriefConfig();
      if (!shouldRunNow(config)) return;
      console.log('[brief] generating scheduled morning brief');
      const brief = await runMorningBrief({ runtime: resolveAiRuntime({}) });
      console.log(`[brief] morning brief ready (${brief.sections.length} sections, ${brief.date})`);
    } catch (err) {
      console.warn('[brief] scheduled run failed:', err instanceof Error ? err.message : err);
    }
  };
  void tick();
  setInterval(() => {
    void tick();
  }, 30_000);
}
