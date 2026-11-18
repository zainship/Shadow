import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';

export type PluginCategory = 'utilities' | 'developer' | 'knowledge' | 'automation' | 'webhook';
export type PluginKind = 'http_api' | 'laptop_command';
export type PluginHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface PluginParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
}

export interface PluginHeader {
  key: string;
  value: string;
}

export interface PluginRuntimeDescriptor {
  id?: string;
  slug: string;
  name: string;
  description: string;
  category: PluginCategory;
  kind: PluginKind;
  toolName: string;
  enabled: boolean;
  version: string;
  author: string;
  parameters: PluginParameter[];
  endpointUrl: string;
  httpMethod: PluginHttpMethod;
  headers: PluginHeader[];
  bodyTemplate: string;
  commandTemplate: string;
}

export interface PluginExecutionOutput {
  ok: boolean;
  pluginId?: string;
  pluginName: string;
  toolName: string;
  kind: PluginKind;
  statusCode?: number;
  latencyMs?: number;
  data?: unknown;
  stdout?: string;
  summary: string;
  error?: string;
  requiresClientExecution?: boolean;
  renderedCommand?: string;
}

export const BUILTIN_TOOL_NAMES = new Set([
  'execute_browser_automation',
  'play_youtube_media',
  'control_youtube_player',
  'save_voice_macro',
  'research_topic',
  'manage_laptop_files',
  'control_laptop_apps',
  'execute_terminal_command',
  'save_memory',
  'forget_memory',
]);

