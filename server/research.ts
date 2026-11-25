import { load } from 'cheerio';
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
    if (
      h.includes('vertexaisearch.cloud.google.com') ||
      h.includes('duckduckgo.com') ||
      h.includes('youtube.com') ||
      h.includes('youtu.be')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function unwrapSearchResultUrl(rawHref: string): string | null {
  const trimmed = String(rawHref || '').trim();
  if (!trimmed) return null;
  try {
    const resolved = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
    const parsed = new URL(resolved, 'https://html.duckduckgo.com');
    const uddg = parsed.searchParams.get('uddg');
    const finalHref = uddg ? decodeURIComponent(uddg) : parsed.toString();
    const finalUrl = new URL(finalHref);
    if (!['http:', 'https:'].includes(finalUrl.protocol)) return null;
    if (finalUrl.hostname.includes('duckduckgo.com')) return null;
    return finalUrl.toString().slice(0, 1000);
  } catch {
    return null;
  }
}

async function runHttpWebDiscovery(
  query: string,
  targetUrls: string[],
  depth: 'quick' | 'deep'
): Promise<{
  groundedNotes: string;
  sources: ResearchSource[];
  webSearchQueries: string[];
}> {
  const cleanSearchQuery = query.replace(/https?:\/\/[^\s)]+/gi, '').replace(/\s+/g, ' ').trim() || query;
  const sourceMap = new Map<string, ResearchSource>();
  const snippetLines: string[] = [];

  for (const url of targetUrls) {
    sourceMap.set(url, {
      title: extractDomain(url),
      url: url.slice(0, 1000),
      domain: extractDomain(url),
    });
  }

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const [ddgRes, wikiRes] = await Promise.allSettled([
    fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanSearchQuery)}`, {
      headers,
      signal: AbortSignal.timeout(7000),
    }).then(async (r) => (r.ok ? r.text() : '')),
    fetch(
      `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=4&search=${encodeURIComponent(
        cleanSearchQuery
      )}`,
      {
        headers,
        signal: AbortSignal.timeout(6000),
      }
    ).then(async (r) => (r.ok ? ((await r.json()) as unknown[]) : null)),
  ]);

  if (ddgRes.status === 'fulfilled' && ddgRes.value) {
    try {
      const $ = load(ddgRes.value);
      $('.result, .web-result').each((_, el) => {
        if (sourceMap.size >= 10) return false;
        const link = $(el).find('a.result__a').first();
        const rawHref = link.attr('href') || '';
        const cleanUrl = unwrapSearchResultUrl(rawHref);
        if (!cleanUrl) return;
        const title = link.text().replace(/\s+/g, ' ').trim().slice(0, 200) || extractDomain(cleanUrl);
        const snippet = $(el).find('.result__snippet').text().replace(/\s+/g, ' ').trim().slice(0, 320);
        if (!sourceMap.has(cleanUrl)) {
          sourceMap.set(cleanUrl, {
            title,
            url: cleanUrl,
            domain: extractDomain(cleanUrl),
          });
        }
        if (snippet) {
          snippetLines.push(`${title} (${extractDomain(cleanUrl)}): ${snippet}`);
        }
      });
    } catch {
      // ignore parse failures
    }
  }

  if (wikiRes.status === 'fulfilled' && Array.isArray(wikiRes.value)) {
    const titles = Array.isArray(wikiRes.value[1]) ? wikiRes.value[1] : [];
    const descs = Array.isArray(wikiRes.value[2]) ? wikiRes.value[2] : [];
    const urls = Array.isArray(wikiRes.value[3]) ? wikiRes.value[3] : [];
    for (let i = 0; i < Math.min(titles.length, urls.length); i++) {
      const rawUrl = String(urls[i] || '').trim();
      if (!/^https?:\/\//i.test(rawUrl)) continue;
      const cleanUrl = rawUrl.slice(0, 1000);
      const title = String(titles[i] || 'Wikipedia').trim().slice(0, 200);
      const desc = String(descs[i] || '').trim().slice(0, 320);
      if (!sourceMap.has(cleanUrl) && sourceMap.size < 12) {
        sourceMap.set(cleanUrl, {
          title,
          url: cleanUrl,
          domain: extractDomain(cleanUrl),
        });
      }
      if (desc) {
        snippetLines.push(`${title}: ${desc}`);
      }
    }
  }

  const sources = Array.from(sourceMap.values()).slice(0, 12);
  const inspectTargets = sources
    .map((s) => s.url)
    .filter(isInspectableSource)
    .slice(0, depth === 'deep' ? 4 : 3);

  const pageNotes: string[] = [];
  if (inspectTargets.length > 0) {
    const inspected = await Promise.allSettled(inspectTargets.map((u) => inspectWebPage(u)));
    for (const item of inspected) {
      if (item.status === 'fulfilled' && item.value.statusCode >= 200 && item.value.statusCode < 400) {
        const p = item.value;
        const matchedSource = sources.find((s) => s.url === p.url || s.url === p.finalUrl);
        if (matchedSource && p.title && matchedSource.title === matchedSource.domain) {
          matchedSource.title = p.title.slice(0, 200);
        }
        const parts: string[] = [];
        if (p.title) parts.push(`Title: ${p.title}`);
        if (p.headings.length > 0) parts.push(`Headings: ${p.headings.slice(0, 4).join(' | ')}`);
        if (p.excerpt) parts.push(`Excerpt: ${p.excerpt.slice(0, 500)}`);
        if (parts.length > 0) {
          pageNotes.push(`[${extractDomain(p.finalUrl)}] ${parts.join(' — ')}`);
        }
      }
    }
  }

  const combinedNotes = [...snippetLines, ...pageNotes].join('\n').trim();
  return {
    groundedNotes: combinedNotes,
    sources,
    webSearchQueries: cleanSearchQuery ? [cleanSearchQuery.slice(0, 200)] : [],
  };
}

async function generateResilient(
  params: Parameters<ReturnType<typeof getGeminiClient>['models']['generateContent']>[0],
  apiKeyOverride?: string
) {
  const ai = getGeminiClient(apiKeyOverride);
  const models = getModelConfig();
  const requestedIsFast = params.model === models.fastText;

  if (Date.now() < preferLiteResearchUntil && !requestedIsFast) {
    const liteConfig = params.config ? { ...params.config } : undefined;
    if (liteConfig && 'thinkingConfig' in liteConfig) {
      delete (liteConfig as Record<string, unknown>).thinkingConfig;
    }
    try {
      return await withGeminiRetry(
        () =>
          ai.models.generateContent({
            ...params,
            model: models.fastText,
            config: liteConfig,
          }),
        1
      );
    } catch (err) {
      if (!isOverloadOrQuotaError(err)) throw err;
    }
  }

  try {
    return await withGeminiRetry(() => ai.models.generateContent(params), requestedIsFast ? 1 : 0);
  } catch (err) {
    if (!isOverloadOrQuotaError(err)) throw err;
    const fallbackModel = requestedIsFast ? models.deepText : models.fastText;
    if (fallbackModel === models.fastText) {
      preferLiteResearchUntil = Date.now() + 60_000;
    }
    const fallbackConfig = params.config ? { ...params.config } : undefined;
    if (fallbackModel === models.fastText && fallbackConfig && 'thinkingConfig' in fallbackConfig) {
      delete (fallbackConfig as Record<string, unknown>).thinkingConfig;
    }
    return await withGeminiRetry(
      () =>
        ai.models.generateContent({
          ...params,
          model: fallbackModel,
          config: fallbackConfig,
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

function fallbackSynthesis(groundedNotes: string, query: string, sources: ResearchSource[]): SynthesisDraft {
  const cleanedLines = groundedNotes
    .split(/\n+/)
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, '').replace(/[*_`#]/g, '').trim())
    .filter((line) => line.length >= 20);

  const sentences = groundedNotes
    .replace(/[*_`#]/g, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^\[[^\]]+\]\s*/, '').trim())
    .filter((s) => s.length > 20);

  const keyFindings = (cleanedLines.length >= 2 ? cleanedLines : sentences)
    .slice(0, 6)
    .map((s) => s.slice(0, 360));

  const comparisonPoints: ResearchComparisonPoint[] = sources.slice(0, 4).map((src) => ({
    label: src.domain.slice(0, 120),
    detail: src.title.slice(0, 480),
  }));

  const executiveSummary =
    sentences.slice(0, 3).join(' ').slice(0, 1400) ||
    cleanedLines.slice(0, 2).join(' ').slice(0, 1400) ||
    `Live web sources gathered for ${query}.`;

  const spokenSummary = (
    sentences.slice(0, 2).join(' ') || `I gathered ${sources.length} live web sources on ${query}.`
  )
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 420);

  return {
    executiveSummary,
    keyFindings,
    comparisonPoints,
    followUpQuestions: [
      `What are the latest updates on ${query}?`,
      `Can you inspect the top source in more detail?`,
    ],
    spokenSummary,
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

  // Phase 1: Grounded discovery (Gemini googleSearch / OpenRouter web plugin + live HTTP web fallback)
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

    let groundingError: unknown = null;
    try {
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
    } catch (err) {
      groundingError = err;
    }

    if (!groundedNotes || groundingError) {
      const webFallback = await runHttpWebDiscovery(query, allTargetUrls, depth);
      if (webFallback.groundedNotes || webFallback.sources.length > 0) {
        groundedNotes = groundedNotes || webFallback.groundedNotes;
        if (sources.length === 0) {
          sources = webFallback.sources;
        }
        if (webSearchQueries.length === 0) {
          webSearchQueries = webFallback.webSearchQueries;
        }
      } else if (groundingError) {
        throw groundingError;
      }
    }
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
    // Graceful fallback using already-grounded live search discovery notes
    parsed = fallbackSynthesis(groundedNotes, query, sources);
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
