import { FunctionDeclaration, Type } from '@google/genai';
import { getGeminiClient, getModelConfig, withGeminiRetry } from './gemini.ts';
import type { PluginRuntimeDescriptor } from './plugins.ts';

export interface AutomationStep {
  action:
    | 'navigate'
    | 'click'
    | 'fill'
    | 'select'
    | 'submit'
    | 'wait'
    | 'extract'
    | 'scroll'
    | 'arrange_windows';
  selector: string;
  value: string;
  description: string;
}

export interface InspectedField {
  tag: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  label: string;
  selector: string;
}

export interface InspectedLink {
  text: string;
  href: string;
}

export interface PageInspectionResult {
  url: string;
  finalUrl: string;
  title: string;
  statusCode: number;
  fields: InspectedField[];
  buttons: string[];
  links: InspectedLink[];
  headings: string[];
  excerpt: string;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function getAttr(tagHtml: string, attr: string): string {
  const re = new RegExp(`${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = tagHtml.match(re);
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim();
}

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'https://news.ycombinator.com';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.includes('.') && !trimmed.includes(' ')) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export async function inspectWebPage(rawUrl: string): Promise<PageInspectionResult> {
  const url = normalizeUrl(rawUrl);
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only HTTP/HTTPS URLs are supported.');
    }
    // Block obvious local network SSRF targets except public internet sites
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.startsWith('169.254.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.')
    ) {
      throw new Error('Private network addresses cannot be inspected from the cloud sandbox.');
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(7000),
    });

    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripTags(titleMatch[1]).slice(0, 140) : parsed.hostname;

    // Extract labels mapped by `for`
    const labelMap = new Map<string, string>();
    const labelMatches = html.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi);
    for (const lm of labelMatches) {
      const forId = getAttr(lm[1], 'for');
      const txt = stripTags(lm[2]).slice(0, 80);
      if (forId && txt) labelMap.set(forId, txt);
    }

    // Extract form fields
    const fields: InspectedField[] = [];
    const inputMatches = html.matchAll(/<(input|textarea|select)\b([^>]*)>/gi);
    for (const im of inputMatches) {
      if (fields.length >= 16) break;
      const tag = im[1].toLowerCase();
      const attrs = im[2];
      const type = (getAttr(attrs, 'type') || (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : 'text')).toLowerCase();
      if (type === 'hidden') continue;
      const id = getAttr(attrs, 'id');
      const name = getAttr(attrs, 'name');
      const placeholder = getAttr(attrs, 'placeholder');
      const ariaLabel = getAttr(attrs, 'aria-label');
      const label = (id && labelMap.get(id)) || ariaLabel || placeholder || name || id || type;
      const selector = id
        ? `#${id}`
        : name
          ? `${tag}[name="${name}"]`
          : placeholder
            ? `${tag}[placeholder="${placeholder}"]`
            : `${tag}[type="${type}"]`;

      fields.push({ tag, type, name, id, placeholder, label, selector });
    }

    // Extract buttons
    const buttons: string[] = [];
    const btnMatches = html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi);
    for (const bm of btnMatches) {
      const text = stripTags(bm[1]).slice(0, 60);
      if (text && !buttons.includes(text)) buttons.push(text);
      if (buttons.length >= 10) break;
    }

    // Extract headings
    const headings: string[] = [];
    const hMatches = html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi);
    for (const hm of hMatches) {
      const text = stripTags(hm[1]).slice(0, 120);
      if (text && !headings.includes(text)) headings.push(text);
      if (headings.length >= 8) break;
    }

    // Extract links
    const links: InspectedLink[] = [];
    const aMatches = html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi);
    for (const am of aMatches) {
      const href = getAttr(am[1], 'href');
      const text = stripTags(am[2]).slice(0, 80);
      if (text && href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        let resolvedHref = href;
        try {
          resolvedHref = new URL(href, res.url || url).toString();
        } catch {
          // keep original
        }
        links.push({ text, href: resolvedHref });
      }
      if (links.length >= 12) break;
    }

    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const cleanedBody = (bodyMatch ? bodyMatch[1] : html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ');
    const excerpt = stripTags(cleanedBody).slice(0, 500);

    return {
      url,
      finalUrl: res.url || url,
      title,
      statusCode: res.status,
      fields,
      buttons,
      links,
      headings,
      excerpt,
    };
  } catch (err) {
    return {
      url,
      finalUrl: url,
      title: url,
      statusCode: 0,
      fields: [],
      buttons: [],
      links: [],
      headings: [],
      excerpt: err instanceof Error ? err.message : 'Unable to fetch target page preview.',
    };
  }
}