export const PLUGIN_CATALOG: Array<Omit<PluginRuntimeDescriptor, 'id'>> = [
  {
    slug: 'open-meteo-weather',
    name: 'Live Weather & Forecast',
    description:
      'Fetches real-time temperature, humidity, wind, conditions, and 3-day forecast for any city via Open-Meteo.',
    category: 'utilities',
    kind: 'http_api',
    toolName: 'plugin_weather_forecast',
    enabled: true,
    version: '1.0.0',
    author: 'Shadow Registry',
    parameters: [
      {
        name: 'location',
        type: 'string',
        description: 'City or place name (e.g. San Francisco, Tokyo, London).',
        required: true,
      },
      {
        name: 'unit',
        type: 'string',
        description: 'Temperature unit: celsius or fahrenheit (default celsius).',
        required: false,
      },
    ],
    endpointUrl: 'builtin://weather',
    httpMethod: 'GET',
    headers: [],
    bodyTemplate: '',
    commandTemplate: '',
  },
  {
    slug: 'github-explorer',
    name: 'GitHub Repository Explorer',
    description:
      'Searches public GitHub repositories by topic, library, or name and returns stars, language, descriptions, and URLs.',
    category: 'developer',
    kind: 'http_api',
    toolName: 'plugin_github_search',
    enabled: true,
    version: '1.0.0',
    author: 'Shadow Registry',
    parameters: [
      {
        name: 'query',
        type: 'string',
        description: 'GitHub search query (e.g. "tauri voice assistant" or "owner/repo").',
        required: true,
      },
    ],
    endpointUrl: 'https://api.github.com/search/repositories?q={{query}}&sort=stars&per_page=5',
    httpMethod: 'GET',
    headers: [
      { key: 'Accept', value: 'application/vnd.github+json' },
      { key: 'User-Agent', value: 'Shadow-Plugin-Runtime' },
    ],
    bodyTemplate: '',
    commandTemplate: '',
  },
  {
    slug: 'hacker-news-live',
    name: 'Hacker News Live Feed',
    description:
      'Retrieves the live top, new, or ask stories from Hacker News with scores, authors, and links.',
    category: 'knowledge',
    kind: 'http_api',
    toolName: 'plugin_hacker_news',
    enabled: true,
    version: '1.0.0',
    author: 'Shadow Registry',
    parameters: [
      {
        name: 'feed',
        type: 'string',
        description: 'Story feed type: top, new, best, or ask (default top).',
        required: false,
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Number of stories to return (1 to 8, default 5).',
        required: false,
      },
    ],
    endpointUrl: 'builtin://hacker-news',
    httpMethod: 'GET',
    headers: [],
    bodyTemplate: '',
    commandTemplate: '',
  },
  {
    slug: 'fx-currency-rates',
    name: 'Currency Exchange Rates',
    description:
      'Fetches live European Central Bank foreign exchange conversion rates between currencies (e.g. USD to EUR, GBP, JPY).',
    category: 'utilities',
    kind: 'http_api',
    toolName: 'plugin_fx_rates',
    enabled: true,
    version: '1.0.0',
    author: 'Shadow Registry',
    parameters: [
      {
        name: 'base',
        type: 'string',
        description: '3-letter base currency code (e.g. USD, EUR, GBP).',
        required: true,
      },
      {
        name: 'target',
        type: 'string',
        description: 'Comma-separated target currency codes (e.g. EUR,INR,JPY).',
        required: true,
      },
    ],
    endpointUrl: 'https://api.frankfurter.app/latest?from={{base}}&to={{target}}',
    httpMethod: 'GET',
    headers: [{ key: 'Accept', value: 'application/json' }],
    bodyTemplate: '',
    commandTemplate: '',
  },
  {
    slug: 'wikipedia-summary',
    name: 'Wikipedia Instant Brief',
    description:
      'Retrieves concise factual encyclopedic summaries and canonical links directly from Wikipedia REST API.',
    category: 'knowledge',
    kind: 'http_api',
    toolName: 'plugin_wikipedia_summary',
    enabled: true,
    version: '1.0.0',
    author: 'Shadow Registry',
    parameters: [
      {
        name: 'topic',
        type: 'string',
        description: 'Article topic or entity title (e.g. "Alan Turing", "Quantum computing").',
        required: true,
      },
    ],
    endpointUrl: 'https://en.wikipedia.org/api/rest_v1/page/summary/{{topic}}',
    httpMethod: 'GET',
    headers: [{ key: 'User-Agent', value: 'Shadow-Plugin-Runtime/1.0' }],
    bodyTemplate: '',
    commandTemplate: '',
  },
  {
    slug: 'public-holidays',
    name: 'Public Holiday Calendar',
    description:
      'Looks up official national public holidays for a given year and ISO country code (e.g. US, GB, IN, DE).',
    category: 'utilities',
    kind: 'http_api',
    toolName: 'plugin_public_holidays',
    enabled: true,
    version: '1.0.0',
    author: 'Shadow Registry',
    parameters: [
      {
        name: 'year',
        type: 'number',
        description: '4-digit calendar year (e.g. 2026).',
        required: true,
      },
      {
        name: 'countryCode',
        type: 'string',
        description: '2-letter ISO country code (e.g. US, GB, CA, DE).',
        required: true,
      },
    ],
    endpointUrl: 'https://date.nager.at/api/v3/PublicHolidays/{{year}}/{{countryCode}}',
    httpMethod: 'GET',
    headers: [{ key: 'Accept', value: 'application/json' }],
    bodyTemplate: '',
    commandTemplate: '',
  },
  {
    slug: 'laptop-git-inspector',
    name: 'Laptop Git Inspector',
    description:
      'Checks git branch status, uncommitted changes, and last 5 commits inside a local repository on your laptop.',
    category: 'developer',
    kind: 'laptop_command',
    toolName: 'plugin_laptop_git_status',
    enabled: true,
    version: '1.0.0',
    author: 'Shadow Registry',
    parameters: [
      {
        name: 'repoPath',
        type: 'string',
        description: 'Local repository path on the laptop (e.g. ~/Projects/my-app or .).',
        required: true,
      },
    ],
    endpointUrl: '',
    httpMethod: 'GET',
    headers: [],
    bodyTemplate: '',
    commandTemplate: 'git -C {{repoPath}} status -sb && git -C {{repoPath}} log -n 5 --oneline',
  },
  {
    slug: 'laptop-docker-ps',
    name: 'Docker Container Monitor',
    description:
      'Lists active Docker containers, uptime status, and published ports running locally on your laptop.',
    category: 'automation',
    kind: 'laptop_command',
    toolName: 'plugin_laptop_docker',
    enabled: true,
    version: '1.0.0',
    author: 'Shadow Registry',
    parameters: [
      {
        name: 'filter',
        type: 'string',
        description: 'Optional container name filter or leave empty for all running containers.',
        required: false,
      },
    ],
    endpointUrl: '',
    httpMethod: 'GET',
    headers: [],
    bodyTemplate: '',
    commandTemplate:
      'docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
  },
];

