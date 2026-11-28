import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  AlertTriangle,
  AudioLines,
  Blocks,
  BookOpen,
  CalendarCheck2,
  Compass,
  Cpu,
  Globe,
  Image as ImageIcon,
  Layers,
  LogIn,
  LogOut,
  Monitor,
  Play,
  Radio,
  ShieldAlert,
  Sunrise,
  X,
} from 'lucide-react';
import {
  ArcReactorScene,
  type ReactorCommandCue,
  type ReactorCommandKind,
  type ReactorMode,
} from './components/ArcReactorScene';
import { BrowserAutomationStage } from './components/BrowserAutomationStage';
import { DynamicIsland } from './components/DynamicIsland';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ErrorInspectorModal } from './components/ErrorInspectorModal';
import {
  clearShadowErrors,
  dismissShadowError,
  reportExceptionError,
  reportShadowError,
  useShadowErrors,
} from './lib/errorStore';
import { FaceAuthGateModal } from './components/FaceAuthGateModal';
import { FirstLaunchSetupModal, type SeedMemoryDraft } from './components/FirstLaunchSetupModal';
import { IosControlDock } from './components/IosControlDock';
import {
  MAC_SPRING_CONTROL,
  MAC_SPRING_WINDOW,
  MacWindowFrame,
} from './components/MacWindowShell';
import { MorningBriefStage } from './components/MorningBriefStage';
import { MeetingCompanionStage } from './components/MeetingCompanionStage';
import { PluginsStage, type PluginActivityLog } from './components/PluginsStage';
import { PWAInstallButton } from './components/PWAInstallButton';
import { RemoteTriggersStage } from './components/RemoteTriggersStage';
import { ResearchStage } from './components/ResearchStage';
import { VisualsStage } from './components/VisualsStage';
import {
  MacrosAndHistoryView,
  TauriDesktopView,
} from './components/WorkflowsAndHistoryPanel';
import { KnowledgeVaultStage } from './components/KnowledgeVaultStage';
import { WorkspaceStage } from './components/WorkspaceStage';
import { YouTubeMediaStage } from './components/YouTubeMediaStage';
import { float32ToPcm16Base64, PcmAudioPlayer, speakWithBrowserSpeech } from './lib/audioEngine';
import {
  DoubleClapAnalyzer,
  playWakeChime,
  StandbyClapListener,
  type ClapListenerStatus,
} from './lib/clapDetector';
import {
  auth,
  clearWorkspaceAccessToken,
  connectWorkspaceScopesPopup,
  getWorkspaceAccessToken,
  googleProvider,
  setWorkspaceAccessToken,
  subscribeWorkspaceTokenChange,
  testConnection,
} from './lib/firebase';
import {
  addMediaQueueItem,
  createExecutionLog,
  createMemory,
  createTaskInFirestore,
  createWorkflow,
  deleteFaceAuthProfile,
  deleteMediaQueueItem,
  deleteMeetingInFirestore,
  deleteMemory,
  deletePluginInFirestore,
  deleteResearchReport,
  deleteTaskInFirestore,
  deleteVaultDocMetaInFirestore,
  deleteWorkflow,
  ensureUserProfile,
  finalizeExecutionLog,
  getFaceAuthProfile,
  incrementPluginRunCount,
  incrementWorkflowRunCount,
  installPluginInFirestore,
  saveFaceAuthProfile,
  saveMeetingInFirestore,
  saveResearchReport,
  saveSetupConfigToFirestore,
  saveVaultDocMetaInFirestore,
  subscribeExecutions,
  subscribeMediaQueue,
  subscribeMeetings,
  subscribeMemories,
  subscribePlugins,
  subscribeResearchReports,
  subscribeTasks,
  subscribeVaultDocs,
  subscribeWorkflows,
  updateMediaQueueStatus,
  updateMemory,
  updatePluginInFirestore,
  updateTaskInFirestore,
  updateUserPreferences,
} from './lib/firestoreService';
import {
  createLocalMemoryRecord,
  createLocalPluginRecord,
  loadConfirmLaptopActions,
  loadLocalFaceAuth,
  loadLocalMeetings,
  loadLocalMemories,
  loadLocalPlugins,
  loadLocalSetupConfig,
  loadLocalTasks,
  loadLocalVaultMeta,
  sanitizePermissions,
  sanitizePluginDraft,
  saveConfirmLaptopActions,
  saveLocalFaceAuth,
  saveLocalMeetings,
  saveLocalMemories,
  saveLocalPlugins,
  saveLocalSetupConfig,
  saveLocalTasks,
  saveLocalVaultMeta,
} from './lib/setupStorage';
import {
  checkLaptopAgentHealth,
  detectRuntimeEnvironment,
  ensureDesktopBackendServer,
  executeLaptopTool,
  invokeDesktopBrowserAutomation,
  invokeDesktopOpenUrl,
  type DesktopRuntimeInfo,
} from './lib/tauriBridge';
import { requestNativeOsPermission } from './lib/osPermissions';
import { buildWindowLayoutInspection } from './lib/windowLayout';
import {
  checkShadowBackendHealth,
  getApiOrigin,
  getApiWsBase,
  parseJsonSafely,
} from './lib/apiBase';

interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0?: { transcript?: string };
  }>;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
import {
  aiRequestHeaders,
  aiSocketAuthMessage,
  loadAiSettings,
  saveAiSettings,
  type AiSettings,
} from './lib/aiSettings';
import { AiSettingsModal } from './components/AiSettingsModal';
import {
  LaptopPermissionModal,
  type LaptopPermissionRequest,
} from './components/LaptopPermissionModal';
import { useNetworkTelemetry } from './hooks/useNetworkTelemetry';
import { useVisionStream } from './hooks/useVisionStream';
import type {
  ActiveWorkspaceContext,
  AgentToolTrace,
  AssistantMemory,
  AutomationExtractedItem,
  AutomationRunState,
  AutomationStep,
  AutomationSubmissionResult,
  AutomationWorkflow,
  AutonomousWebAgentResult,
  CommandAttachment,
  CommandExecution,
  DialogueEntry,
  FaceAuthProfile,
  GeneratedVisual,
  LaptopActionEvent,
  LaptopAgentHealth,
  MeetingNote,
  MemoryCategory,
  MemoryImportance,
  PageInspectionResult,
  PendingWorkspaceAction,
  PluginExecutionResult,
  ResearchReport,
  SetupConfig,
  ShadowPlugin,
  ShadowTask,
  StepExecutionState,
  TaskPriority,
  VaultDocumentMeta,
  VisionSourceMode,
  VisualAspectRatio,
  VisualStyle,
  VoiceName,
  WakeMode,
  MorningBrief,
  MorningBriefConfig,
  WindowLayoutMode,
  YouTubeTrack,
} from './types/assistant';

type DrawerTab =
  | 'brief'
  | 'research'
  | 'automation'
  | 'youtube'
  | 'visuals'
  | 'workspace'
  | 'meetings'
  | 'vault'
  | 'triggers'
  | 'macros'
  | 'plugins'
  | 'tauri'
  | null;

const VOICES: VoiceName[] = ['Charon', 'Fenrir', 'Zephyr', 'Kore', 'Puck'];
const VISUALS_STORAGE_KEY = 'shadow_visuals_v1';
const BRIEF_SEEN_STORAGE_KEY = 'shadow_brief_seen_v1';
const REACTOR_BRIGHTNESS_STORAGE_KEY = 'shadow_reactor_brightness_v1';
const DIALOGUE_STORAGE_KEY = 'shadow_dialogue_v1';
const DEEP_THINKING_STORAGE_KEY = 'shadow_deep_thinking_v1';

function loadDialogueHistory(): DialogueEntry[] {
  try {
    const raw = window.localStorage.getItem(DIALOGUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is DialogueEntry =>
          Boolean(item && typeof item.id === 'string' && typeof item.text === 'string')
      )
      .slice(-40);
  } catch {
    return [];
  }
}

function saveDialogueHistory(entries: DialogueEntry[]): void {
  try {
    window.localStorage.setItem(DIALOGUE_STORAGE_KEY, JSON.stringify(entries.slice(-40)));
  } catch {
    // ignore storage failures
  }
}

