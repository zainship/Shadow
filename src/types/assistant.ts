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
  durationMs?: number;
  matchedSelector?: string;
}

export interface AutomationExtractedItem {
  label: string;
  value?: string;
  href?: string;
}

export interface AutomationSubmissionResult {
  method: string;
  actionUrl: string;
  statusCode: number;
  contentType: string;
  bodyPreview: string;
  parsedJson?: unknown;
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
  engine?: 'playwright' | 'http-dom';
  playwrightAvailable?: boolean;
  screenshotBase64?: string | null;
  status: 'idle' | 'running' | 'completed' | 'failed';
  steps: StepExecutionState[];
  inspection: PageInspectionResult | null;
  extractedItems?: AutomationExtractedItem[];
  submissionResult?: AutomationSubmissionResult | null;
  agentIterations?: AutonomousAgentIteration[];
  agentAnswer?: string;
  totalDurationMs?: number;
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
    | 'workspace'
    | 'meeting'
    | 'vault'
    | 'schedule'
    | 'devops'
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
  toolTraces?: AgentToolTrace[];
  groundingSources?: Array<{ title: string; url: string }>;
  modelUsed?: string;
  attachmentName?: string;
}

export type VisionSourceMode = 'off' | 'camera' | 'screen';

export interface AgentToolTrace {
  id: string;
  name: string;
  summary: string;
  ok: boolean;
  durationMs: number;
}

export interface CommandAttachment {
  name: string;
  mimeType: string;
  dataBase64: string;
}

export interface ActiveWorkspaceContext {
  currentDateTime: string;
  timeZone: string;
  activeDrawer: string | null;
  activeAutomationUrl?: string;
  activeAutomationTitle?: string;
  activeAutomationFields?: string[];
  activeResearchQuery?: string;
  activeTrackTitle?: string;
  visionMode?: VisionSourceMode;
  shelfItems?: Array<{ name: string; kind: 'file' | 'text' | 'image'; previewText?: string }>;
  tasksSummary?: string;
  activeMeetingTitle?: string;
  vaultDocsCount?: number;
  workspaceConnected?: boolean;
}

export interface AutonomousAgentIteration {
  stepIndex: number;
  action: 'inspect' | 'navigate' | 'fill_and_submit' | 'extract' | 'finish';
  target: string;
  value?: string;
  rationale: string;
  status: 'completed' | 'failed';
  url: string;
  title: string;
  detail: string;
  durationMs: number;
}

export interface AutonomousWebAgentResult {
  ok: boolean;
  goal: string;
  startUrl: string;
  finalUrl: string;
  answer: string;
  iterations: AutonomousAgentIteration[];
  steps: StepExecutionState[];
  inspection: PageInspectionResult | null;
  extractedItems: AutomationExtractedItem[];
  submissionResult: AutomationSubmissionResult | null;
  totalDurationMs: number;
  error?: string;
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
  /** Local date key (YYYY-MM-DD) the brief was generated for. */
  date: string;
  generatedAt: number;
  headline: string;
  sections: MorningBriefSection[];
  action: string;
  spokenSummary: string;
  audioBase64?: string | null;
  topics: string[];
  provider: string;
  workspaceDigestIncluded?: boolean;
}

export interface MorningBriefConfig {
  enabled: boolean;
  /** 24h local time, 'HH:MM'. */
  time: string;
  topics: string[];
  voiceName: VoiceName;
  speakOnUnlock: boolean;
  /** Server-managed run bookkeeping. */
  lastRunDate?: string;
  lastAttemptAt?: number;
}

export type TaskPriority = 'low' | 'medium' | 'high';

export interface ShadowTask {
  id: string;
  ownerId?: string;
  title: string;
  status: 'pending' | 'done';
  priority: TaskPriority;
  dueAt: string;
  notes: string;
  reminded: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PendingWorkspaceAction {
  id: string;
  service: 'gmail' | 'calendar';
  action: 'send' | 'create_event' | 'delete_event';
  title: string;
  payload: Record<string, unknown>;
}

export interface MeetingActionItem {
  text: string;
  assignee?: string;
  dueHint?: string;
}

export interface MeetingNote {
  id: string;
  ownerId?: string;
  title: string;
  summary: string;
  transcript: string;
  keyDecisions: string[];
  actionItems: MeetingActionItem[];
  topics: string[];
  durationSeconds: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface VaultDocumentMeta {
  id: string;
  ownerId?: string;
  vaultId: string;
  title: string;
  sourceType: 'note' | 'file' | 'pdf' | 'repo' | 'meeting' | 'url';
  summary: string;
  chunkCount: number;
  embedded: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}


