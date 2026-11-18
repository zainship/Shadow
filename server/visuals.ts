import { ThinkingLevel, Type } from '@google/genai';
import { getGeminiClient, isOverloadOrQuotaError, withGeminiRetry } from './gemini.ts';

export type VisualStyle = 'auto' | 'diagram' | 'chart' | 'illustration' | 'wireframe';
export type VisualAspectRatio = '16:9' | '1:1' | '4:3' | '3:4';

export interface GeneratedVisualPayload {
  id: string;
  title: string;
  prompt: string;
  kind: Exclude<VisualStyle, 'auto'>;
  aspectRatio: VisualAspectRatio;
  width: number;
  height: number;
  summary: string;
  svgMarkup: string;
  palette: string[];
  createdAt: number;
}

const ASPECT_DIMENSIONS: Record<VisualAspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1200, height: 675 },
  '1:1': { width: 1000, height: 1000 },
  '4:3': { width: 1200, height: 900 },
  '3:4': { width: 900, height: 1200 },
};

export function normalizeAspectRatio(raw: unknown): VisualAspectRatio {
  const val = String(raw || '').trim();
  if (val === '1:1' || val === '4:3' || val === '3:4' || val === '16:9') {
    return val;
  }
  return '16:9';
}

export function normalizeVisualStyle(raw: unknown): VisualStyle {
  const val = String(raw || '').toLowerCase().trim();
  if (val === 'diagram' || val === 'chart' || val === 'illustration' || val === 'wireframe') {
    return val;
  }
  return 'auto';
}

export function sanitizeSvgMarkup(rawSvg: string, width: number, height: number): string {
  let svg = String(rawSvg || '').trim();
  // Extract <svg ...>...</svg> block if wrapped in markdown fences or prose
  const match = svg.match(/<svg\b[\s\S]*<\/svg>/i);
  if (match) {
    svg = match[0];
  }

  if (!/^<svg\b/i.test(svg)) {
    throw new Error('Model did not return a valid SVG visual.');
  }

  // Remove dangerous elements & event handlers
  svg = svg
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:href|xlink:href)\s*=\s*(?:"(?:javascript:|vbscript:|data:text\/html|https?:\/\/)[^"]*"|'(?:javascript:|vbscript:|data:text\/html|https?:\/\/)[^']*')/gi, '');

  // Ensure xmlns and crisp viewBox dimensions
  svg = svg.replace(/^<svg\b([^>]*)>/i, (_full, attrs: string) => {
    let cleanAttrs = attrs;
    if (!/\bxmlns\s*=/i.test(cleanAttrs)) {
      cleanAttrs += ' xmlns="http://www.w3.org/2000/svg"';
    }
    if (!/\bviewBox\s*=/i.test(cleanAttrs)) {
      cleanAttrs += ` viewBox="0 0 ${width} ${height}"`;
    }
    if (!/\bwidth\s*=/i.test(cleanAttrs)) {
      cleanAttrs += ` width="${width}"`;
    }
    if (!/\bheight\s*=/i.test(cleanAttrs)) {
      cleanAttrs += ` height="${height}"`;
    }
    return `<svg${cleanAttrs}>`;
  });

  return svg;
}