function loadDeepThinking(): boolean {
  try {
    return window.localStorage.getItem(DEEP_THINKING_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveDeepThinking(enabled: boolean): void {
  try {
    window.localStorage.setItem(DEEP_THINKING_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore storage failures
  }
}

function loadReactorBrightness(): number {
  try {
    const raw = window.localStorage.getItem(REACTOR_BRIGHTNESS_STORAGE_KEY);
    if (!raw) return 1;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(2, Math.max(0.2, parsed));
  } catch {
    return 1;
  }
}

function saveReactorBrightness(value: number): void {
  try {
    window.localStorage.setItem(
      REACTOR_BRIGHTNESS_STORAGE_KEY,
      String(Math.min(2, Math.max(0.2, value)))
    );
  } catch {
    // ignore storage failures
  }
}

function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
}

function loadBriefSeenDate(): string {
  try {
    return window.localStorage.getItem(BRIEF_SEEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function saveBriefSeenDate(date: string): void {
  try {
    window.localStorage.setItem(BRIEF_SEEN_STORAGE_KEY, date);
  } catch {
    // ignore persistence failures
  }
}

const DEFAULT_BRIEF_CONFIG: MorningBriefConfig = {
  enabled: false,
  time: '08:00',
  topics: ['top technology & AI news'],
  voiceName: 'Charon',
  speakOnUnlock: true,
};

function loadLocalVisuals(): GeneratedVisual[] {
  try {
    const raw = window.localStorage.getItem(VISUALS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is GeneratedVisual =>
        Boolean(item && typeof item.id === 'string' && typeof item.svgMarkup === 'string')
    );
  } catch {
    return [];
  }
}

function saveLocalVisuals(items: GeneratedVisual[]): void {
  try {
    window.localStorage.setItem(VISUALS_STORAGE_KEY, JSON.stringify(items.slice(0, 20)));
  } catch {
    // Ignore storage quota errors
  }
}

function JarvisArcWorkspace() {
  // Auth & Firebase State
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Runtime & Preferences
  const [runtimeInfo, setRuntimeInfo] = useState<DesktopRuntimeInfo>({
    isTauri: false,
    runtime: 'web-sandbox',
    os: 'browser',
    arch: 'web',
    sidecarAvailable: false,
  });
  const [agentHealth, setAgentHealth] = useState<LaptopAgentHealth>({
    reachable: false,
    authenticated: false,
  });
  const [laptopActions, setLaptopActions] = useState<LaptopActionEvent[]>([]);
  const [voiceName, setVoiceName] = useState<VoiceName>('Charon');
  const [wakeMode, setWakeMode] = useState<WakeMode>('push-to-talk');

  // First-Launch Setup, Memory & Face Auth State
  const [setupConfig, setSetupConfig] = useState<SetupConfig>(() => loadLocalSetupConfig());
  const [setupOpen, setSetupOpen] = useState<boolean>(() => !loadLocalSetupConfig().setupCompleted);
  const [aiSettings, setAiSettingsState] = useState<AiSettings>(() => loadAiSettings());
  const [aiSettingsOpen, setAiSettingsOpen] = useState<boolean>(false);
  const aiSettingsRef = useRef<AiSettings>(aiSettings);
  const serverHasGeminiKeyRef = useRef<boolean>(false);

  useEffect(() => {
    aiSettingsRef.current = aiSettings;
    saveAiSettings(aiSettings);
  }, [aiSettings]);

  useEffect(() => {
    const origin = getApiOrigin();
    void checkShadowBackendHealth(origin).then((healthy) => {
      if (!healthy) {
        serverHasGeminiKeyRef.current = false;
        return;
      }
      void fetch(`${origin}/api/ai/status`)
        .then((r) => (r.ok ? parseJsonSafely<{ hasServerGeminiKey?: boolean }>(r) : null))
        .then((data) => {
          if (data && typeof data.hasServerGeminiKey === 'boolean') {
            serverHasGeminiKeyRef.current = data.hasServerGeminiKey;
          }
        })
        .catch(() => null);
    });
  }, [aiSettingsOpen]);
  const [faceAuthProfile, setFaceAuthProfile] = useState<FaceAuthProfile | null>(() =>
    loadLocalFaceAuth()
  );
  const [isFaceUnlocked, setIsFaceUnlocked] = useState<boolean>(() => {
    const cfg = loadLocalSetupConfig();
    const face = loadLocalFaceAuth();
    return !(cfg.setupCompleted && cfg.faceAuthEnabled && Boolean(face));
  });
  const [localMemories, setLocalMemories] = useState<AssistantMemory[]>(() => loadLocalMemories());
  const [firestoreMemories, setFirestoreMemories] = useState<AssistantMemory[]>([]);
  const [localPlugins, setLocalPlugins] = useState<ShadowPlugin[]>(() => loadLocalPlugins());
  const [firestorePlugins, setFirestorePlugins] = useState<ShadowPlugin[]>([]);
  const [pluginLogs, setPluginLogs] = useState<PluginActivityLog[]>([]);

  // Minimal 3D HUD State
  const [activeDrawer, setActiveDrawer] = useState<DrawerTab>(null);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [hudCollapsed, setHudCollapsed] = useState(false);
  const [reactorBrightness, setReactorBrightness] = useState<number>(() => loadReactorBrightness());
  const [confirmLaptopActions, setConfirmLaptopActions] = useState<boolean>(() =>
    loadConfirmLaptopActions()
  );
  const confirmLaptopActionsRef = useRef<boolean>(confirmLaptopActions);
  const sessionAllowedCategoriesRef = useRef<Set<'files' | 'apps' | 'terminal'>>(new Set());
  const [pendingPermissionReq, setPendingPermissionReq] = useState<LaptopPermissionRequest | null>(
    null
  );
  const permissionResolverRef = useRef<((decision: 'deny' | 'once' | 'always') => void) | null>(
    null
  );
  const permissionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const prefersReduced = useReducedMotion();

  useEffect(() => {
    saveReactorBrightness(reactorBrightness);
  }, [reactorBrightness]);

  useEffect(() => {
    confirmLaptopActionsRef.current = confirmLaptopActions;
    saveConfirmLaptopActions(confirmLaptopActions);
  }, [confirmLaptopActions]);

  // Voice Session State (Voice-only, no chatbox)
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [isAutomating, setIsAutomating] = useState(false);
  const [isResearching, setIsResearching] = useState(false);
  const [isGeneratingVisual, setIsGeneratingVisual] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const shadowErrors = useShadowErrors();
  const [errorInspectorOpen, setErrorInspectorOpen] = useState(false);
  const [liveCaption, setLiveCaption] = useState<{ speaker: string; text: string } | null>(null);
  const [commandCue, setCommandCue] = useState<ReactorCommandCue | null>(null);
  const [dialogueHistory, setDialogueHistory] = useState<DialogueEntry[]>(() =>
    loadDialogueHistory()
  );
  const [deepThinking, setDeepThinking] = useState<boolean>(() => loadDeepThinking());
  const [shelfWorkspaceItems, setShelfWorkspaceItems] = useState<
    Array<{ name: string; kind: 'file' | 'text' | 'image'; previewText?: string }>
  >([]);
  const [timerControlEvent, setTimerControlEvent] = useState<{
    action: 'start' | 'pause' | 'reset';
    minutes?: number;
    label?: string;
    nonce: number;
  } | null>(null);
  const cueTimerRef = useRef<number | null>(null);
  const cueIdRef = useRef<number>(0);

  useEffect(() => {
    saveDialogueHistory(dialogueHistory);
  }, [dialogueHistory]);

  useEffect(() => {
    saveDeepThinking(deepThinking);
  }, [deepThinking]);

  const appendDialogueEntry = useCallback((entry: Omit<DialogueEntry, 'id' | 'timestamp'>) => {
    const cleanText = entry.text.trim();
    if (!cleanText) return;
    setDialogueHistory((prev) => [
      ...prev.slice(-39),
      {
        ...entry,
        text: cleanText,
        id: `dlg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
      },
    ]);
  }, []);

  // Automation, Research, Visuals & YouTube Stage State
  const [automationRun, setAutomationRun] = useState<AutomationRunState | null>(null);
  const [currentResearch, setCurrentResearch] = useState<ResearchReport | null>(null);
  const [localResearchHistory, setLocalResearchHistory] = useState<ResearchReport[]>([]);
  const [visuals, setVisuals] = useState<GeneratedVisual[]>(() => loadLocalVisuals());
  const [currentVisual, setCurrentVisual] = useState<GeneratedVisual | null>(
    () => loadLocalVisuals()[0] ?? null
  );
  const [briefToday, setBriefToday] = useState<MorningBrief | null>(null);
  const [briefConfig, setBriefConfig] = useState<MorningBriefConfig>(() => ({ ...DEFAULT_BRIEF_CONFIG }));
  const [briefHistory, setBriefHistory] = useState<MorningBrief[]>([]);
  const [isBriefRunning, setIsBriefRunning] = useState(false);
  const [briefSeenDate, setBriefSeenDate] = useState<string>(() => loadBriefSeenDate());
  const [currentTrack, setCurrentTrack] = useState<YouTubeTrack | null>(null);
  const [localQueue, setLocalQueue] = useState<YouTubeTrack[]>([]);
  const [pendingPlayerAction, setPendingPlayerAction] = useState<{
    action: string;
    seconds?: number;
    nonce: number;
  } | null>(null);

  // Firestore Collections
  const [workflows, setWorkflows] = useState<AutomationWorkflow[]>([]);
  const [executions, setExecutions] = useState<CommandExecution[]>([]);
  const [firestoreQueue, setFirestoreQueue] = useState<YouTubeTrack[]>([]);
  const [firestoreResearch, setFirestoreResearch] = useState<ResearchReport[]>([]);
  const [workspaceConnected, setWorkspaceConnected] = useState<boolean>(() =>
    Boolean(getWorkspaceAccessToken())
  );
  const [localTasks, setLocalTasks] = useState<ShadowTask[]>(() => loadLocalTasks());
  const [firestoreTasks, setFirestoreTasks] = useState<ShadowTask[]>([]);
  const [localMeetings, setLocalMeetings] = useState<MeetingNote[]>(() => loadLocalMeetings());
  const [firestoreMeetings, setFirestoreMeetings] = useState<MeetingNote[]>([]);
  const [localVaultDocs, setLocalVaultDocs] = useState<VaultDocumentMeta[]>(() => loadLocalVaultMeta());
  const [firestoreVaultDocs, setFirestoreVaultDocs] = useState<VaultDocumentMeta[]>([]);
  const [pendingWorkspaceAction, setPendingWorkspaceAction] =
    useState<PendingWorkspaceAction | null>(null);
  const [workspaceConfirmBusy, setWorkspaceConfirmBusy] = useState(false);

  // Audio & Socket Refs
  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<PcmAudioPlayer>(new PcmAudioPlayer());
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const inputLevelRef = useRef<number>(0);
  const outputLevelRef = useRef<number>(0);
  const isMicMutedRef = useRef<boolean>(false);
  const isConnectedRef = useRef<boolean>(false);
  const isConnectingRef = useRef<boolean>(false);
  const userTranscriptBufRef = useRef<string>('');
  const jarvisTranscriptBufRef = useRef<string>('');
  const captionTimerRef = useRef<number | null>(null);
  const spaceHoldActiveRef = useRef<boolean>(false);
  const desktopAuthPollRef = useRef<number | null>(null);
  const sessionUnlockedOnceRef = useRef<boolean>(false);
  const clapListenerRef = useRef<StandbyClapListener>(new StandbyClapListener());
  const mutedClapAnalyzerRef = useRef<DoubleClapAnalyzer>(new DoubleClapAnalyzer());
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const browserVoiceActiveRef = useRef<boolean>(false);
  const handleSpeakTextRef = useRef<(text: string) => Promise<void>>(async () => {});
  const runSpokenActionRef = useRef<(commandText: string, explicitAttachment?: CommandAttachment) => Promise<void>>(
    async () => {}
  );
  const [clapStatus, setClapStatus] = useState<ClapListenerStatus>('idle');
  const clapWakeEnabledRef = useRef<boolean>(setupConfig.clapWakeEnabled);
  clapWakeEnabledRef.current = setupConfig.clapWakeEnabled;

  useEffect(() => {
    return subscribeWorkspaceTokenChange((connected) => {
      setWorkspaceConnected(connected);
      const token = getWorkspaceAccessToken();
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'workspace_token',
            data: token || '',
          })
        );
      }
    });
  }, []);

  const mediaQueue = user ? firestoreQueue : localQueue;
  const researchHistory = user ? firestoreResearch : localResearchHistory;
  const memories = user ? firestoreMemories : localMemories;
  const plugins = user ? firestorePlugins : localPlugins;
  const tasks = user ? firestoreTasks : localTasks;
  const meetings = user ? firestoreMeetings : localMeetings;
  const vaultDocs = user ? firestoreVaultDocs : localVaultDocs;
  const tasksRef = useRef<ShadowTask[]>(tasks);
  tasksRef.current = tasks;
  const pluginsRef = useRef<ShadowPlugin[]>(plugins);
  pluginsRef.current = plugins;
  const assistantName = setupConfig.assistantName.trim() || 'Shadow';
  const assistantNameRef = useRef<string>(assistantName);
  assistantNameRef.current = assistantName;

  useEffect(() => {
    document.title = `${assistantName} — Voice & Browser Automation PWA`;
  }, [assistantName]);

  const sendLiveVideoFrame = useCallback((base64: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'video',
          data: base64,
          mimeType: 'image/jpeg',
        })
      );
    }
  }, []);

  const vision = useVisionStream({
    liveStreamEnabled: isConnected,
    onVideoFrame: sendLiveVideoFrame,
  });

  useEffect(() => {
    if (vision.visionError) {
      setVoiceError(vision.visionError);
      reportShadowError({
        source: 'Live Vision',
        title: 'Camera / Screen Vision Error',
        message: vision.visionError,
      });
    }
  }, [vision.visionError]);

  const handleChangeVisionMode = useCallback(
    (nextMode: VisionSourceMode) => {
      if (nextMode === 'off') {
        vision.stopVision();
      } else {
        void vision.startVision(nextMode);
      }
    },
    [vision]
  );

  const beginCommandCue = useCallback((kind: ReactorCommandKind, label: string) => {
    if (cueTimerRef.current) {
      window.clearTimeout(cueTimerRef.current);
      cueTimerRef.current = null;
    }
    const id = ++cueIdRef.current;
    setCommandCue({ id, kind, label, active: true });
    return id;
  }, []);

  const finishCommandCue = useCallback(
    (kind: ReactorCommandKind, label: string, ok = true, holdMs = 2400) => {
      if (cueTimerRef.current) {
        window.clearTimeout(cueTimerRef.current);
      }
      const id = ++cueIdRef.current;
      setCommandCue({
        id,
        kind,
        label,
        active: false,
        outcome: ok ? 'ok' : 'error',
      });
      cueTimerRef.current = window.setTimeout(() => {
        setCommandCue((prev) => (prev?.id === id ? null : prev));
      }, holdMs);
    },
    []
  );

  const describeToolCue = useCallback(
    (toolName: string, args: Record<string, unknown> = {}): { kind: ReactorCommandKind; label: string } => {
      if (toolName === 'research_topic') {
        const q = String(args.query || '').trim();
        return {
          kind: 'research',
          label: q ? `Researching: ${q.slice(0, 48)}` : 'Researching live sources',
        };
      }
      if (toolName === 'generate_visual') {
        const promptText = String(args.prompt || '').trim();
        return {
          kind: 'visuals',
          label: promptText
            ? `Creating visual: ${promptText.slice(0, 44)}`
            : 'Generating visual graphic',
        };
      }
      if (toolName === 'inspect_web_page') {
        const u = String(args.url || '').trim();
        return {
          kind: 'automation',
          label: u ? `Inspecting: ${u.slice(0, 44)}` : 'Inspecting live webpage DOM',
        };
      }
      if (toolName === 'run_autonomous_web_agent') {
        const g = String(args.goal || args.startUrl || '').trim();
        return {
          kind: 'automation',
          label: g ? `Autonomous Agent: ${g.slice(0, 38)}` : 'Running autonomous web agent',
        };
      }
      if (toolName === 'set_focus_timer') {
        const act = String(args.action || 'start');
        const mins = Number(args.minutes || 25);
        return {
          kind: 'command',
          label: act === 'start' ? `Focus Timer: ${mins}m` : `Focus Timer: ${act}`,
        };
      }
      if (toolName === 'execute_browser_automation') {
        const stepsArr = Array.isArray(args.steps) ? (args.steps as AutomationStep[]) : [];
        const arrangeStep = stepsArr.find((s) => s?.action === 'arrange_windows');
        if (arrangeStep || String(args.targetUrl || '').toLowerCase().startsWith('desktop://')) {
          const layoutLabel = arrangeStep?.selector || 'grid';
          return {
            kind: 'automation',
            label: `Arranging windows (${layoutLabel})`,
          };
        }
        const goal = String(args.goal || args.targetUrl || '').trim();
        return {
          kind: 'automation',
          label: goal ? `Automating: ${goal.slice(0, 48)}` : 'Executing browser task',
        };
      }
      if (toolName === 'play_youtube_media') {
        const q = String(args.query || '').trim();
        return {
          kind: 'youtube',
          label: q ? `YouTube: ${q.slice(0, 48)}` : 'Loading YouTube media',
        };
      }
      if (toolName === 'control_youtube_player') {
        const action = String(args.action || 'playback');
        return {
          kind: 'youtube',
          label: `Player: ${action}`,
        };
      }
      if (toolName === 'manage_laptop_files') {
        const op = String(args.operation || 'file');
        const p = String(args.path || '').trim();
        return {
          kind: 'laptop',
          label: p ? `Files (${op}): ${p.slice(0, 40)}` : `Managing laptop files (${op})`,
        };
      }
      if (toolName === 'control_laptop_apps') {
        const rawAction = String(args.action || 'app');
        if (rawAction === 'arrange_windows') {
          const layoutLabel = String(args.layout || 'grid');
          return {
            kind: 'laptop',
            label: `Tiling windows (${layoutLabel})`,
          };
        }
        const action = rawAction.replace(/_/g, ' ');
        const appName = String(args.appName || '').trim();
        return {
          kind: 'laptop',
          label: appName ? `${action}: ${appName.slice(0, 40)}` : `Laptop ${action}`,
        };
      }
      if (toolName === 'execute_terminal_command') {
        const cmd = String(args.command || '').trim();
        return {
          kind: 'laptop',
          label: cmd ? `Terminal: ${cmd.slice(0, 42)}` : 'Running terminal command',
        };
      }
      if (toolName === 'save_memory' || toolName === 'forget_memory') {
        return {
          kind: 'memory',
          label: toolName === 'save_memory' ? 'Encoding long-term memory' : 'Updating memory bank',
        };
      }
      if (toolName === 'save_voice_macro') {
        const name = String(args.name || '').trim();
        return {
          kind: 'memory',
          label: name ? `Saving macro: ${name.slice(0, 40)}` : 'Saving voice macro',
        };
      }
      if (toolName === 'manage_workspace') {
        const svc = String(args.service || 'workspace');
        const op = String(args.operation || 'action');
        return {
          kind: 'command',
          label: `Workspace (${svc}): ${op}`,
        };
      }
      if (toolName === 'manage_tasks_reminders') {
        const op = String(args.action || 'tasks');
        return {
          kind: 'command',
          label: `Tasks: ${op}`,
        };
      }
      if (toolName === 'search_knowledge_vault') {
        const q = String(args.query || '').trim();
        return {
          kind: 'memory',
          label: q ? `Vault search: ${q.slice(0, 38)}` : 'Searching Knowledge Vault',
        };
      }
      if (toolName === 'inspect_github_repo') {
        const repo = String(args.repo || '').trim();
        return {
          kind: 'automation',
          label: repo ? `GitHub: ${repo.slice(0, 40)}` : 'Inspecting GitHub repo',
        };
      }
      if (toolName === 'trigger_bridge_message' || toolName === 'manage_schedules') {
        return {
          kind: 'command',
          label: toolName === 'trigger_bridge_message' ? 'Sending bridge notification' : 'Updating automation schedule',
        };
      }
      const pluginMatch = pluginsRef.current.find((p) => p.toolName === toolName);
      if (pluginMatch) {
        return {
          kind: 'plugin',
          label: `Plugin: ${pluginMatch.name}`,
        };
      }
      return {
        kind: 'command',
        label: `Processing ${toolName.replace(/_/g, ' ')}`,
      };
    },
    []
  );

  const showTransientCaption = useCallback((speaker: string, text: string, holdMs = 6000) => {
    const clean = text.trim();
    if (!clean) return;
    setLiveCaption({ speaker, text: clean });
    if (captionTimerRef.current) window.clearTimeout(captionTimerRef.current);
    captionTimerRef.current = window.setTimeout(() => {
      setLiveCaption(null);
    }, holdMs);
  }, []);

  // Startup checks (Runtime shell + Shadow Laptop Agent health)
  useEffect(() => {
    void testConnection();
    void detectRuntimeEnvironment().then(setRuntimeInfo);
    void checkLaptopAgentHealth().then(setAgentHealth);
  }, []);

  // Poll audio amplitudes for 3D Arc Reactor reactivity
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      if (micAnalyserRef.current && isConnectedRef.current && !isMicMutedRef.current) {
        const buf = new Uint8Array(micAnalyserRef.current.frequencyBinCount);
        micAnalyserRef.current.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        inputLevelRef.current = sum / (buf.length * 255);
      } else {
        inputLevelRef.current = 0;
      }
      outputLevelRef.current = playerRef.current.getOutputLevel();
      const speakingNow = playerRef.current.isPlaying();
      setIsAssistantSpeaking((prev) => (prev !== speakingNow ? speakingNow : prev));
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Firebase Auth + Real-Time Firestore Listeners
  useEffect(() => {
    let unsubWorkflows: (() => void) | null = null;
    let unsubExecutions: (() => void) | null = null;
    let unsubQueue: (() => void) | null = null;
    let unsubResearch: (() => void) | null = null;
    let unsubMemories: (() => void) | null = null;
    let unsubPlugins: (() => void) | null = null;
    let unsubTasks: (() => void) | null = null;
    let unsubMeetings: (() => void) | null = null;
    let unsubVaultDocs: (() => void) | null = null;

    void getRedirectResult(auth)
      .then((res) => {
        if (res) {
          const cred = GoogleAuthProvider.credentialFromResult(res);
          if (cred?.accessToken) {
            setWorkspaceAccessToken(cred.accessToken);
          }
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : '';
        if (msg) {
          setAuthError(msg);
          reportExceptionError('Authentication', err, msg);
        }
      });

    const unsubAuth = onAuthStateChanged(auth, async (nextUser) => {
      if (unsubWorkflows) unsubWorkflows();
      if (unsubExecutions) unsubExecutions();
      if (unsubQueue) unsubQueue();
      if (unsubResearch) unsubResearch();
      if (unsubMemories) unsubMemories();
      if (unsubPlugins) unsubPlugins();
      if (unsubTasks) unsubTasks();
      if (unsubMeetings) unsubMeetings();
      if (unsubVaultDocs) unsubVaultDocs();
      unsubWorkflows = null;
      unsubExecutions = null;
      unsubQueue = null;
      unsubResearch = null;
      unsubMemories = null;
      unsubPlugins = null;
      unsubTasks = null;
      unsubMeetings = null;
      unsubVaultDocs = null;

      setUser(nextUser);
      setAuthReady(true);

      if (nextUser) {
        if (desktopAuthPollRef.current) {
          window.clearInterval(desktopAuthPollRef.current);
          desktopAuthPollRef.current = null;
        }
        setAuthError(null);
        try {
          const profile = await ensureUserProfile(nextUser);
          if (profile.voiceName) setVoiceName(profile.voiceName);
          if (profile.wakeMode) setWakeMode(profile.wakeMode);

          const localCfg = loadLocalSetupConfig();
          const remoteConfigured = Boolean(profile.setupCompleted);
          let resolvedConfig: SetupConfig;
          if (remoteConfigured) {
            resolvedConfig = {
              assistantName: (profile.assistantName || 'Shadow').slice(0, 60),
              userPreferredName: (profile.userPreferredName || '').slice(0, 80),
              setupCompleted: true,
              faceAuthEnabled: Boolean(profile.faceAuthEnabled),
              clapWakeEnabled:
                profile.clapWakeEnabled !== undefined
                  ? Boolean(profile.clapWakeEnabled)
                  : localCfg.clapWakeEnabled,
              permissions: sanitizePermissions(profile.permissions),
            };
            saveLocalSetupConfig(resolvedConfig);
          } else if (localCfg.setupCompleted) {
            resolvedConfig = localCfg;
            await saveSetupConfigToFirestore(nextUser.uid, localCfg);
          } else {
            resolvedConfig = {
              assistantName: (profile.assistantName || localCfg.assistantName || 'Shadow').slice(0, 60),
              userPreferredName: (
                profile.userPreferredName ||
                localCfg.userPreferredName ||
                profile.displayName?.split(' ')[0] ||
                ''
              ).slice(0, 80),
              setupCompleted: false,
              faceAuthEnabled: Boolean(profile.faceAuthEnabled),
              clapWakeEnabled:
                profile.clapWakeEnabled !== undefined
                  ? Boolean(profile.clapWakeEnabled)
                  : localCfg.clapWakeEnabled,
              permissions: sanitizePermissions(profile.permissions || localCfg.permissions),
            };
          }
          setSetupConfig(resolvedConfig);
          setSetupOpen(!resolvedConfig.setupCompleted);

          const remoteFace = await getFaceAuthProfile(nextUser.uid).catch(() => null);
          const localFace = loadLocalFaceAuth();
          const resolvedFace = remoteFace || localFace;
          if (!remoteFace && localFace) {
            void saveFaceAuthProfile(nextUser.uid, {
              descriptor: localFace.descriptor,
              sampleCount: localFace.sampleCount,
              threshold: localFace.threshold,
              passcodeHash: localFace.passcodeHash,
            }).catch(() => null);
          } else if (remoteFace) {
            saveLocalFaceAuth(remoteFace);
          }
          setFaceAuthProfile(resolvedFace);
          if (
            resolvedConfig.setupCompleted &&
            resolvedConfig.faceAuthEnabled &&
            resolvedFace &&
            !sessionUnlockedOnceRef.current
          ) {
            setIsFaceUnlocked(false);
          }

          unsubWorkflows = subscribeWorkflows(nextUser.uid, setWorkflows);
          unsubExecutions = subscribeExecutions(nextUser.uid, setExecutions);
          unsubQueue = subscribeMediaQueue(nextUser.uid, (items) => {
            setFirestoreQueue(items);
            if (!currentTrack && items.length > 0) {
              const playing = items.find((i) => i.status === 'playing') || items[0];
              if (playing) setCurrentTrack(playing);
            }
          });
          unsubResearch = subscribeResearchReports(nextUser.uid, (reports) => {
            setFirestoreResearch(reports);
            setCurrentResearch((prev) => prev || reports[0] || null);
          });
          unsubMemories = subscribeMemories(nextUser.uid, setFirestoreMemories);
          unsubPlugins = subscribePlugins(nextUser.uid, setFirestorePlugins);
          unsubTasks = subscribeTasks(nextUser.uid, setFirestoreTasks);
          unsubMeetings = subscribeMeetings(nextUser.uid, setFirestoreMeetings);
          unsubVaultDocs = subscribeVaultDocs(nextUser.uid, setFirestoreVaultDocs);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to load profile';
          setAuthError(msg);
          reportExceptionError('User Profile', err, msg);
        }
      } else {
        setWorkflows([]);
        setExecutions([]);
        setFirestoreQueue([]);
        setFirestoreResearch([]);
        setFirestoreMemories([]);
        setFirestorePlugins([]);
        setFirestoreTasks([]);
        setFirestoreMeetings([]);
        setFirestoreVaultDocs([]);
        clearWorkspaceAccessToken();
      }
    });

    return () => {
      unsubAuth();
      if (unsubWorkflows) unsubWorkflows();
      if (unsubExecutions) unsubExecutions();
      if (unsubQueue) unsubQueue();
      if (unsubResearch) unsubResearch();
      if (unsubMemories) unsubMemories();
      if (unsubPlugins) unsubPlugins();
      if (unsubTasks) unsubTasks();
      if (unsubMeetings) unsubMeetings();
      if (unsubVaultDocs) unsubVaultDocs();
    };
  }, []);

  // Permission check + Memory CRUD helpers
  const isToolPermitted = useCallback(
    (toolName: string): boolean => {
      const p = setupConfig.permissions;
      if (toolName === 'manage_laptop_files') return p.files;
      if (toolName === 'control_laptop_apps') return p.apps;
      if (toolName === 'execute_terminal_command') return p.terminal;
      if (
        toolName === 'execute_browser_automation' ||
        toolName === 'inspect_web_page' ||
        toolName === 'run_autonomous_web_agent'
      ) {
        return p.browser;
      }
      if (toolName === 'research_topic') return p.research;
      if (toolName === 'play_youtube_media' || toolName === 'control_youtube_player') {
        return p.youtube;
      }
      if (toolName === 'save_memory' || toolName === 'forget_memory') return p.memory;
      return true;
    },
    [setupConfig.permissions]
  );

  const authorizeLaptopAction = useCallback(
    async (toolName: string, args: Record<string, unknown>): Promise<boolean> => {
      const category: 'files' | 'apps' | 'terminal' =
        toolName === 'manage_laptop_files'
          ? 'files'
          : toolName === 'control_laptop_apps'
            ? 'apps'
            : 'terminal';
      const categoryGranted = isToolPermitted(toolName);
      if (
        categoryGranted &&
        (!confirmLaptopActionsRef.current || sessionAllowedCategoriesRef.current.has(category))
      ) {
        return true;
      }

      const op = String(args.operation || args.action || '').toLowerCase();
      const isHighRisk =
        category === 'terminal' ||
        (category === 'files' && ['write', 'append', 'move', 'delete'].includes(op)) ||
        (category === 'apps' && ['quit_app', 'automate_app'].includes(op));

      const title =
        category === 'files'
          ? `File Operation: ${String(args.operation || 'access')}`
          : category === 'apps'
            ? `Desktop App Action: ${String(args.action || 'control')}`
            : Boolean(args.background)
              ? 'Background Terminal Process'
              : 'Terminal Shell Command';

      const summary =
        category === 'files'
          ? String(args.path || 'Local file path')
          : category === 'apps'
            ? String(args.appName || args.instruction || 'Desktop workspace')
            : String(args.cwd ? `Working directory: ${String(args.cwd)}` : 'Default user directory');

      const detailText =
        category === 'terminal'
          ? String(args.command || '')
          : JSON.stringify(args, null, 2);

      // Serialize prompts cleanly so back-to-back tool requests never collide
      const decisionPromise = permissionQueueRef.current.then(
        () =>
          new Promise<'deny' | 'once' | 'always'>((resolveQueue) => {
            permissionResolverRef.current = (decision) => {
              permissionResolverRef.current = null;
              setPendingPermissionReq(null);
              resolveQueue(decision);
            };
            setPendingPermissionReq({
              id: `perm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              toolName,
              category,
              title,
              summary,
              detailText,
              isHighRisk,
              wasCategoryBlocked: !categoryGranted,
            });
          })
      );
      permissionQueueRef.current = decisionPromise.then(
        () => undefined,
        () => undefined
      );
      const resultDecision = await decisionPromise;

      if (resultDecision === 'always') {
        sessionAllowedCategoriesRef.current.add(category);
        setSetupConfig((prev) => {
          const nextConfig: SetupConfig = {
            ...prev,
            permissions: {
              ...prev.permissions,
              [category]: true,
            },
          };
          saveLocalSetupConfig(nextConfig);
          if (user) {
            void saveSetupConfigToFirestore(user.uid, nextConfig).catch(() => null);
          }
          return nextConfig;
        });
        return true;
      }

      return resultDecision === 'once';
    },
    [isToolPermitted, user]
  );

  const handleAddMemoryRecord = useCallback(
    async (input: {
      category: MemoryCategory;
      content: string;
      importance?: MemoryImportance;
      source?: 'voice' | 'manual' | 'setup';
    }) => {
      const clean = input.content.trim().slice(0, 600);
      if (!clean) return;
      if (user) {
        await createMemory(user.uid, {
          category: input.category,
          content: clean,
          importance: input.importance || 'normal',
          source: input.source || 'manual',
        });
      } else {
        const record = createLocalMemoryRecord(input);
        setLocalMemories((prev) => {
          const next = [record, ...prev].slice(0, 200);
          saveLocalMemories(next);
          return next;
        });
      }
    },
    [user]
  );

  const handleToggleMemoryImportance = useCallback(
    async (mem: AssistantMemory) => {
      const nextImportance: MemoryImportance = mem.importance === 'high' ? 'normal' : 'high';
      if (user) {
        await updateMemory(mem.id, { importance: nextImportance });
      } else {
        setLocalMemories((prev) => {
          const next = prev.map((m) =>
            m.id === mem.id ? { ...m, importance: nextImportance } : m
          );
          saveLocalMemories(next);
          return next;
        });
      }
    },
    [user]
  );

  const handleDeleteMemoryRecord = useCallback(
    async (id: string) => {
      if (user) {
        await deleteMemory(id);
      } else {
        setLocalMemories((prev) => {
          const next = prev.filter((m) => m.id !== id);
          saveLocalMemories(next);
          return next;
        });
      }
    },
    [user]
  );

  const handleInstallPlugin = useCallback(
    async (draft: Partial<ShadowPlugin> & { name: string; description: string }) => {
      if (user) {
        await installPluginInFirestore(user.uid, draft);
      } else {
        const record = createLocalPluginRecord(draft);
        setLocalPlugins((prev) => {
          const next = [record, ...prev.filter((p) => p.toolName !== record.toolName)].slice(0, 40);
          saveLocalPlugins(next);
          return next;
        });
      }
    },
    [user]
  );

  const handleUpdatePlugin = useCallback(
    async (plugin: ShadowPlugin, updates: Partial<ShadowPlugin>) => {
      if (user) {
        await updatePluginInFirestore(plugin, updates);
      } else {
        const clean = sanitizePluginDraft({
          ...plugin,
          ...updates,
          slug: plugin.slug,
          toolName: plugin.toolName,
          kind: plugin.kind,
        });
        setLocalPlugins((prev) => {
          const next = prev.map((p) =>
            p.id === plugin.id
              ? { ...p, ...clean, updatedAt: new Date().toISOString() }
              : p
          );
          saveLocalPlugins(next);
          return next;
        });
      }
    },
    [user]
  );

  const handleDeletePlugin = useCallback(
    async (pluginId: string) => {
      if (user) {
        await deletePluginInFirestore(pluginId);
      } else {
        setLocalPlugins((prev) => {
          const next = prev.filter((p) => p.id !== pluginId);
          saveLocalPlugins(next);
          return next;
        });
      }
    },
    [user]
  );

  const recordPluginExecution = useCallback(
    async (
      plugin: ShadowPlugin | undefined,
      toolName: string,
      ok: boolean,
      summary: string,
      opts?: { latencyMs?: number; statusCode?: number; targetUrl?: string; transcript?: string }
    ) => {
      setPluginLogs((prev) => [
        {
          id: `plog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          pluginName: plugin?.name || toolName,
          toolName,
          ok,
          summary,
          latencyMs: opts?.latencyMs,
          statusCode: opts?.statusCode,
          timestamp: Date.now(),
        },
        ...prev.slice(0, 29),
      ]);

      if (plugin) {
        if (user) {
          void incrementPluginRunCount(plugin.id, plugin.runCount).catch(() => null);
        } else {
          setLocalPlugins((prev) => {
            const next = prev.map((p) =>
              p.id === plugin.id ? { ...p, runCount: p.runCount + 1 } : p
            );
            saveLocalPlugins(next);
            return next;
          });
        }
      }

      if (user) {
        try {
          const exId = await createExecutionLog(user.uid, {
            transcript: opts?.transcript || `Plugin: ${plugin?.name || toolName}`,
            intent: 'plugin_run',
            targetUrl: opts?.targetUrl || plugin?.endpointUrl || '',
            stepsCount: 1,
            summary: summary.slice(0, 900),
            runtime: runtimeInfo.runtime,
          });
          await finalizeExecutionLog(exId, {
            status: ok ? 'completed' : 'failed',
            stepsCount: 1,
            summary: summary.slice(0, 900),
            targetUrl: opts?.targetUrl || plugin?.endpointUrl || '',
          });
        } catch {
          // ignore logging failure
        }
      }
    },
    [user, runtimeInfo.runtime]
  );

  const handleConnectWorkspace = useCallback(async () => {
    setAuthError(null);
    const token = await connectWorkspaceScopesPopup();
    if (token) {
      showTransientCaption(assistantNameRef.current, 'Google Workspace connected.', 3500);
    }
  }, [showTransientCaption]);

  const handleCreateTask = useCallback(
    async (input: { title: string; priority?: TaskPriority; dueAt?: string; notes?: string }) => {
      const cleanTitle = input.title.trim().slice(0, 200);
      if (!cleanTitle) return;
      if (user) {
        await createTaskInFirestore(user.uid, input);
      } else {
        const record: ShadowTask = {
          id: `tsk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title: cleanTitle,
          status: 'pending',
          priority: input.priority || 'medium',
          dueAt: String(input.dueAt || '').trim(),
          notes: String(input.notes || '').trim(),
          reminded: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setLocalTasks((prev) => {
          const next = [record, ...prev].slice(0, 120);
          saveLocalTasks(next);
          return next;
        });
      }
    },
    [user]
  );

  const handleToggleTask = useCallback(
    async (task: ShadowTask) => {
      const nextStatus: ShadowTask['status'] = task.status === 'done' ? 'pending' : 'done';
      if (user) {
        await updateTaskInFirestore(task.id, { status: nextStatus });
      } else {
        setLocalTasks((prev) => {
          const next = prev.map((t) =>
            t.id === task.id ? { ...t, status: nextStatus, updatedAt: new Date().toISOString() } : t
          );
          saveLocalTasks(next);
          return next;
        });
      }
    },
    [user]
  );

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      if (user) {
        await deleteTaskInFirestore(taskId);
      } else {
        setLocalTasks((prev) => {
          const next = prev.filter((t) => t.id !== taskId);
          saveLocalTasks(next);
          return next;
        });
      }
    },
    [user]
  );

  const handleSaveMeeting = useCallback(
    async (note: Omit<MeetingNote, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>) => {
      if (user) {
        await saveMeetingInFirestore(user.uid, note);
      } else {
        const record: MeetingNote = {
          ...note,
          id: `mtg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setLocalMeetings((prev) => {
          const next = [record, ...prev].slice(0, 40);
          saveLocalMeetings(next);
          return next;
        });
      }
      showTransientCaption(assistantNameRef.current, `Saved meeting: ${note.title}`, 3500);
    },
    [user, showTransientCaption]
  );

  const handleDeleteMeeting = useCallback(
    async (meetingId: string) => {
      if (user) {
        await deleteMeetingInFirestore(meetingId);
      } else {
        setLocalMeetings((prev) => {
          const next = prev.filter((m) => m.id !== meetingId);
          saveLocalMeetings(next);
          return next;
        });
      }
    },
    [user]
  );

  const handleSaveVaultDocMeta = useCallback(
    async (meta: Omit<VaultDocumentMeta, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>) => {
      if (user) {
        await saveVaultDocMetaInFirestore(user.uid, meta);
      } else {
        const record: VaultDocumentMeta = {
          ...meta,
          id: meta.vaultId || `vlt-${Date.now()}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setLocalVaultDocs((prev) => {
          const next = [record, ...prev.filter((d) => d.vaultId !== record.vaultId)].slice(0, 100);
          saveLocalVaultMeta(next);
          return next;
        });
      }
    },
    [user]
  );

  const handleDeleteVaultDocMeta = useCallback(
    async (vaultId: string) => {
      if (user) {
        const match = firestoreVaultDocs.find((d) => d.vaultId === vaultId || d.id === vaultId);
        if (match) await deleteVaultDocMetaInFirestore(match.id);
      } else {
        setLocalVaultDocs((prev) => {
          const next = prev.filter((d) => d.vaultId !== vaultId && d.id !== vaultId);
          saveLocalVaultMeta(next);
          return next;
        });
      }
    },
    [user, firestoreVaultDocs]
  );

  const handleIngestToVault = useCallback(
    async (input: {
      title: string;
      contentText: string;
      sourceType: VaultDocumentMeta['sourceType'];
    }) => {
      const res = await fetch(`${getApiOrigin()}/api/vault/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...aiRequestHeaders(aiSettingsRef.current) },
        body: JSON.stringify({
          ownerKey: user?.uid || 'local',
          title: input.title,
          sourceType: input.sourceType,
          contentText: input.contentText,
        }),
      });
      const data = await parseJsonSafely<{
        ok?: boolean;
        doc?: {
          id: string;
          title: string;
          sourceType: VaultDocumentMeta['sourceType'];
          summary: string;
          chunkCount: number;
          embedded: boolean;
        };
        error?: string;
      }>(res);
      if (!res.ok || !data?.doc) {
        throw new Error(data?.error || 'Failed to index document into Knowledge Vault');
      }
      await handleSaveVaultDocMeta({
        vaultId: data.doc.id,
        title: data.doc.title,
        sourceType: data.doc.sourceType,
        summary: data.doc.summary,
        chunkCount: data.doc.chunkCount,
        embedded: data.doc.embedded,
      });
      showTransientCaption(
        assistantNameRef.current,
        `Indexed "${data.doc.title}" into Knowledge Vault.`,
        4000
      );
    },
    [user, handleSaveVaultDocMeta, showTransientCaption]
  );

  // Poll pending task due dates every 20s and fire notifications + speech reminders
  useEffect(() => {
    const checkDueTasks = () => {
      const now = Date.now();
      const dueList = tasksRef.current.filter((t) => {
        if (t.status !== 'pending' || t.reminded || !t.dueAt) return false;
        const ts = Date.parse(t.dueAt);
        return !Number.isNaN(ts) && ts <= now;
      });
      if (dueList.length === 0) return;

      for (const task of dueList) {
        if (user) {
          void updateTaskInFirestore(task.id, { reminded: true }).catch(() => null);
        } else {
          setLocalTasks((prev) => {
            const next = prev.map((item) =>
              item.id === task.id ? { ...item, reminded: true } : item
            );
            saveLocalTasks(next);
            return next;
          });
        }
        const msg = `Reminder: ${task.title}`;
        showTransientCaption(assistantNameRef.current, msg, 7500);
        void handleSpeakTextRef.current(msg);
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            new Notification(`${assistantNameRef.current} · Task Due`, { body: task.title });
          } catch {
            // ignore notification blocks
          }
        }
      }
    };

    checkDueTasks();
    const timer = window.setInterval(checkDueTasks, 20_000);
    return () => window.clearInterval(timer);
  }, [user, showTransientCaption]);

  const buildSessionContextPayload = useCallback(() => {
    const sortedMemories = [...memories]
      .sort((a, b) => {
        const score = (imp: MemoryImportance) => (imp === 'high' ? 2 : imp === 'normal' ? 1 : 0);
        return score(b.importance) - score(a.importance);
      })
      .slice(0, 40)
      .map((m) => ({
        category: m.category,
        content: m.content,
        importance: m.importance,
      }));
    const activePlugins = plugins
      .filter((p) => p.enabled)
      .slice(0, 30)
      .map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        description: p.description,
        category: p.category,
        kind: p.kind,
        toolName: p.toolName,
        enabled: p.enabled,
        version: p.version,
        author: p.author,
        parameters: p.parameters,
        endpointUrl: p.endpointUrl,
        httpMethod: p.httpMethod,
        headers: p.headers,
        bodyTemplate: p.bodyTemplate,
        commandTemplate: p.commandTemplate,
      }));
    const pendingTasks = tasks.filter((t) => t.status === 'pending');
    const tasksSummary =
      pendingTasks.length > 0
        ? pendingTasks
            .slice(0, 6)
            .map((t) => `${t.title}${t.dueAt ? ` (due ${t.dueAt})` : ''}`)
            .join('; ')
        : undefined;
    const workspace: ActiveWorkspaceContext = {
      currentDateTime: new Date().toLocaleString([], {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      activeDrawer,
      activeAutomationUrl: automationRun?.inspection?.finalUrl || automationRun?.targetUrl,
      activeAutomationTitle: automationRun?.inspection?.title,
      activeAutomationFields: automationRun?.inspection?.fields
        .map((f) => f.selector || f.label || f.name)
        .filter(Boolean)
        .slice(0, 12),
      activeResearchQuery: currentResearch?.query,
      activeTrackTitle: currentTrack?.title,
      visionMode: vision.visionMode,
      shelfItems: shelfWorkspaceItems.slice(0, 6),
      tasksSummary,
      vaultDocsCount: vaultDocs.length,
      workspaceConnected,
    };
    return {
      assistantName,
      userPreferredName: setupConfig.userPreferredName,
      permissions: setupConfig.permissions,
      memories: sortedMemories,
      plugins: activePlugins,
      workspace,
    };
  }, [
    memories,
    plugins,
    tasks,
    vaultDocs.length,
    workspaceConnected,
    assistantName,
    setupConfig,
    activeDrawer,
    automationRun,
    currentResearch,
    currentTrack,
    vision.visionMode,
    shelfWorkspaceItems,
  ]);

  // Keyboard shortcut: 'H' toggles Cinema / Zen HUD collapse
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (['input', 'textarea', 'select'].includes(target.tagName.toLowerCase()) ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        setHudCollapsed((prev) => !prev);
      } else if (e.key === 'Escape' && activeDrawer) {
        setActiveDrawer(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeDrawer]);

  const runAutomationSequence = useCallback(
    async (
      goal: string,
      targetUrl: string,
      rawSteps: AutomationStep[],
      inspection: PageInspectionResult | null,
      transcript: string,
      options?: {
        skipClientInvocation?: boolean;
        gap?: number;
        preExecuted?: {
          steps?: StepExecutionState[];
          extractedItems?: AutomationExtractedItem[];
          submissionResult?: AutomationSubmissionResult | null;
          totalDurationMs?: number;
          ok?: boolean;
          engine?: 'playwright' | 'http-dom';
          playwrightAvailable?: boolean;
          screenshotBase64?: string | null;
        };
      }
    ) => {
      setIsAutomating(true);
      setActiveDrawer('automation');

      const baseSteps: AutomationStep[] =
        rawSteps.length > 0
          ? rawSteps
          : [
              {
                action: 'navigate',
                selector: 'document',
                value: targetUrl,
                description: `Open ${targetUrl}`,
              },
            ];
      const initialSteps: StepExecutionState[] = baseSteps.map((s) => ({
        ...s,
        status: 'pending',
      }));

      const runId = `run-${Date.now()}`;
      setAutomationRun({
        id: runId,
        goal,
        targetUrl,
        engine: options?.preExecuted?.engine,
        playwrightAvailable: options?.preExecuted?.playwrightAvailable,
        screenshotBase64: options?.preExecuted?.screenshotBase64 ?? null,
        status: 'running',
        steps: initialSteps,
        inspection,
        extractedItems: [],
        submissionResult: null,
        startedAt: Date.now(),
      });

      let execId: string | null = null;
      if (user) {
        try {
          execId = await createExecutionLog(user.uid, {
            transcript: transcript || goal,
            intent: 'browser_automation',
            targetUrl,
            stepsCount: initialSteps.length,
            summary: goal,
            runtime: runtimeInfo.runtime,
          });
        } catch {
          // continue cleanly
        }
      }

      const isDesktopLayout =
        targetUrl.toLowerCase().startsWith('desktop://') ||
        baseSteps.some((s) => s.action === 'arrange_windows');
      const canReachLaptop =
        runtimeInfo.isTauri || (agentHealth.reachable && agentHealth.authenticated);

      let execOk = true;
      let resolvedSteps: StepExecutionState[] = initialSteps.map((s) => ({
        ...s,
        status: 'completed',
      }));
      let resolvedInspection: PageInspectionResult | null = inspection;
      let resolvedExtracted: AutomationExtractedItem[] = options?.preExecuted?.extractedItems || [];
      let resolvedSubmission: AutomationSubmissionResult | null =
        options?.preExecuted?.submissionResult ?? null;
      let resolvedDuration: number | undefined = options?.preExecuted?.totalDurationMs;
      let resolvedEngine: 'playwright' | 'http-dom' | undefined = options?.preExecuted?.engine;
      let resolvedPlaywrightAvailable: boolean | undefined =
        options?.preExecuted?.playwrightAvailable;
      let resolvedScreenshotBase64: string | null | undefined =
        options?.preExecuted?.screenshotBase64;

      if (!options?.skipClientInvocation && canReachLaptop && (runtimeInfo.isTauri || isDesktopLayout)) {
        try {
          const tauriRes = await invokeDesktopBrowserAutomation({
            goal,
            targetUrl,
            steps: baseSteps,
            gap: options?.gap,
          });
          execOk = tauriRes.executedInDesktop;
        } catch {
          execOk = false;
        }
      } else if (options?.preExecuted?.steps && options.preExecuted.steps.length > 0) {
        resolvedSteps = options.preExecuted.steps;
        execOk = options.preExecuted.ok !== false;
      } else if (!isDesktopLayout) {
        // Mark first step as actively running while server engine executes real HTTP/DOM steps
        setAutomationRun((prev) => {
          if (!prev || prev.id !== runId) return prev;
          return {
            ...prev,
            steps: prev.steps.map((st, idx) =>
              idx === 0 ? { ...st, status: 'running' as const } : st
            ),
          };
        });

        try {
          const execRes = await fetch(`${getApiOrigin()}/api/automation/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ goal, targetUrl, steps: baseSteps }),
          });
          const data = await parseJsonSafely<{
            ok?: boolean;
            targetUrl?: string;
            engine?: 'playwright' | 'http-dom';
            playwrightAvailable?: boolean;
            screenshotBase64?: string | null;
            steps?: StepExecutionState[];
            inspection?: PageInspectionResult | null;
            extractedItems?: AutomationExtractedItem[];
            submissionResult?: AutomationSubmissionResult | null;
            totalDurationMs?: number;
            error?: string;
          }>(execRes);
          if (!execRes.ok || !data) {
            throw new Error(
              data?.error ||
                'Shadow backend is unreachable at this URL. Start your local server or set a Server URL in AI Keys.'
            );
          }
          execOk = data.ok !== false;
          resolvedEngine = data.engine;
          resolvedPlaywrightAvailable = data.playwrightAvailable;
          resolvedScreenshotBase64 = data.screenshotBase64 ?? null;
          if (Array.isArray(data.steps) && data.steps.length > 0) {
            resolvedSteps = data.steps;
          }
          if (data.inspection !== undefined) {
            resolvedInspection = data.inspection;
          }
          resolvedExtracted = Array.isArray(data.extractedItems) ? data.extractedItems : [];
          resolvedSubmission = data.submissionResult ?? null;
          resolvedDuration = data.totalDurationMs;
          if (data.error && !execOk) {
            setVoiceError(data.error);
            reportShadowError({
              source: 'Browser Automation',
              title: `Automation failed (${targetUrl})`,
              message: data.error,
              endpoint: '/api/automation/execute',
            });
          }
        } catch (err) {
          execOk = false;
          const msg = err instanceof Error ? err.message : 'Browser automation failed';
          setVoiceError(msg);
          reportExceptionError('Browser Automation', err, msg, { endpoint: '/api/automation/execute' });
          resolvedSteps = initialSteps.map((st, idx) =>
            idx === 0 ? { ...st, status: 'failed', detail: msg } : { ...st, status: 'failed' }
          );
        }
      }

      // Smoothly reveal real step results in the timeline
      for (let i = 0; i < resolvedSteps.length; i++) {
        setAutomationRun((prev) => {
          if (!prev || prev.id !== runId) return prev;
          return {
            ...prev,
            steps: prev.steps.map((st, idx) =>
              idx === i ? { ...resolvedSteps[i], status: 'running' as const } : st
            ),
          };
        });

        await new Promise((r) => setTimeout(r, 140));

        setAutomationRun((prev) => {
          if (!prev || prev.id !== runId) return prev;
          const updatedSteps = prev.steps.map((st, idx) =>
            idx === i ? resolvedSteps[i] : st
          );
          return {
            ...prev,
            steps: updatedSteps,
          };
        });
      }

      const finalStatus = execOk ? 'completed' : 'failed';
      setAutomationRun((prev) =>
        prev && prev.id === runId
          ? {
              ...prev,
              status: finalStatus,
              targetUrl: resolvedInspection?.finalUrl || targetUrl,
              engine: resolvedEngine ?? prev.engine,
              playwrightAvailable: resolvedPlaywrightAvailable ?? prev.playwrightAvailable,
              screenshotBase64: resolvedScreenshotBase64 ?? prev.screenshotBase64 ?? null,
              steps: resolvedSteps,
              inspection: resolvedInspection,
              extractedItems: resolvedExtracted,
              submissionResult: resolvedSubmission,
              totalDurationMs: resolvedDuration,
            }
          : prev
      );
      setIsAutomating(false);

      if (execId && user) {
        try {
          await finalizeExecutionLog(execId, {
            status: finalStatus,
            stepsCount: resolvedSteps.length,
            summary: `${goal} (${resolvedSteps.length} steps)`,
            targetUrl: resolvedInspection?.finalUrl || targetUrl,
          });
        } catch {
          // ignore
        }
      }
    },
    [user, runtimeInfo, agentHealth.reachable, agentHealth.authenticated]
  );

  const handleExecuteAutomationPlan = useCallback(
    async (plan: { goal: string; targetUrl: string; steps: AutomationStep[] }) => {
      if (!isToolPermitted('execute_browser_automation')) {
        setVoiceError('Browser Automation permission is disabled in Setup.');
        return;
      }
      beginCommandCue('automation', `Automating: ${plan.goal.slice(0, 44)}`);
      try {
        await runAutomationSequence(plan.goal, plan.targetUrl, plan.steps, null, plan.goal);
        finishCommandCue('automation', plan.goal.slice(0, 48), true);
      } catch (err) {
        finishCommandCue('automation', 'Automation failed', false);
        setVoiceError(err instanceof Error ? err.message : 'Browser automation failed');
      }
    },
    [isToolPermitted, beginCommandCue, finishCommandCue, runAutomationSequence]
  );

  const handleToolAction = useCallback(
    async (
      name: string,
      args: Record<string, unknown>,
      result: Record<string, unknown>,
      transcript = ''
    ) => {
      if (name === 'inspect_web_page') {
        const insp = result.inspection as PageInspectionResult | undefined;
        if (insp?.finalUrl || insp?.url) {
          const inspectedUrl = insp.finalUrl || insp.url;
          setAutomationRun({
            id: `inspect-${Date.now()}`,
            goal: `Inspect ${insp.title || inspectedUrl}`,
            targetUrl: inspectedUrl,
            status: result.ok !== false ? 'completed' : 'failed',
            steps: [
              {
                action: 'navigate',
                selector: 'document',
                value: inspectedUrl,
                description: `Inspected ${insp.title || inspectedUrl}`,
                status: result.ok !== false ? 'completed' : 'failed',
                detail: `HTTP ${insp.statusCode} · ${insp.fields.length} field(s), ${insp.links.length} link(s)`,
              },
            ],
            inspection: insp,
            extractedItems: [],
            submissionResult: null,
            startedAt: Date.now(),
          });
          setActiveDrawer('automation');
        }
      } else if (name === 'run_autonomous_web_agent') {
        const agentRes = result as unknown as AutonomousWebAgentResult & {
          engine?: 'playwright' | 'http-dom';
          playwrightAvailable?: boolean;
          screenshotBase64?: string | null;
        };
        setIsAutomating(false);
        setAutomationRun({
          id: `agent-${Date.now()}`,
          goal: agentRes.goal || String(args.goal || 'Autonomous Web Task'),
          targetUrl: agentRes.finalUrl || agentRes.startUrl || String(args.startUrl || ''),
          engine: agentRes.engine,
          playwrightAvailable: agentRes.playwrightAvailable,
          screenshotBase64: agentRes.screenshotBase64 ?? null,
          status: agentRes.ok ? 'completed' : 'failed',
          steps: Array.isArray(agentRes.steps) ? agentRes.steps : [],
          inspection: agentRes.inspection ?? null,
          extractedItems: Array.isArray(agentRes.extractedItems) ? agentRes.extractedItems : [],
          submissionResult: agentRes.submissionResult ?? null,
          agentIterations: Array.isArray(agentRes.iterations) ? agentRes.iterations : [],
          agentAnswer: agentRes.answer,
          totalDurationMs: agentRes.totalDurationMs,
          startedAt: Date.now(),
        });
        setActiveDrawer('automation');
      } else if (name === 'set_focus_timer') {
        const rawAct = String(result.action || args.action || 'start');
        const action: 'start' | 'pause' | 'reset' =
          rawAct === 'pause' ? 'pause' : rawAct === 'reset' ? 'reset' : 'start';
        const minutes = Number(result.minutes || args.minutes || 25);
        const label = String(result.label || args.label || 'Focus Timer');
        setTimerControlEvent({ action, minutes, label, nonce: Date.now() });
      } else if (name === 'execute_browser_automation') {
        const goal = String(result.goal || args.goal || 'Browser Automation');
        const targetUrl = String(result.targetUrl || args.targetUrl || 'https://news.ycombinator.com');
        const steps = (Array.isArray(result.steps) ? result.steps : args.steps || []) as StepExecutionState[];
        const inspection = (result.inspection as PageInspectionResult | null) ?? null;
        const extractedItems = Array.isArray(result.extractedItems)
          ? (result.extractedItems as AutomationExtractedItem[])
          : [];
        const submissionResult =
          (result.submissionResult as AutomationSubmissionResult | null | undefined) ?? null;
        const totalDurationMs =
          typeof result.totalDurationMs === 'number' ? result.totalDurationMs : undefined;
        const engine =
          result.engine === 'playwright' || result.engine === 'http-dom'
            ? result.engine
            : undefined;
        const playwrightAvailable =
          typeof result.playwrightAvailable === 'boolean' ? result.playwrightAvailable : undefined;
        const screenshotBase64 =
          typeof result.screenshotBase64 === 'string' ? result.screenshotBase64 : undefined;
        await runAutomationSequence(goal, targetUrl, steps, inspection, transcript || goal, {
          skipClientInvocation: Boolean(result.clientExecuted),
          preExecuted: steps.some((s) => s.status && s.status !== 'pending')
            ? {
                steps,
                extractedItems,
                submissionResult,
                totalDurationMs,
                ok: result.ok !== false,
                engine,
                playwrightAvailable,
                screenshotBase64,
              }
            : undefined,
        });
      } else if (name === 'play_youtube_media') {
        const selected = result.selected as YouTubeTrack | undefined;
        if (selected?.videoId) {
          const track: YouTubeTrack = {
            videoId: selected.videoId,
            title: selected.title,
            channel: selected.channel,
            duration: selected.duration,
            thumbnailUrl: selected.thumbnailUrl,
            mediaType: args.mediaType === 'song' ? 'song' : 'video',
            status: 'playing',
            url: selected.url,
          };
          setCurrentTrack(track);
          setActiveDrawer('youtube');

          if (user) {
            try {
              await addMediaQueueItem(user.uid, track);
              const exId = await createExecutionLog(user.uid, {
                transcript: transcript || `Play ${selected.title} on YouTube`,
                intent: 'youtube_play',
                targetUrl: `https://www.youtube.com/watch?v=${selected.videoId}`,
                stepsCount: 1,
                summary: `Playing "${selected.title}" by ${selected.channel}`,
                runtime: runtimeInfo.runtime,
              });
              await finalizeExecutionLog(exId, {
                status: 'completed',
                stepsCount: 1,
                summary: `Playing "${selected.title}"`,
                targetUrl: `https://www.youtube.com/watch?v=${selected.videoId}`,
              });
            } catch {
              // continue smoothly
            }
          } else {
            setLocalQueue((prev) => [track, ...prev.filter((p) => p.videoId !== track.videoId)]);
          }
        }
      } else if (name === 'control_youtube_player') {
        const action = String(args.action || 'play');
        const seconds = typeof args.seconds === 'number' ? args.seconds : undefined;
        setPendingPlayerAction({ action, seconds, nonce: Date.now() });
      } else if (name === 'save_voice_macro' && user) {
        const steps = (Array.isArray(args.steps) ? args.steps : []) as AutomationStep[];
        await createWorkflow(user.uid, {
          name: String(args.name || 'Saved Macro'),
          voiceTrigger: String(args.voiceTrigger || args.name || 'Run macro'),
          targetUrl: String(args.targetUrl || 'https://news.ycombinator.com'),
          category: (['navigation', 'form-fill', 'media', 'research'].includes(String(args.category))
            ? args.category
            : 'navigation') as AutomationWorkflow['category'],
          steps,
        });
      } else if (name === 'save_memory') {
        if (!isToolPermitted('save_memory')) {
          setVoiceError('Memory permission is disabled in Setup.');
          return;
        }
        const content = String(args.content || '').trim();
        if (content) {
          const validCats: MemoryCategory[] = ['preference', 'fact', 'project', 'routine', 'person'];
          const rawCat = String(args.category || 'fact') as MemoryCategory;
          const category = validCats.includes(rawCat) ? rawCat : 'fact';
          const rawImp = String(args.importance || 'normal') as MemoryImportance;
          const importance: MemoryImportance = ['low', 'normal', 'high'].includes(rawImp)
            ? rawImp
            : 'normal';
          await handleAddMemoryRecord({
            category,
            content,
            importance,
            source: 'voice',
          });
        }
      } else if (name === 'forget_memory') {
        if (!isToolPermitted('forget_memory')) {
          setVoiceError('Memory permission is disabled in Setup.');
          return;
        }
        const q = String(args.query || '').trim().toLowerCase();
        if (q) {
          const matches = memories.filter((m) => m.content.toLowerCase().includes(q));
          for (const m of matches.slice(0, 5)) {
            await handleDeleteMemoryRecord(m.id);
          }
        }
      } else if (name === 'research_topic') {
        if (!isToolPermitted('research_topic')) {
          setIsResearching(false);
          setVoiceError('Deep Research permission is disabled in Setup.');
          return;
        }
        setIsResearching(false);
        const report = result.report as ResearchReport | undefined;
        if (report?.query) {
          setCurrentResearch(report);
          setActiveDrawer('research');
          if (user) {
            try {
              const savedId = await saveResearchReport(user.uid, report);
              setCurrentResearch((prev) => (prev?.id === report.id ? { ...report, id: savedId } : prev));
              const exId = await createExecutionLog(user.uid, {
                transcript: transcript || report.query,
                intent: 'research',
                targetUrl: report.sources?.[0]?.url || '',
                stepsCount: Math.max(1, report.sources.length),
                summary: report.executiveSummary.slice(0, 900),
                runtime: runtimeInfo.runtime,
              });
              await finalizeExecutionLog(exId, {
                status: 'completed',
                stepsCount: Math.max(1, report.sources.length),
                summary: `${report.query} (${report.sources.length} sources)`,
                targetUrl: report.sources?.[0]?.url || '',
              });
            } catch {
              // continue smoothly
            }
          } else {
            setLocalResearchHistory((prev) => [report, ...prev.filter((r) => r.id !== report.id)].slice(0, 20));
          }
        }
      } else if (name === 'generate_visual') {
        setIsGeneratingVisual(false);
        const visual = result.visual as GeneratedVisual | undefined;
        if (visual?.svgMarkup) {
          setCurrentVisual(visual);
          setVisuals((prev) => {
            const next = [visual, ...prev.filter((item) => item.id !== visual.id)].slice(0, 20);
            saveLocalVisuals(next);
            return next;
          });
          setActiveDrawer('visuals');
          if (user) {
            try {
              const exId = await createExecutionLog(user.uid, {
                transcript: transcript || visual.prompt,
                intent: 'visual_generate',
                targetUrl: '',
                stepsCount: 1,
                summary: `${visual.title} (${visual.kind}, ${visual.aspectRatio})`,
                runtime: runtimeInfo.runtime,
              });
              await finalizeExecutionLog(exId, {
                status: 'completed',
                stepsCount: 1,
                summary: visual.summary || visual.title,
                targetUrl: '',
              });
            } catch {
              // continue smoothly
            }
          }
        } else if (result.error) {
          setVoiceError(String(result.error));
        }
      } else if (
        name === 'manage_laptop_files' ||
        name === 'control_laptop_apps' ||
        name === 'execute_terminal_command'
      ) {
        if (result.requiresClientExecution) {
          const allowed = await authorizeLaptopAction(name, args);
          if (!allowed) {
            setVoiceError(`Permission denied by user for ${name}.`);
            return;
          }
        } else if (!isToolPermitted(name)) {
          setVoiceError(`Permission for ${name} is disabled in Laptop Setup.`);
          return;
        }
        const finalResult = result.requiresClientExecution
          ? (await executeLaptopTool(name, args)).result
          : result;
        const ok = Boolean(finalResult.ok);
        const summary =
          name === 'manage_laptop_files'
            ? `${String(args.operation || 'file')} ${String(args.path || '')}`.trim()
            : name === 'control_laptop_apps'
              ? `${String(args.action || 'app')} ${String(args.appName || '')}`.trim()
              : `${Boolean(args.background) ? '[BG] ' : ''}${String(args.command || '')}`;
        const rawOut =
          typeof finalResult.stdout === 'string' && finalResult.stdout
            ? finalResult.stdout
            : typeof finalResult.content === 'string'
              ? finalResult.content.slice(0, 600)
              : typeof finalResult.error === 'string'
                ? finalResult.error
                : JSON.stringify(finalResult).slice(0, 600);
        setLaptopActions((prev) => [
          {
            id: `lap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            tool: name,
            summary,
            ok,
            output: rawOut,
            timestamp: Date.now(),
            runtime: runtimeInfo.isTauri ? 'tauri-native' : 'laptop-agent',
          },
          ...prev.slice(0, 24),
        ]);
        if (!ok) {
          setActiveDrawer('tauri');
        }
      } else if (name === 'manage_workspace') {
        if (result.needsReauth) {
          clearWorkspaceAccessToken();
          setActiveDrawer('workspace');
          showTransientCaption(
            assistantNameRef.current,
            'Connect Google Workspace in the Workspace stage to continue.',
            5000
          );
        } else if (result.requiresConfirmation && result.pendingAction) {
          setPendingWorkspaceAction(result.pendingAction as PendingWorkspaceAction);
        } else {
          setActiveDrawer('workspace');
        }
      } else if (name === 'manage_tasks_reminders') {
        const act = String(args.action || 'list').toLowerCase();
        const titleInput = String(args.title || '').trim();
        if (act === 'create' && titleInput) {
          const prio = String(args.priority || 'medium') as TaskPriority;
          await handleCreateTask({
            title: titleInput,
            priority: prio === 'low' || prio === 'high' ? prio : 'medium',
            dueAt: typeof args.dueAt === 'string' ? args.dueAt : '',
            notes: typeof args.notes === 'string' ? args.notes : '',
          });
        } else if (act === 'complete') {
          const id = String(args.taskId || '').trim();
          const match = tasksRef.current.find(
            (t) =>
              t.status === 'pending' &&
              ((id && t.id === id) ||
                (titleInput && t.title.toLowerCase().includes(titleInput.toLowerCase())))
          );
          if (match) await handleToggleTask(match);
        } else if (act === 'delete') {
          const id = String(args.taskId || '').trim();
          const match = tasksRef.current.find(
            (t) =>
              (id && t.id === id) ||
              (titleInput && t.title.toLowerCase().includes(titleInput.toLowerCase()))
          );
          if (match) await handleDeleteTask(match.id);
        }
        setActiveDrawer('workspace');
      } else if (name === 'search_knowledge_vault') {
        setActiveDrawer('vault');
      } else if (name === 'inspect_github_repo') {
        setActiveDrawer('vault');
      } else if (name === 'trigger_bridge_message' || name === 'manage_schedules') {
        setActiveDrawer('triggers');
      } else {
        const matchedPlugin = pluginsRef.current.find((p) => p.toolName === name);
        if (matchedPlugin) {
          let finalOk = Boolean(result.ok);
          let finalSummary =
            typeof result.summary === 'string' && result.summary
              ? result.summary
              : finalOk
                ? `${matchedPlugin.name} executed.`
                : String(result.error || 'Plugin failed.');

          if (result.requiresClientExecution && typeof result.renderedCommand === 'string') {
            const allowed = await authorizeLaptopAction('execute_terminal_command', {
              command: result.renderedCommand,
              background: false,
            });
            if (!allowed) {
              finalOk = false;
              finalSummary = 'User denied laptop terminal permission.';
            } else {
              const { result: laptopExec, runtime } = await executeLaptopTool(
                'execute_terminal_command',
                {
                  command: result.renderedCommand,
                  background: false,
                }
              );
              finalOk = Boolean(laptopExec.ok);
              finalSummary = finalOk
                ? `${matchedPlugin.name} ran on laptop.`
                : String(laptopExec.error || 'Laptop command failed.');
              const rawOut =
                typeof laptopExec.stdout === 'string' && laptopExec.stdout
                  ? laptopExec.stdout
                  : typeof laptopExec.error === 'string'
                    ? laptopExec.error
                    : finalSummary;
              setLaptopActions((prev) => [
                {
                  id: `lap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  tool: name,
                  summary: `${matchedPlugin.name}: ${result.renderedCommand}`,
                  ok: finalOk,
                  output: rawOut,
                  timestamp: Date.now(),
                  runtime,
                },
                ...prev.slice(0, 24),
              ]);
            }
          }

          await recordPluginExecution(matchedPlugin, name, finalOk, finalSummary, {
            latencyMs: typeof result.latencyMs === 'number' ? result.latencyMs : undefined,
            statusCode: typeof result.statusCode === 'number' ? result.statusCode : undefined,
            targetUrl: matchedPlugin.endpointUrl,
            transcript: transcript || `Voice call ${matchedPlugin.name}`,
          });
        }
      }
    },
    [
      user,
      runtimeInfo.runtime,
      runtimeInfo.isTauri,
      runAutomationSequence,
      isToolPermitted,
      authorizeLaptopAction,
      handleAddMemoryRecord,
      handleDeleteMemoryRecord,
      memories,
      recordPluginExecution,
      handleCreateTask,
      handleToggleTask,
      handleDeleteTask,
      showTransientCaption,
    ]
  );

  const runDirectLaptopTool = useCallback(
    async (toolName: string, args: Record<string, unknown>) => {
      const cueInfo = describeToolCue(toolName, args);
      const isInteractiveLaptopTool =
        toolName === 'manage_laptop_files' ||
        toolName === 'control_laptop_apps' ||
        toolName === 'execute_terminal_command';
      const permitted = isInteractiveLaptopTool
        ? await authorizeLaptopAction(toolName, args)
        : isToolPermitted(toolName);
      if (!permitted) {
        const deniedResult = {
          ok: false,
          permissionDenied: true,
          error: `Permission for ${toolName} was denied by user.`,
        };
        finishCommandCue(cueInfo.kind, `${cueInfo.label} (Denied)`, false);
        setVoiceError(deniedResult.error);
        reportShadowError({
          source: 'Laptop Permission',
          title: `Permission denied for ${toolName}`,
          message: deniedResult.error,
        });
        return deniedResult;
      }
      beginCommandCue(cueInfo.kind, cueInfo.label);
      const { result, runtime } = await executeLaptopTool(toolName, args);
      const ok = Boolean(result.ok);
      finishCommandCue(cueInfo.kind, ok ? cueInfo.label : `${cueInfo.label} failed`, ok);
      const summary =
        toolName === 'manage_laptop_files'
          ? `${String(args.operation || 'file')} ${String(args.path || '')}`.trim()
          : toolName === 'control_laptop_apps'
            ? args.action === 'arrange_windows'
              ? `arrange_windows (${String(args.layout || 'grid')})`
              : `${String(args.action || 'app')} ${String(args.appName || '')}`.trim()
            : toolName === 'execute_browser_automation'
              ? String(args.goal || args.targetUrl || 'Browser Automation').trim()
              : `${Boolean(args.background) ? '[BG] ' : ''}${String(args.command || '')}`;
      const output =
        typeof result.stdout === 'string' && result.stdout
          ? result.stdout
          : typeof result.content === 'string'
            ? result.content.slice(0, 800)
            : typeof result.error === 'string'
              ? result.error
              : JSON.stringify(result, null, 2).slice(0, 800);

      setLaptopActions((prev) => [
        {
          id: `lap-${Date.now()}`,
          tool: toolName,
          summary,
          ok,
          output,
          timestamp: Date.now(),
          runtime,
        },
        ...prev.slice(0, 24),
      ]);

      if (user) {
        try {
          const exId = await createExecutionLog(user.uid, {
            transcript: summary,
            intent: 'workflow_run',
            targetUrl: '',
            stepsCount: 1,
            summary: output.slice(0, 900) || summary,
            runtime: runtimeInfo.runtime,
          });
          await finalizeExecutionLog(exId, {
            status: ok ? 'completed' : 'failed',
            stepsCount: 1,
            summary: `${summary} · ${ok ? 'OK' : 'Failed'}`,
            targetUrl: '',
          });
        } catch {
          // continue smoothly
        }
      }
      return result;
    },
    [
      user,
      runtimeInfo.runtime,
      isToolPermitted,
      authorizeLaptopAction,
      describeToolCue,
      beginCommandCue,
      finishCommandCue,
    ]
  );

  const stopVoiceSession = useCallback(() => {
    isConnectedRef.current = false;
    isConnectingRef.current = false;
    browserVoiceActiveRef.current = false;
    setIsConnected(false);
    setIsConnecting(false);

    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.onresult = null;
        speechRecognitionRef.current.onerror = null;
        speechRecognitionRef.current.onend = null;
        speechRecognitionRef.current.stop();
      } catch {
        // ignore
      }
      speechRecognitionRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (inputCtxRef.current && inputCtxRef.current.state !== 'closed') {
      void inputCtxRef.current.close();
      inputCtxRef.current = null;
    }
    micAnalyserRef.current = null;

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    playerRef.current.clear();
  }, []);

  const startVoiceSession = useCallback(
    async (startMuted = false) => {
      if (isConnectedRef.current || isConnectingRef.current) return;
      isConnectingRef.current = true;
      setVoiceError(null);
      setIsConnecting(true);

      // Release standby clap listener stream before opening live session mic
      clapListenerRef.current.stop();
      setClapStatus('idle');
      mutedClapAnalyzerRef.current.reset();

      try {
        const apiOrigin = getApiOrigin();
        const apiWsBase = getApiWsBase();
        const backendHealthyPromise = checkShadowBackendHealth(apiOrigin);

        const streamPromise = navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });

        const [stream, backendHealthy] = await Promise.all([
          streamPromise,
          backendHealthyPromise,
        ]);
        micStreamRef.current = stream;

        const inputCtx = new AudioContext({ sampleRate: 16000 });
        inputCtxRef.current = inputCtx;
        if (inputCtx.state === 'suspended') {
          await inputCtx.resume().catch(() => null);
        }
        const source = inputCtx.createMediaStreamSource(stream);
        const analyser = inputCtx.createAnalyser();
        analyser.fftSize = 128;
        micAnalyserRef.current = analyser;

        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        // Route through a muted GainNode so Windows/WebView2 drivers keep onaudioprocess active without echo
        const silentGain = inputCtx.createGain();
        silentGain.gain.value = 0;

        source.connect(analyser);
        analyser.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(inputCtx.destination);

        isMicMutedRef.current = startMuted;
        setIsMicMuted(startMuted);

        // Standalone Static PWA Fallback (e.g. Firebase Hosting without a backend server):
        // Use browser-native SpeechRecognition + local/BYOK command handling instead of failing WS.
        if (!backendHealthy) {
          const SpeechRecCtor =
            typeof window !== 'undefined'
              ? (
                  window as unknown as {
                    SpeechRecognition?: new () => BrowserSpeechRecognition;
                    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
                  }
                ).SpeechRecognition ||
                (
                  window as unknown as {
                    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
                  }
                ).webkitSpeechRecognition
              : undefined;

          if (!SpeechRecCtor) {
            throw new Error(
              apiOrigin
                ? `Shadow server unreachable at ${apiOrigin}. Start "npm start" or clear the Server URL in AI Keys.`
                : 'No Shadow backend at this URL and browser speech recognition is unavailable. Type in Spotlight or set a Shadow Server URL in AI Keys.'
            );
          }

          browserVoiceActiveRef.current = true;
          isConnectingRef.current = false;
          isConnectedRef.current = true;
          setIsConnected(true);
          setIsConnecting(false);

          const recognition = new SpeechRecCtor();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang =
            typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';

          recognition.onresult = (event) => {
            if (isMicMutedRef.current || !isConnectedRef.current) return;
            let interim = '';
            let finalized = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const resItem = event.results[i];
              const chunk = resItem?.[0]?.transcript || '';
              if (resItem?.isFinal) {
                finalized += chunk;
              } else {
                interim += chunk;
              }
            }
            if (interim.trim()) {
              showTransientCaption('You', interim.trim(), 3000);
            }
            if (finalized.trim()) {
              void runSpokenActionRef.current(finalized.trim());
            }
          };

          recognition.onerror = (ev) => {
            if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
              const msg = `Microphone speech recognition permission denied (${ev.error}).`;
              setVoiceError(msg);
              reportShadowError({
                source: 'Speech Recognition',
                title: `SpeechRecognition ${ev.error}`,
                message: msg,
              });
              stopVoiceSession();
            } else if (ev.error && ev.error !== 'no-speech' && ev.error !== 'aborted') {
              reportShadowError({
                source: 'Speech Recognition',
                title: `SpeechRecognition error: ${ev.error}`,
                message: `Browser speech recognition reported "${ev.error}".`,
              });
            }
          };

          recognition.onend = () => {
            if (
              isConnectedRef.current &&
              browserVoiceActiveRef.current &&
              speechRecognitionRef.current === recognition
            ) {
              try {
                recognition.start();
              } catch {
                // ignore restart race
              }
            }
          };

          speechRecognitionRef.current = recognition;
          recognition.start();

          processor.onaudioprocess = (e) => {
            if (!isConnectedRef.current) return;
            const samples = e.inputBuffer.getChannelData(0);
            if (
              isMicMutedRef.current &&
              clapWakeEnabledRef.current &&
              mutedClapAnalyzerRef.current.processSamples(samples, 16000)
            ) {
              playWakeChime();
              isMicMutedRef.current = false;
              setIsMicMuted(false);
              showTransientCaption(
                assistantNameRef.current,
                'Double-clap detected. Mic live.',
                3500
              );
            }
          };

          showTransientCaption(
            assistantNameRef.current,
            'Browser voice online (standalone mode). Listening.',
            4000
          );
          return;
        }

        const ctxData = await fetch(`${apiOrigin}/api/assistant/context`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildSessionContextPayload()),
        })
          .then((r) => (r.ok ? parseJsonSafely<{ ctxId?: string }>(r) : null))
          .catch(() => null);

        const ctxQuery = ctxData?.ctxId ? `&ctx=${encodeURIComponent(ctxData.ctxId)}` : '';

        if (apiOrigin && !ctxData) {
          await ensureDesktopBackendServer();
        }

        const ws = new WebSocket(`${apiWsBase}/ws/live?voice=${voiceName}${ctxQuery}`);
        wsRef.current = ws;

        ws.onopen = () => {
          if (wsRef.current !== ws) {
            try {
              ws.close();
            } catch {
              // ignore
            }
            return;
          }
          isConnectingRef.current = false;
          isConnectedRef.current = true;
          setIsConnected(true);
          setIsConnecting(false);
          // Announce BYOK provider & memory-only Workspace token (server falls back to env keys when absent).
          ws.send(
            JSON.stringify({
              ...aiSocketAuthMessage(aiSettingsRef.current),
              workspaceToken: getWorkspaceAccessToken(),
            })
          );
          showTransientCaption(assistantNameRef.current, 'Voice core online. Listening.', 3500);
        };

        ws.onmessage = async (event) => {
          const msg = JSON.parse(event.data) as {
            type: string;
            data?: string;
            text?: string;
            callId?: string;
            name?: string;
            args?: Record<string, unknown>;
            result?: Record<string, unknown>;
            message?: string;
            detail?: {
              source?: string;
              status?: number;
              summary?: string;
              rawMessage?: string;
              code?: string;
              cause?: string;
              stack?: string;
              endpoint?: string;
            };
          };

          if (msg.type === 'audio' && msg.data) {
            playerRef.current.enqueuePcmChunk(msg.data);
          } else if (msg.type === 'interrupted') {
            playerRef.current.clear();
            if (userTranscriptBufRef.current.trim()) {
              appendDialogueEntry({ speaker: 'user', text: userTranscriptBufRef.current });
              userTranscriptBufRef.current = '';
            }
            if (jarvisTranscriptBufRef.current.trim()) {
              appendDialogueEntry({ speaker: 'shadow', text: jarvisTranscriptBufRef.current });
              showTransientCaption(assistantNameRef.current, jarvisTranscriptBufRef.current, 4500);
              jarvisTranscriptBufRef.current = '';
            }
          } else if (msg.type === 'input_transcript' && msg.text) {
            userTranscriptBufRef.current += msg.text;
            showTransientCaption('You', userTranscriptBufRef.current, 5000);
          } else if (msg.type === 'output_transcript' && msg.text) {
            if (userTranscriptBufRef.current.trim()) {
              appendDialogueEntry({ speaker: 'user', text: userTranscriptBufRef.current });
            }
            userTranscriptBufRef.current = '';
            jarvisTranscriptBufRef.current += msg.text;
            showTransientCaption(assistantNameRef.current, jarvisTranscriptBufRef.current, 7000);
          } else if (msg.type === 'turn_complete') {
            if (userTranscriptBufRef.current.trim()) {
              appendDialogueEntry({ speaker: 'user', text: userTranscriptBufRef.current });
            }
            userTranscriptBufRef.current = '';
            if (jarvisTranscriptBufRef.current.trim()) {
              appendDialogueEntry({ speaker: 'shadow', text: jarvisTranscriptBufRef.current });
              showTransientCaption(assistantNameRef.current, jarvisTranscriptBufRef.current, 6000);
              jarvisTranscriptBufRef.current = '';
            }
          } else if (msg.type === 'tool_started' && msg.name) {
            const cueInfo = describeToolCue(msg.name, msg.args || {});
            beginCommandCue(cueInfo.kind, cueInfo.label);
            if (msg.name === 'research_topic') {
              setIsResearching(true);
              setActiveDrawer('research');
              showTransientCaption(
                assistantNameRef.current,
                `Researching ${String(msg.args?.query || 'live sources')}...`,
                5000
              );
            } else if (msg.name === 'generate_visual') {
              setIsGeneratingVisual(true);
              setActiveDrawer('visuals');
              showTransientCaption(
                assistantNameRef.current,
                `Generating visual: ${String(msg.args?.prompt || 'graphic').slice(0, 48)}...`,
                5000
              );
            } else if (
              msg.name === 'execute_browser_automation' ||
              msg.name === 'inspect_web_page' ||
              msg.name === 'run_autonomous_web_agent'
            ) {
              setIsAutomating(true);
              setActiveDrawer('automation');
            } else if (
              msg.name === 'manage_laptop_files' ||
              msg.name === 'control_laptop_apps' ||
              msg.name === 'execute_terminal_command'
            ) {
              setIsAutomating(true);
            } else {
              const pluginMatch = pluginsRef.current.find((p) => p.toolName === msg.name);
              if (pluginMatch) {
                showTransientCaption(
                  assistantNameRef.current,
                  `Running plugin: ${pluginMatch.name}...`,
                  4000
                );
              }
            }
          } else if (msg.type === 'client_tool_request' && msg.callId && msg.name) {
            const cueInfo = describeToolCue(msg.name, msg.args || {});
            beginCommandCue(cueInfo.kind, cueInfo.label);
            const toolResult = await runDirectLaptopTool(msg.name, msg.args || {});
            setIsAutomating(false);
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({
                  type: 'client_tool_response',
                  callId: msg.callId,
                  result: toolResult,
                })
              );
            }
          } else if (msg.type === 'tool_action' && msg.name) {
            if (msg.name === 'research_topic') setIsResearching(false);
            if (msg.name === 'generate_visual') setIsGeneratingVisual(false);
            if (
              msg.name === 'execute_browser_automation' ||
              msg.name === 'inspect_web_page' ||
              msg.name === 'run_autonomous_web_agent'
            ) {
              setIsAutomating(false);
            }
            const cueInfo = describeToolCue(msg.name, msg.args || {});
            const actionOk = msg.result?.ok !== false;
            finishCommandCue(cueInfo.kind, cueInfo.label, actionOk);
            if (!actionOk && typeof msg.result?.error === 'string') {
              const toolDetail = msg.result.errorDetail as
                | { rawMessage?: string; cause?: string; stack?: string; code?: string }
                | undefined;
              reportShadowError({
                source: `Live Tool · ${msg.name}`,
                title: `Tool "${msg.name}" failed`,
                message: msg.result.error,
                rawDetail: [
                  toolDetail?.code ? `Code: ${toolDetail.code}` : '',
                  toolDetail?.rawMessage ? `Upstream: ${toolDetail.rawMessage}` : '',
                  toolDetail?.cause ? `Cause: ${toolDetail.cause}` : '',
                  `Args: ${JSON.stringify(msg.args || {}, null, 2)}`,
                ]
                  .filter(Boolean)
                  .join('\n'),
                stack: toolDetail?.stack,
              });
            }
            const recentTranscript = userTranscriptBufRef.current || '';
            await handleToolAction(msg.name, msg.args || {}, msg.result || {}, recentTranscript);
          } else if (msg.type === 'error') {
            setIsResearching(false);
            setIsGeneratingVisual(false);
            setIsAutomating(false);
            const errMsg = msg.message || 'Voice stream error.';
            finishCommandCue('command', errMsg, false);
            setVoiceError(errMsg);
            const srv = msg.detail;
            const detailLines = [
              srv?.code ? `Code: ${srv.code}` : '',
              srv?.rawMessage ? `Upstream: ${srv.rawMessage}` : '',
              srv?.cause ? `Cause: ${srv.cause}` : '',
            ].filter(Boolean);
            reportShadowError({
              source: srv?.source || 'Gemini Live WS',
              title: 'Live Voice Stream Error',
              message: errMsg,
              rawDetail: detailLines.length > 0 ? detailLines.join('\n') : undefined,
              statusCode: srv?.status,
              endpoint: srv?.endpoint || '/ws/live',
              stack: srv?.stack,
            });
          } else if (msg.type === 'closed') {
            setIsResearching(false);
            setIsGeneratingVisual(false);
            setIsAutomating(false);
            setCommandCue(null);
            stopVoiceSession();
          }
        };

        const wsUrl = `${apiWsBase}/ws/live?voice=${voiceName}${ctxQuery}`;
        let wsErrorReported = false;

        ws.onerror = (ev) => {
          if (wsRef.current !== ws) return;
          wsErrorReported = true;
          const wsOrigin = getApiWsBase();
          const msg = getApiOrigin()
            ? `WebSocket connection failed (${wsOrigin}/ws/live, readyState=${ws.readyState}). Verify your Shadow server is running and reachable.`
            : `Live voice WebSocket connection error (${wsUrl.split('?')[0]}, readyState=${ws.readyState}). Verify server /ws/live upgrade and GEMINI_API_KEY.`;
          setVoiceError(msg);
          reportShadowError({
            source: 'Voice WebSocket',
            title: 'WebSocket connection error',
            message: msg,
            rawDetail: `URL: ${wsUrl.split('?')[0]}\nReadyState: ${ws.readyState}\nEvent Type: ${ev.type}\nOnline: ${navigator.onLine}`,
            endpoint: '/ws/live',
          });
          stopVoiceSession();
        };

        ws.onclose = (closeEv) => {
          if (wsRef.current === ws) {
            if (!wsErrorReported && closeEv.code !== 1000 && closeEv.code !== 1005) {
              const reasonText = closeEv.reason ? `: ${closeEv.reason}` : '';
              const closeMsg = `Voice WebSocket closed unexpectedly (code ${closeEv.code}${reasonText}).`;
              setVoiceError(closeMsg);
              reportShadowError({
                source: 'Voice WebSocket',
                title: `WebSocket closed (${closeEv.code})`,
                message: closeMsg,
                rawDetail: `Close Code: ${closeEv.code}\nReason: ${closeEv.reason || 'None provided'}\nClean Close: ${String(closeEv.wasClean)}\nEndpoint: /ws/live`,
                statusCode: closeEv.code,
                endpoint: '/ws/live',
              });
            }
            stopVoiceSession();
          }
        };

        processor.onaudioprocess = (e) => {
          if (!isConnectedRef.current) return;
          const samples = e.inputBuffer.getChannelData(0);
          if (isMicMutedRef.current) {
            if (
              clapWakeEnabledRef.current &&
              mutedClapAnalyzerRef.current.processSamples(samples, 16000)
            ) {
              playWakeChime();
              isMicMutedRef.current = false;
              setIsMicMuted(false);
              showTransientCaption(
                assistantNameRef.current,
                'Double-clap detected. Mic live.',
                3500
              );
            }
            return;
          }
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
          const base64 = float32ToPcm16Base64(samples);
          wsRef.current.send(JSON.stringify({ type: 'audio', data: base64 }));
        };
      } catch (err) {
        const rawMsg =
          err instanceof Error
            ? err.message
            : 'Microphone permission is required for voice control.';
        const isMicDenied =
          err instanceof DOMException &&
          (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
        if (isMicDenied && runtimeInfo.isTauri) {
          void requestNativeOsPermission('microphone');
        }
        const finalMsg = isMicDenied
          ? `Microphone permission denied (${err instanceof DOMException ? err.name : 'PermissionDenied'}): Allow Microphone access in your OS/browser Privacy Settings.`
          : rawMsg;
        setVoiceError(finalMsg);
        reportExceptionError('Voice Session', err, finalMsg);
        stopVoiceSession();
      }
    },
    [
      voiceName,
      showTransientCaption,
      handleToolAction,
      runDirectLaptopTool,
      stopVoiceSession,
      buildSessionContextPayload,
      describeToolCue,
      beginCommandCue,
      finishCommandCue,
      runtimeInfo.isTauri,
      appendDialogueEntry,
    ]
  );

  useEffect(() => {
    return () => {
      if (cueTimerRef.current) window.clearTimeout(cueTimerRef.current);
      if (captionTimerRef.current) window.clearTimeout(captionTimerRef.current);
      if (desktopAuthPollRef.current) window.clearInterval(desktopAuthPollRef.current);
      clapListenerRef.current.stop();
      stopVoiceSession();
      playerRef.current.dispose();
    };
  }, [stopVoiceSession]);

  // Background Double-Clap Wake Listener (active in standby when unlocked & not in setup)
  useEffect(() => {
    const faceLocked = Boolean(faceAuthProfile && setupConfig.faceAuthEnabled && !isFaceUnlocked);
    const shouldArm =
      setupConfig.clapWakeEnabled &&
      !isConnected &&
      !isConnecting &&
      !setupOpen &&
      !faceLocked;

    if (!shouldArm) {
      clapListenerRef.current.stop();
      setClapStatus('idle');
      return;
    }

    let cancelled = false;
    let gestureCleanup: (() => void) | null = null;

    const triggerWake = () => {
      if (cancelled || isConnectedRef.current) return;
      clapListenerRef.current.stop();
      setClapStatus('idle');
      playWakeChime();
      showTransientCaption(
        assistantNameRef.current,
        'Double-clap detected. Listening.',
        3500
      );
      void startVoiceSession(false);
    };

    const arm = async () => {
      const status = await clapListenerRef.current.start(triggerWake);
      if (cancelled) {
        clapListenerRef.current.stop();
        return;
      }
      setClapStatus(status);

      if (status === 'needs-gesture' || status === 'denied') {
        const onFirstGesture = () => {
          if (gestureCleanup) {
            gestureCleanup();
            gestureCleanup = null;
          }
          if (!cancelled) {
            void arm();
          }
        };
        window.addEventListener('pointerdown', onFirstGesture, { once: true });
        window.addEventListener('keydown', onFirstGesture, { once: true });
        gestureCleanup = () => {
          window.removeEventListener('pointerdown', onFirstGesture);
          window.removeEventListener('keydown', onFirstGesture);
        };
      }
    };

    void arm();

    return () => {
      cancelled = true;
      if (gestureCleanup) gestureCleanup();
      clapListenerRef.current.stop();
    };
  }, [
    setupConfig.clapWakeEnabled,
    setupConfig.faceAuthEnabled,
    faceAuthProfile,
    isFaceUnlocked,
    isConnected,
    isConnecting,
    setupOpen,
    startVoiceSession,
    showTransientCaption,
  ]);

  // Hold Spacebar shortcut for Push-to-Talk
  useEffect(() => {
    const isInputTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isInputTarget(e.target)) return;
      if (wakeMode !== 'push-to-talk') return;
      e.preventDefault();
      spaceHoldActiveRef.current = true;
      if (!isConnectedRef.current) {
        void startVoiceSession(false);
      } else {
        isMicMutedRef.current = false;
        setIsMicMuted(false);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !spaceHoldActiveRef.current) return;
      spaceHoldActiveRef.current = false;
      if (wakeMode === 'push-to-talk' && isConnectedRef.current) {
        isMicMutedRef.current = true;
        setIsMicMuted(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [wakeMode, startVoiceSession]);

  const handleSpeakText = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      showTransientCaption(assistantNameRef.current, clean, 7000);
      const settings = aiSettingsRef.current;
      const apiOrigin = getApiOrigin();
      const canUseNeuralTts =
        Boolean(settings.geminiKey.trim()) ||
        (settings.provider !== 'openrouter' && serverHasGeminiKeyRef.current);

      if (!canUseNeuralTts) {
        speakWithBrowserSpeech(clean);
        return;
      }

      try {
        const res = await fetch(`${apiOrigin}/api/assistant/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...aiRequestHeaders(settings) },
          body: JSON.stringify({ text: clean, voiceName }),
        });
        const data = await parseJsonSafely<{ audioBase64?: string | null; error?: string }>(res);
        if (!res.ok || !data) throw new Error(data?.error || 'TTS failed');
        if (data.audioBase64) {
          await playerRef.current.playWavBase64(data.audioBase64);
        } else {
          speakWithBrowserSpeech(clean);
        }
      } catch {
        speakWithBrowserSpeech(clean);
      }
    },
    [voiceName, showTransientCaption]
  );
  handleSpeakTextRef.current = handleSpeakText;

  // Triggered by Dynamic Island Spotlight, Browser Voice fallback, Shelf, stage demo buttons, or macro replay
  const runSpokenAction = useCallback(
    async (commandText: string, explicitAttachment?: CommandAttachment) => {
      const clean = commandText.trim();
      if (!clean && !explicitAttachment) return;
      setVoiceError(null);

      let activeAttachment: CommandAttachment | undefined = explicitAttachment;
      if (!activeAttachment && vision.visionMode !== 'off') {
        const snapshot = vision.captureSnapshot();
        if (snapshot) {
          activeAttachment = snapshot;
        }
      }

      const displayPrompt = clean || 'Analyze the current visual view.';
      showTransientCaption('You', displayPrompt, 4000);
      beginCommandCue('command', `Processing: ${displayPrompt.slice(0, 44)}`);

      const priorHistory = dialogueHistory.slice(-10).map((d) => ({
        speaker: d.speaker,
        text: d.text,
      }));
      appendDialogueEntry({
        speaker: 'user',
        text: displayPrompt,
        attachmentName: activeAttachment?.name,
      });

      const apiOrigin = getApiOrigin();
      const lower = displayPrompt.toLowerCase();

      const executeStandaloneFallback = async (): Promise<boolean> => {
        // 1) Focus Timer intents
        if (/\btimer\b|\bpomodoro\b|\bfocus\b/.test(lower)) {
          let action = 'start';
          if (/\bpause\b/.test(lower)) action = 'pause';
          else if (/\bresume\b|\bcontinue\b/.test(lower)) action = 'resume';
          else if (/\bstop\b|\bcancel\b|\breset\b|\bclear\b/.test(lower)) action = 'stop';
          const minsMatch = lower.match(/(\d{1,3})\s*(?:min|minute|minutes|m)\b/);
          const minutes = minsMatch ? Math.min(180, Math.max(1, Number(minsMatch[1]))) : 25;
          await handleToolAction(
            'set_focus_timer',
            { action, minutes, label: 'Focus Timer' },
            { ok: true, action, minutes, label: 'Focus Timer' },
            displayPrompt
          );
          const reply =
            action === 'start'
              ? `Focus timer set for ${minutes} minutes.`
              : `Focus timer ${action}d.`;
          appendDialogueEntry({ speaker: 'shadow', text: reply });
          finishCommandCue('command', reply, true);
          void handleSpeakText(reply);
          return true;
        }

        // 2) Memory intents
        const rememberMatch = displayPrompt.match(/^(?:remember(?:\s+that)?|save\s+memory)\s+(.+)/i);
        if (rememberMatch?.[1]) {
          const content = rememberMatch[1].trim();
          await handleToolAction(
            'save_memory',
            { content, category: 'fact', importance: 'normal' },
            { ok: true, saved: true, content, category: 'fact', importance: 'normal' },
            displayPrompt
          );
          const reply = `Saved to memory: ${content}`;
          appendDialogueEntry({ speaker: 'shadow', text: reply });
          finishCommandCue('memory', 'Memory saved', true);
          void handleSpeakText(reply);
          return true;
        }

        const forgetMatch = displayPrompt.match(/^forget\s+(.+)/i);
        if (forgetMatch?.[1]) {
          const query = forgetMatch[1].trim();
          await handleToolAction('forget_memory', { query }, { ok: true, query }, displayPrompt);
          const reply = `Cleared matching memories for "${query}".`;
          appendDialogueEntry({ speaker: 'shadow', text: reply });
          finishCommandCue('memory', 'Memory updated', true);
          void handleSpeakText(reply);
          return true;
        }

        // 3) Drawer switching
        if (/\b(?:open|show)\s+(?:youtube|music|media)\b/i.test(lower)) {
          setActiveDrawer('youtube');
          const reply = 'Opened YouTube stage.';
          appendDialogueEntry({ speaker: 'shadow', text: reply });
          finishCommandCue('youtube', reply, true);
          void handleSpeakText(reply);
          return true;
        }
        if (/\b(?:open|show)\s+(?:browser|automation)\b/i.test(lower)) {
          setActiveDrawer('automation');
          const reply = 'Opened Browser Automation stage.';
          appendDialogueEntry({ speaker: 'shadow', text: reply });
          finishCommandCue('automation', reply, true);
          void handleSpeakText(reply);
          return true;
        }
        if (/\b(?:open|show)\s+(?:research|brief)\b/i.test(lower)) {
          setActiveDrawer('research');
          const reply = 'Opened Research stage.';
          appendDialogueEntry({ speaker: 'shadow', text: reply });
          finishCommandCue('research', reply, true);
          void handleSpeakText(reply);
          return true;
        }
        if (/\b(?:open|show)\s+(?:visual|visuals|image|canvas)\b/i.test(lower)) {
          setActiveDrawer('visuals');
          const reply = 'Opened Visuals stage.';
          appendDialogueEntry({ speaker: 'shadow', text: reply });
          finishCommandCue('visuals', reply, true);
          void handleSpeakText(reply);
          return true;
        }
        if (/\b(?:open|show)\s+(?:plugin|plugins)\b/i.test(lower)) {
          setActiveDrawer('plugins');
          const reply = 'Opened Plugins stage.';
          appendDialogueEntry({ speaker: 'shadow', text: reply });
          finishCommandCue('plugin', reply, true);
          void handleSpeakText(reply);
          return true;
        }
        if (/\b(?:open|show)\s+(?:workspace|tasks?|gmail|calendar|drive)\b/i.test(lower)) {
          setActiveDrawer('workspace');
          const reply = 'Opened Workspace & Tasks stage.';
          appendDialogueEntry({ speaker: 'shadow', text: reply });
          finishCommandCue('command', reply, true);
          void handleSpeakText(reply);
          return true;
        }
        if (/\b(?:open|show)\s+(?:meeting|meetings|transcript)\b/i.test(lower)) {
          setActiveDrawer('meetings');
          const reply = 'Opened Meeting Companion stage.';
          appendDialogueEntry({ speaker: 'shadow', text: reply });
          finishCommandCue('command', reply, true);
          void handleSpeakText(reply);
          return true;
        }
        if (/\b(?:open|show)\s+(?:vault|knowledge|github|devops|repo)\b/i.test(lower)) {
          setActiveDrawer('vault');
          const reply = 'Opened Knowledge Vault & DevOps stage.';
          appendDialogueEntry({ speaker: 'shadow', text: reply });
          finishCommandCue('memory', reply, true);
          void handleSpeakText(reply);
          return true;
        }
        if (/\b(?:open|show)\s+(?:trigger|triggers|bridge|bridges|schedule|webhook)\b/i.test(lower)) {
          setActiveDrawer('triggers');
          const reply = 'Opened Remote & Triggers stage.';
          appendDialogueEntry({ speaker: 'shadow', text: reply });
          finishCommandCue('command', reply, true);
          void handleSpeakText(reply);
          return true;
        }
        if (/\b(?:close|hide)\s+(?:drawer|panel|stage)\b/i.test(lower)) {
          setActiveDrawer(null);
          const reply = 'Closed active stage.';
          appendDialogueEntry({ speaker: 'shadow', text: reply });
          finishCommandCue('command', reply, true);
          void handleSpeakText(reply);
          return true;
        }

        // 4) OpenRouter BYOK direct browser execution (supports CORS directly)
        const settings = aiSettingsRef.current;
        if (settings.provider === 'openrouter' && settings.openrouterKey.trim()) {
          const model = settings.openrouterModel.trim() || 'openai/gpt-4o-mini';
          const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${settings.openrouterKey.trim()}`,
              'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://shadow-solodev.web.app',
              'X-Title': assistantNameRef.current,
            },
            body: JSON.stringify({
              model,
              messages: [
                {
                  role: 'system',
                  content: `You are ${assistantNameRef.current}, a concise voice-first AI assistant running in standalone PWA mode. Keep answers sharp and speakable.`,
                },
                ...priorHistory.map((h) => ({
                  role: h.speaker === 'user' ? 'user' : 'assistant',
                  content: h.text,
                })),
                { role: 'user', content: displayPrompt },
              ],
            }),
          });
          const orData = await parseJsonSafely<{
            choices?: Array<{ message?: { content?: string } }>;
            error?: { message?: string };
          }>(orRes);
          if (!orRes.ok) {
            throw new Error(orData?.error?.message || `OpenRouter HTTP ${orRes.status}`);
          }
          const reply = orData?.choices?.[0]?.message?.content?.trim() || 'Done.';
          appendDialogueEntry({ speaker: 'shadow', text: reply, modelUsed: model });
          finishCommandCue('command', 'Command completed', true);
          void handleSpeakText(reply);
          return true;
        }

        const standaloneHint =
          'Running in standalone PWA mode. Timer, Memory, and Stage controls work offline; add an OpenRouter key or Shadow Server URL in AI Keys for full AI & web automation.';
        appendDialogueEntry({ speaker: 'shadow', text: standaloneHint });
        finishCommandCue('command', 'Standalone PWA mode', true);
        void handleSpeakText(standaloneHint);
        return true;
      };

      try {
        const wsToken = getWorkspaceAccessToken();
        const res = await fetch(`${apiOrigin}/api/assistant/command`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...aiRequestHeaders(aiSettingsRef.current),
            ...(wsToken ? { Authorization: `Bearer ${wsToken}` } : {}),
          },
          body: JSON.stringify({
            command: displayPrompt,
            history: priorHistory,
            attachments: activeAttachment ? [activeAttachment] : [],
            deepThinking,
            voiceName,
            speak: false,
            context: buildSessionContextPayload(),
          }),
        });
        const data = await parseJsonSafely<{
          spokenText?: string;
          actions?: Array<{
            name: string;
            args: Record<string, unknown>;
            result: Record<string, unknown>;
          }>;
          toolTraces?: AgentToolTrace[];
          modelUsed?: string;
          audioBase64?: string | null;
          error?: string;
        }>(res);

        if (!data) {
          await executeStandaloneFallback();
          return;
        }

        if (!res.ok) throw new Error(data.error || 'Command failed');

        if (data.actions && data.actions.length > 0) {
          for (const act of data.actions) {
            const cueInfo = describeToolCue(act.name, act.args);
            beginCommandCue(cueInfo.kind, cueInfo.label);
            await handleToolAction(act.name, act.args, act.result, displayPrompt);
            finishCommandCue(cueInfo.kind, cueInfo.label, act.result?.ok !== false);
          }
        } else {
          finishCommandCue('command', 'Command completed', true);
        }
        if (data.spokenText) {
          appendDialogueEntry({
            speaker: 'shadow',
            text: data.spokenText,
            toolTraces: data.toolTraces,
            modelUsed: data.modelUsed,
          });
          showTransientCaption(assistantNameRef.current, data.spokenText, 6000);
          if (data.audioBase64) {
            void playerRef.current.playWavBase64(data.audioBase64);
          } else {
            void handleSpeakText(data.spokenText);
          }
        }
      } catch (err) {
        if (err instanceof TypeError) {
          try {
            await executeStandaloneFallback();
            return;
          } catch (fallbackErr) {
            const msg =
              fallbackErr instanceof Error ? fallbackErr.message : 'Unable to execute command.';
            finishCommandCue('command', 'Command failed', false);
            setVoiceError(msg);
            reportExceptionError('Assistant Fallback', fallbackErr, msg);
            return;
          }
        }
        const msg = err instanceof Error ? err.message : 'Unable to execute command.';
        finishCommandCue('command', 'Command failed', false);
        setVoiceError(msg);
        reportExceptionError('Assistant Command', err, msg, { endpoint: '/api/assistant/command' });
      }
    },
    [
      voiceName,
      deepThinking,
      dialogueHistory,
      vision,
      appendDialogueEntry,
      showTransientCaption,
      handleToolAction,
      handleSpeakText,
      buildSessionContextPayload,
      describeToolCue,
      beginCommandCue,
      finishCommandCue,
    ]
  );
  runSpokenActionRef.current = runSpokenAction;

  const handleSearchAndPlayYouTube = useCallback(
    async (query: string, mediaType: 'song' | 'video') => {
      if (!isToolPermitted('play_youtube_media')) {
        const msg = 'YouTube Media permission is disabled in Laptop Setup.';
        setVoiceError(msg);
        reportShadowError({ source: 'YouTube Media', message: msg, statusCode: 403 });
        return;
      }
      setActiveDrawer('youtube');
      beginCommandCue('youtube', `YouTube: ${query.slice(0, 44)}`);
      try {
        const res = await fetch(`${getApiOrigin()}/api/youtube/search?q=${encodeURIComponent(query)}`, {
          headers: aiRequestHeaders(aiSettingsRef.current),
        });
        const data = await parseJsonSafely<{ results?: YouTubeTrack[]; error?: string }>(res);
        if (!data) {
          finishCommandCue('youtube', 'Shadow server required', false);
          const msg = 'YouTube search requires a connected Shadow server (set Shadow Server URL in AI Keys).';
          setVoiceError(msg);
          reportShadowError({
            source: 'YouTube Media',
            message: msg,
            endpoint: '/api/youtube/search',
            statusCode: res.status || undefined,
          });
          return;
        }
        if (!res.ok || data.error) {
          throw new Error(data.error || `YouTube search failed (${res.status})`);
        }
        const first = data.results?.[0];
        if (!first) {
          finishCommandCue('youtube', 'No matching tracks found', false);
          const msg = `No playable YouTube videos found for "${query}".`;
          setVoiceError(msg);
          reportShadowError({
            source: 'YouTube Media',
            message: msg,
            endpoint: '/api/youtube/search',
          });
          return;
        }
        await handleToolAction(
          'play_youtube_media',
          { query, mediaType },
          { ok: true, mediaType, selected: first },
          `Play ${query} on YouTube`
        );
        finishCommandCue('youtube', `Playing: ${first.title.slice(0, 42)}`, true);
      } catch (err) {
        finishCommandCue('youtube', 'YouTube search failed', false);
        const msg = err instanceof Error ? err.message : 'YouTube search failed';
        setVoiceError(msg);
        reportExceptionError('YouTube Media', err, msg, { endpoint: '/api/youtube/search' });
      }
    },
    [handleToolAction, isToolPermitted, beginCommandCue, finishCommandCue]
  );

  const handleInspectUrl = useCallback(
    async (url: string) => {
      if (!isToolPermitted('execute_browser_automation')) {
        const msg = 'Browser Automation permission is disabled in Laptop Setup.';
        setVoiceError(msg);
        reportShadowError({ source: 'Browser Automation', message: msg, statusCode: 403 });
        return;
      }
      setActiveDrawer('automation');
      beginCommandCue('automation', `Inspecting: ${url.slice(0, 44)}`);
      const started = performance.now();
      try {
        const res = await fetch(`${getApiOrigin()}/api/automation/inspect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const payload = await parseJsonSafely<PageInspectionResult & { error?: string }>(res);
        if (!res.ok || !payload || payload.error) {
          throw new Error(
            payload?.error ||
              (payload
                ? `HTTP ${res.status} inspecting ${url}`
                : 'Page inspection requires a connected Shadow server (set Shadow Server URL in AI Keys).')
          );
        }
        const elapsedMs = Math.max(1, Math.round(performance.now() - started));
        setAutomationRun({
          id: `inspect-${Date.now()}`,
          goal: `Inspect ${payload.title || url}`,
          targetUrl: payload.finalUrl || url,
          status: 'completed',
          steps: [
            {
              action: 'navigate',
              selector: 'document',
              value: payload.finalUrl || url,
              description: `Loaded ${payload.title || url}`,
              status: 'completed',
              durationMs: elapsedMs,
              detail: `HTTP ${payload.statusCode} · ${payload.fields.length} field(s), ${payload.links.length} link(s)`,
            },
          ],
          inspection: payload,
          extractedItems: [],
          submissionResult: null,
          totalDurationMs: elapsedMs,
          startedAt: Date.now(),
        });
        finishCommandCue('automation', `Inspected ${payload.title || url}`, true);
      } catch (err) {
        finishCommandCue('automation', 'Page inspection failed', false);
        const msg = err instanceof Error ? err.message : 'Inspection failed';
        setVoiceError(msg);
        reportExceptionError('Page Inspection', err, msg, { endpoint: '/api/automation/inspect' });
      }
    },
    [isToolPermitted, beginCommandCue, finishCommandCue]
  );

  const handleRunAutonomousAgent = useCallback(
    async (goal: string, startUrl: string) => {
      if (!isToolPermitted('run_autonomous_web_agent')) {
        const msg = 'Browser Automation permission is disabled in Setup.';
        setVoiceError(msg);
        reportShadowError({ source: 'Autonomous Agent', message: msg, statusCode: 403 });
        return;
      }
      const cleanGoal = goal.trim();
      const cleanUrl = startUrl.trim();
      if (!cleanGoal || !cleanUrl) return;

      setIsAutomating(true);
      setActiveDrawer('automation');
      setVoiceError(null);
      beginCommandCue('automation', `Autonomous Agent: ${cleanGoal.slice(0, 38)}`);
      showTransientCaption('You', `${cleanGoal} (${cleanUrl})`, 4000);

      const runId = `agent-${Date.now()}`;
      setAutomationRun({
        id: runId,
        goal: cleanGoal,
        targetUrl: cleanUrl,
        status: 'running',
        steps: [
          {
            action: 'navigate',
            selector: 'document',
            value: cleanUrl,
            description: `Inspecting ${cleanUrl} and planning autonomous actions`,
            status: 'running',
          },
        ],
        inspection: null,
        extractedItems: [],
        submissionResult: null,
        agentIterations: [],
        startedAt: Date.now(),
      });

      let execId: string | null = null;
      if (user) {
        try {
          execId = await createExecutionLog(user.uid, {
            transcript: `${cleanGoal} (${cleanUrl})`,
            intent: 'browser_automation',
            targetUrl: cleanUrl,
            stepsCount: 1,
            summary: `Autonomous Web Agent: ${cleanGoal}`,
            runtime: runtimeInfo.runtime,
          });
        } catch {
          // continue smoothly
        }
      }

      try {
        const res = await fetch(`${getApiOrigin()}/api/automation/agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...aiRequestHeaders(aiSettingsRef.current) },
          body: JSON.stringify({ goal: cleanGoal, startUrl: cleanUrl, maxSteps: 4, deepThinking }),
        });
        const data = await parseJsonSafely<
          AutonomousWebAgentResult & {
            engine?: 'playwright' | 'http-dom';
            playwrightAvailable?: boolean;
            screenshotBase64?: string | null;
            error?: string;
          }
        >(res);
        if (!res.ok || !data) {
          throw new Error(
            data?.error ||
              (data
                ? `HTTP ${res.status} autonomous agent failed`
                : 'Autonomous web agent requires a connected Shadow server (set Shadow Server URL in AI Keys).')
          );
        }

        const resolvedStatus = data.ok ? 'completed' : 'failed';
        setAutomationRun({
          id: runId,
          goal: data.goal || cleanGoal,
          targetUrl: data.finalUrl || cleanUrl,
          engine: data.engine,
          playwrightAvailable: data.playwrightAvailable,
          screenshotBase64: data.screenshotBase64 ?? null,
          status: resolvedStatus,
          steps: Array.isArray(data.steps) ? data.steps : [],
          inspection: data.inspection ?? null,
          extractedItems: Array.isArray(data.extractedItems) ? data.extractedItems : [],
          submissionResult: data.submissionResult ?? null,
          agentIterations: Array.isArray(data.iterations) ? data.iterations : [],
          agentAnswer: data.answer,
          totalDurationMs: data.totalDurationMs,
          startedAt: Date.now(),
        });

        if (execId && user) {
          try {
            await finalizeExecutionLog(execId, {
              status: resolvedStatus,
              stepsCount: Math.max(1, data.iterations?.length || data.steps?.length || 1),
              summary: (data.answer || cleanGoal).slice(0, 900),
              targetUrl: data.finalUrl || cleanUrl,
            });
          } catch {
            // ignore
          }
        }

        if (data.answer) {
          appendDialogueEntry({
            speaker: 'shadow',
            text: data.answer,
            actionTag: 'autonomous-agent',
          });
          void handleSpeakText(data.answer);
        }
        finishCommandCue(
          'automation',
          data.ok
            ? `Agent finished (${data.iterations?.length || 1} iterations)`
            : 'Agent finished with issues',
          data.ok
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Autonomous web agent failed';
        setVoiceError(msg);
        reportExceptionError('Autonomous Agent', err, msg, { endpoint: '/api/automation/agent' });
        setAutomationRun((prev) =>
          prev && prev.id === runId
            ? {
                ...prev,
                status: 'failed',
                agentAnswer: msg,
                steps: prev.steps.map((s) => ({ ...s, status: 'failed', detail: msg })),
              }
            : prev
        );
        if (execId && user) {
          void finalizeExecutionLog(execId, {
            status: 'failed',
            stepsCount: 1,
            summary: msg.slice(0, 900),
            targetUrl: cleanUrl,
          }).catch(() => null);
        }
        finishCommandCue('automation', 'Autonomous agent failed', false);
      } finally {
        setIsAutomating(false);
      }
    },
    [
      user,
      runtimeInfo.runtime,
      deepThinking,
      isToolPermitted,
      beginCommandCue,
      finishCommandCue,
      showTransientCaption,
      appendDialogueEntry,
      handleSpeakText,
    ]
  );

  const handleArrangeWindowsViaBrowserAutomation = useCallback(
    async ({
      layout,
      apps,
      gap,
    }: {
      layout: WindowLayoutMode;
      apps: string[];
      gap: number;
    }) => {
      if (!isToolPermitted('execute_browser_automation')) {
        const msg = 'Browser Automation permission is disabled in Laptop Setup.';
        setVoiceError(msg);
        reportShadowError({ source: 'Window Layout', message: msg, statusCode: 403 });
        return;
      }
      const layoutLabel =
        layout === 'side-by-side'
          ? 'Side-by-Side'
          : layout === 'focus-split'
            ? 'Focus + Stack'
            : 'Grid';
      const steps: AutomationStep[] = [
        {
          action: 'arrange_windows',
          selector: layout,
          value: apps.join(', '),
          description: `Arrange ${apps.length > 0 ? apps.join(', ') : 'open windows'} into ${layoutLabel} layout (${gap}px gap)`,
        },
      ];
      const goal = `Arrange ${apps.length || 'open'} laptop windows (${layoutLabel})`;
      const inspection = buildWindowLayoutInspection(layout, apps, steps);
      beginCommandCue('automation', `Arranging windows (${layout})`);
      try {
        await runAutomationSequence(
          goal,
          'desktop://window-layout',
          steps,
          inspection,
          `Arrange ${apps.join(', ') || 'open windows'} into ${layoutLabel} layout`,
          { gap }
        );
        finishCommandCue('automation', `Arranged windows (${layoutLabel})`, true);
      } catch (err) {
        finishCommandCue('automation', 'Window arrangement failed', false);
        const msg = err instanceof Error ? err.message : 'Unable to arrange windows.';
        setVoiceError(msg);
        reportExceptionError('Window Layout', err, msg, { endpoint: '/api/automation/execute' });
      }
    },
    [isToolPermitted, beginCommandCue, finishCommandCue, runAutomationSequence]
  );


  const refreshBriefs = useCallback(async () => {
    try {
      const origin = getApiOrigin();
      const [todayRes, historyRes] = await Promise.all([
        fetch(`${origin}/api/brief/today`),
        fetch(`${origin}/api/brief/history?limit=20`),
      ]);
      if (todayRes.ok) {
        const data = await parseJsonSafely<{
          brief?: MorningBrief | null;
          config?: MorningBriefConfig;
        }>(todayRes);
        if (data?.brief !== undefined) setBriefToday(data.brief ?? null);
        if (data?.config) setBriefConfig(data.config);
      }
      if (historyRes.ok) {
        const data = await parseJsonSafely<{ briefs?: MorningBrief[] }>(historyRes);
        if (data && Array.isArray(data.briefs)) setBriefHistory(data.briefs);
      }
    } catch {
      // briefs are optional; ignore fetch failures silently
    }
  }, []);

  useEffect(() => {
    void refreshBriefs();
    const timer = window.setInterval(() => void refreshBriefs(), 120_000);
    return () => window.clearInterval(timer);
  }, [refreshBriefs]);

  const markBriefSeen = useCallback((date: string) => {
    setBriefSeenDate(date);
    saveBriefSeenDate(date);
  }, []);

  // Opening the Brief stage acknowledges today's brief.
  useEffect(() => {
    if (activeDrawer === 'brief' && briefToday && briefSeenDate !== briefToday.date) {
      markBriefSeen(briefToday.date);
    }
  }, [activeDrawer, briefToday, briefSeenDate, markBriefSeen]);

  const handleRunBrief = useCallback(async () => {
    if (isBriefRunning) return;
    setIsBriefRunning(true);
    setVoiceError(null);
    beginCommandCue('research', 'Compiling morning brief');
    try {
      const wsToken = getWorkspaceAccessToken();
      const res = await fetch(`${getApiOrigin()}/api/brief/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...aiRequestHeaders(aiSettingsRef.current),
          ...(wsToken ? { Authorization: `Bearer ${wsToken}` } : {}),
        },
        body: JSON.stringify({ voiceName, tasks: tasksRef.current.slice(0, 30) }),
      });
      const data = await parseJsonSafely<{ brief?: MorningBrief; error?: string }>(res);
      if (!res.ok || !data) throw new Error(data?.error || 'Morning Brief requires a connected Shadow server.');
      if (data.brief) {
        setBriefToday(data.brief);
        markBriefSeen(data.brief.date);
        showTransientCaption(assistantNameRef.current, data.brief.headline, 6000);
      }
      finishCommandCue('research', 'Morning brief ready', true);
      void refreshBriefs();
    } catch (err) {
      finishCommandCue('research', 'Morning brief failed', false);
      const msg = err instanceof Error ? err.message : 'Morning Brief failed';
      setVoiceError(msg);
      reportExceptionError('Morning Brief', err, msg, { endpoint: '/api/brief/run' });
    } finally {
      setIsBriefRunning(false);
    }
  }, [
    isBriefRunning,
    voiceName,
    beginCommandCue,
    finishCommandCue,
    markBriefSeen,
    refreshBriefs,
    showTransientCaption,
  ]);

  const handleSaveBriefConfig = useCallback(async (next: MorningBriefConfig) => {
    try {
      const res = await fetch(`${getApiOrigin()}/api/brief/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const data = await parseJsonSafely<{ config?: MorningBriefConfig; error?: string }>(res);
      if (!res.ok || !data?.config) throw new Error(data?.error || 'Could not save brief settings');
      setBriefConfig(data.config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save brief settings';
      setVoiceError(msg);
      reportExceptionError('Morning Brief', err, msg, { endpoint: '/api/brief/config' });
    }
  }, []);

  const executeConfirmedWorkspaceAction = useCallback(async () => {
    const action = pendingWorkspaceAction;
    if (!action || workspaceConfirmBusy) return;
    const token = getWorkspaceAccessToken();
    if (!token) {
      const msg = 'Google Workspace session expired. Reconnect inside Workspace.';
      setVoiceError(msg);
      reportShadowError({ source: 'Google Workspace', message: msg, statusCode: 401 });
      setPendingWorkspaceAction(null);
      setActiveDrawer('workspace');
      return;
    }

    setWorkspaceConfirmBusy(true);
    setVoiceError(null);
    try {
      const origin = getApiOrigin();
      let res: Response;
      if (action.service === 'gmail' && action.action === 'send') {
        res = await fetch(`${origin}/api/workspace/gmail/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(action.payload),
        });
      } else if (action.service === 'calendar' && action.action === 'create_event') {
        res = await fetch(`${origin}/api/workspace/calendar/events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(action.payload),
        });
      } else if (action.service === 'calendar' && action.action === 'delete_event') {
        const eventId = String(action.payload.eventId || '');
        res = await fetch(`${origin}/api/workspace/calendar/events/${encodeURIComponent(eventId)}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      } else {
        throw new Error('Unsupported Workspace action.');
      }

      const data = await parseJsonSafely<{ ok?: boolean; needsReauth?: boolean; error?: string }>(res);
      if (data?.needsReauth || res.status === 401) {
        clearWorkspaceAccessToken();
        throw new Error('Google Workspace authorization expired. Please reconnect Workspace.');
      }
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `Workspace action failed (${res.status})`);
      }

      setPendingWorkspaceAction(null);
      const confirmationText =
        action.action === 'send'
          ? 'Email sent.'
          : action.action === 'create_event'
            ? 'Calendar event created.'
            : 'Calendar event deleted.';
      showTransientCaption(assistantNameRef.current, confirmationText, 4500);
      void handleSpeakText(confirmationText);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Workspace action failed.';
      setVoiceError(msg);
      reportExceptionError('Google Workspace', err, msg, { endpoint: '/api/workspace' });
    } finally {
      setWorkspaceConfirmBusy(false);
    }
  }, [pendingWorkspaceAction, workspaceConfirmBusy, showTransientCaption, handleSpeakText]);

  const handleRunResearch = useCallback(
    async (query: string, depth: 'quick' | 'deep', urls: string[]) => {
      if (!isToolPermitted('research_topic')) {
        const msg = 'Deep Research permission is disabled in Laptop Setup.';
        setVoiceError(msg);
        reportShadowError({ source: 'Deep Research', message: msg, statusCode: 403 });
        return;
      }
      const clean = query.trim();
      if (!clean) return;
      setVoiceError(null);
      setIsResearching(true);
      setActiveDrawer('research');
      showTransientCaption('You', `Research: ${clean}`, 4500);
      beginCommandCue('research', `Researching: ${clean.slice(0, 44)}`);

      try {
        const res = await fetch(`${getApiOrigin()}/api/research/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...aiRequestHeaders(aiSettingsRef.current) },
          body: JSON.stringify({ query: clean, depth, urls, voiceName, speak: false }),
        });
        const data = await parseJsonSafely<{
          report?: ResearchReport;
          audioBase64?: string | null;
          error?: string;
        }>(res);
        if (!res.ok || !data?.report) {
          throw new Error(
            data?.error ||
              (data
                ? 'Research request failed'
                : 'Deep research requires a connected Shadow server (set Shadow Server URL in AI Keys).')
          );
        }
        await handleToolAction(
          'research_topic',
          { query: clean, depth, urls },
          { ok: true, report: data.report },
          clean
        );
        finishCommandCue('research', `Briefing ready (${data.report.sources.length} sources)`, true);
        if (data.report.spokenSummary) {
          showTransientCaption(assistantNameRef.current, data.report.spokenSummary, 7000);
          if (data.audioBase64) {
            void playerRef.current.playWavBase64(data.audioBase64);
          } else {
            void handleSpeakText(data.report.spokenSummary);
          }
        }
      } catch (err) {
        finishCommandCue('research', 'Research failed', false);
        const msg = err instanceof Error ? err.message : 'Unable to complete research.';
        setVoiceError(msg);
        reportExceptionError('Deep Research', err, msg, { endpoint: '/api/research/run' });
      } finally {
        setIsResearching(false);
      }
    },
    [
      voiceName,
      showTransientCaption,
      handleToolAction,
      handleSpeakText,
      isToolPermitted,
      beginCommandCue,
      finishCommandCue,
    ]
  );

  const handleGenerateVisual = useCallback(
    async (input: {
      prompt: string;
      style: VisualStyle;
      aspectRatio: VisualAspectRatio;
      refineFromSvg?: string;
    }) => {
      const clean = input.prompt.trim();
      if (!clean) return;
      setVoiceError(null);
      setIsGeneratingVisual(true);
      setActiveDrawer('visuals');
      showTransientCaption('You', `Visual: ${clean}`, 4500);
      beginCommandCue('visuals', `Creating visual: ${clean.slice(0, 40)}`);

      try {
        const res = await fetch(`${getApiOrigin()}/api/visuals/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...aiRequestHeaders(aiSettingsRef.current) },
          body: JSON.stringify({
            prompt: clean,
            style: input.style,
            aspectRatio: input.aspectRatio,
            refineFromSvg: input.refineFromSvg,
            voiceName,
            speak: false,
          }),
        });
        const data = await parseJsonSafely<{
          ok?: boolean;
          visual?: GeneratedVisual;
          audioBase64?: string | null;
          error?: string;
        }>(res);
        if (!res.ok || !data?.visual) {
          throw new Error(
            data?.error ||
              (data
                ? 'Visual generation failed'
                : 'Visual generation requires a connected Shadow server (set Shadow Server URL in AI Keys).')
          );
        }
        await handleToolAction(
          'generate_visual',
          { prompt: clean, style: input.style, aspectRatio: input.aspectRatio },
          { ok: true, visual: data.visual },
          clean
        );
        finishCommandCue('visuals', `Visual ready: ${data.visual.title.slice(0, 36)}`, true);
        if (data.visual.summary) {
          showTransientCaption(assistantNameRef.current, data.visual.summary, 6500);
          if (data.audioBase64) {
            void playerRef.current.playWavBase64(data.audioBase64);
          } else {
            void handleSpeakText(data.visual.summary);
          }
        }
      } catch (err) {
        finishCommandCue('visuals', 'Visual generation failed', false);
        const msg = err instanceof Error ? err.message : 'Unable to generate visual.';
        setVoiceError(msg);
        reportExceptionError('Visual Studio', err, msg, { endpoint: '/api/visuals/generate' });
      } finally {
        setIsGeneratingVisual(false);
      }
    },
    [
      voiceName,
      showTransientCaption,
      beginCommandCue,
      finishCommandCue,
      handleToolAction,
      handleSpeakText,
    ]
  );

  const handleSignIn = async () => {
    setAuthError(null);

    if (runtimeInfo.isTauri) {
      try {
        await ensureDesktopBackendServer();
        const apiOrigin = getApiOrigin();
        const startRes = await fetch(`${apiOrigin}/api/desktop-auth/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const startData = await parseJsonSafely<{ ok?: boolean; nonce?: string; error?: string }>(startRes);
        if (!startRes.ok || !startData?.nonce) {
          throw new Error(startData?.error || 'Local Shadow server is unavailable for Sign-In.');
        }

        const nonce = startData.nonce;
        const authUrl = `http://localhost:3000/?desktopAuth=${encodeURIComponent(nonce)}`;
        const opened = await invokeDesktopOpenUrl(authUrl);
        if (!opened) {
          throw new Error('Could not open your system browser for Google Sign-In.');
        }

        showTransientCaption(assistantNameRef.current, 'Finish Google Sign-In in your browser...', 6000);

        if (desktopAuthPollRef.current) {
          window.clearInterval(desktopAuthPollRef.current);
          desktopAuthPollRef.current = null;
        }

        const startedAt = Date.now();
        desktopAuthPollRef.current = window.setInterval(async () => {
          if (Date.now() - startedAt > 150000) {
            if (desktopAuthPollRef.current) {
              window.clearInterval(desktopAuthPollRef.current);
              desktopAuthPollRef.current = null;
            }
            setAuthError('Google Sign-In timed out. Click Sign In to try again.');
            return;
          }
          try {
            const pollRes = await fetch(`${apiOrigin}/api/desktop-auth/session/${encodeURIComponent(nonce)}`);
            if (pollRes.status === 404) {
              if (desktopAuthPollRef.current) {
                window.clearInterval(desktopAuthPollRef.current);
                desktopAuthPollRef.current = null;
              }
              return;
            }
            const pollData = await parseJsonSafely<{
              status?: string;
              idToken?: string | null;
              accessToken?: string | null;
            }>(pollRes);
            if (pollData?.status === 'completed') {
              if (desktopAuthPollRef.current) {
                window.clearInterval(desktopAuthPollRef.current);
                desktopAuthPollRef.current = null;
              }
              const cred = GoogleAuthProvider.credential(
                pollData.idToken ?? null,
                pollData.accessToken ?? null
              );
              await signInWithCredential(auth, cred);
              if (pollData.accessToken) {
                setWorkspaceAccessToken(pollData.accessToken);
              }
              showTransientCaption(assistantNameRef.current, 'Signed in with Google.', 3500);
            }
          } catch {
            // Transient poll error; keep polling until timeout
          }
        }, 1200);
        return;
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Desktop Google Sign-In failed.');
        return;
      }
    }

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const cred = GoogleAuthProvider.credentialFromResult(result);
      if (cred?.accessToken) {
        setWorkspaceAccessToken(cred.accessToken);
      }
    } catch (err) {
      const code =
        typeof err === 'object' && err && 'code' in err ? String((err as { code?: string }).code) : '';
      if (code === 'auth/popup-blocked') {
        const inIframe = typeof window !== 'undefined' && window.self !== window.top;
        if (!inIframe) {
          try {
            await signInWithRedirect(auth, googleProvider);
            return;
          } catch (redirectErr) {
            const msg =
              redirectErr instanceof Error ? redirectErr.message : 'Google Sign-In failed.';
            setAuthError(msg);
            reportExceptionError('Firebase Auth Redirect', redirectErr, msg);
            return;
          }
        }
        const blockedMsg =
          'Popup was blocked by your browser (auth/popup-blocked). Allow popups for this tab and try Sign In again.';
        setAuthError(blockedMsg);
        reportExceptionError('Firebase Auth Popup', err, blockedMsg);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Google Sign-In failed';
      setAuthError(msg);
      reportExceptionError('Firebase Auth', err, msg);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const handleVoiceChange = async (next: VoiceName) => {
    setVoiceName(next);
    if (user) await updateUserPreferences(user.uid, { voiceName: next });
    if (isConnectedRef.current) stopVoiceSession();
  };

  const handleWakeModeChange = async (mode: WakeMode) => {
    setWakeMode(mode);
    if (user) await updateUserPreferences(user.uid, { wakeMode: mode });
  };

  const handleToggleClapWake = async (enabled: boolean) => {
    const nextConfig: SetupConfig = {
      ...setupConfig,
      clapWakeEnabled: enabled,
    };
    setSetupConfig(nextConfig);
    saveLocalSetupConfig(nextConfig);
    if (user) {
      await updateUserPreferences(user.uid, { clapWakeEnabled: enabled });
    }
  };

  const handleTestRunPlugin = useCallback(
    async (
      plugin: ShadowPlugin,
      args: Record<string, unknown>
    ): Promise<PluginExecutionResult> => {
      const started = Date.now();
      beginCommandCue('plugin', `Plugin: ${plugin.name}`);
      const res = await fetch(`${getApiOrigin()}/api/plugins/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plugin, args }),
      });
      const data = await parseJsonSafely<PluginExecutionResult>(res);
      if (!data) {
        finishCommandCue('plugin', 'Shadow server required', false);
        return {
          ok: false,
          pluginId: plugin.id,
          pluginName: plugin.name,
          toolName: plugin.toolName,
          kind: plugin.kind,
          latencyMs: Date.now() - started,
          error: 'Plugin execution requires a connected Shadow server (set Shadow Server URL in AI Keys).',
        };
      }
      if (data.requiresClientExecution && data.renderedCommand) {
        const laptopRes = await runDirectLaptopTool('execute_terminal_command', {
          command: data.renderedCommand,
          background: false,
        });
        const laptopObj = laptopRes as Record<string, unknown>;
        const ok = Boolean(laptopObj.ok);
        const execResult: PluginExecutionResult = {
          ok,
          pluginId: plugin.id,
          pluginName: plugin.name,
          toolName: plugin.toolName,
          kind: plugin.kind,
          latencyMs: Date.now() - started,
          stdout:
            typeof laptopObj.stdout === 'string' && laptopObj.stdout
              ? laptopObj.stdout
              : typeof laptopObj.stderr === 'string'
                ? laptopObj.stderr
                : undefined,
          summary: ok
            ? `Executed "${data.renderedCommand}" on laptop.`
            : String(laptopObj.error || 'Laptop command failed.'),
          error: ok ? undefined : String(laptopObj.error || 'Command failed'),
        };
        await recordPluginExecution(plugin, plugin.toolName, ok, execResult.summary || plugin.name, {
          latencyMs: execResult.latencyMs,
          transcript: `Test Run: ${plugin.name}`,
        });
        finishCommandCue('plugin', `Plugin: ${plugin.name}`, ok);
        return execResult;
      }

      await recordPluginExecution(
        plugin,
        plugin.toolName,
        Boolean(data.ok),
        data.summary || (data.ok ? `${plugin.name} succeeded.` : data.error || 'Failed'),
        {
          latencyMs: data.latencyMs,
          statusCode: data.statusCode,
          targetUrl: plugin.endpointUrl,
          transcript: `Test Run: ${plugin.name}`,
        }
      );
      finishCommandCue('plugin', `Plugin: ${plugin.name}`, Boolean(data.ok));
      return data;
    },
    [runDirectLaptopTool, recordPluginExecution, beginCommandCue, finishCommandCue]
  );

  // Compute 3D Arc Reactor visual mode
  const reactorMode: ReactorMode = useMemo(() => {
    if (commandCue?.active) {
      if (commandCue.kind === 'research') return 'researching';
      if (commandCue.kind === 'visuals') return 'visuals';
      if (commandCue.kind === 'automation') return 'automating';
      if (commandCue.kind === 'youtube') return 'media';
      if (commandCue.kind === 'laptop') return 'laptop';
      if (commandCue.kind === 'memory') return 'memory';
      if (commandCue.kind === 'plugin') return 'plugin';
    }
    if (isResearching) return 'researching';
    if (isGeneratingVisual) return 'visuals';
    if (isAutomating) return 'automating';
    if (isAssistantSpeaking) return 'speaking';
    if (isConnecting) return 'connecting';
    if (isConnected && !isMicMuted) return 'listening';
    if (currentTrack && activeDrawer === 'youtube') return 'media';
    return 'standby';
  }, [
    commandCue,
    isResearching,
    isGeneratingVisual,
    isAutomating,
    isAssistantSpeaking,
    isConnecting,
    isConnected,
    isMicMuted,
    currentTrack,
    activeDrawer,
  ]);

  const statusText = commandCue
    ? commandCue.label
    : reactorMode === 'connecting'
      ? 'Connecting Audio'
      : reactorMode === 'researching'
        ? 'Researching Live Sources'
        : reactorMode === 'visuals'
          ? 'Generating Visual Graphic'
          : reactorMode === 'laptop'
            ? 'Executing Laptop Command'
            : reactorMode === 'memory'
              ? 'Updating Long-Term Memory'
              : reactorMode === 'plugin'
                ? 'Running Plugin Connector'
                : reactorMode === 'speaking'
                  ? 'Speaking'
                  : reactorMode === 'listening'
                    ? 'Listening'
                    : reactorMode === 'automating'
                      ? 'Executing Browser Task'
                      : isConnected && isMicMuted
                        ? setupConfig.clapWakeEnabled
                          ? 'Microphone Muted · Clap twice to unmute'
                          : 'Microphone Muted'
                        : setupConfig.clapWakeEnabled
                          ? clapStatus === 'listening'
                            ? 'Clap twice or click Core to speak'
                            : clapStatus === 'needs-gesture'
                              ? 'Click anywhere once to arm Double-Clap Wake'
                              : 'Click Core or Press Speak'
                          : 'Click Core or Press Speak';

  const isAppActive =
    isConnected ||
    isConnecting ||
    isAssistantSpeaking ||
    isResearching ||
    isGeneratingVisual ||
    isAutomating ||
    Boolean(commandCue?.active);

  const networkTelemetry = useNetworkTelemetry(isAppActive);

  const briefPending = Boolean(
    briefToday && briefToday.date === todayKey() && briefSeenDate !== briefToday.date
  );

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#06090F] text-[#F3F4F6] select-none">
      {/* Full-Viewport Centered 3D Arc Reactor */}
      <div className="absolute inset-0 z-0">
        <ArcReactorScene
          mode={reactorMode}
          commandCue={commandCue}
          stageOverlayOpen={activeDrawer !== null}
          brightness={reactorBrightness}
          inputLevelRef={inputLevelRef}
          outputLevelRef={outputLevelRef}
          onCoreClick={() => {
            if (isConnected) stopVoiceSession();
            else void startVoiceSession(false);
          }}
        />
      </div>

      {/* Minimal Top Bar Corners (Top Center Reserved for Mac Dynamic Island) */}
      <header className="relative z-20 px-4 sm:px-6 pt-14 pb-2 sm:py-4 flex items-center justify-between gap-8 pointer-events-none">
        <motion.button
          type="button"
          whileHover={prefersReduced ? undefined : { scale: 1.03 }}
          whileTap={prefersReduced ? undefined : { scale: 0.96 }}
          transition={MAC_SPRING_CONTROL}
          onClick={() => setActiveDrawer(null)}
          className="pointer-events-auto font-[family-name:var(--font-display)] text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 hover:text-sky-300 transition-colors cursor-pointer"
        >
          {assistantName}
        </motion.button>

        <div className="pointer-events-auto flex items-center gap-2 shrink-0">
          {!networkTelemetry.isOnline && (
            <span className="px-2.5 py-1 rounded-lg border border-rose-400/35 bg-rose-500/15 text-[11px] font-medium text-rose-200 whitespace-nowrap shrink-0">
              Offline
            </span>
          )}

          <PWAInstallButton />

          {shadowErrors.length > 0 && (
            <motion.button
              type="button"
              whileHover={prefersReduced ? undefined : { scale: 1.03 }}
              whileTap={prefersReduced ? undefined : { scale: 0.96 }}
              transition={MAC_SPRING_CONTROL}
              onClick={() => setErrorInspectorOpen(true)}
              title="Inspect recorded error details"
              className="px-3 py-1.5 rounded-lg border border-rose-400/45 bg-rose-500/18 backdrop-blur-2xl backdrop-saturate-150 text-xs font-medium text-rose-100 hover:bg-rose-500/28 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-rose-300" />
              <span className="tabular-nums">Errors ({shadowErrors.length})</span>
            </motion.button>
          )}

          <motion.button
            type="button"
            whileHover={prefersReduced ? undefined : { scale: 1.03 }}
            whileTap={prefersReduced ? undefined : { scale: 0.96 }}
            transition={MAC_SPRING_CONTROL}
            onClick={() => setAiSettingsOpen(true)}
            title="Configure OpenRouter or Gemini API Key"
            className="px-3 py-1.5 rounded-lg border border-white/16 bg-white/[0.06] backdrop-blur-2xl backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] text-xs font-medium text-slate-200 hover:bg-white/[0.12] hover:border-sky-400/45 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Cpu className="w-3.5 h-3.5 text-sky-400" />
            <span>
              {aiSettings.provider === 'openrouter'
                ? 'OpenRouter'
                : aiSettings.provider === 'gemini'
                  ? 'Gemini'
                  : 'AI Keys'}
            </span>
          </motion.button>

          {!authReady ? (
            <span className="text-xs text-slate-500 whitespace-nowrap shrink-0">Connecting</span>
          ) : user ? (
            <motion.button
              type="button"
              whileHover={prefersReduced ? undefined : { scale: 1.03 }}
              whileTap={prefersReduced ? undefined : { scale: 0.96 }}
              transition={MAC_SPRING_CONTROL}
              onClick={handleSignOut}
              className="px-3.5 py-1.5 rounded-lg border border-white/16 bg-white/[0.06] backdrop-blur-2xl backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] text-xs font-medium text-slate-200 hover:bg-white/[0.12] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5 text-slate-400" />
              <span className="max-w-[130px] truncate">{user.displayName || user.email}</span>
            </motion.button>
          ) : (
            <motion.button
              type="button"
              whileHover={prefersReduced ? undefined : { scale: 1.03 }}
              whileTap={prefersReduced ? undefined : { scale: 0.96 }}
              transition={MAC_SPRING_CONTROL}
              onClick={handleSignIn}
              className="px-4 py-1.5 rounded-lg bg-gradient-to-b from-sky-400 to-sky-500 text-slate-950 text-xs font-semibold shadow-[0_6px_18px_rgba(56,189,248,0.35),inset_0_1px_0_rgba(255,255,255,0.45)] hover:brightness-110 transition-all inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </motion.button>
          )}
        </div>
      </header>

      {/* Mac-Style Dynamic Island (Top Center Live Activity & Control Notch) */}
      <DynamicIsland
        assistantName={assistantName}
        mode={reactorMode}
        commandCue={commandCue}
        statusText={statusText}
        isConnected={isConnected}
        isConnecting={isConnecting}
        isMicMuted={isMicMuted}
        isAssistantSpeaking={isAssistantSpeaking}
        isResearching={isResearching}
        isGeneratingVisual={isGeneratingVisual}
        isAutomating={isAutomating}
        briefPending={briefPending}
        currentTrack={currentTrack}
        activeDrawer={activeDrawer}
        aiProviderLabel={
          aiSettings.provider === 'openrouter'
            ? 'OpenRouter BYOK'
            : aiSettings.provider === 'gemini'
              ? 'Gemini BYOK'
              : 'Server Default'
        }
        hasActivePlugins={plugins.some((p) => p.enabled)}
        networkTelemetry={networkTelemetry}
        faceAuthLockAvailable={Boolean(faceAuthProfile && setupConfig.faceAuthEnabled)}
        visionMode={vision.visionMode}
        visionStream={vision.stream}
        deepThinking={deepThinking}
        dialogueHistory={dialogueHistory}
        timerControlEvent={timerControlEvent}
        mediaQueue={mediaQueue}
        currentResearch={currentResearch}
        currentVisual={currentVisual}
        voiceName={voiceName}
        voices={VOICES}
        reactorBrightness={reactorBrightness}
        errorMessage={voiceError || authError}
        errors={shadowErrors}
        inputLevelRef={inputLevelRef}
        outputLevelRef={outputLevelRef}
        onToggleVoiceSession={() => {
          if (isConnected) stopVoiceSession();
          else void startVoiceSession(false);
        }}
        onToggleMute={() => {
          const next = !isMicMutedRef.current;
          isMicMutedRef.current = next;
          setIsMicMuted(next);
        }}
        onInterruptSpeech={() => playerRef.current.clear()}
        onVoiceChange={(next) => void handleVoiceChange(next)}
        onChangeVisionMode={handleChangeVisionMode}
        onToggleDeepThinking={setDeepThinking}
        onClearDialogue={() => setDialogueHistory([])}
        onTimerComplete={(label) => {
          const msg = `${label} complete.`;
          showTransientCaption(assistantName, msg, 7000);
          void handleSpeakText(msg);
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try {
              new Notification(`${assistantName} · ${label}`, { body: msg });
            } catch {
              // ignore notification blocks
            }
          }
        }}
        onShelfChange={setShelfWorkspaceItems}
        onChangeReactorBrightness={setReactorBrightness}
        onSelectDrawer={setActiveDrawer}
        onSelectTrack={(track) => {
          setCurrentTrack(track);
          if (user && track.id) void updateMediaQueueStatus(track.id, 'playing');
        }}
        onRunCommand={(cmd, attachment) => void runSpokenAction(cmd, attachment)}
        onOpenAiSettings={() => setAiSettingsOpen(true)}
        onOpenSetup={() => setSetupOpen(true)}
        onOpenErrorInspector={() => setErrorInspectorOpen(true)}
        onLockWithFace={() => {
          stopVoiceSession();
          setIsFaceUnlocked(false);
        }}
        onDismissError={() => {
          setVoiceError(null);
          setAuthError(null);
        }}
      />

      {/* Live Spoken Caption Only (No Chatbox, No Input Form) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-32 z-10 flex flex-col items-center px-6 text-center">
        <AnimatePresence mode="wait">
          {liveCaption ? (
            <motion.div
              key={liveCaption.text}
              initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.94, filter: 'blur(6px)' }}
              animate={prefersReduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
              exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.96, filter: 'blur(4px)' }}
              transition={MAC_SPRING_WINDOW}
              className="max-w-xl px-5 py-2.5 rounded-2xl bg-[#0B1222]/58 backdrop-blur-3xl backdrop-saturate-150 border border-white/18 shadow-[0_20px_54px_rgba(0,0,0,0.62),inset_0_1px_0_rgba(255,255,255,0.22)]"
            >
              <p className="text-[11px] font-medium text-sky-400 mb-0.5">{liveCaption.speaker}</p>
              <p className="text-sm text-slate-100 leading-snug line-clamp-2">{liveCaption.text}</p>
            </motion.div>
          ) : (
            <motion.div
              key={statusText}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="inline-flex items-center gap-2 text-xs tracking-wide text-slate-400"
            >
              <span>{statusText}</span>
              {currentTrack && activeDrawer !== 'youtube' && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="text-sky-300">Playing: {currentTrack.title}</span>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* macOS Vibrancy Glass Window Stage Overlay */}
      <AnimatePresence>
        {activeDrawer && activeDrawer !== 'youtube' && (
          <motion.div
            key={activeDrawer}
            layout
            initial={
              prefersReduced
                ? { opacity: 0 }
                : { opacity: 0, y: 68, scale: 0.86, filter: 'blur(8px)' }
            }
            animate={
              prefersReduced
                ? { opacity: 1 }
                : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }
            }
            exit={
              prefersReduced
                ? { opacity: 0 }
                : { opacity: 0, y: 74, scale: 0.84, filter: 'blur(8px)' }
            }
            transition={prefersReduced ? { duration: 0.01 } : MAC_SPRING_WINDOW}
            className={`absolute z-30 flex flex-col origin-bottom ${
              windowMaximized
                ? 'inset-x-3 md:inset-x-4 top-16 bottom-26'
                : 'inset-x-4 md:inset-x-10 top-16 bottom-28 max-w-6xl mx-auto'
            }`}
          >
            <MacWindowFrame
              title={
                activeDrawer === 'brief'
                  ? 'Morning Brief'
                  : activeDrawer === 'research'
                    ? 'Research'
                    : activeDrawer === 'visuals'
                      ? 'Visuals'
                      : activeDrawer === 'automation'
                        ? 'Browser Automation'
                        : activeDrawer === 'workspace'
                          ? 'Workspace & Tasks'
                          : activeDrawer === 'meetings'
                            ? 'Meeting Companion'
                            : activeDrawer === 'vault'
                              ? 'Knowledge Vault & GitHub'
                              : activeDrawer === 'triggers'
                                ? 'Remote & Proactive Triggers'
                                : activeDrawer === 'macros'
                                  ? 'Memory & Macros'
                                  : activeDrawer === 'plugins'
                                    ? 'Plugins'
                                    : 'Desktop App'
              }
              subtitle={
                activeDrawer === 'brief'
                  ? 'Your Daily Intelligence Digest'
                  : activeDrawer === 'research'
                    ? 'Grounded Web Intelligence'
                    : activeDrawer === 'visuals'
                      ? 'Diagrams, Charts & Vector Studio'
                      : activeDrawer === 'automation'
                        ? 'Playwright & DOM Action Engine'
                        : activeDrawer === 'workspace'
                          ? 'Gmail · Calendar · Drive · Reminders'
                          : activeDrawer === 'meetings'
                            ? 'Live Transcription, Notes & Action Items'
                            : activeDrawer === 'vault'
                              ? 'Semantic RAG Vault & DevOps Cockpit'
                              : activeDrawer === 'triggers'
                                ? 'Cloud Run · Webhooks · Messaging Bridges'
                                : activeDrawer === 'macros'
                                  ? `${assistantName} Long-Term Context`
                                  : activeDrawer === 'plugins'
                                    ? 'Live API & CLI Extensions'
                                    : 'Laptop Agent & Terminal'
              }
              icon={
                activeDrawer === 'brief' ? (
                  <Sunrise className="w-3.5 h-3.5 text-orange-300" />
                ) : activeDrawer === 'research' ? (
                  <Compass className="w-3.5 h-3.5 text-indigo-300" />
                ) : activeDrawer === 'visuals' ? (
                  <ImageIcon className="w-3.5 h-3.5 text-purple-300" />
                ) : activeDrawer === 'automation' ? (
                  <Globe className="w-3.5 h-3.5 text-sky-300" />
                ) : activeDrawer === 'workspace' ? (
                  <CalendarCheck2 className="w-3.5 h-3.5 text-cyan-300" />
                ) : activeDrawer === 'meetings' ? (
                  <AudioLines className="w-3.5 h-3.5 text-fuchsia-300" />
                ) : activeDrawer === 'vault' ? (
                  <BookOpen className="w-3.5 h-3.5 text-teal-300" />
                ) : activeDrawer === 'triggers' ? (
                  <Radio className="w-3.5 h-3.5 text-violet-300" />
                ) : activeDrawer === 'macros' ? (
                  <Layers className="w-3.5 h-3.5 text-amber-300" />
                ) : activeDrawer === 'plugins' ? (
                  <Blocks className="w-3.5 h-3.5 text-emerald-300" />
                ) : (
                  <Monitor className="w-3.5 h-3.5 text-slate-200" />
                )
              }
              isMaximized={windowMaximized}
              onClose={() => setActiveDrawer(null)}
              onMinimize={() => setActiveDrawer(null)}
              onToggleMaximize={() => setWindowMaximized((prev) => !prev)}
            >
              {activeDrawer === 'research' && (
                <ResearchStage
                  report={currentResearch}
                  history={researchHistory}
                  isResearching={isResearching}
                  onRunResearch={(q, depth, urls) => void handleRunResearch(q, depth, urls)}
                  onSelectReport={(rep) => setCurrentResearch(rep)}
                  onDeleteReport={(rep) => {
                    if (user && rep.id) {
                      void deleteResearchReport(rep.id);
                    } else {
                      setLocalResearchHistory((prev) => prev.filter((r) => r.id !== rep.id));
                    }
                    if (currentResearch?.id === rep.id) {
                      setCurrentResearch(null);
                    }
                  }}
                  onSpeakBrief={(text) => void handleSpeakText(text)}
                  onInspectSourceUrl={(url) => void handleInspectUrl(url)}
                />
              )}

              {activeDrawer === 'brief' && (
                <MorningBriefStage
                  brief={briefToday}
                  history={briefHistory}
                  config={briefConfig}
                  voices={VOICES}
                  isRunning={isBriefRunning}
                  onRunNow={() => void handleRunBrief()}
                  onSaveConfig={(next) => void handleSaveBriefConfig(next)}
                  onSpeak={(text) => void handleSpeakText(text)}
                />
              )}

              {activeDrawer === 'visuals' && (
                <VisualsStage
                  visual={currentVisual}
                  history={visuals}
                  isGenerating={isGeneratingVisual}
                  onGenerateVisual={handleGenerateVisual}
                  onSelectVisual={(v) => setCurrentVisual(v)}
                  onDeleteVisual={(v) => {
                    setVisuals((prev) => {
                      const next = prev.filter((item) => item.id !== v.id);
                      saveLocalVisuals(next);
                      return next;
                    });
                    setCurrentVisual((prev) => (prev?.id === v.id ? null : prev));
                  }}
                />
              )}

              {activeDrawer === 'automation' && (
                <BrowserAutomationStage
                  run={automationRun}
                  runtime={runtimeInfo.runtime}
                  isAutomating={isAutomating}
                  onInspectUrl={(url) => void handleInspectUrl(url)}
                  onRunQuickDemo={(cmd) => void runSpokenAction(cmd)}
                  onRunAutonomousAgent={(goal, url) => void handleRunAutonomousAgent(goal, url)}
                  onExecutePlan={(plan) => void handleExecuteAutomationPlan(plan)}
                  onClearRun={() => setAutomationRun(null)}
                  onSaveAsMacro={async (run) => {
                    if (!user) {
                      await handleSignIn();
                      return;
                    }
                    await createWorkflow(user.uid, {
                      name: run.goal.slice(0, 120),
                      voiceTrigger: run.goal.slice(0, 180),
                      targetUrl: run.targetUrl,
                      category: 'form-fill',
                      steps: run.steps.map(({ action, selector, value, description }) => ({
                        action,
                        selector,
                        value,
                        description,
                      })),
                    });
                    setActiveDrawer('macros');
                  }}
                />
              )}

              {activeDrawer === 'macros' && (
                <MacrosAndHistoryView
                  workflows={workflows}
                  executions={executions}
                  assistantName={assistantName}
                  memories={memories}
                  onAddMemory={(input) => handleAddMemoryRecord({ ...input, source: 'manual' })}
                  onToggleMemoryImportance={(mem) => handleToggleMemoryImportance(mem)}
                  onDeleteMemory={(id) => handleDeleteMemoryRecord(id)}
                  isAuthenticated={Boolean(user)}
                  onRequireAuth={() => void handleSignIn()}
                  onRunWorkflow={async (wf) => {
                    if (user) void incrementWorkflowRunCount(wf.id, wf.runCount);
                    await runAutomationSequence(
                      wf.name,
                      wf.targetUrl,
                      wf.steps,
                      null,
                      wf.voiceTrigger
                    );
                  }}
                  onDeleteWorkflow={(id) => void deleteWorkflow(id)}
                  onCreateWorkflow={(input) => {
                    if (!user) return;
                    void createWorkflow(user.uid, {
                      ...input,
                      steps: [
                        {
                          action: 'navigate',
                          selector: 'body',
                          value: input.targetUrl,
                          description: `Navigate to ${input.targetUrl}`,
                        },
                      ],
                    });
                  }}
                />
              )}

              {activeDrawer === 'plugins' && (
                <PluginsStage
                  plugins={plugins}
                  assistantName={assistantName}
                  recentLogs={pluginLogs}
                  onInstallPlugin={handleInstallPlugin}
                  onUpdatePlugin={handleUpdatePlugin}
                  onDeletePlugin={handleDeletePlugin}
                  onTestRunPlugin={handleTestRunPlugin}
                />
              )}

              {activeDrawer === 'workspace' && (
                <WorkspaceStage
                  tasks={tasks}
                  workspaceConnected={workspaceConnected}
                  aiSettings={aiSettings}
                  onConnectWorkspace={handleConnectWorkspace}
                  onCreateTask={handleCreateTask}
                  onToggleTask={handleToggleTask}
                  onDeleteTask={handleDeleteTask}
                  onRequestConfirmWorkspaceAction={(action) => setPendingWorkspaceAction(action)}
                  onSaveToVault={handleIngestToVault}
                  onSpeak={(text) => void handleSpeakText(text)}
                />
              )}

              {activeDrawer === 'meetings' && (
                <MeetingCompanionStage
                  meetings={meetings}
                  aiSettings={aiSettings}
                  onSaveMeeting={handleSaveMeeting}
                  onDeleteMeeting={handleDeleteMeeting}
                  onAddTask={handleCreateTask}
                  onSaveToVault={handleIngestToVault}
                  onSpeak={(text) => void handleSpeakText(text)}
                />
              )}

              {activeDrawer === 'vault' && (
                <KnowledgeVaultStage
                  ownerKey={user?.uid || 'local'}
                  aiSettings={aiSettings}
                  syncedMeta={vaultDocs}
                  onSaveVaultDocMeta={handleSaveVaultDocMeta}
                  onDeleteVaultDocMeta={handleDeleteVaultDocMeta}
                  onSpeak={(text) => void handleSpeakText(text)}
                />
              )}

              {activeDrawer === 'triggers' && <RemoteTriggersStage />}

              {activeDrawer === 'tauri' && (
                <TauriDesktopView
                  runtimeInfo={runtimeInfo}
                  agentHealth={agentHealth}
                  laptopActions={laptopActions}
                  setupConfig={setupConfig}
                  hasFaceEnrolled={Boolean(faceAuthProfile)}
                  onOpenSetup={() => setSetupOpen(true)}
                  onLockSession={() => {
                    stopVoiceSession();
                    setIsFaceUnlocked(false);
                  }}
                  onAgentStatusChanged={setAgentHealth}
                  onRunLaptopTool={async (toolName, args) => {
                    return await runDirectLaptopTool(toolName, args);
                  }}
                  onArrangeViaBrowserAutomation={handleArrangeWindowsViaBrowserAutomation}
                  onRunAutomationCommand={async (cmd) => {
                    await runSpokenAction(cmd);
                  }}
                />
              )}
            </MacWindowFrame>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Persistent YouTube Media Stage (keeps audio/video playing seamlessly when minimized to Dock) */}
      {(currentTrack || activeDrawer === 'youtube') && (
        <motion.div
          layout
          initial={false}
          animate={
            activeDrawer === 'youtube'
              ? prefersReduced
                ? { opacity: 1 }
                : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }
              : prefersReduced
                ? { opacity: 0 }
                : { opacity: 0, y: 74, scale: 0.84, filter: 'blur(8px)' }
          }
          transition={prefersReduced ? { duration: 0.01 } : MAC_SPRING_WINDOW}
          aria-hidden={activeDrawer !== 'youtube'}
          className={`absolute z-30 flex flex-col origin-bottom ${
            windowMaximized
              ? 'inset-x-3 md:inset-x-4 top-16 bottom-26'
              : 'inset-x-4 md:inset-x-10 top-16 bottom-28 max-w-6xl mx-auto'
          } ${activeDrawer === 'youtube' ? 'pointer-events-auto' : 'pointer-events-none'}`}
        >
          <MacWindowFrame
            title="YouTube Player"
            subtitle={currentTrack ? currentTrack.title : 'Audio & Video Stage'}
            icon={<Play className="w-3 h-3 text-rose-400 fill-current ml-0.5" />}
            isMaximized={windowMaximized}
            onClose={() => setActiveDrawer(null)}
            onMinimize={() => setActiveDrawer(null)}
            onToggleMaximize={() => setWindowMaximized((prev) => !prev)}
          >
            <YouTubeMediaStage
              currentTrack={currentTrack}
              queue={mediaQueue}
              pendingPlayerAction={pendingPlayerAction}
              onSearchAndPlay={(q, type) => void handleSearchAndPlayYouTube(q, type)}
              onSelectTrack={(track) => {
                setCurrentTrack(track);
                if (user && track.id) void updateMediaQueueStatus(track.id, 'playing');
              }}
              onRemoveTrack={(track) => {
                if (user && track.id) void deleteMediaQueueItem(track.id);
                else setLocalQueue((prev) => prev.filter((t) => t.videoId !== track.videoId));
              }}
            />
          </MacWindowFrame>
        </motion.div>
      )}

      {/* iOS-Style Floating Control Dock */}
      <IosControlDock
        assistantName={assistantName}
        faceAuthLockAvailable={Boolean(faceAuthProfile && setupConfig.faceAuthEnabled)}
        clapWakeEnabled={setupConfig.clapWakeEnabled}
        clapArmed={clapStatus === 'listening'}
        activeDrawer={activeDrawer}
        onSelectDrawer={setActiveDrawer}
        hudCollapsed={hudCollapsed}
        onToggleCollapse={setHudCollapsed}
        isConnected={isConnected}
        isConnecting={isConnecting}
        isMicMuted={isMicMuted}
        isAssistantSpeaking={isAssistantSpeaking}
        isResearching={isResearching}
        isAutomating={isAutomating}
        isGeneratingVisual={isGeneratingVisual}
        briefPending={briefPending}
        hasActiveTrack={Boolean(currentTrack)}
        hasActiveVisual={Boolean(currentVisual)}
        hasPendingTasks={tasks.some((t) => t.status === 'pending')}
        hasWorkspaceConnected={workspaceConnected}
        hasActivePlugins={plugins.some((p) => p.enabled)}
        agentConnected={(agentHealth.reachable && agentHealth.authenticated) || runtimeInfo.isTauri}
        voiceName={voiceName}
        wakeMode={wakeMode}
        voices={VOICES}
        onToggleVoiceSession={() => {
          if (isConnected) stopVoiceSession();
          else void startVoiceSession(false);
        }}
        onToggleMute={() => {
          const next = !isMicMutedRef.current;
          isMicMutedRef.current = next;
          setIsMicMuted(next);
        }}
        onInterruptSpeech={() => playerRef.current.clear()}
        onVoiceChange={(next) => void handleVoiceChange(next)}
        onWakeModeChange={(mode) => void handleWakeModeChange(mode)}
        onToggleClapWake={(enabled) => void handleToggleClapWake(enabled)}
        onOpenSetup={() => setSetupOpen(true)}
        onOpenAiSettings={() => setAiSettingsOpen(true)}
        aiProviderLabel={
          aiSettings.provider === 'gemini'
            ? 'Gemini BYOK'
            : aiSettings.provider === 'openrouter'
              ? 'OpenRouter BYOK'
              : 'AI Provider'
        }
        visionMode={vision.visionMode}
        onChangeVisionMode={handleChangeVisionMode}
        deepThinking={deepThinking}
        onToggleDeepThinking={setDeepThinking}
        onLockWithFace={() => {
          stopVoiceSession();
          setIsFaceUnlocked(false);
        }}
      />

      {/* First-Launch Laptop Setup Wizard */}
      <FirstLaunchSetupModal
        open={setupOpen}
        isFirstLaunch={!setupConfig.setupCompleted}
        initialConfig={setupConfig}
        initialAiSettings={aiSettings}
        existingFaceAuth={faceAuthProfile}
        onSaveAiSettings={(nextAi) => setAiSettingsState(nextAi)}
        onClose={() => setSetupOpen(false)}
        onComplete={async ({
          config,
          aiSettings: nextAi,
          seedMemories,
          faceAuthProfile: nextFace,
          clearFaceAuth,
        }: {
          config: SetupConfig;
          aiSettings?: AiSettings;
          seedMemories: SeedMemoryDraft[];
          faceAuthProfile?: Omit<FaceAuthProfile, 'uid' | 'createdAt' | 'updatedAt'> | null;
          clearFaceAuth?: boolean;
        }) => {
          if (nextAi) {
            setAiSettingsState(nextAi);
          }
          setSetupConfig(config);
          saveLocalSetupConfig(config);
          if (user) {
            await saveSetupConfigToFirestore(user.uid, config);
          }

          for (const seed of seedMemories) {
            await handleAddMemoryRecord({
              category: seed.category,
              content: seed.content,
              importance: seed.importance,
              source: 'setup',
            });
          }

          if (clearFaceAuth) {
            setFaceAuthProfile(null);
            saveLocalFaceAuth(null);
            if (user) {
              await deleteFaceAuthProfile(user.uid).catch(() => null);
            }
          } else if (nextFace) {
            setFaceAuthProfile(nextFace);
            saveLocalFaceAuth(nextFace);
            if (user) {
              await saveFaceAuthProfile(user.uid, nextFace);
            }
          }

          sessionUnlockedOnceRef.current = true;
          setIsFaceUnlocked(true);
          setSetupOpen(false);
          if (isConnectedRef.current) stopVoiceSession();
          const greeting = config.userPreferredName
            ? `${config.assistantName} configured for ${config.userPreferredName}.`
            : `${config.assistantName} setup saved.`;
          showTransientCaption(config.assistantName, greeting, 4500);
        }}
      />

      {/* Runtime Laptop Permission Confirmation Dialog */}
      <LaptopPermissionModal
        request={pendingPermissionReq}
        assistantName={assistantName}
        runtimeLabel={
          runtimeInfo.isTauri
            ? `Native Desktop (${runtimeInfo.os})`
            : agentHealth.reachable && agentHealth.authenticated
              ? 'Local Laptop Agent'
              : 'Desktop Bridge'
        }
        onDeny={() => permissionResolverRef.current?.('deny')}
        onAllowOnce={() => permissionResolverRef.current?.('once')}
        onAlwaysAllowCategory={() => permissionResolverRef.current?.('always')}
      />

      {/* BYOK AI Provider Settings */}
      <AiSettingsModal
        open={aiSettingsOpen}
        settings={aiSettings}
        onSave={(next) => setAiSettingsState(next)}
        onClose={() => setAiSettingsOpen(false)}
      />

      {/* Facial Recognition Lock Screen */}
      {faceAuthProfile && !setupOpen && (
        <FaceAuthGateModal
          open={!isFaceUnlocked && setupConfig.faceAuthEnabled}
          assistantName={assistantName}
          userPreferredName={setupConfig.userPreferredName}
          faceAuthProfile={faceAuthProfile}
          onUnlock={() => {
            sessionUnlockedOnceRef.current = true;
            setIsFaceUnlocked(true);
            showTransientCaption(
              assistantName,
              setupConfig.userPreferredName
                ? `Welcome back, ${setupConfig.userPreferredName}.`
                : 'Identity verified.',
              4000
            );
            // Morning Brief delivery: if a fresh brief is waiting, announce it
            // after the welcome and play the spoken digest when configured.
            if (briefToday && briefToday.date === todayKey() && briefSeenDate !== briefToday.date) {
              const freshBrief = briefToday;
              window.setTimeout(() => {
                showTransientCaption(assistantName, freshBrief.headline, 6000);
                if (briefConfig?.speakOnUnlock && freshBrief.audioBase64) {
                  void playerRef.current.playWavBase64(freshBrief.audioBase64 as string);
                }
              }, 1200);
              markBriefSeen(freshBrief.date);
            }
          }}
        />
      )}

      {/* Explicit Confirmation Modal for Workspace Mutating Actions (Gmail Send / Calendar Create & Delete) */}
      <AnimatePresence>
        {pendingWorkspaceAction && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4"
          >
            <motion.div
              initial={prefersReduced ? false : { opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 12 }}
              className="w-full max-w-md rounded-2xl bg-[#0B1222]/95 border border-white/15 shadow-[0_28px_80px_rgba(0,0,0,0.8)] overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-400/35 flex items-center justify-center text-amber-300">
                    <ShieldAlert className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">
                      Confirm Google Workspace Action
                    </h3>
                    <p className="text-[11px] text-slate-400">{pendingWorkspaceAction.title}</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={workspaceConfirmBusy}
                  onClick={() => setPendingWorkspaceAction(null)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-slate-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-3 text-xs text-slate-200">
                {pendingWorkspaceAction.service === 'gmail' &&
                  pendingWorkspaceAction.action === 'send' && (
                    <div className="space-y-2 rounded-xl bg-black/45 border border-white/10 p-3.5">
                      <div>
                        <span className="text-slate-400">To: </span>
                        <span className="font-mono text-sky-300">
                          {String(pendingWorkspaceAction.payload.to || '')}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400">Subject: </span>
                        <span className="font-medium text-slate-100">
                          {String(pendingWorkspaceAction.payload.subject || '')}
                        </span>
                      </div>
                      <pre className="pt-2 border-t border-white/10 whitespace-pre-wrap font-sans text-slate-300 max-h-48 overflow-y-auto leading-relaxed">
                        {String(pendingWorkspaceAction.payload.body || '')}
                      </pre>
                    </div>
                  )}

                {pendingWorkspaceAction.service === 'calendar' &&
                  pendingWorkspaceAction.action === 'create_event' && (
                    <div className="space-y-2 rounded-xl bg-black/45 border border-white/10 p-3.5">
                      <div>
                        <span className="text-slate-400">Event: </span>
                        <span className="font-medium text-slate-100">
                          {String(pendingWorkspaceAction.payload.summary || '')}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400">Start: </span>
                        <span className="font-mono text-sky-300">
                          {String(pendingWorkspaceAction.payload.startIso || '')}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400">End: </span>
                        <span className="font-mono text-sky-300">
                          {String(pendingWorkspaceAction.payload.endIso || '')}
                        </span>
                      </div>
                      {Boolean(pendingWorkspaceAction.payload.location) && (
                        <div>
                          <span className="text-slate-400">Location: </span>
                          <span>{String(pendingWorkspaceAction.payload.location)}</span>
                        </div>
                      )}
                      {Boolean(pendingWorkspaceAction.payload.description) && (
                        <p className="pt-2 border-t border-white/10 text-slate-300">
                          {String(pendingWorkspaceAction.payload.description)}
                        </p>
                      )}
                    </div>
                  )}

                {pendingWorkspaceAction.service === 'calendar' &&
                  pendingWorkspaceAction.action === 'delete_event' && (
                    <div className="space-y-1.5 rounded-xl bg-rose-500/10 border border-rose-400/30 p-3.5 text-rose-100">
                      <p className="font-medium">
                        Permanently remove this event from your Google Calendar?
                      </p>
                      <p className="text-xs text-rose-200/80">
                        Event:{' '}
                        {String(
                          pendingWorkspaceAction.payload.summary ||
                            pendingWorkspaceAction.payload.eventId ||
                            'Selected event'
                        )}
                      </p>
                    </div>
                  )}

                <p className="text-[11px] text-slate-400">
                  Review the details above. Shadow never sends emails or changes calendar events without your explicit approval.
                </p>
              </div>

              <div className="px-5 py-3.5 border-t border-white/10 bg-black/30 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  disabled={workspaceConfirmBusy}
                  onClick={() => setPendingWorkspaceAction(null)}
                  className="px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-medium text-slate-200 cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={workspaceConfirmBusy}
                  onClick={() => void executeConfirmedWorkspaceAction()}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50 ${
                    pendingWorkspaceAction.action === 'delete_event'
                      ? 'bg-rose-500 hover:bg-rose-400 text-white'
                      : 'bg-sky-500 hover:bg-sky-400 text-slate-950'
                  }`}
                >
                  {workspaceConfirmBusy ? 'Executing...' : 'Confirm & Execute'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ErrorInspectorModal
        open={errorInspectorOpen}
        errors={shadowErrors}
        onClose={() => setErrorInspectorOpen(false)}
        onDismissError={dismissShadowError}
        onClearAll={() => {
          clearShadowErrors();
          setVoiceError(null);
          setAuthError(null);
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <JarvisArcWorkspace />
    </ErrorBoundary>
  );
}
