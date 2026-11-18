export type VoiceName = 'Charon' | 'Fenrir' | 'Zephyr' | 'Kore' | 'Puck';
export type WakeMode = 'push-to-talk' | 'continuous';
export type DefaultBrowser = 'chromium' | 'system-default' | 'sandbox';
export type RuntimeKind = 'tauri-desktop' | 'web-sandbox';

export type WindowLayoutMode = 'side-by-side' | 'grid' | 'focus-split';

export interface WindowTilePlacement {
  appName: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
}

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

export interface StepExecutionState extends AutomationStep {
  status: 'pending' | 'running' | 'completed' | 'failed';
  detail?: string;
}

export interface InspectedField {
  tag: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  label: string;
  selector: string;
  filledValue?: string;
}

export interface PageInspectionResult {
  url: string;
  finalUrl: string;
  title: string;
  statusCode: number;
  fields: InspectedField[];
  buttons: string[];
  links: Array<{ text: string; href: string }>;
  headings: string[];
  excerpt: string;
}

export interface AutomationRunState {
  id: string;
  goal: string;
  targetUrl: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  steps: StepExecutionState[];
  inspection: PageInspectionResult | null;
  startedAt: number;
}

export interface YouTubeTrack {
  id?: string;
  videoId: string;
  title: string;
  channel: string;
  duration?: string;
  thumbnailUrl: string;
  mediaType: 'song' | 'video';
  status: 'queued' | 'playing' | 'played';
  url?: string;
}

export interface ShadowPermissions {
  files: boolean;
  apps: boolean;
  terminal: boolean;
  browser: boolean;
  research: boolean;
  youtube: boolean;
  memory: boolean;
  faceAuth: boolean;
}

export interface SetupConfig {
  userPreferredName: string;
  assistantName: string;
  setupCompleted: boolean;
  faceAuthEnabled: boolean;
  clapWakeEnabled: boolean;
  permissions: ShadowPermissions;
}

export interface FaceAuthProfile {
  uid?: string;
  descriptor: number[];
  sampleCount: number;
  threshold: number;
  passcodeHash: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type MemoryCategory = 'preference' | 'fact' | 'project' | 'routine' | 'person';
export type MemoryImportance = 'low' | 'normal' | 'high';
export type MemorySource = 'voice' | 'manual' | 'setup';

export interface AssistantMemory {
  id: string;
  ownerId?: string;
  category: MemoryCategory;
  content: string;
  importance: MemoryImportance;
  source: MemorySource;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  voiceName: VoiceName;
  wakeMode: WakeMode;
  defaultBrowser: DefaultBrowser;
  assistantName?: string;
  userPreferredName?: string;
  setupCompleted?: boolean;
  faceAuthEnabled?: boolean;
  clapWakeEnabled?: boolean;
  permissions?: ShadowPermissions;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AutomationWorkflow {
  id: string;
  ownerId: string;
  name: string;
  voiceTrigger: string;
  targetUrl: string;
  category: 'navigation' | 'form-fill' | 'media' | 'research';
  steps: AutomationStep[];
  runCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CommandExecution {
  id: string;
  ownerId: string;
  transcript: string;
  intent:
    | 'browser_automation'
    | 'youtube_play'
    | 'youtube_control'
    | 'workflow_run'
    | 'research'
    | 'plugin_run'
    | 'visual_generate'
    | 'conversation';
  targetUrl: string;
  status: 'running' | 'completed' | 'failed';
  stepsCount: number;
  summary: string;
  runtime: RuntimeKind;
  createdAt?: unknown;
  updatedAt?: unknown;
}

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
  ownerId?: string;
  query: string;
  depth: 'quick' | 'deep';
  executiveSummary: string;
  keyFindings: string[];
  comparisonPoints: ResearchComparisonPoint[];
  followUpQuestions: string[];
  sources: ResearchSource[];
  groundingSearchQueries: string[];
  spokenSummary?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DialogueEntry {
  id: string;
  speaker: 'user' | 'shadow';
  text: string;
  timestamp: number;
  actionTag?: string;
}

export interface LaptopAgentHealth {
  reachable: boolean;
  authenticated: boolean;
  platform?: string;
  arch?: string;
  hostname?: string;
  homeDir?: string;
  pid?: number;
  uptimeSeconds?: number;
  jobsCount?: number;
}

export interface LaptopBackgroundJob {
  id: string;
  command: string;
  cwd: string;
  pid?: number;
  status: 'running' | 'completed' | 'failed' | 'killed';
  startedAt: number;
  exitCode?: number | null;
  outputTail?: string;
}

export interface LaptopActionEvent {
  id: string;
  tool: string;
  summary: string;
  ok: boolean;
  output: string;
  timestamp: number;
  runtime: 'laptop-agent' | 'tauri-native' | 'web-sandbox';
}

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

export interface ShadowPlugin {
  id: string;
  ownerId?: string;
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
  runCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PluginExecutionResult {
  ok: boolean;
  pluginId?: string;
  pluginName?: string;
  toolName: string;
  kind?: PluginKind;
  statusCode?: number;
  latencyMs?: number;
  data?: unknown;
  stdout?: string;
  summary?: string;
  error?: string;
  requiresClientExecution?: boolean;
  renderedCommand?: string;
}

export type VisualStyle = 'auto' | 'diagram' | 'chart' | 'illustration' | 'wireframe';
export type VisualAspectRatio = '16:9' | '1:1' | '4:3' | '3:4';

export interface GeneratedVisual {
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

