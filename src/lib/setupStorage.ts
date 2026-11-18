import type {
  AssistantMemory,
  FaceAuthProfile,
  MemoryCategory,
  MemoryImportance,
  MemorySource,
  PluginCategory,
  PluginHeader,
  PluginHttpMethod,
  PluginKind,
  PluginParameter,
  SetupConfig,
  ShadowPermissions,
  ShadowPlugin,
} from '../types/assistant';

const SETUP_STORAGE_KEY = 'shadow_setup_config_v1';
const LOCAL_MEMORIES_KEY = 'shadow_local_memories_v1';
const LOCAL_FACE_AUTH_KEY = 'shadow_local_face_auth_v1';
const LOCAL_PLUGINS_KEY = 'shadow_local_plugins_v1';

export const DEFAULT_PERMISSIONS: ShadowPermissions = {
  files: true,
  apps: true,
  terminal: true,
  browser: true,
  research: true,
  youtube: true,
  memory: true,
  faceAuth: true,
};

export const DEFAULT_SETUP_CONFIG: SetupConfig = {
  userPreferredName: '',
  assistantName: 'Shadow',
  setupCompleted: false,
  faceAuthEnabled: false,
  clapWakeEnabled: true,
  permissions: { ...DEFAULT_PERMISSIONS },
};

export function sanitizePermissions(raw?: Partial<ShadowPermissions> | null): ShadowPermissions {
  return {
    files: raw?.files !== undefined ? Boolean(raw.files) : DEFAULT_PERMISSIONS.files,
    apps: raw?.apps !== undefined ? Boolean(raw.apps) : DEFAULT_PERMISSIONS.apps,
    terminal: raw?.terminal !== undefined ? Boolean(raw.terminal) : DEFAULT_PERMISSIONS.terminal,
    browser: raw?.browser !== undefined ? Boolean(raw.browser) : DEFAULT_PERMISSIONS.browser,
    research: raw?.research !== undefined ? Boolean(raw.research) : DEFAULT_PERMISSIONS.research,
    youtube: raw?.youtube !== undefined ? Boolean(raw.youtube) : DEFAULT_PERMISSIONS.youtube,
    memory: raw?.memory !== undefined ? Boolean(raw.memory) : DEFAULT_PERMISSIONS.memory,
    faceAuth: raw?.faceAuth !== undefined ? Boolean(raw.faceAuth) : DEFAULT_PERMISSIONS.faceAuth,
  };
}

export function loadLocalSetupConfig(): SetupConfig {
  try {
    const raw = localStorage.getItem(SETUP_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETUP_CONFIG, permissions: { ...DEFAULT_PERMISSIONS } };
    const parsed = JSON.parse(raw) as Partial<SetupConfig>;
    return {
      userPreferredName: String(parsed.userPreferredName || '').slice(0, 80),
      assistantName: (String(parsed.assistantName || 'Shadow').trim() || 'Shadow').slice(0, 60),
      setupCompleted: Boolean(parsed.setupCompleted),
      faceAuthEnabled: Boolean(parsed.faceAuthEnabled),
      clapWakeEnabled: parsed.clapWakeEnabled !== undefined ? Boolean(parsed.clapWakeEnabled) : true,
      permissions: sanitizePermissions(parsed.permissions),
    };
  } catch {
    return { ...DEFAULT_SETUP_CONFIG, permissions: { ...DEFAULT_PERMISSIONS } };
  }
}

export function saveLocalSetupConfig(config: SetupConfig): void {
  try {
    localStorage.setItem(
      SETUP_STORAGE_KEY,
      JSON.stringify({
        userPreferredName: config.userPreferredName.trim().slice(0, 80),
        assistantName: (config.assistantName.trim() || 'Shadow').slice(0, 60),
        setupCompleted: Boolean(config.setupCompleted),
        faceAuthEnabled: Boolean(config.faceAuthEnabled),
        clapWakeEnabled: Boolean(config.clapWakeEnabled),
        permissions: sanitizePermissions(config.permissions),
      })
    );
  } catch {
    // ignore storage errors
  }
}

