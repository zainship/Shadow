import { extractOpenRouterCitations, openRouterGenerate } from './ai-provider.ts';
import { getGeminiClient, getModelConfig, withGeminiRetry } from './gemini.ts';

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channel: string;
  duration: string;
  thumbnailUrl: string;
  url: string;
}

function extractBalancedJson(source: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIndex; i < source.length; i++) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }
  return null;
}

function collectVideoRenderers(node: unknown, out: Record<string, unknown>[], limit = 6): void {
  if (!node || typeof node !== 'object' || out.length >= limit) return;
  if (Array.isArray(node)) {
    for (const item of node) {
      collectVideoRenderers(item, out, limit);
      if (out.length >= limit) return;
    }
    return;
  }
  const obj = node as Record<string, unknown>;
  if (obj.videoRenderer && typeof obj.videoRenderer === 'object') {
    out.push(obj.videoRenderer as Record<string, unknown>);
    if (out.length >= limit) return;
  }
  for (const val of Object.values(obj)) {
    collectVideoRenderers(val, out, limit);
    if (out.length >= limit) return;
  }
}

function extractText(field: unknown): string {
  if (!field || typeof field !== 'object') return '';
  const f = field as { simpleText?: string; runs?: { text?: string }[] };
  if (typeof f.simpleText === 'string') return f.simpleText;
  if (Array.isArray(f.runs)) return f.runs.map((r) => r.text ?? '').join('');
  return '';
}

export function extractVideoIdFromUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return /^[a-zA-Z0-9_-]{6,32}$/.test(id) ? id : null;
    }
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{6,32}$/.test(v)) return v;
      const parts = u.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'embed' || parts[0] === 'shorts') && parts[1]) {
        return /^[a-zA-Z0-9_-]{6,32}$/.test(parts[1]) ? parts[1] : null;
      }
    }
  } catch {
    // Not a URL
  }
  return null;
}

export interface SearchYouTubeOptions {
  /** BYOK Gemini key override for the grounded fallback lookup. */
  geminiKeyOverride?: string;
  /** BYOK OpenRouter runtime for the grounded fallback lookup (web plugin). */
  openRouter?: { apiKey: string; model: string };
}

export async function searchYouTube(
  query: string,
  opts?: SearchYouTubeOptions
): Promise<YouTubeSearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  // Direct YouTube URL support
  const directId = extractVideoIdFromUrl(cleanQuery);
  if (directId) {
    try {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${directId}`)}&format=json`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (oembedRes.ok) {
        const meta = (await oembedRes.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
        return [
          {
            videoId: directId,
            title: meta.title || 'YouTube Video',
            channel: meta.author_name || 'YouTube',
            duration: 'Live / Stream',
            thumbnailUrl: meta.thumbnail_url || `https://i.ytimg.com/vi/${directId}/hqdefault.jpg`,
            url: `https://www.youtube.com/watch?v=${directId}`,
          },
        ];
      }
    } catch {
      // fall through
    }
  }

  // Primary: Parse ytInitialData from YouTube public search HTML
  try {
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(7000),
      }
    );
    if (res.ok) {
      const html = await res.text();
      const marker = 'var ytInitialData = ';
      const idx = html.indexOf(marker);
      if (idx !== -1) {
        const jsonStr = extractBalancedJson(html, idx + marker.length);
        if (jsonStr) {
          const parsed = JSON.parse(jsonStr) as unknown;
          const renderers: Record<string, unknown>[] = [];
          collectVideoRenderers(parsed, renderers, 6);
          const results: YouTubeSearchResult[] = [];
          for (const vr of renderers) {
            const videoId = typeof vr.videoId === 'string' ? vr.videoId : '';
            if (!/^[a-zA-Z0-9_-]{6,32}$/.test(videoId)) continue;
            const title = extractText(vr.title) || 'Untitled Video';
            const channel =
              extractText(vr.ownerText) || extractText(vr.longBylineText) || 'YouTube Channel';
            const duration = extractText(vr.lengthText) || 'Video';
            results.push({
              videoId,
              title: title.slice(0, 190),
              channel: channel.slice(0, 110),
              duration,
              thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
              url: `https://www.youtube.com/watch?v=${videoId}`,
            });
          }
          if (results.length > 0) {
            return results;
          }
        }
      }
    }
  } catch (err) {
    console.warn('Direct YouTube HTML search failed, attempting Gemini Google Search grounding:', err);
  }

  // Secondary: grounded web lookup to find a real YouTube watch URL
  // (BYOK: OpenRouter web plugin when provided, else Gemini Google Search grounding)
  try {
    const lookupPrompt = `Find the exact official YouTube video URL (youtube.com/watch?v=...) for: "${cleanQuery}". Return the full watch URL and title.`;
    let text = '';
    const candidateUrls: string[] = [];

    if (opts?.openRouter) {
      const turn = await openRouterGenerate({
        apiKey: opts.openRouter.apiKey,
        model: opts.openRouter.model,
        contents: [{ role: 'user', parts: [{ text: lookupPrompt }] }],
        webSearch: true,
      });
      text = turn.text;
      for (const citation of extractOpenRouterCitations(turn.annotations)) {
        candidateUrls.push(citation.url);
      }
    } else {
      const ai = getGeminiClient(opts?.geminiKeyOverride);
      const response = await withGeminiRetry(() =>
        ai.models.generateContent({
          model: getModelConfig().deepText,
          contents: lookupPrompt,
          config: {
            tools: [{ googleSearch: {} }],
          },
        })
      );
      text = response.text || '';
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      for (const chunk of chunks) {
        const uri = (chunk as { web?: { uri?: string } })?.web?.uri;
        if (uri) candidateUrls.push(uri);
      }
    }

    const regexMatches = text.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]{6,32}/g) ?? [];
    candidateUrls.push(...regexMatches);

    for (const url of candidateUrls) {
      const vid = extractVideoIdFromUrl(url);
      if (vid) {
        try {
          const oembedRes = await fetch(
            `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${vid}`)}&format=json`,
            { signal: AbortSignal.timeout(4000) }
          );
          if (oembedRes.ok) {
            const meta = (await oembedRes.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
            return [
              {
                videoId: vid,
                title: (meta.title || cleanQuery).slice(0, 190),
                channel: (meta.author_name || 'YouTube').slice(0, 110),
                duration: 'Video',
                thumbnailUrl: meta.thumbnail_url || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
                url: `https://www.youtube.com/watch?v=${vid}`,
              },
            ];
          }
        } catch {
          return [
            {
              videoId: vid,
              title: cleanQuery.slice(0, 190),
              channel: 'YouTube',
              duration: 'Video',
              thumbnailUrl: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
              url: `https://www.youtube.com/watch?v=${vid}`,
            },
          ];
        }
      }
    }
  } catch (err) {
    console.error('Gemini grounded YouTube lookup failed:', err);
  }

  return [];
}