export function buildDesktopLayoutInspection(
  rawSteps: unknown[],
  rawTargetUrl = 'desktop://window-layout'
): PageInspectionResult {
  const steps = Array.isArray(rawSteps) ? rawSteps : [];
  const arrangeStep = steps.find(
    (s): s is Record<string, unknown> =>
      Boolean(s) && typeof s === 'object' && (s as Record<string, unknown>).action === 'arrange_windows'
  );
  const rawLayout = String(arrangeStep?.selector || 'grid').toLowerCase();
  const layout =
    rawLayout === 'side-by-side' || rawLayout === 'split'
      ? 'side-by-side'
      : rawLayout === 'focus-split'
        ? 'focus-split'
        : 'grid';
  const rawApps = String(arrangeStep?.value || '').trim();
  const apps = rawApps
    ? rawApps
        .split(/[,;\n]+/)
        .map((a) => a.trim())
        .filter(Boolean)
    : ['Active Browser', 'Code Editor', 'Terminal', 'Notes'];
  const count = apps.length;
  const cols = layout === 'side-by-side' ? count : count <= 2 ? count : Math.ceil(Math.sqrt(count));
  const rows = layout === 'side-by-side' ? 1 : Math.ceil(count / Math.max(1, cols));

  return {
    url: rawTargetUrl || 'desktop://window-layout',
    finalUrl: `desktop://window-layout?mode=${layout}`,
    title: `Laptop Screen Window Layout (${layout === 'side-by-side' ? 'Side-by-Side' : layout === 'focus-split' ? 'Focus + Stack' : 'Grid'})`,
    statusCode: 200,
    fields: apps.map((app, idx) => {
      const col = idx % Math.max(1, cols);
      const row = Math.floor(idx / Math.max(1, cols));
      const wPct =
        layout === 'focus-split'
          ? idx === 0
            ? 60
            : 40
          : Math.round(100 / Math.max(1, cols));
      const hPct =
        layout === 'focus-split'
          ? idx === 0
            ? 100
            : Math.round(100 / Math.max(1, count - 1))
          : Math.round(100 / Math.max(1, rows));
      return {
        tag: 'window',
        type: `${wPct}% × ${hPct}%`,
        name: `window_${idx + 1}`,
        id: `tile-${idx + 1}`,
        placeholder: `col ${col + 1}, row ${row + 1}`,
        label: app,
        selector: `window[app="${app}"]`,
        filledValue: `${wPct}% × ${hPct}% (${layout})`,
      };
    }),
    buttons: ['Arrange Side-by-Side', 'Arrange Grid', 'Refresh Open Windows'],
    links: [],
    headings: [
      `Layout Preset: ${layout}`,
      `Target Windows (${apps.length}): ${apps.join(', ')}`,
    ],
    excerpt: `Arranges ${apps.length} open application window(s) across the laptop screen in a ${layout} formation via browser automation.`,
  };
}

