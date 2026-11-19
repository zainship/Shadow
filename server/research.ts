import { ThinkingLevel, Type } from '@google/genai';
import { inspectWebPage } from './automation.ts';
import {
  extractOpenRouterCitations,
  openRouterGenerate,
  type AiRuntime,
} from './ai-provider.ts';
import { getGeminiClient, getModelConfig, isOverloadOrQuotaError, withGeminiRetry } from './gemini.ts';

export interface ResearchSource {
  title: string;
  url: string;
  domain: string;
}

export interface ResearchComparisonPoint {
  label: string;
  detail: string;
}

export interface ResearchReport {
  id: string;
  query: string;
  depth: 'quick' | 'deep';
  executiveSummary: string;
  keyFindings: string[];
  comparisonPoints: ResearchComparisonPoint[];
  followUpQuestions: string[];
  sources: ResearchSource[];
  groundingSearchQueries: string[];
  spokenSummary: string;
  createdAt: number;
}

let preferLiteResearchUntil = 0;

function extractDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '').slice(0, 160) || 'web';
  } catch {
    return 'web';
  }
}

function isInspectableSource(url: string): boolean {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const h = u.hostname.toLowerCase();
    // Skip search redirectors and heavy video sites during raw HTML excerpt extraction
    if (h.includes('vertexaisearch.cloud.google.com') || h.includes('youtube.com') || h.includes('youtu.be')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function generateResilient(
  params: Parameters<ReturnType<typeof getGeminiClient>['models']['generateContent']>[0],
  apiKeyOverride?: string
) {
  const ai = getGeminiClient(apiKeyOverride);
  if (Date.now() < preferLiteResearchUntil) {
    const liteConfig = params.config ? { ...params.config } : undefined;
    if (liteConfig && 'thinkingConfig' in liteConfig) {
      delete (liteConfig as Record<string, unknown>).thinkingConfig;
    }
    return withGeminiRetry(
      () =>
        ai.models.generateContent({
          ...params,
          model: getModelConfig().fastText,
          config: liteConfig,
        }),
      1
    );
  }

  try {
    return await withGeminiRetry(() => ai.models.generateContent(params), 0);
  } catch (err) {
    if (!isOverloadOrQuotaError(err)) throw err;
    preferLiteResearchUntil = Date.now() + 60_000;
    const liteConfig = params.config ? { ...params.config } : undefined;
    if (liteConfig && 'thinkingConfig' in liteConfig) {
      delete (liteConfig as Record<string, unknown>).thinkingConfig;
    }
    return await withGeminiRetry(
      () =>
        ai.models.generateContent({
          ...params,
          model: getModelConfig().fastText,
          config: liteConfig,
        }),
      1
    );
  }
}

const SYNTHESIS_COMPARISON_ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    label: { type: Type.STRING },
    detail: { type: Type.STRING },
  },
  required: ['label', 'detail'],
};

const SYNTHESIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    executiveSummary: { type: Type.STRING },
    keyFindings: { type: Type.ARRAY, items: { type: Type.STRING } },
    comparisonPoints: {
      type: Type.ARRAY,
      items: SYNTHESIS_COMPARISON_ITEM_SCHEMA,
    },
    followUpQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
    spokenSummary: { type: Type.STRING },
  },
  required: [
    'executiveSummary',
    'keyFindings',
    'comparisonPoints',
    'followUpQuestions',
    'spokenSummary',
  ],
};

interface SynthesisDraft {
  executiveSummary: string;
  keyFindings: string[];
  comparisonPoints: ResearchComparisonPoint[];
  followUpQuestions: string[];
  spokenSummary: string;
}

/** Provider-independent phase: fetch up to 3 inspectable primary pages in parallel. */
async function verifyPrimarySources(
  sources: ResearchSource[],
  depth: 'quick' | 'deep'
): Promise<{ sources: ResearchSource[]; verifiedExcerpts: string[] }> {
  const verifiedExcerpts: string[] = [];
  if (depth !== 'deep') return { sources, verifiedExcerpts };

  const inspectTargets = sources
    .map((s) => s.url)
    .filter(isInspectableSource)
    .slice(0, 3);
  if (inspectTargets.length === 0) return { sources, verifiedExcerpts };

  const inspections = await Promise.allSettled(inspectTargets.map((u) => inspectWebPage(u)));
  for (const res of inspections) {
    if (res.status === 'fulfilled' && res.value.statusCode >= 200 && res.value.statusCode < 400) {
      const p = res.value;
      if (p.excerpt) {
        verifiedExcerpts.push(
          `Source "${p.title}" (${p.finalUrl}):\nHeadings: ${p.headings.slice(0, 4).join(' | ')}\nExcerpt: ${p.excerpt.slice(0, 420)}`
        );
      }
      const existingSrc = sources.find((s) => s.url === p.url || s.url === p.finalUrl);
      if (existingSrc && p.title && existingSrc.title === existingSrc.domain) {
        existingSrc.title = p.title.slice(0, 200);
      }
    }
  }
  return { sources, verifiedExcerpts };
}

