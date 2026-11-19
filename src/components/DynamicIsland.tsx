import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowRight,
  Blocks,
  Brain,
  Check,
  ChevronUp,
  Clock,
  Compass,
  Cpu,
  FileText,
  Globe,
  Image as ImageIcon,
  Layers,
  Loader2,
  Lock,
  Mic,
  MicOff,
  Monitor,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
  Square,
  Sun,
  Sunrise,
  Terminal,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { ReactorCommandCue, ReactorMode } from './ArcReactorScene';
import type { DockDrawerTab } from './IosControlDock';
import type {
  GeneratedVisual,
  ResearchReport,
  VoiceName,
  YouTubeTrack,
} from '../types/assistant';

export type DynamicIslandTab = 'now' | 'focus' | 'shelf';

interface ShelfItem {
  id: string;
  name: string;
  sizeLabel: string;
  kind: 'file' | 'text';
  previewText?: string;
}

interface DynamicIslandProps {
  assistantName: string;
  mode: ReactorMode;
  commandCue: ReactorCommandCue | null;
  statusText: string;
  isConnected: boolean;
  isConnecting: boolean;
  isMicMuted: boolean;
  isAssistantSpeaking: boolean;
  isResearching: boolean;
  isGeneratingVisual: boolean;
  isAutomating: boolean;
  briefPending: boolean;
  hasActivePlugins?: boolean;
  agentConnected?: boolean;
  faceAuthLockAvailable?: boolean;
  currentTrack: YouTubeTrack | null;
  mediaQueue?: YouTubeTrack[];
  currentResearch?: ResearchReport | null;
  currentVisual?: GeneratedVisual | null;
  activeDrawer: DockDrawerTab;
  aiProviderLabel: string;
  voiceName: VoiceName;
  voices: VoiceName[];
  reactorBrightness: number;
  errorMessage: string | null;
  inputLevelRef: React.MutableRefObject<number>;
  outputLevelRef: React.MutableRefObject<number>;
  onToggleVoiceSession: () => void;
  onToggleMute: () => void;
  onInterruptSpeech: () => void;
  onVoiceChange: (voice: VoiceName) => void;
  onChangeReactorBrightness: (brightness: number) => void;
  onSelectDrawer: (tab: DockDrawerTab) => void;
  onSelectTrack?: (track: YouTubeTrack) => void;
  onRunCommand: (commandText: string) => void;
  onOpenAiSettings: () => void;
  onOpenSetup: () => void;
  onLockWithFace?: () => void;
  onDismissError: () => void;
}

const SPRING_LIQUID = { type: 'spring' as const, stiffness: 440, damping: 32, mass: 0.82 };
const SPRING_DETACH = { type: 'spring' as const, stiffness: 390, damping: 28, mass: 0.78 };
const WAVE_COUNT = 16;

function formatClock(now: Date): string {
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatShortDate(now: Date): string {
  return now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTimer(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function playFocusChime(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = ctx.currentTime + idx * 0.11;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.08, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.6);
    });
    window.setTimeout(() => {
      void ctx.close().catch(() => null);
    }, 1200);
  } catch {
    // ignore Web Audio blocks
  }
}

function cueTheme(
  mode: ReactorMode,
  commandCue: ReactorCommandCue | null
): {
  icon: React.ReactNode;
  glowClass: string;
  ringColor: string;
} {
  const kind = commandCue?.kind;
  if (commandCue?.outcome === 'error') {
    return {
      icon: <X className="w-3.5 h-3.5 text-rose-400" />,
      glowClass: 'from-rose-500/25 via-rose-500/10 to-transparent',
      ringColor: '#fb7185',
    };
  }
  if (commandCue?.outcome === 'ok') {
    return {
      icon: <Check className="w-3.5 h-3.5 text-emerald-400" />,
      glowClass: 'from-emerald-500/25 via-emerald-500/10 to-transparent',
      ringColor: '#34d399',
    };
  }
  if (kind === 'research' || mode === 'researching') {
    return {
      icon: <Compass className="w-3.5 h-3.5 text-indigo-400" />,
      glowClass: 'from-indigo-500/28 via-sky-500/12 to-transparent',
      ringColor: '#818cf8',
    };
  }
  if (kind === 'visuals' || mode === 'visuals') {
    return {
      icon: <ImageIcon className="w-3.5 h-3.5 text-purple-400" />,
      glowClass: 'from-purple-500/28 via-violet-500/12 to-transparent',
      ringColor: '#c084fc',
    };
  }
  if (kind === 'automation' || mode === 'automating') {
    return {
      icon: <Globe className="w-3.5 h-3.5 text-amber-300" />,
      glowClass: 'from-amber-400/24 via-sky-500/10 to-transparent',
      ringColor: '#fbbf24',
    };
  }
  if (kind === 'youtube' || mode === 'media') {
    return {
      icon: <Play className="w-3.5 h-3.5 text-rose-400 fill-current" />,
      glowClass: 'from-rose-500/28 via-red-500/10 to-transparent',
      ringColor: '#fb7185',
    };
  }
  if (kind === 'laptop' || mode === 'laptop') {
    return {
      icon: <Terminal className="w-3.5 h-3.5 text-emerald-400" />,
      glowClass: 'from-emerald-500/25 via-teal-500/10 to-transparent',
      ringColor: '#34d399',
    };
  }
  if (kind === 'memory' || mode === 'memory') {
    return {
      icon: <Brain className="w-3.5 h-3.5 text-amber-300" />,
      glowClass: 'from-amber-400/24 via-orange-500/10 to-transparent',
      ringColor: '#fcd34d',
    };
  }
  if (kind === 'plugin' || mode === 'plugin') {
    return {
      icon: <Blocks className="w-3.5 h-3.5 text-teal-400" />,
      glowClass: 'from-teal-400/25 via-emerald-500/10 to-transparent',
      ringColor: '#2dd4bf',
    };
  }
  if (mode === 'speaking') {
    return {
      icon: <Volume2 className="w-3.5 h-3.5 text-emerald-400" />,
      glowClass: 'from-emerald-400/28 via-sky-500/10 to-transparent',
      ringColor: '#34d399',
    };
  }
  if (mode === 'listening') {
    return {
      icon: <Mic className="w-3.5 h-3.5 text-sky-400" />,
      glowClass: 'from-sky-400/28 via-cyan-500/12 to-transparent',
      ringColor: '#38bdf8',
    };
  }
  return {
    icon: <Sparkles className="w-3.5 h-3.5 text-sky-400" />,
    glowClass: 'from-sky-400/15 via-indigo-500/8 to-transparent',
    ringColor: '#38bdf8',
  };
}