export function sanitizeToolName(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^[^a-z]+/, 'plugin_')
    .slice(0, 56);
  const candidate = normalized.length >= 3 ? normalized : `plugin_${normalized || 'tool'}`;
  if (BUILTIN_TOOL_NAMES.has(candidate)) {
    return `plugin_${candidate}`.slice(0, 56);
  }
  return candidate;
}

export function normalizePluginDescriptors(
  rawList: unknown,
  maxPlugins = 30
): PluginRuntimeDescriptor[] {
  if (!Array.isArray(rawList)) return [];
  const seenTools = new Set<string>();
  const valid: PluginRuntimeDescriptor[] = [];

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const enabled = obj.enabled !== false;
    const name = String(obj.name || '').trim().slice(0, 80);
    const description = String(obj.description || '').trim().slice(0, 300);
    const kind: PluginKind = obj.kind === 'laptop_command' ? 'laptop_command' : 'http_api';
    const rawTool = String(obj.toolName || obj.slug || name || '');
    const toolName = sanitizeToolName(rawTool);

    if (!name || !description || seenTools.has(toolName)) continue;
    seenTools.add(toolName);

    const rawParams = Array.isArray(obj.parameters) ? obj.parameters.slice(0, 8) : [];
    const parameters: PluginParameter[] = rawParams
      .map((p) => {
        if (!p || typeof p !== 'object') return null;
        const param = p as Record<string, unknown>;
        const pName = String(param.name || '')
          .trim()
          .replace(/[^a-zA-Z0-9_]/g, '')
          .slice(0, 40);
        if (!pName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(pName)) return null;
        const pType: PluginParameter['type'] =
          param.type === 'number' || param.type === 'boolean' ? param.type : 'string';
        return {
          name: pName,
          type: pType,
          description: (String(param.description || pName).trim() || pName).slice(0, 200),
          required: Boolean(param.required),
        };
      })
      .filter((p): p is PluginParameter => Boolean(p));

    const rawHeaders = Array.isArray(obj.headers) ? obj.headers.slice(0, 8) : [];
    const headers: PluginHeader[] = rawHeaders
      .map((h) => {
        if (!h || typeof h !== 'object') return null;
        const hdr = h as Record<string, unknown>;
        const key = String(hdr.key || '').trim().slice(0, 80);
        const value = String(hdr.value || '').trim().slice(0, 300);
        if (!key) return null;
        return { key, value };
      })
      .filter((h): h is PluginHeader => Boolean(h));

    const method = String(obj.httpMethod || 'GET').toUpperCase();
    const httpMethod: PluginHttpMethod = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      ? (method as PluginHttpMethod)
      : 'GET';

    const cat = String(obj.category || 'utilities');
    const category: PluginCategory = [
      'utilities',
      'developer',
      'knowledge',
      'automation',
      'webhook',
    ].includes(cat)
      ? (cat as PluginCategory)
      : 'utilities';

    valid.push({
      id: typeof obj.id === 'string' ? obj.id : undefined,
      slug:
        String(obj.slug || toolName)
          .trim()
          .replace(/[^a-zA-Z0-9_-]/g, '-')
          .slice(0, 64) || toolName,
      name,
      description,
      category,
      kind,
      toolName,
      enabled,
      version: String(obj.version || '1.0.0').trim().slice(0, 20) || '1.0.0',
      author: String(obj.author || 'Custom').trim().slice(0, 80) || 'Custom',
      parameters,
      endpointUrl: String(obj.endpointUrl || '').trim().slice(0, 500),
      httpMethod,
      headers,
      bodyTemplate: String(obj.bodyTemplate || '').slice(0, 1500),
      commandTemplate: String(obj.commandTemplate || '').trim().slice(0, 500),
    });

    if (valid.length >= maxPlugins) break;
  }

  return valid;
}