export const jarvisToolDeclarations: FunctionDeclaration[] = [
  {
    name: 'execute_browser_automation',
    description:
      'Opens websites, fills web forms, clicks buttons, navigates complex multi-step web interfaces, extracts page information, OR arranges open app windows on the laptop screen into a grid or side-by-side layout using arrange_windows steps.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        goal: {
          type: Type.STRING,
          description: 'Concise summary of the browser or window-layout task the user wants accomplished.',
        },
        targetUrl: {
          type: Type.STRING,
          description:
            'Starting URL (e.g., https://httpbin.org/forms/post) or "desktop://window-layout" when arranging open laptop app windows.',
        },
        steps: {
          type: Type.ARRAY,
          description: 'Ordered sequence of browser automation steps to execute.',
          items: {
            type: Type.OBJECT,
            properties: {
              action: {
                type: Type.STRING,
                description:
                  'One of: navigate, click, fill, select, submit, wait, extract, scroll, arrange_windows',
              },
              selector: {
                type: Type.STRING,
                description:
                  'CSS selector, field name, aria-label, button text, OR for arrange_windows: layout preset ("side-by-side", "grid", or "focus-split").',
              },
              value: {
                type: Type.STRING,
                description:
                  'Value to type, option to select, URL to navigate, OR for arrange_windows: comma-separated app names (or empty string to tile all open windows).',
              },
              description: {
                type: Type.STRING,
                description: 'Human-readable description of this step.',
              },
            },
            required: ['action', 'selector', 'value', 'description'],
          },
        },
      },
      required: ['goal', 'targetUrl', 'steps'],
    },
  },
  {
    name: 'play_youtube_media',
    description:
      'Searches YouTube and immediately plays any requested song, music track, artist, or video.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Song name, artist, video title, or YouTube URL to play.',
        },
        mediaType: {
          type: Type.STRING,
          description: 'Either "song" or "video".',
        },
      },
      required: ['query', 'mediaType'],
    },
  },
  {
    name: 'control_youtube_player',
    description:
      'Controls the active YouTube player (pause, resume/play, next track, previous track, mute, unmute, seek, stop).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'One of: play, pause, next, previous, mute, unmute, seek, stop',
        },
        seconds: {
          type: Type.NUMBER,
          description: 'Optional seek offset or timestamp in seconds.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'save_voice_macro',
    description:
      'Saves a reusable browser automation workflow or routine to Firebase so the user can trigger it later by voice.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: 'Short title for the workflow.',
        },
        voiceTrigger: {
          type: Type.STRING,
          description: 'Spoken phrase that activates this workflow.',
        },
        targetUrl: {
          type: Type.STRING,
          description: 'Starting URL for the workflow.',
        },
        category: {
          type: Type.STRING,
          description: 'One of: navigation, form-fill, media, research',
        },
        steps: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING },
              selector: { type: Type.STRING },
              value: { type: Type.STRING },
              description: { type: Type.STRING },
            },
            required: ['action', 'selector', 'value', 'description'],
          },
        },
      },
      required: ['name', 'voiceTrigger', 'targetUrl', 'category', 'steps'],
    },
  },
  {
    name: 'research_topic',
    description:
      'Performs live grounded web research and multi-source synthesis using Google Search and optional target URLs. Use for any factual question, current events, technology or product comparison, deep dive, or webpage analysis.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'The research question, topic, or comparison to investigate.',
        },
        depth: {
          type: Type.STRING,
          description: 'Either "quick" (fast overview) or "deep" (multi-source verification and comparison).',
        },
        urls: {
          type: Type.ARRAY,
          description: 'Optional list of specific URLs to inspect and synthesize.',
          items: { type: Type.STRING },
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'manage_laptop_files',
    description:
      'Reads, writes, appends, lists, creates folders, searches, moves, copies, or deletes files and folders on the user’s laptop.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        operation: {
          type: Type.STRING,
          description: 'One of: read, write, append, list, mkdir, move, copy, delete, search, stat',
        },
        path: {
          type: Type.STRING,
          description: 'File or directory path on the laptop (supports ~ for home directory, e.g. ~/Desktop/notes.md).',
        },
        destinationPath: {
          type: Type.STRING,
          description: 'Optional target path when operation is move or copy.',
        },
        content: {
          type: Type.STRING,
          description: 'Text content to write or append when operation is write or append.',
        },
        pattern: {
          type: Type.STRING,
          description: 'Filename search term when operation is search.',
        },
      },
      required: ['operation', 'path'],
    },
  },
  {
    name: 'control_laptop_apps',
    description:
      'Opens, focuses, quits, lists, automates, or arranges open desktop application windows on the user’s laptop (e.g., side-by-side, grid, or focus-split), or retrieves laptop system info.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description:
            'One of: open_app, list_apps, focus_app, quit_app, automate_app, arrange_windows, system_info',
        },
        appName: {
          type: Type.STRING,
          description: 'Application name to open, focus, quit, or control.',
        },
        layout: {
          type: Type.STRING,
          description: 'When action is arrange_windows: "side-by-side", "grid", or "focus-split".',
        },
        apps: {
          type: Type.STRING,
          description:
            'Optional comma-separated list of app names to tile when action is arrange_windows (defaults to all open visible windows).',
        },
        gap: {
          type: Type.NUMBER,
          description: 'Optional pixel gap between tiled windows (default 8).',
        },
        instruction: {
          type: Type.STRING,
          description: 'Optional automation script or AppleScript/PowerShell/shell command to control the app.',
        },
        args: {
          type: Type.STRING,
          description: 'Optional file path or URL argument to pass when opening the app.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'execute_terminal_command',
    description:
      'Runs any shell or terminal command on the user’s laptop synchronously or as a detached background process.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: 'Exact terminal/shell command to execute on the laptop.',
        },
        cwd: {
          type: Type.STRING,
          description: 'Optional working directory (supports ~).',
        },
        background: {
          type: Type.BOOLEAN,
          description: 'Set true to run persistently in the background without blocking.',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'save_memory',
    description:
      'Saves a durable long-term memory about the user (preferences, personal facts, ongoing projects, daily routines, key contacts, or explicit "remember that..." instructions) so the assistant remembers everything across sessions.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        content: {
          type: Type.STRING,
          description: 'Concise factual statement to remember permanently (under 500 chars).',
        },
        category: {
          type: Type.STRING,
          description: 'One of: preference, fact, project, routine, person',
        },
        importance: {
          type: Type.STRING,
          description: 'One of: low, normal, high',
        },
      },
      required: ['content', 'category'],
    },
  },
  {
    name: 'forget_memory',
    description:
      'Removes or forgets a previously stored memory matching a keyword or topic when the user asks to forget something.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Keyword or phrase identifying the memory to forget.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'generate_visual',
    description:
      'Generates a custom visual asset (architecture diagram, chart, infographic, illustration, or UI wireframe) and immediately opens it inside Shadow’s Visuals stage.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: {
          type: Type.STRING,
          description: 'Detailed description of the visual, diagram, chart, or artwork to generate.',
        },
        style: {
          type: Type.STRING,
          description: 'One of: auto, diagram, chart, illustration, wireframe',
        },
        aspectRatio: {
          type: Type.STRING,
          description: 'One of: 16:9, 1:1, 4:3, 3:4 (defaults to 16:9).',
        },
      },
      required: ['prompt'],
    },
  },
];