export function loadLocalMemories(): AssistantMemory[] {
  try {
    const raw = localStorage.getItem(LOCAL_MEMORIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AssistantMemory[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 200);
  } catch {
    return [];
  }
}

export function saveLocalMemories(memories: AssistantMemory[]): void {
  try {
    localStorage.setItem(LOCAL_MEMORIES_KEY, JSON.stringify(memories.slice(0, 200)));
  } catch {
    // ignore storage errors
  }
}

export function createLocalMemoryRecord(input: {
  category: MemoryCategory;
  content: string;
  importance?: MemoryImportance;
  source?: MemorySource;
}): AssistantMemory {
  const now = new Date().toISOString();
  return {
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    category: input.category,
    content: input.content.trim().slice(0, 600),
    importance: input.importance || 'normal',
    source: input.source || 'manual',
    createdAt: now,
    updatedAt: now,
  };
}

export function loadLocalFaceAuth(): FaceAuthProfile | null {
  try {
    const raw = localStorage.getItem(LOCAL_FACE_AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FaceAuthProfile;
    if (!Array.isArray(parsed.descriptor) || parsed.descriptor.length < 16) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLocalFaceAuth(profile: FaceAuthProfile | null): void {
  try {
    if (!profile) {
      localStorage.removeItem(LOCAL_FACE_AUTH_KEY);
      return;
    }
    localStorage.setItem(LOCAL_FACE_AUTH_KEY, JSON.stringify(profile));
  } catch {
    // ignore storage errors
  }
}

const VALID_PLUGIN_CATEGORIES = new Set<PluginCategory>([
  'utilities',
  'developer',
  'knowledge',
  'automation',
  'webhook',
]);
const VALID_PLUGIN_METHODS = new Set<PluginHttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export function sanitizePluginDraft(
  raw: Partial<ShadowPlugin> & { name: string; description: string }
): Omit<ShadowPlugin, 'id' | 'ownerId' | 'runCount' | 'createdAt' | 'updatedAt'> {
  const safeName = (raw.name.trim() || 'Custom Plugin').slice(0, 80);
  const safeDescription = (raw.description.trim() || safeName).slice(0, 300);
  const rawTool = (raw.toolName || raw.slug || safeName)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^[^a-z]+/, 'plugin_')
    .slice(0, 56);
  const toolName = rawTool.length >= 3 ? rawTool : `plugin_${rawTool || 'custom'}`.slice(0, 56);
  const slug =
    (raw.slug || toolName)
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .slice(0, 64) || toolName;
  const kind: PluginKind = raw.kind === 'laptop_command' ? 'laptop_command' : 'http_api';
  const category: PluginCategory =
    raw.category && VALID_PLUGIN_CATEGORIES.has(raw.category) ? raw.category : 'utilities';
  const methodUpper = String(raw.httpMethod || 'GET').toUpperCase() as PluginHttpMethod;
  const httpMethod: PluginHttpMethod = VALID_PLUGIN_METHODS.has(methodUpper) ? methodUpper : 'GET';

  const parameters: PluginParameter[] = (Array.isArray(raw.parameters) ? raw.parameters : [])
    .slice(0, 8)
    .map((p) => {
      const pName = String(p?.name || '')
        .trim()
        .replace(/[^a-zA-Z0-9_]/g, '')
        .slice(0, 40);
      if (!pName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(pName)) return null;
      const pType: PluginParameter['type'] =
        p?.type === 'number' || p?.type === 'boolean' ? p.type : 'string';
      return {
        name: pName,
        type: pType,
        description: (String(p?.description || pName).trim() || pName).slice(0, 200),
        required: Boolean(p?.required),
      };
    })
    .filter((p): p is PluginParameter => Boolean(p));

  const headers: PluginHeader[] = (Array.isArray(raw.headers) ? raw.headers : [])
    .slice(0, 8)
    .map((h) => {
      const key = String(h?.key || '').trim().slice(0, 80);
      const value = String(h?.value || '').trim().slice(0, 300);
      if (!key) return null;
      return { key, value };
    })
    .filter((h): h is PluginHeader => Boolean(h));

  return {
    slug,
    name: safeName,
    description: safeDescription,
    category,
    kind,
    toolName,
    enabled: raw.enabled !== undefined ? Boolean(raw.enabled) : true,
    version: (String(raw.version || '1.0.0').trim() || '1.0.0').slice(0, 20),
    author: (String(raw.author || 'Custom').trim() || 'Custom').slice(0, 80),
    parameters,
    endpointUrl: String(raw.endpointUrl || '').trim().slice(0, 500),
    httpMethod,
    headers,
    bodyTemplate: String(raw.bodyTemplate || '').slice(0, 1500),
    commandTemplate: String(raw.commandTemplate || '').trim().slice(0, 500),
  };
}

export function loadLocalPlugins(): ShadowPlugin[] {
  try {
    const raw = localStorage.getItem(LOCAL_PLUGINS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ShadowPlugin[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 40);
  } catch {
    return [];
  }
}

export function saveLocalPlugins(plugins: ShadowPlugin[]): void {
  try {
    localStorage.setItem(LOCAL_PLUGINS_KEY, JSON.stringify(plugins.slice(0, 40)));
  } catch {
    // ignore storage errors
  }
}

export function createLocalPluginRecord(
  draft: Partial<ShadowPlugin> & { name: string; description: string }
): ShadowPlugin {
  const clean = sanitizePluginDraft(draft);
  const now = new Date().toISOString();
  return {
    id: `plg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ...clean,
    runCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