export async function generateVisualAsset(input: {
  prompt: string;
  style?: VisualStyle;
  aspectRatio?: VisualAspectRatio;
  refineFromSvg?: string;
}): Promise<GeneratedVisualPayload> {
  const prompt = String(input.prompt || '').trim();
  if (!prompt) {
    throw new Error('Visual prompt is required.');
  }
  const style = normalizeVisualStyle(input.style);
  const aspectRatio = normalizeAspectRatio(input.aspectRatio);
  const { width, height } = ASPECT_DIMENSIONS[aspectRatio];
  const ai = getGeminiClient();

  const systemInstruction = `You are a master visual designer, technical illustrator, and data visualization architect creating bespoke, high-craft SVG visuals.

Strict requirements for svgMarkup:
- Root element MUST be <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">.
- Completely self-contained vector SVG: NO <script>, NO <foreignObject>, NO external image URLs, NO inline event handlers.
- Craft genuinely rich, polished, gallery-grade visuals:
  - Include a cohesive full-bleed background <rect> with deep atmospheric gradients or editorial surface styling in <defs> (<linearGradient>, <radialGradient>, subtle <filter> glow/shadow, crisp <marker> arrowheads for diagrams).
  - Use generous whitespace margins (at least 60px padding around edges), crisp alignment, clear visual hierarchy, and well-proportioned typography (font-family="system-ui, -apple-system, sans-serif").
  - Ensure labels NEVER collide or overlap shapes or other text lines. Keep text concise and readable at standard zoom.
  - For "diagram": structured nodes, rounded glass-style containers, directional bezier/orthogonal connectors with arrowheads, subtle grid lines, and a clear legend/title.
  - For "chart": accurate axes, gridlines, tick labels, numeric value callouts, clean bars/lines/areas or radial arcs, and a clear title + legend.
  - For "illustration": layered geometric/organic vector shapes, lighting gradients, depth layers, focal subject, and atmospheric highlights.
  - For "wireframe": sleek dark or light UI mockup frames, layout regions, typography blocks, and realistic interactive component chrome.`;

  const userParts = input.refineFromSvg
    ? `Refine the existing SVG visual below according to this instruction: "${prompt}"\nTarget aspect ratio: ${aspectRatio} (${width}x${height}).\n\nExisting SVG:\n${input.refineFromSvg.slice(0, 14000)}`
    : `Create a ${style === 'auto' ? 'tailored' : style} visual for: "${prompt}".\nTarget canvas dimensions: ${width}x${height} (aspectRatio ${aspectRatio}).`;

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description: 'Concise 2-6 word title for the visual.',
      },
      kind: {
        type: Type.STRING,
        description: 'One of: diagram, chart, illustration, wireframe',
      },
      summary: {
        type: Type.STRING,
        description: 'One crisp natural sentence describing the generated visual for spoken narration.',
      },
      palette: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: '3 to 5 primary hex color codes used in the visual (e.g. "#38BDF8").',
      },
      svgMarkup: {
        type: Type.STRING,
        description: `Complete valid <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">...</svg> string.`,
      },
    },
    required: ['title', 'kind', 'summary', 'palette', 'svgMarkup'],
  };

  let response;
  try {
    response = await withGeminiRetry(
      () =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: userParts,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        }),
      1
    );
  } catch (err) {
    if (!isOverloadOrQuotaError(err)) throw err;
    response = await withGeminiRetry(
      () =>
        ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: userParts,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema,
          },
        }),
      1
    );
  }

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    title?: string;
    kind?: string;
    summary?: string;
    palette?: string[];
    svgMarkup?: string;
  };

  const sanitizedSvg = sanitizeSvgMarkup(parsed.svgMarkup || '', width, height);
  const rawKind = String(parsed.kind || style).toLowerCase();
  const kind: Exclude<VisualStyle, 'auto'> =
    rawKind === 'diagram' || rawKind === 'chart' || rawKind === 'wireframe'
      ? rawKind
      : 'illustration';

  const palette = Array.isArray(parsed.palette)
    ? parsed.palette
        .map((c) => String(c || '').trim())
        .filter((c) => /^#[0-9a-fA-F]{3,8}$/.test(c))
        .slice(0, 6)
    : ['#38BDF8', '#818CF8', '#0B111E'];

  return {
    id: `vis-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: (parsed.title || prompt.slice(0, 48)).trim().slice(0, 90),
    prompt,
    kind,
    aspectRatio,
    width,
    height,
    summary:
      (parsed.summary || `Generated a ${kind} visual for ${prompt}.`).trim().slice(0, 260),
    svgMarkup: sanitizedSvg,
    palette: palette.length > 0 ? palette : ['#38BDF8', '#818CF8', '#0B111E'],
    createdAt: Date.now(),
  };
}