export function buildPluginToolDeclarations(
  plugins: PluginRuntimeDescriptor[]
): FunctionDeclaration[] {
  const declarations: FunctionDeclaration[] = [];

  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    const properties: Record<string, { type: Type; description: string }> = {};
    const required: string[] = [];

    for (const param of plugin.parameters.slice(0, 8)) {
      const geminiType =
        param.type === 'number'
          ? Type.NUMBER
          : param.type === 'boolean'
            ? Type.BOOLEAN
            : Type.STRING;
      properties[param.name] = {
        type: geminiType,
        description: param.description,
      };
      if (param.required) required.push(param.name);
    }

    // Gemini Type.OBJECT requires non-empty properties; add an optional note field when parameterless
    if (Object.keys(properties).length === 0) {
      properties.input = {
        type: Type.STRING,
        description: 'Optional input context or filter string for this plugin.',
      };
    }

    declarations.push({
      name: plugin.toolName,
      description: `[Plugin: ${plugin.name}] ${plugin.description}`,
      parameters: {
        type: Type.OBJECT,
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
    });
  }

  return declarations;
}

function assertPublicHttpUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Plugin endpoint URL must use http:// or https://.');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.startsWith('169.254.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error('Private/local network URLs are blocked in cloud HTTP plugins.');
  }
  return parsed;
}

function interpolateUrlTemplate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const val = args[key];
    return val === undefined || val === null ? '' : encodeURIComponent(String(val));
  });
}

function interpolatePlainTemplate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const val = args[key];
    return val === undefined || val === null ? '' : String(val);
  });
}

function interpolateJsonBodyTemplate(template: string, args: Record<string, unknown>): string {
  // Replace "{{key}}" inside quotes safely, or unquoted {{key}} as JSON literals
  let out = template.replace(/"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}"/g, (_m, key: string) => {
    const val = args[key];
    const str = val === undefined || val === null ? '' : String(val);
    return JSON.stringify(str);
  });
  out = out.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const val = args[key];
    if (val === undefined || val === null) return 'null';
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    return JSON.stringify(String(val));
  });
  return out;
}

function shellEscapePosixArg(raw: string): string {
  const clean = raw.replace(/\0/g, '');
  if (clean === '~') return '"$HOME"';
  if (clean.startsWith('~/')) {
    const rest = clean.slice(2).replace(/'/g, `'\\''`);
    return `"$HOME"/'${rest}'`;
  }
  return `'${clean.replace(/'/g, `'\\''`)}'`;
}

export function renderLaptopCommand(
  plugin: PluginRuntimeDescriptor,
  args: Record<string, unknown>
): string {
  const tpl = plugin.commandTemplate.trim();
  if (!tpl) {
    throw new Error(`Plugin "${plugin.name}" has an empty commandTemplate.`);
  }
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const val = args[key];
    const str = val === undefined || val === null ? '' : String(val);
    return shellEscapePosixArg(str);
  });
}

const WMO_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  80: 'Rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  95: 'Thunderstorm',
};