export const DynamicIsland: React.FC<DynamicIslandProps> = ({
  assistantName,
  mode,
  commandCue,
  statusText,
  isConnected,
  isConnecting,
  isMicMuted,
  isAssistantSpeaking,
  isResearching,
  isGeneratingVisual,
  isAutomating,
  briefPending,
  hasActivePlugins = false,
  agentConnected = false,
  faceAuthLockAvailable = false,
  currentTrack,
  mediaQueue = [],
  currentResearch = null,
  currentVisual = null,
  activeDrawer,
  aiProviderLabel,
  voiceName,
  voices,
  reactorBrightness,
  errorMessage,
  inputLevelRef,
  outputLevelRef,
  onToggleVoiceSession,
  onToggleMute,
  onInterruptSpeech,
  onVoiceChange,
  onChangeReactorBrightness,
  onSelectDrawer,
  onSelectTrack,
  onRunCommand,
  onOpenAiSettings,
  onOpenSetup,
  onLockWithFace,
  onDismissError,
}) => {
  const prefersReduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<DynamicIslandTab>('now');
  const [clockNow, setClockNow] = useState<Date>(() => new Date());
  const [waveBars, setWaveBars] = useState<number[]>(() => Array(WAVE_COUNT).fill(0.22));
  const [thumbFailed, setThumbFailed] = useState(false);
  const [quickCommand, setQuickCommand] = useState('');
  const [isDragHovering, setIsDragHovering] = useState(false);
  const [shelfItems, setShelfItems] = useState<ShelfItem[]>([]);

  // Built-in Focus / Pomodoro Countdown Timer (persists cleanly in Dynamic Island)
  const [timerDuration, setTimerDuration] = useState(25 * 60);
  const [timerRemaining, setTimerRemaining] = useState(25 * 60);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerCompletedFlash, setTimerCompletedFlash] = useState(false);

  const islandRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Clock refresh every 10s
  useEffect(() => {
    const id = window.setInterval(() => setClockNow(new Date()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setThumbFailed(false);
  }, [currentTrack?.videoId]);

  // Countdown tick
  useEffect(() => {
    if (!timerRunning) return;
    const id = window.setInterval(() => {
      setTimerRemaining((prev) => {
        if (prev <= 1) {
          setTimerRunning(false);
          setTimerCompletedFlash(true);
          playFocusChime();
          window.setTimeout(() => setTimerCompletedFlash(false), 6000);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerRunning]);

  // Keyboard shortcut: Cmd/Ctrl + I toggles Dynamic Island; Escape closes
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setExpanded((prev) => !prev);
        return;
      }
      if (e.key === 'Escape' && expanded && !isTyping) {
        setExpanded(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  // Close expanded island on outside click
  useEffect(() => {
    if (!expanded) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (islandRef.current && !islandRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [expanded]);

  // Live audio waveform sampling when voice or media is active
  const liveWaveActive = isConnected || isAssistantSpeaking || Boolean(currentTrack);
  useEffect(() => {
    if (!liveWaveActive || prefersReduced) {
      setWaveBars(Array(WAVE_COUNT).fill(0.24));
      return;
    }
    let rafId = 0;
    let lastTick = 0;
    const tick = (now: number) => {
      if (now - lastTick >= 70) {
        lastTick = now;
        const raw = isAssistantSpeaking
          ? Math.max(0.28, outputLevelRef.current * 2.1)
          : isConnected && !isMicMuted
            ? Math.max(0.2, inputLevelRef.current * 2.4)
            : 0.28;
        const phase = now * 0.0085;
        const nextBars: number[] = [];
        for (let i = 0; i < WAVE_COUNT; i++) {
          const envelope = Math.sin(((i + 1) / (WAVE_COUNT + 1)) * Math.PI);
          const harmonic = 0.62 + 0.38 * Math.sin(phase * (1.1 + (i % 4) * 0.22) + i * 0.75);
          nextBars.push(Math.min(1, Math.max(0.14, raw * envelope * harmonic * 1.25)));
        }
        setWaveBars(nextBars);
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [
    liveWaveActive,
    isAssistantSpeaking,
    isConnected,
    isMicMuted,
    inputLevelRef,
    outputLevelRef,
    prefersReduced,
  ]);

  const handleFilesIngest = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const additions: ShelfItem[] = [];
    for (const file of Array.from(files).slice(0, 6)) {
      let previewText: string | undefined;
      if (
        file.size <= 160_000 &&
        (file.type.startsWith('text/') ||
          /\.(txt|md|json|ts|tsx|js|py|rs|sh|csv|yml|yaml|html|css)$/i.test(file.name))
      ) {
        previewText = (await file.text().catch(() => '')).slice(0, 600);
      }
      additions.push({
        id: `shelf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        sizeLabel: formatFileSize(file.size),
        kind: 'file',
        previewText,
      });
    }
    setShelfItems((prev) => [...additions, ...prev].slice(0, 12));
    setActiveTab('shelf');
    setExpanded(true);
  };

  const handleDropOnIsland = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragHovering(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFilesIngest(e.dataTransfer.files);
      return;
    }
    const droppedText = e.dataTransfer.getData('text/plain')?.trim();
    if (droppedText) {
      setShelfItems((prev) =>
        [
          {
            id: `shelf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: droppedText.slice(0, 38) + (droppedText.length > 38 ? '…' : ''),
            sizeLabel: `${droppedText.length} chars`,
            kind: 'text' as const,
            previewText: droppedText.slice(0, 800),
          },
          ...prev,
        ].slice(0, 12)
      );
      setActiveTab('shelf');
      setExpanded(true);
    }
  };

  const handleSubmitQuickCommand = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = quickCommand.trim();
    if (!clean) return;
    setQuickCommand('');
    onRunCommand(clean);
  };

  const isBusyActivity = Boolean(
    commandCue || isConnecting || isResearching || isGeneratingVisual || isAutomating
  );

  const compactKind: 'error' | 'activity' | 'voice' | 'media' | 'timer' | 'idle' = errorMessage
    ? 'error'
    : isBusyActivity
      ? 'activity'
      : isConnected
        ? 'voice'
        : currentTrack
          ? 'media'
          : timerRunning || timerCompletedFlash
            ? 'timer'
            : 'idle';

  // Show detached Split Live Activity pill when a second live activity runs concurrently
  const showSplitTimerPill =
    !expanded &&
    (timerRunning || timerCompletedFlash) &&
    compactKind !== 'timer' &&
    compactKind !== 'error';
  const showSplitMediaPill =
    !expanded && Boolean(currentTrack) && (compactKind === 'activity' || compactKind === 'voice');

  const theme = cueTheme(mode, commandCue);
  const timerProgress = timerDuration > 0 ? (timerDuration - timerRemaining) / timerDuration : 0;

  const stageApps: Array<{
    id: Exclude<DockDrawerTab, null>;
    label: string;
    icon: React.ReactNode;
    running: boolean;
  }> = [
    {
      id: 'brief',
      label: 'Brief',
      icon: <Sunrise className="w-4 h-4 text-orange-300" />,
      running: briefPending,
    },
    {
      id: 'research',
      label: 'Research',
      icon: <Compass className="w-4 h-4 text-indigo-300" />,
      running: isResearching,
    },
    {
      id: 'visuals',
      label: 'Visuals',
      icon: <ImageIcon className="w-4 h-4 text-purple-300" />,
      running: isGeneratingVisual || Boolean(currentVisual),
    },
    {
      id: 'automation',
      label: 'Automation',
      icon: <Globe className="w-4 h-4 text-sky-300" />,
      running: isAutomating,
    },
    {
      id: 'youtube',
      label: 'YouTube',
      icon: <Play className="w-4 h-4 text-rose-400 fill-current" />,
      running: Boolean(currentTrack),
    },
    {
      id: 'macros',
      label: 'Memory',
      icon: <Layers className="w-4 h-4 text-amber-300" />,
      running: false,
    },
    {
      id: 'plugins',
      label: 'Plugins',
      icon: <Blocks className="w-4 h-4 text-emerald-300" />,
      running: hasActivePlugins,
    },
    {
      id: 'tauri',
      label: 'Desktop',
      icon: <Monitor className="w-4 h-4 text-slate-200" />,
      running: agentConnected,
    },
  ];

  return (
    <div
      ref={islandRef}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragHovering(true);
      }}
      onDragLeave={() => setIsDragHovering(false)}
      onDrop={handleDropOnIsland}
      className="fixed top-2 left-1/2 -translate-x-1/2 z-40 flex items-start justify-center gap-2 pointer-events-none"
    >
      {/* Hidden file input for Shelf */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFilesIngest(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Main Liquid Dynamic Island Notch */}
      <div className="relative pointer-events-auto flex flex-col items-center">
        {/* Adaptive Ambient Edge Halo */}
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute -inset-x-6 -top-1 h-14 rounded-full bg-gradient-to-b ${theme.glowClass} blur-xl transition-opacity duration-500 ${
            expanded || isBusyActivity || isConnected || currentTrack ? 'opacity-90' : 'opacity-40'
          }`}
        />

        <motion.div
          layout
          transition={prefersReduced ? { duration: 0.01 } : SPRING_LIQUID}
          whileHover={
            !expanded && !prefersReduced
              ? { scale: 1.025 }
              : undefined
          }
          whileTap={
            !expanded && !prefersReduced
              ? { scale: 0.975 }
              : undefined
          }
          className={`relative overflow-hidden border backdrop-blur-3xl backdrop-saturate-150 transition-colors duration-200 ${
            isDragHovering
              ? 'w-[min(90vw,360px)] rounded-[24px] bg-[#040B14]/82 border-sky-400/55 shadow-[0_24px_64px_rgba(56,189,248,0.25),inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(255,255,255,0.05)]'
              : expanded
                ? 'w-[min(93vw,492px)] rounded-[30px] bg-[#030509]/80 border-white/[0.16] shadow-[0_34px_96px_rgba(0,0,0,0.88),inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(255,255,255,0.05)]'
                : compactKind === 'error'
                  ? 'max-w-[min(86vw,370px)] rounded-[22px] bg-[#120409]/82 border-rose-400/40 shadow-[0_18px_46px_rgba(0,0,0,0.82),inset_0_1px_0_rgba(255,255,255,0.15)]'
                  : 'max-w-[min(86vw,390px)] rounded-[22px] bg-[#020408]/76 border-white/[0.15] shadow-[0_18px_50px_rgba(0,0,0,0.82),inset_0_1px_0_rgba(255,255,255,0.16),inset_0_-1px_0_rgba(255,255,255,0.04)] hover:bg-[#05080F]/84 hover:border-white/[0.24]'
          }`}
        >
          {/* Dark Smoked Obsidian Glass Refractive Sheen Layer */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.065] via-transparent to-black/35"
          />
          {/* Specular Top Edge Glass Hairline */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/28 to-transparent"
          />

          <AnimatePresence mode="wait" initial={false}>
            {isDragHovering && !expanded ? (
              <motion.div
                key="island-drag-target"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-11 px-4 flex items-center justify-center gap-2 text-xs font-medium text-sky-200"
              >
                <Upload className="w-4 h-4 text-sky-400" />
                <span>Drop onto {assistantName} Shelf</span>
              </motion.div>
            ) : !expanded ? (
              <motion.div
                key={`compact-${compactKind}`}
                initial={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => setExpanded(true)}
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                aria-label={`${assistantName} Dynamic Island (Cmd+I)`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setExpanded(true);
                  }
                }}
                className="h-9 px-3.5 flex items-center justify-between gap-3 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded-[22px]"
              >
                {/* Left Region: Optical Lens / Live Activity Thumbnail */}
                <div className="flex items-center gap-2.5 min-w-0">
                  {compactKind === 'media' && currentTrack ? (
                    currentTrack.thumbnailUrl && !thumbFailed ? (
                      <img
                        src={currentTrack.thumbnailUrl}
                        alt={currentTrack.title}
                        referrerPolicy="no-referrer"
                        onError={() => setThumbFailed(true)}
                        className="w-5 h-5 rounded-md object-cover shrink-0 border border-white/15"
                      />
                    ) : (
                      <span className="w-5 h-5 rounded-md bg-rose-500/20 border border-rose-400/35 flex items-center justify-center shrink-0">
                        <Play className="w-2.5 h-2.5 text-rose-300 fill-current ml-0.5" />
                      </span>
                    )
                  ) : compactKind === 'timer' ? (
                    <span className="w-5 h-5 rounded-full bg-amber-500/15 border border-amber-400/35 flex items-center justify-center shrink-0">
                      <Clock className="w-3 h-3 text-amber-300" />
                    </span>
                  ) : compactKind === 'activity' ? (
                    <span className="w-5 h-5 rounded-full bg-white/[0.06] border border-white/12 flex items-center justify-center shrink-0">
                      {isConnecting || commandCue?.active ? (
                        <Loader2 className="w-3 h-3 text-sky-400 animate-spin" />
                      ) : (
                        theme.icon
                      )}
                    </span>
                  ) : compactKind === 'voice' ? (
                    <span className="w-5 h-5 rounded-full bg-sky-500/15 border border-sky-400/35 flex items-center justify-center shrink-0">
                      {isMicMuted ? (
                        <MicOff className="w-3 h-3 text-amber-300" />
                      ) : (
                        <Mic className="w-3 h-3 text-sky-300" />
                      )}
                    </span>
                  ) : compactKind === 'error' ? (
                    <span className="w-5 h-5 rounded-full bg-rose-500/20 border border-rose-400/40 flex items-center justify-center shrink-0">
                      <X className="w-3 h-3 text-rose-300" />
                    </span>
                  ) : (
                    /* Recessed MacBook Camera Optical Lens Housing */
                    <span
                      aria-hidden="true"
                      className="w-4 h-4 rounded-full bg-[#090D16] border border-white/14 shadow-[inset_0_1px_2px_rgba(0,0,0,0.95)] flex items-center justify-center shrink-0"
                    >
                      <span className="w-2 h-2 rounded-full bg-gradient-to-br from-sky-400/55 via-indigo-500/30 to-slate-950 flex items-center justify-center">
                        <span className="w-0.5 h-0.5 rounded-full bg-white/50 -translate-x-[1px] -translate-y-[1px]" />
                      </span>
                    </span>
                  )}

                  <span className="text-xs font-medium text-slate-100 truncate max-w-[175px] sm:max-w-[230px]">
                    {compactKind === 'error'
                      ? errorMessage
                      : compactKind === 'activity'
                        ? commandCue?.label || statusText
                        : compactKind === 'voice'
                          ? isAssistantSpeaking
                            ? `${assistantName} speaking`
                            : isMicMuted
                              ? 'Mic muted'
                              : 'Listening'
                          : compactKind === 'media' && currentTrack
                            ? currentTrack.title
                            : compactKind === 'timer'
                              ? timerCompletedFlash
                                ? 'Focus complete'
                                : 'Focus Timer'
                              : assistantName}
                  </span>
                </div>

                {/* Right Region: Spectrum / Countdown / Time */}
                <div className="flex items-center gap-2 shrink-0">
                  {compactKind === 'error' ? (
                    <button
                      type="button"
                      aria-label="Dismiss error"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDismissError();
                      }}
                      className="px-2 py-0.5 rounded-full bg-rose-500/22 hover:bg-rose-500/38 text-[11px] font-medium text-rose-200 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      Clear
                    </button>
                  ) : compactKind === 'voice' || compactKind === 'media' ? (
                    <div className="flex items-center gap-0.5 h-4 px-0.5" aria-hidden="true">
                      {waveBars.slice(0, 5).map((lvl, idx) => (
                        <span
                          key={idx}
                          style={{ height: `${Math.round(4 + lvl * 12)}px` }}
                          className={`w-[2.5px] rounded-full transition-[height] duration-75 ${
                            compactKind === 'media'
                              ? 'bg-rose-400'
                              : isAssistantSpeaking
                                ? 'bg-emerald-400'
                                : isMicMuted
                                  ? 'bg-amber-400/75'
                                  : 'bg-sky-400'
                          }`}
                        />
                      ))}
                    </div>
                  ) : compactKind === 'timer' ? (
                    <span className="text-[11px] font-mono tabular-nums text-amber-300 font-semibold">
                      {formatTimer(timerRemaining)}
                    </span>
                  ) : compactKind === 'idle' ? (
                    <span className="text-[11px] font-mono tabular-nums text-slate-400 pl-0.5">
                      {formatClock(clockNow)}
                    </span>
                  ) : (
                    theme.icon
                  )}
                </div>
              </motion.div>
            ) : (
              /* Expanded Interactive Mac Dynamic Island */
              <motion.div
                key="island-expanded"
                initial={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="p-4 space-y-3.5"
              >
                {/* Top Header: Live Core & Instant Controls */}
                <div className="flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      aria-hidden="true"
                      className="w-8 h-8 rounded-2xl bg-white/[0.06] border border-white/12 flex items-center justify-center shrink-0"
                    >
                      {isConnecting || commandCue?.active ? (
                        <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />
                      ) : (
                        theme.icon
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-100 truncate">
                        {assistantName}
                      </p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {errorMessage || commandCue?.label || statusText}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isAssistantSpeaking && (
                      <button
                        type="button"
                        onClick={onInterruptSpeech}
                        title="Interrupt Speech"
                        aria-label="Interrupt Speech"
                        className="p-2 rounded-xl bg-amber-500/18 border border-amber-400/35 text-amber-200 hover:bg-amber-500/28 transition-colors cursor-pointer"
                      >
                        <VolumeX className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {isConnected && (
                      <button
                        type="button"
                        onClick={onToggleMute}
                        title={isMicMuted ? 'Unmute Mic' : 'Mute Mic'}
                        aria-label={isMicMuted ? 'Unmute Mic' : 'Mute Mic'}
                        className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                          isMicMuted
                            ? 'bg-amber-500/20 border-amber-400/40 text-amber-200'
                            : 'bg-white/[0.06] border-white/12 text-slate-200 hover:bg-white/[0.12]'
                        }`}
                      >
                        {isMicMuted ? (
                          <MicOff className="w-3.5 h-3.5" />
                        ) : (
                          <Mic className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={isConnecting}
                      onClick={onToggleVoiceSession}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                        isConnected
                          ? 'bg-rose-500 hover:bg-rose-400 text-white'
                          : 'bg-sky-500 hover:bg-sky-400 text-slate-950'
                      }`}
                    >
                      {isConnecting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : isConnected ? (
                        <Square className="w-3 h-3 fill-current" />
                      ) : (
                        <Mic className="w-3.5 h-3.5" />
                      )}
                      <span>{isConnected ? 'Stop' : isConnecting ? 'Joining' : 'Voice'}</span>
                    </button>
                  </div>
                </div>

                {/* Mac Segmented Mode Switcher: Now · Focus & Media · Shelf & Apps */}
                <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-black/45 border border-white/[0.09] shadow-[inset_0_1px_2px_rgba(0,0,0,0.6)]">
                  {(
                    [
                      { id: 'now', label: 'Live Hub' },
                      {
                        id: 'focus',
                        label: timerRunning
                          ? `Focus · ${formatTimer(timerRemaining)}`
                          : 'Focus & Media',
                      },
                      {
                        id: 'shelf',
                        label: shelfItems.length > 0 ? `Shelf (${shelfItems.length})` : 'Shelf & Apps',
                      },
                    ] as const
                  ).map((tab) => {
                    const selected = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`relative py-1.5 px-2 rounded-xl text-[11px] font-medium transition-colors whitespace-nowrap truncate cursor-pointer ${
                          selected ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {selected && (
                          <motion.span
                            layoutId="dynamic-island-tab-pill"
                            transition={SPRING_LIQUID}
                            className="absolute inset-0 rounded-xl bg-white/[0.09] border border-white/[0.14] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]"
                          />
                        )}
                        <span className="relative z-10 tabular-nums">{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Spotlight-Grade Quick Command Bar */}
                <form onSubmit={handleSubmitQuickCommand} className="relative flex items-center">
                  <Sparkles className="w-3.5 h-3.5 text-sky-400 absolute left-3 pointer-events-none" />
                  <input
                    type="text"
                    value={quickCommand}
                    onChange={(e) => setQuickCommand(e.target.value)}
                    placeholder={`Command ${assistantName} (e.g. research AI chips, open VS Code)...`}
                    className="w-full pl-8 pr-9 py-2 rounded-xl bg-black/45 border border-white/[0.09] text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400/55 focus:bg-black/60 transition-all"
                  />
                  <button
                    type="submit"
                    disabled={!quickCommand.trim()}
                    aria-label="Run command"
                    className="absolute right-1.5 p-1.5 rounded-lg bg-sky-500 text-slate-950 hover:bg-sky-400 disabled:opacity-30 disabled:bg-white/10 disabled:text-slate-400 transition-colors cursor-pointer"
                  >
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </form>

                {/* Tab Content Surface */}
                <AnimatePresence mode="wait" initial={false}>
                  {activeTab === 'now' && (
                    <motion.div
                      key="tab-now"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.14 }}
                      className="space-y-2.5"
                    >
                      {/* 16-Bar Live Audio Equalizer + Inline Voice Persona Strip */}
                      <div className="p-2.5 rounded-2xl bg-black/38 border border-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-medium text-slate-300">
                            {isAssistantSpeaking
                              ? 'Audio Output Stream'
                              : isConnected
                                ? isMicMuted
                                  ? 'Mic Muted'
                                  : 'Live Audio Input'
                                : 'Voice Persona'}
                          </span>
                          <div className="flex items-center gap-0.5 h-4" aria-hidden="true">
                            {waveBars.map((lvl, idx) => (
                              <span
                                key={idx}
                                style={{
                                  height: `${Math.round(
                                    3 + (isConnected || isAssistantSpeaking ? lvl : 0.14) * 12
                                  )}px`,
                                }}
                                className={`w-[2.5px] rounded-full transition-[height] duration-75 ${
                                  isAssistantSpeaking
                                    ? 'bg-emerald-400'
                                    : isConnected
                                      ? isMicMuted
                                        ? 'bg-amber-400/65'
                                        : 'bg-sky-400'
                                      : 'bg-slate-600/60'
                                }`}
                              />
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 flex-wrap">
                          {voices.map((v) => (
                            <button
                              key={v}
                              type="button"
                              onClick={() => onVoiceChange(v)}
                              className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                                voiceName === v
                                  ? 'bg-sky-500/20 text-sky-200 border border-sky-400/40'
                                  : 'bg-white/[0.04] text-slate-400 border border-transparent hover:text-slate-200'
                              }`}
                            >
                              {v}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Arc Reactor Brightness Adjuster (Mac Control Center Frosted Slider) */}
                      {(() => {
                        const brightnessPct = Math.round(
                          Math.min(200, Math.max(20, reactorBrightness * 100))
                        );
                        const fillPct = ((brightnessPct - 20) / (200 - 20)) * 100;
                        return (
                          <div className="p-2.5 rounded-2xl bg-black/38 border border-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <Sun
                                  className="w-3.5 h-3.5 text-sky-300 shrink-0 transition-opacity"
                                  style={{ opacity: 0.45 + (fillPct / 100) * 0.55 }}
                                />
                                <span className="text-[11px] font-medium text-slate-200 truncate">
                                  Reactor Brightness
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {brightnessPct !== 100 && (
                                  <button
                                    type="button"
                                    onClick={() => onChangeReactorBrightness(1)}
                                    className="px-1.5 py-0.5 rounded text-[10px] font-medium text-sky-300 hover:bg-sky-400/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    Reset
                                  </button>
                                )}
                                <span className="text-[11px] font-mono tabular-nums text-sky-200 bg-sky-400/15 border border-sky-400/30 px-1.5 py-0.5 rounded-md">
                                  {brightnessPct}%
                                </span>
                              </div>
                            </div>

                            <div className="relative h-6 rounded-xl bg-black/55 border border-white/[0.1] overflow-hidden flex items-center shadow-[inset_0_1px_2px_rgba(0,0,0,0.65)] focus-within:ring-2 focus-within:ring-sky-400/70">
                              <div
                                className="h-full bg-gradient-to-r from-sky-500/55 via-cyan-400/65 to-sky-300/80 shadow-[0_0_18px_rgba(56,189,248,0.45)] transition-[width] duration-75 ease-out relative"
                                style={{ width: `${Math.max(4, fillPct)}%` }}
                              >
                                <span
                                  aria-hidden="true"
                                  className="absolute right-1 top-1/2 -translate-y-1/2 w-1 h-3 rounded-full bg-white/85 shadow-sm"
                                />
                              </div>
                              <input
                                type="range"
                                min={20}
                                max={200}
                                step={5}
                                value={brightnessPct}
                                aria-label="Shadow Arc Reactor brightness"
                                onChange={(e) =>
                                  onChangeReactorBrightness(Number(e.target.value) / 100)
                                }
                                className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
                              />
                            </div>

                            <div className="flex items-center justify-between gap-1">
                              {[
                                { label: 'Dim 35%', val: 0.35 },
                                { label: 'Soft 65%', val: 0.65 },
                                { label: 'Std 100%', val: 1.0 },
                                { label: 'Boost 145%', val: 1.45 },
                                { label: 'Max 200%', val: 2.0 },
                              ].map((preset) => {
                                const isActive = Math.abs(reactorBrightness - preset.val) < 0.04;
                                return (
                                  <button
                                    key={preset.label}
                                    type="button"
                                    onClick={() => onChangeReactorBrightness(preset.val)}
                                    className={`flex-1 py-1 rounded-lg text-[10px] font-medium tabular-nums transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                      isActive
                                        ? 'bg-sky-400/20 text-sky-200 border border-sky-400/40'
                                        : 'bg-white/[0.03] text-slate-400 border border-transparent hover:text-slate-200 hover:bg-white/[0.06]'
                                    }`}
                                  >
                                    {preset.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Latest Active Artifact / Quick Actions */}
                      {currentVisual ? (
                        <button
                          type="button"
                          onClick={() => {
                            onSelectDrawer('visuals');
                            setExpanded(false);
                          }}
                          className="w-full p-2.5 rounded-2xl bg-black/38 hover:bg-black/55 border border-white/[0.09] flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-400/35 flex items-center justify-center shrink-0">
                              <ImageIcon className="w-4 h-4 text-purple-300" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-slate-100 truncate">
                                {currentVisual.title}
                              </p>
                              <p className="text-[11px] text-slate-400 truncate">
                                Latest generated visual · Click to inspect
                              </p>
                            </div>
                          </div>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        </button>
                      ) : currentResearch ? (
                        <button
                          type="button"
                          onClick={() => {
                            onSelectDrawer('research');
                            setExpanded(false);
                          }}
                          className="w-full p-2.5 rounded-2xl bg-black/38 hover:bg-black/55 border border-white/[0.09] flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-400/35 flex items-center justify-center shrink-0">
                              <Compass className="w-4 h-4 text-indigo-300" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-slate-100 truncate">
                                {currentResearch.query}
                              </p>
                              <p className="text-[11px] text-slate-400 truncate">
                                {currentResearch.sources.length} sources · Open research
                              </p>
                            </div>
                          </div>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        </button>
                      ) : (
                        <div className="grid grid-cols-2 gap-1.5">
                          {[
                            {
                              label: 'Morning Brief',
                              icon: <Sunrise className="w-3.5 h-3.5 text-orange-300" />,
                              onClick: () => {
                                onSelectDrawer('brief');
                                setExpanded(false);
                              },
                            },
                            {
                              label: 'Create Visual',
                              icon: <ImageIcon className="w-3.5 h-3.5 text-purple-300" />,
                              onClick: () => {
                                onSelectDrawer('visuals');
                                setExpanded(false);
                              },
                            },
                            {
                              label: 'Web Research',
                              icon: <Compass className="w-3.5 h-3.5 text-indigo-300" />,
                              onClick: () => {
                                onSelectDrawer('research');
                                setExpanded(false);
                              },
                            },
                            {
                              label: 'Desktop Control',
                              icon: <Monitor className="w-3.5 h-3.5 text-slate-200" />,
                              onClick: () => {
                                onSelectDrawer('tauri');
                                setExpanded(false);
                              },
                            },
                          ].map((act) => (
                            <button
                              key={act.label}
                              type="button"
                              onClick={act.onClick}
                              className="px-3 py-2 rounded-xl bg-black/38 hover:bg-black/55 border border-white/[0.09] text-xs font-medium text-slate-200 flex items-center gap-2 transition-colors cursor-pointer"
                            >
                              {act.icon}
                              <span className="truncate">{act.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )}

                  {activeTab === 'focus' && (
                    <motion.div
                      key="tab-focus"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.14 }}
                      className="space-y-2.5"
                    >
                      {/* Live Countdown Focus Timer */}
                      <div className="p-3 rounded-2xl bg-black/38 border border-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="relative w-11 h-11 shrink-0 flex items-center justify-center">
                            <svg className="w-11 h-11 -rotate-90" viewBox="0 0 40 40">
                              <circle
                                cx="20"
                                cy="20"
                                r="16"
                                fill="none"
                                stroke="rgba(255,255,255,0.1)"
                                strokeWidth="3"
                              />
                              <circle
                                cx="20"
                                cy="20"
                                r="16"
                                fill="none"
                                stroke="#fbbf24"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeDasharray={100.53}
                                strokeDashoffset={100.53 * (1 - timerProgress)}
                                className="transition-[stroke-dashoffset] duration-300"
                              />
                            </svg>
                            <Clock className="w-3.5 h-3.5 text-amber-300 absolute" />
                          </div>

                          <div className="min-w-0">
                            <p className="text-lg font-mono font-semibold tabular-nums text-slate-100 leading-none">
                              {formatTimer(timerRemaining)}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1.5">
                              {[5, 15, 25, 45].map((mins) => (
                                <button
                                  key={mins}
                                  type="button"
                                  onClick={() => {
                                    setTimerRunning(false);
                                    setTimerCompletedFlash(false);
                                    setTimerDuration(mins * 60);
                                    setTimerRemaining(mins * 60);
                                  }}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums transition-colors cursor-pointer ${
                                    timerDuration === mins * 60
                                      ? 'bg-amber-400/20 text-amber-200 border border-amber-400/40'
                                      : 'bg-white/[0.04] text-slate-400 hover:text-slate-200'
                                  }`}
                                >
                                  {mins}m
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setTimerCompletedFlash(false);
                              if (timerRemaining === 0) {
                                setTimerRemaining(timerDuration);
                              }
                              setTimerRunning((r) => !r);
                            }}
                            aria-label={timerRunning ? 'Pause timer' : 'Start timer'}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer ${
                              timerRunning
                                ? 'bg-amber-400/20 text-amber-200 border border-amber-400/40'
                                : 'bg-amber-400 text-slate-950 hover:bg-amber-300'
                            }`}
                          >
                            {timerRunning ? (
                              <>
                                <Pause className="w-3.5 h-3.5" />
                                <span>Pause</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5 fill-current" />
                                <span>Start</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTimerRunning(false);
                              setTimerCompletedFlash(false);
                              setTimerRemaining(timerDuration);
                            }}
                            aria-label="Reset timer"
                            className="p-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-slate-300 transition-colors cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Now Playing Media & Quick Queue */}
                      {currentTrack ? (
                        <div className="p-2.5 rounded-2xl bg-black/38 border border-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] space-y-2">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectDrawer('youtube');
                              setExpanded(false);
                            }}
                            className="w-full flex items-center justify-between gap-2.5 text-left group cursor-pointer"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              {currentTrack.thumbnailUrl && !thumbFailed ? (
                                <img
                                  src={currentTrack.thumbnailUrl}
                                  alt={currentTrack.title}
                                  referrerPolicy="no-referrer"
                                  onError={() => setThumbFailed(true)}
                                  className="w-9 h-9 rounded-lg object-cover shrink-0 border border-white/10"
                                />
                              ) : (
                                <div className="w-9 h-9 rounded-lg bg-rose-500/20 border border-rose-400/35 flex items-center justify-center shrink-0">
                                  <Play className="w-4 h-4 text-rose-300 fill-current ml-0.5" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-slate-100 truncate group-hover:text-sky-300 transition-colors">
                                  {currentTrack.title}
                                </p>
                                <p className="text-[11px] text-slate-400 truncate">
                                  {currentTrack.channel || 'YouTube'} · Open Stage
                                </p>
                              </div>
                            </div>
                            <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          </button>

                          {mediaQueue.length > 1 && onSelectTrack && (
                            <div className="pt-1.5 border-t border-white/8 flex items-center gap-1.5 overflow-x-auto">
                              {mediaQueue.slice(0, 4).map((trk) => (
                                <button
                                  key={trk.videoId}
                                  type="button"
                                  onClick={() => onSelectTrack(trk)}
                                  className={`px-2 py-1 rounded-lg text-[10px] truncate max-w-[140px] shrink-0 transition-colors cursor-pointer ${
                                    trk.videoId === currentTrack.videoId
                                      ? 'bg-rose-500/20 text-rose-200 border border-rose-400/35'
                                      : 'bg-black/45 text-slate-400 hover:text-slate-100'
                                  }`}
                                >
                                  {trk.title}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            onSelectDrawer('youtube');
                            setExpanded(false);
                          }}
                          className="w-full px-3 py-2.5 rounded-2xl bg-black/38 hover:bg-black/55 border border-white/[0.09] flex items-center justify-between text-xs text-slate-300 transition-colors cursor-pointer"
                        >
                          <span className="inline-flex items-center gap-2">
                            <Play className="w-3.5 h-3.5 text-rose-400 fill-current" />
                            <span>Open YouTube Player &amp; Media Queue</span>
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                        </button>
                      )}
                    </motion.div>
                  )}

                  {activeTab === 'shelf' && (
                    <motion.div
                      key="tab-shelf"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.14 }}
                      className="space-y-2.5"
                    >
                      {/* Mac Drag-and-Drop Notch Shelf */}
                      <div className="p-2.5 rounded-2xl bg-black/38 border border-dashed border-white/[0.14] space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-medium text-slate-300">
                            Notch Drop Shelf
                          </span>
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[11px] text-slate-200 inline-flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <Upload className="w-3 h-3 text-sky-400" />
                            <span>Add File</span>
                          </button>
                        </div>

                        {shelfItems.length > 0 ? (
                          <div className="space-y-1 max-h-28 overflow-y-auto">
                            {shelfItems.map((item) => (
                              <div
                                key={item.id}
                                className="px-2.5 py-1.5 rounded-xl bg-white/[0.04] border border-white/8 flex items-center justify-between gap-2"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileText className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                                  <div className="min-w-0">
                                    <p className="text-[11px] font-medium text-slate-100 truncate">
                                      {item.name}
                                    </p>
                                    <p className="text-[10px] text-slate-500">{item.sizeLabel}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {item.previewText && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onRunCommand(
                                          `Summarize this dropped ${item.kind} "${item.name}":\n${item.previewText}`
                                        );
                                      }}
                                      className="px-2 py-0.5 rounded-md bg-sky-500/20 hover:bg-sky-500/35 text-[10px] font-medium text-sky-200 cursor-pointer"
                                    >
                                      Ask
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    aria-label={`Remove ${item.name}`}
                                    onClick={() =>
                                      setShelfItems((prev) => prev.filter((s) => s.id !== item.id))
                                    }
                                    className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] text-slate-500 text-center py-1">
                            Drag files or text onto the notch anytime to hold or ask {assistantName}.
                          </p>
                        )}
                      </div>

                      {/* All 8 Stage Launchers */}
                      <div className="grid grid-cols-4 gap-1.5">
                        {stageApps.map((app) => (
                          <button
                            key={app.id}
                            type="button"
                            onClick={() => {
                              onSelectDrawer(activeDrawer === app.id ? null : app.id);
                              setExpanded(false);
                            }}
                            className={`relative px-2 py-2 rounded-xl border text-[11px] font-medium flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                              activeDrawer === app.id
                                ? 'bg-sky-500/18 border-sky-400/45 text-white'
                                : app.running
                                  ? 'bg-black/50 border-white/[0.14] text-slate-100'
                                  : 'bg-black/38 border-white/[0.08] text-slate-300 hover:bg-black/55 hover:text-white'
                            }`}
                          >
                            {app.icon}
                            <span className="truncate max-w-full">{app.label}</span>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Clean Utility Footer */}
                <div className="pt-2 border-t border-white/8 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                  <div className="flex items-center gap-1.5 min-w-0 truncate">
                    <span className="font-mono tabular-nums text-slate-300">
                      {formatClock(clockNow)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatShortDate(clockNow)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{aiProviderLabel}</span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setExpanded(false);
                        onOpenAiSettings();
                      }}
                      className="px-2 py-1 rounded-lg hover:bg-white/[0.08] text-slate-300 hover:text-white inline-flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Cpu className="w-3 h-3 text-violet-300" />
                      <span>Keys</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setExpanded(false);
                        onOpenSetup();
                      }}
                      className="px-2 py-1 rounded-lg hover:bg-white/[0.08] text-slate-300 hover:text-white inline-flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Settings2 className="w-3 h-3 text-sky-300" />
                      <span>Setup</span>
                    </button>
                    {faceAuthLockAvailable && onLockWithFace && (
                      <button
                        type="button"
                        onClick={() => {
                          setExpanded(false);
                          onLockWithFace();
                        }}
                        aria-label="Lock session"
                        className="p-1 rounded-lg hover:bg-white/[0.08] text-amber-300 transition-colors cursor-pointer"
                      >
                        <Lock className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpanded(false)}
                      aria-label="Collapse Dynamic Island"
                      className="p-1 rounded-lg hover:bg-white/[0.08] text-slate-400 hover:text-white transition-colors cursor-pointer"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Detached Split Live Activity Pill (Apple Dynamic Island Dual-Capsule Physics) */}
      <AnimatePresence>
        {showSplitTimerPill && (
          <motion.button
            key="split-timer-pill"
            type="button"
            initial={prefersReduced ? { opacity: 0 } : { opacity: 0, x: -14, scale: 0.72 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={prefersReduced ? { opacity: 0 } : { opacity: 0, x: -10, scale: 0.75 }}
            whileHover={!prefersReduced ? { scale: 1.05 } : undefined}
            whileTap={!prefersReduced ? { scale: 0.94 } : undefined}
            transition={SPRING_DETACH}
            onClick={() => {
              setActiveTab('focus');
              setExpanded(true);
            }}
            title="Open Focus Timer"
            className="pointer-events-auto h-9 px-2.5 rounded-full bg-[#020408]/78 backdrop-blur-3xl backdrop-saturate-150 border border-amber-300/35 shadow-[0_14px_38px_rgba(0,0,0,0.78),inset_0_1px_0_rgba(255,255,255,0.16)] flex items-center gap-1.5 cursor-pointer hover:border-amber-200/55 hover:bg-[#05080F]/86 transition-colors"
          >
            <svg className="w-4 h-4 -rotate-90 shrink-0" viewBox="0 0 24 24">
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                stroke="rgba(255,255,255,0.15)"
                strokeWidth="2.5"
              />
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                stroke="#fbbf24"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={56.55}
                strokeDashoffset={56.55 * (1 - timerProgress)}
              />
            </svg>
            <span className="text-[11px] font-mono font-semibold tabular-nums text-amber-200">
              {formatTimer(timerRemaining)}
            </span>
          </motion.button>
        )}

        {!showSplitTimerPill && showSplitMediaPill && currentTrack && (
          <motion.button
            key="split-media-pill"
            type="button"
            initial={prefersReduced ? { opacity: 0 } : { opacity: 0, x: -14, scale: 0.72 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={prefersReduced ? { opacity: 0 } : { opacity: 0, x: -10, scale: 0.75 }}
            whileHover={!prefersReduced ? { scale: 1.07 } : undefined}
            whileTap={!prefersReduced ? { scale: 0.94 } : undefined}
            transition={SPRING_DETACH}
            onClick={() => onSelectDrawer('youtube')}
            title={`Playing: ${currentTrack.title}`}
            className="pointer-events-auto w-9 h-9 rounded-full bg-[#020408]/78 backdrop-blur-3xl backdrop-saturate-150 border border-rose-300/35 shadow-[0_14px_38px_rgba(0,0,0,0.78),inset_0_1px_0_rgba(255,255,255,0.16)] flex items-center justify-center overflow-hidden cursor-pointer hover:border-rose-200/55 hover:bg-[#05080F]/86 transition-colors"
          >
            {currentTrack.thumbnailUrl && !thumbFailed ? (
              <img
                src={currentTrack.thumbnailUrl}
                alt={currentTrack.title}
                referrerPolicy="no-referrer"
                onError={() => setThumbFailed(true)}
                className="w-6 h-6 rounded-full object-cover"
              />
            ) : (
              <Play className="w-3.5 h-3.5 text-rose-400 fill-current ml-0.5" />
            )}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
};