export interface AssistantSessionContext {
  assistantName?: string;
  userPreferredName?: string;
  permissions?: Partial<Record<
    'files' | 'apps' | 'terminal' | 'browser' | 'research' | 'youtube' | 'memory' | 'faceAuth',
    boolean
  >>;
  memories?: Array<{
    category?: string;
    content?: string;
    importance?: string;
  }>;
  plugins?: PluginRuntimeDescriptor[];
}

export function buildShadowSystemInstruction(ctx?: AssistantSessionContext): string {
  const assistantName = (ctx?.assistantName || 'Shadow').trim().slice(0, 60) || 'Shadow';
  const userName = (ctx?.userPreferredName || '').trim().slice(0, 80);
  const perms = ctx?.permissions || {};

  const capabilityLines: string[] = [];
  if (perms.research !== false) {
    capabilityLines.push(
      '1. Deep web research: investigating topics with live Google Search grounding and URL analysis, verifying primary sources, synthesizing structured findings, and delivering crisp spoken briefings via research_topic.'
    );
  }
  if (perms.files !== false || perms.apps !== false || perms.terminal !== false) {
    const allowedLaptop: string[] = [];
    if (perms.files !== false) allowedLaptop.push('files (manage_laptop_files)');
    if (perms.apps !== false) allowedLaptop.push('desktop apps (control_laptop_apps)');
    if (perms.terminal !== false) allowedLaptop.push('terminal commands & background jobs (execute_terminal_command)');
    capabilityLines.push(`2. Laptop control (permitted scope: ${allowedLaptop.join(', ')}).`);
  }
  if (perms.browser !== false) {
    capabilityLines.push(
      '3. Browser & window-layout automation: opening websites, filling complex multi-field forms, clicking UI controls, extracting information, AND arranging open laptop app windows into a grid, side-by-side, or focus-split layout via execute_browser_automation (using action: "arrange_windows", targetUrl: "desktop://window-layout").'
    );
  }
  if (perms.youtube !== false) {
    capabilityLines.push(
      '4. YouTube media playback: playing any song, music track, album, or video on YouTube immediately upon request, and controlling playback (play_youtube_media, control_youtube_player).'
    );
  }
  if (perms.memory !== false) {
    capabilityLines.push(
      '5. Long-term memory & macros: automatically calling save_memory whenever the user shares preferences, projects, routines, personal facts, or says "remember this", and calling forget_memory when asked to forget something; also saving reusable workflows via save_voice_macro.'
    );
  }
  capabilityLines.push(
    '6. Visual synthesis: whenever the user asks to draw, illustrate, visualize, diagram, chart, wireframe, or show a visual, immediately call generate_visual to create the visual and open it in Shadow’s Visuals stage.'
  );

  const deniedCaps: string[] = [];
  if (perms.files === false) deniedCaps.push('manage_laptop_files');
  if (perms.apps === false) deniedCaps.push('control_laptop_apps');
  if (perms.terminal === false) deniedCaps.push('execute_terminal_command');
  if (perms.browser === false) deniedCaps.push('execute_browser_automation');
  if (perms.research === false) deniedCaps.push('research_topic');
  if (perms.youtube === false) deniedCaps.push('play_youtube_media / control_youtube_player');
  if (perms.memory === false) deniedCaps.push('save_memory / forget_memory');

  const memoryItems = (ctx?.memories || [])
    .filter((m) => m?.content && String(m.content).trim())
    .slice(0, 40)
    .map(
      (m) =>
        `- [${String(m.category || 'fact').toUpperCase()}${m.importance === 'high' ? ' · PRIORITY' : ''}] ${String(m.content).trim().slice(0, 300)}`
    );

  const activePlugins = (ctx?.plugins || []).filter((p) => p && p.enabled);
  const pluginLines = activePlugins.map(
    (p) => `- ${p.toolName} (${p.name}, ${p.kind}): ${p.description}`
  );

  return [
    `You are ${assistantName}, an ultra-responsive, calm, articulate voice-only desktop assistant running on the user's laptop.`,
    userName
      ? `Address the user naturally as "${userName}" when appropriate.`
      : 'Address the user politely and naturally.',
    capabilityLines.length > 0
      ? `Your active granted capabilities:\n${capabilityLines.join('\n')}`
      : 'All external tools are currently restricted; respond conversationally.',
    pluginLines.length > 0
      ? `INSTALLED ACTIVE PLUGINS (Invoke these plugin tools directly whenever relevant):\n${pluginLines.join('\n')}`
      : '',
    deniedCaps.length > 0
      ? `RESTRICTED PERMISSIONS (DO NOT invoke these tools; if asked, tell the user that permission is disabled in Setup): ${deniedCaps.join(', ')}.`
      : '',
    memoryItems.length > 0
      ? `PERSISTENT LONG-TERM MEMORY (Remember and apply these facts automatically):\n${memoryItems.join('\n')}`
      : 'PERSISTENT LONG-TERM MEMORY: No stored memories yet. Whenever the user shares something important about themselves, their laptop setup, or preferences, call save_memory right away.',
    `Guidelines for every response:
- Speak concisely and naturally, like an attentive personal chief-of-staff (1–2 crisp sentences). Never read out raw CSS selectors, URLs character-by-character, or markdown formatting aloud.
- Always invoke the matching permitted tool or installed plugin immediately without asking redundant confirmation questions when the user's intent is clear.
- When filling forms from brief instructions, infer realistic complete step selectors.
- Summarize the real output or outcome clearly once a tool or plugin completes.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const JARVIS_SYSTEM_INSTRUCTION = buildShadowSystemInstruction();

export async function synthesizeJarvisSpeech(
  text: string,
  voiceName = 'Charon',
  apiKeyOverride?: string
): Promise<string | null> {
  if (!text.trim()) return null;
  try {
    const ai = getGeminiClient(apiKeyOverride);
    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: getModelConfig().tts,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: text.slice(0, 600),
                speechMetadata: {
                  style: 'Calm, confident, crisp British-leaning personal AI assistant',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      })
    );
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;
  } catch (err) {
    console.warn('TTS synthesis error:', err);
    return null;
  }
}