async function runBuiltinWeather(
  plugin: PluginRuntimeDescriptor,
  args: Record<string, unknown>,
  startedAt: number
): Promise<PluginExecutionOutput> {
  const location = String(args.location || args.city || args.input || '').trim();
  if (!location) {
    return {
      ok: false,
      pluginId: plugin.id,
      pluginName: plugin.name,
      toolName: plugin.toolName,
      kind: plugin.kind,
      summary: 'Location is required.',
      error: 'Missing location parameter.',
    };
  }
  const unitPref = String(args.unit || 'celsius').toLowerCase().includes('f')
    ? 'fahrenheit'
    : 'celsius';

  const geoRes = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!geoRes.ok) {
    throw new Error(`Weather geocoding returned HTTP ${geoRes.status}`);
  }
  const geoData = (await geoRes.json()) as {
    results?: Array<{
      name: string;
      country?: string;
      admin1?: string;
      latitude: number;
      longitude: number;
    }>;
  };
  const place = geoData.results?.[0];
  if (!place) {
    return {
      ok: false,
      pluginId: plugin.id,
      pluginName: plugin.name,
      toolName: plugin.toolName,
      kind: plugin.kind,
      latencyMs: Date.now() - startedAt,
      summary: `Location "${location}" not found.`,
      error: `Could not find coordinates for "${location}".`,
    };
  }

  const wxUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&temperature_unit=${unitPref}&forecast_days=3&timezone=auto`;

  const wxRes = await fetch(wxUrl, { signal: AbortSignal.timeout(8000) });
  if (!wxRes.ok) {
    throw new Error(`Open-Meteo forecast returned HTTP ${wxRes.status}`);
  }
  const wx = (await wxRes.json()) as {
    current?: {
      temperature_2m?: number;
      apparent_temperature?: number;
      relative_humidity_2m?: number;
      wind_speed_10m?: number;
      weather_code?: number;
    };
    daily?: {
      time?: string[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: number[];
      weather_code?: number[];
    };
  };

  const unitSymbol = unitPref === 'fahrenheit' ? '°F' : '°C';
  const condition = WMO_CODES[wx.current?.weather_code ?? -1] || 'Clear';
  const resolvedName = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
  const forecast = (wx.daily?.time || []).map((date, idx) => ({
    date,
    condition: WMO_CODES[wx.daily?.weather_code?.[idx] ?? -1] || 'Variable',
    high: `${wx.daily?.temperature_2m_max?.[idx] ?? ''}${unitSymbol}`,
    low: `${wx.daily?.temperature_2m_min?.[idx] ?? ''}${unitSymbol}`,
    rainChance: `${wx.daily?.precipitation_probability_max?.[idx] ?? 0}%`,
  }));

  const payload = {
    location: resolvedName,
    current: {
      condition,
      temperature: `${wx.current?.temperature_2m ?? ''}${unitSymbol}`,
      feelsLike: `${wx.current?.apparent_temperature ?? ''}${unitSymbol}`,
      humidity: `${wx.current?.relative_humidity_2m ?? ''}%`,
      windSpeedKmh: wx.current?.wind_speed_10m ?? null,
    },
    forecast,
  };

  return {
    ok: true,
    pluginId: plugin.id,
    pluginName: plugin.name,
    toolName: plugin.toolName,
    kind: plugin.kind,
    statusCode: wxRes.status,
    latencyMs: Date.now() - startedAt,
    data: payload,
    summary: `${resolvedName}: ${condition}, ${payload.current.temperature} (feels like ${payload.current.feelsLike}), humidity ${payload.current.humidity}.`,
  };
}

async function runBuiltinHackerNews(
  plugin: PluginRuntimeDescriptor,
  args: Record<string, unknown>,
  startedAt: number
): Promise<PluginExecutionOutput> {
  const rawFeed = String(args.feed || 'top').toLowerCase();
  const feed = ['top', 'new', 'best', 'ask'].includes(rawFeed) ? rawFeed : 'top';
  const count = Math.max(1, Math.min(8, Number(args.limit || 5) || 5));

  const idsRes = await fetch(`https://hacker-news.firebaseio.com/v0/${feed}stories.json`, {
    signal: AbortSignal.timeout(7000),
  });
  if (!idsRes.ok) {
    throw new Error(`Hacker News API returned HTTP ${idsRes.status}`);
  }
  const ids = ((await idsRes.json()) as number[]).slice(0, count);
  const stories = await Promise.all(
    ids.map(async (id) => {
      const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) return null;
      const item = (await r.json()) as {
        id: number;
        title?: string;
        by?: string;
        score?: number;
        descendants?: number;
        url?: string;
      };
      return {
        id: item.id,
        title: item.title || 'Untitled',
        score: item.score ?? 0,
        author: item.by || 'unknown',
        comments: item.descendants ?? 0,
        url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
      };
    })
  );
  const cleanStories = stories.filter((s): s is NonNullable<typeof s> => Boolean(s));
  return {
    ok: true,
    pluginId: plugin.id,
    pluginName: plugin.name,
    toolName: plugin.toolName,
    kind: plugin.kind,
    statusCode: 200,
    latencyMs: Date.now() - startedAt,
    data: { feed, stories: cleanStories },
    summary: `Fetched ${cleanStories.length} ${feed} Hacker News stories. Top: "${cleanStories[0]?.title || 'N/A'}" (${cleanStories[0]?.score || 0} points).`,
  };
}