function fallbackSynthesis(groundedNotes: string): SynthesisDraft {
  const sentences = groundedNotes
    .replace(/[*_`#]/g, '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
  return {
    executiveSummary: sentences.slice(0, 3).join(' ') || groundedNotes.slice(0, 600),
    keyFindings: sentences.slice(0, 6).map((s) => s.slice(0, 360)),
    comparisonPoints: [],
    followUpQuestions: [],
    spokenSummary: sentences.slice(0, 2).join(' ').slice(0, 420),
  };
}

export async function runJarvisResearch(input: {
  query: string;
  depth?: 'quick' | 'deep';
  urls?: string[];
  runtime?: AiRuntime | null;
}): Promise<ResearchReport> {
  const query = String(input.query || '').trim().slice(0, 400);
  if (!query) {
    throw new Error('Research query cannot be empty.');
  }

  const depth: 'quick' | 'deep' = input.depth === 'quick' ? 'quick' : 'deep';
  const cleanUrls = (Array.isArray(input.urls) ? input.urls : [])
    .map((u) => String(u || '').trim())
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, 10);

  // Extract any URLs written directly inside the query too
  const inlineUrls = query.match(/https?:\/\/[^\s)]+/gi) ?? [];
  const allTargetUrls = Array.from(new Set([...cleanUrls, ...inlineUrls])).slice(0, 10);

  const useOpenRouter = input.runtime?.provider === 'openrouter' && Boolean(input.runtime.apiKey);
  const geminiKeyOverride =
    input.runtime?.provider === 'gemini' && input.runtime.apiKey ? input.runtime.apiKey : undefined;

  // Phase 1: Grounded discovery (Gemini googleSearch / OpenRouter web plugin)
  let groundedNotes = '';
  let webSearchQueries: string[] = [];
  let sources: ResearchSource[] = [];

  const discoveryPrompt = [
    `Conduct ${depth === 'deep' ? 'thorough, multi-angle' : 'concise'} factual research on the following request:`,
    `"${query}"`,
    allTargetUrls.length > 0 ? `Prioritize and analyze these URLs: ${allTargetUrls.join(', ')}` : '',
    'Include concrete facts, dates, metrics, key comparisons, trade-offs, and cite specific details observed in live sources.',
  ]
    .filter(Boolean)
    .join('\n');

  if (useOpenRouter) {
    const discovery = await openRouterGenerate({
      apiKey: input.runtime!.apiKey,
      model: input.runtime!.model,
      contents: [{ role: 'user', parts: [{ text: discoveryPrompt }] }],
      webSearch: true,
      temperature: 0.4,
    });
    groundedNotes = discovery.text.trim();

    const sourceMap = new Map<string, ResearchSource>();
    for (const url of allTargetUrls) {
      sourceMap.set(url, {
        title: extractDomain(url),
        url: url.slice(0, 1000),
        domain: extractDomain(url),
      });
    }
    for (const citation of extractOpenRouterCitations(discovery.annotations).slice(0, 12)) {
      if (!sourceMap.has(citation.url)) {
        const url = citation.url.slice(0, 1000);
        sourceMap.set(url, {
          title: citation.title || extractDomain(url),
          url,
          domain: extractDomain(url),
        });
      }
    }
    sources = Array.from(sourceMap.values()).slice(0, 12);
  } else {
    const researchTools: Array<{ googleSearch?: Record<string, never>; urlContext?: Record<string, never> }> = [
      { googleSearch: {} },
    ];
    if (allTargetUrls.length > 0) {
      researchTools.push({ urlContext: {} });
    }

    const discoveryResponse = await generateResilient(
      {
        model: depth === 'quick' ? getModelConfig().fastText : getModelConfig().research,
        contents: discoveryPrompt,
        config: {
          tools: researchTools,
          ...(depth === 'deep'
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : {}),
        },
      },
      geminiKeyOverride
    );

    groundedNotes = (discoveryResponse.text || '').trim();
    const metadata = discoveryResponse.candidates?.[0]?.groundingMetadata;
    const rawChunks = metadata?.groundingChunks ?? [];
    webSearchQueries = (metadata?.webSearchQueries ?? [])
      .map((q) => String(q).trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 8);

    const sourceMap = new Map<string, ResearchSource>();
    for (const url of allTargetUrls) {
      sourceMap.set(url, {
        title: extractDomain(url),
        url: url.slice(0, 1000),
        domain: extractDomain(url),
      });
    }
    for (const chunk of rawChunks) {
      const web = (chunk as { web?: { uri?: string; title?: string } })?.web;
      if (web?.uri && /^https?:\/\//i.test(web.uri)) {
        const url = web.uri.slice(0, 1000);
        const title = (web.title || extractDomain(url)).trim().slice(0, 200);
        if (!sourceMap.has(url)) {
          sourceMap.set(url, {
            title: title || extractDomain(url),
            url,
            domain: extractDomain(url),
          });
        }
      }
    }
    sources = Array.from(sourceMap.values()).slice(0, 12);
  }

  // Phase 2: Primary-source verification in deep mode (shared, provider-independent)
  const { sources: verifiedSources, verifiedExcerpts } = await verifyPrimarySources(sources, depth);
  sources = verifiedSources;

  // Phase 3: Distill into clean structured intelligence brief + spoken summary
  const synthesisPrompt = [
    `Distill the following grounded research into a crisp, structured intelligence brief for the user's request: "${query}".`,
    '',
    '=== GROUNDED RESEARCH NOTES ===',
    groundedNotes.slice(0, 6000),
    verifiedExcerpts.length > 0 ? '\n=== VERIFIED PRIMARY PAGE EXCERPTS ===\n' + verifiedExcerpts.join('\n\n') : '',
    '',
    'Rules:',
    '- executiveSummary: 2–3 clear sentences directly answering the core question.',
    '- keyFindings: 4–7 specific, high-signal factual takeaways.',
    '- comparisonPoints: 3–5 structured dimension/metric pairs ({ label, detail }).',
    '- followUpQuestions: 3 smart next research questions the user might ask Shadow.',
    '- spokenSummary: 1–2 natural spoken sentences for voice readout (no markdown, no raw URLs, no bullet syntax).',
  ].join('\n');

  let parsed: Partial<SynthesisDraft> = {};

  try {
    if (useOpenRouter) {
      const synthesis = await openRouterGenerate({
        apiKey: input.runtime!.apiKey,
        model: input.runtime!.model,
        contents: [{ role: 'user', parts: [{ text: synthesisPrompt }] }],
        jsonSchema: SYNTHESIS_SCHEMA as unknown as Record<string, unknown>,
        temperature: 0.2,
      });
      parsed = JSON.parse(synthesis.text || '{}') as Partial<SynthesisDraft>;
    } else {
      const synthResponse = await generateResilient(
        {
          model: getModelConfig().fastText,
          contents: synthesisPrompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: SYNTHESIS_SCHEMA,
          },
        },
        geminiKeyOverride
      );
      parsed = JSON.parse(synthResponse.text || '{}') as Partial<SynthesisDraft>;
    }
  } catch {
    // Graceful fallback using already-grounded search discovery notes
    parsed = fallbackSynthesis(groundedNotes);
  }

  const executiveSummary =
    String(parsed.executiveSummary || groundedNotes || `Completed research on ${query}.`)
      .trim()
      .slice(0, 2000) || `Completed research on ${query}.`;

  const keyFindings = (Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [])
    .map((f) => String(f || '').trim().slice(0, 400))
    .filter(Boolean)
    .slice(0, 10);

  const comparisonPoints = (Array.isArray(parsed.comparisonPoints) ? parsed.comparisonPoints : [])
    .map((c) => ({
      label: String(c?.label || '').trim().slice(0, 120),
      detail: String(c?.detail || '').trim().slice(0, 500),
    }))
    .filter((c) => c.label && c.detail)
    .slice(0, 8);

  const followUpQuestions = (Array.isArray(parsed.followUpQuestions) ? parsed.followUpQuestions : [])
    .map((q) => String(q || '').trim().slice(0, 240))
    .filter(Boolean)
    .slice(0, 6);

  const spokenSummary =
    String(parsed.spokenSummary || executiveSummary)
      .replace(/[*_`#]/g, '')
      .trim()
      .slice(0, 450) || `Here is what I found about ${query}.`;

  return {
    id: `res-${Date.now()}`,
    query,
    depth,
    executiveSummary,
    keyFindings: keyFindings.length > 0 ? keyFindings : [executiveSummary.slice(0, 400)],
    comparisonPoints,
    followUpQuestions,
    sources,
    groundingSearchQueries: webSearchQueries,
    spokenSummary,
    createdAt: Date.now(),
  };
}