function compactPayload(raw: unknown): unknown {
  if (typeof raw === 'string') return raw.slice(0, 5000);
  try {
    const serialized = JSON.stringify(raw);
    if (serialized.length <= 5500) return raw;
    if (Array.isArray(raw)) {
      return raw.slice(0, 8);
    }
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (Array.isArray(obj.items)) {
        return {
          ...obj,
          items: obj.items.slice(0, 5).map((item) => {
            if (item && typeof item === 'object') {
              const r = item as Record<string, unknown>;
              return {
                name: r.full_name || r.name || r.title,
                description: typeof r.description === 'string' ? r.description.slice(0, 180) : undefined,
                stars: r.stargazers_count,
                language: r.language,
                url: r.html_url || r.url,
              };
            }
            return item;
          }),
        };
      }
      return { truncatedPreview: serialized.slice(0, 5200) };
    }
  } catch {
    return String(raw).slice(0, 4000);
  }
  return raw;
}

export async function executeHttpPlugin(
  plugin: PluginRuntimeDescriptor,
  args: Record<string, unknown>
): Promise<PluginExecutionOutput> {
  const startedAt = Date.now();
  try {
    if (plugin.endpointUrl === 'builtin://weather') {
      return await runBuiltinWeather(plugin, args, startedAt);
    }
    if (plugin.endpointUrl === 'builtin://hacker-news') {
      return await runBuiltinHackerNews(plugin, args, startedAt);
    }

    if (!plugin.endpointUrl.trim()) {
      throw new Error(`Plugin "${plugin.name}" has no endpointUrl configured.`);
    }

    const renderedUrl = interpolateUrlTemplate(plugin.endpointUrl, args);
    const validatedUrl = assertPublicHttpUrl(renderedUrl);

    const headers: Record<string, string> = {};
    for (const h of plugin.headers) {
      if (h.key.trim()) {
        headers[h.key.trim()] = interpolatePlainTemplate(h.value, args);
      }
    }

    let body: string | undefined;
    if (['POST', 'PUT', 'PATCH'].includes(plugin.httpMethod) && plugin.bodyTemplate.trim()) {
      body = interpolateJsonBodyTemplate(plugin.bodyTemplate, args);
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const res = await fetch(validatedUrl.toString(), {
      method: plugin.httpMethod,
      headers,
      body,
      redirect: 'follow',
      signal: AbortSignal.timeout(9000),
    });

    const contentType = res.headers.get('content-type') || '';
    const rawText = await res.text();
    let parsedData: unknown = rawText;
    if (contentType.includes('application/json') || rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
      try {
        parsedData = JSON.parse(rawText);
      } catch {
        parsedData = rawText.slice(0, 4000);
      }
    }

    const compacted = compactPayload(parsedData);
    const ok = res.ok;

    return {
      ok,
      pluginId: plugin.id,
      pluginName: plugin.name,
      toolName: plugin.toolName,
      kind: plugin.kind,
      statusCode: res.status,
      latencyMs: Date.now() - startedAt,
      data: compacted,
      summary: ok
        ? `${plugin.name} succeeded (HTTP ${res.status} in ${Date.now() - startedAt}ms).`
        : `${plugin.name} returned HTTP ${res.status}.`,
      ...(ok ? {} : { error: `HTTP ${res.status}: ${rawText.slice(0, 240)}` }),
    };
  } catch (err) {
    return {
      ok: false,
      pluginId: plugin.id,
      pluginName: plugin.name,
      toolName: plugin.toolName,
      kind: plugin.kind,
      latencyMs: Date.now() - startedAt,
      summary: `${plugin.name} failed.`,
      error: err instanceof Error ? err.message : 'HTTP plugin execution error.',
    };
  }
}

export async function fetchPluginManifestFromUrl(
  rawUrl: string
): Promise<PluginRuntimeDescriptor> {
  const url = assertPublicHttpUrl(rawUrl.trim());
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) {
    throw new Error(`Manifest URL returned HTTP ${res.status}`);
  }
  const rawJson = (await res.json()) as unknown;
  const list = normalizePluginDescriptors(Array.isArray(rawJson) ? rawJson : [rawJson], 1);
  if (list.length === 0) {
    throw new Error(
      'Invalid plugin manifest JSON. Required fields: name, description, kind, and toolName.'
    );
  }
  return list[0];
}
