import React, { useEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from 'motion/react';
import {
  AudioLines,
  Blocks,
  BookOpen,
  CalendarCheck2,
  Camera,
  Check,
  Compass,
  Cpu,
  Eye,
  Globe,
  Image,
  Layers,
  Loader2,
  Lock,
  Mic,
  MicOff,
  MonitorUp,
  Play,
  Radio,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sunrise,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { VisionSourceMode, VoiceName, WakeMode } from '../types/assistant';

export type DockDrawerTab =
  | 'brief'
  | 'research'
  | 'visuals'
  | 'automation'
  | 'youtube'
  | 'workspace'
  | 'meetings'
  | 'vault'
  | 'triggers'
  | 'macros'
  | 'plugins'
  | 'tauri'
  | null;

interface IosControlDockProps {
  assistantName?: string;
  faceAuthLockAvailable?: boolean;
  clapWakeEnabled?: boolean;
  clapArmed?: boolean;
  activeDrawer: DockDrawerTab;
  onSelectDrawer: (tab: DockDrawerTab) => void;
  hudCollapsed: boolean;
  onToggleCollapse: (collapsed: boolean) => void;
  isConnected: boolean;
  isConnecting: boolean;
  isMicMuted: boolean;
  isAssistantSpeaking: boolean;
  isResearching: boolean;
  isGeneratingVisual?: boolean;
  briefPending?: boolean;
  isAutomating: boolean;
  hasActiveVisual?: boolean;
  hasActiveTrack: boolean;
  hasPendingTasks?: boolean;
  hasWorkspaceConnected?: boolean;
  hasActivePlugins?: boolean;
  agentConnected?: boolean;
  voiceName: VoiceName;
  wakeMode: WakeMode;
  voices: VoiceName[];
  onToggleVoiceSession: () => void;
  onToggleMute: () => void;
  onInterruptSpeech: () => void;
  onVoiceChange: (voice: VoiceName) => void;
  onWakeModeChange: (mode: WakeMode) => void;
  onToggleClapWake: (enabled: boolean) => void;
  onOpenSetup: () => void;
  onOpenAiSettings?: () => void;
  aiProviderLabel?: string;
  onLockWithFace?: () => void;
  visionMode?: VisionSourceMode;
  onChangeVisionMode?: (mode: VisionSourceMode) => void;
  deepThinking?: boolean;
  onToggleDeepThinking?: (enabled: boolean) => void;
}

interface DockItemButtonProps {
  mouseX: MotionValue<number>;
  label: string;
  isActive?: boolean;
  isRunning?: boolean;
  disabled?: boolean;
  onClick: () => void;
  squircleClassName: string;
  children: React.ReactNode;
}

const DockItemButton: React.FC<DockItemButtonProps> = ({
  mouseX,
  label,
  isActive = false,
  isRunning = false,
  disabled = false,
  onClick,
  squircleClassName,
  children,
}) => {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const prefersReduced = useReducedMotion();

  const distance = useTransform(mouseX, (val) => {
    if (prefersReduced || val === Infinity) return 200;
    const bounds = ref.current?.getBoundingClientRect();
    if (!bounds) return 200;
    return val - (bounds.left + bounds.width / 2);
  });

  const rawScale = useTransform(distance, [-140, 0, 140], [1, 1.26, 1]);
  const rawLift = useTransform(distance, [-140, 0, 140], [0, -7, 0]);
  const scale = useSpring(rawScale, { mass: 0.12, stiffness: 280, damping: 20 });
  const y = useSpring(rawLift, { mass: 0.12, stiffness: 280, damping: 20 });

  return (
    <div className="relative flex flex-col items-center shrink-0">
      {/* Floating iOS-style label tooltip above magnified icon */}
      <AnimatePresence>
        {hovered && (
          <motion.span
            initial={{ opacity: 0, y: 6, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.94 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-none absolute -top-10 px-2.5 py-1 rounded-lg bg-[#0F172A]/95 border border-white/12 text-[11px] font-medium text-slate-100 shadow-lg whitespace-nowrap z-50"
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>

      <motion.button
        ref={ref}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-pressed={isActive}
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        style={prefersReduced ? undefined : { scale, y }}
        whileTap={prefersReduced ? undefined : { scale: 0.9 }}
        className={`relative w-10 h-10 sm:w-12 sm:h-12 rounded-[13px] sm:rounded-[15px] flex items-center justify-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-50 cursor-pointer select-none ${squircleClassName}`}
      >
        {children}
      </motion.button>

      {/* Authentic iOS / iPadOS Dock running-app indicator dot */}
      <div className="h-1.5 mt-1 flex items-center justify-center">
        <span
          className={`w-1 h-1 rounded-full transition-all duration-200 ${
            isActive
              ? 'bg-white scale-110 opacity-100'
              : isRunning
                ? 'bg-sky-400 opacity-90'
                : 'bg-transparent scale-0 opacity-0'
          }`}
        />
      </div>
    </div>
  );
};

export const IosControlDock: React.FC<IosControlDockProps> = ({
  assistantName = 'Shadow',
  faceAuthLockAvailable = false,
  clapWakeEnabled = true,
  clapArmed = false,
  activeDrawer,
  onSelectDrawer,
  hudCollapsed,
  onToggleCollapse,
  isConnected,
  isConnecting,
  isMicMuted,
  isAssistantSpeaking,
  isResearching,
  isGeneratingVisual = false,
  briefPending = false,
  isAutomating,
  hasActiveVisual = false,
  hasActiveTrack,
  hasPendingTasks = false,
  hasWorkspaceConnected = false,
  hasActivePlugins = false,
  agentConnected = false,
  voiceName,
  wakeMode,
  voices,
  onToggleVoiceSession,
  onToggleMute,
  onInterruptSpeech,
  onVoiceChange,
  onWakeModeChange,
  onToggleClapWake,
  onOpenSetup,
  onOpenAiSettings,
  aiProviderLabel,
  onLockWithFace,
  visionMode = 'off',
  onChangeVisionMode,
  deepThinking = false,
  onToggleDeepThinking,
}) => {
  const mouseX = useMotionValue(Infinity);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dockWrapRef = useRef<HTMLDivElement | null>(null);
  const prefersReduced = useReducedMotion();

  // Close Voice & Mode popover on outside click or Escape
  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (dockWrapRef.current && !dockWrapRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [settingsOpen]);

  // Collapse popover whenever the dock itself tucks away
  useEffect(() => {
    if (hudCollapsed && settingsOpen) {
      setSettingsOpen(false);
    }
  }, [hudCollapsed, settingsOpen]);

  const stageApps: Array<{
    id: Exclude<DockDrawerTab, null>;
    label: string;
    icon: React.ReactNode;
    running: boolean;
    accentClass: string;
  }> = [
    {
      id: 'brief',
      label: 'Brief',
      icon: <Sunrise className="w-5 h-5" />,
      running: Boolean(briefPending),
      accentClass:
        activeDrawer === 'brief'
          ? 'bg-gradient-to-b from-orange-400 to-rose-500 text-white shadow-[0_8px_20px_rgba(251,113,133,0.45),inset_0_1px_0_rgba(255,255,255,0.35)]'
          : 'bg-gradient-to-b from-slate-800/95 to-slate-900/95 text-orange-300 border border-white/10 hover:border-orange-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
    },
    {
      id: 'research',
      label: 'Research',
      icon: <Compass className="w-5 h-5" />,
      running: isResearching,
      accentClass:
        activeDrawer === 'research'
          ? 'bg-gradient-to-b from-indigo-400 to-indigo-600 text-white shadow-[0_8px_20px_rgba(99,102,241,0.45),inset_0_1px_0_rgba(255,255,255,0.35)]'
          : 'bg-gradient-to-b from-slate-800/95 to-slate-900/95 text-indigo-300 border border-white/10 hover:border-indigo-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
    },
    {
      id: 'visuals',
      label: 'Visuals',
      icon: <Image className="w-5 h-5" />,
      running: isGeneratingVisual || hasActiveVisual,
      accentClass:
        activeDrawer === 'visuals'
          ? 'bg-gradient-to-b from-purple-400 to-violet-600 text-white shadow-[0_8px_20px_rgba(168,85,247,0.45),inset_0_1px_0_rgba(255,255,255,0.35)]'
          : 'bg-gradient-to-b from-slate-800/95 to-slate-900/95 text-purple-300 border border-white/10 hover:border-purple-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
    },
    {
      id: 'automation',
      label: 'Automation',
      icon: <Globe className="w-5 h-5" />,
      running: isAutomating,
      accentClass:
        activeDrawer === 'automation'
          ? 'bg-gradient-to-b from-sky-400 to-blue-600 text-white shadow-[0_8px_20px_rgba(56,189,248,0.45),inset_0_1px_0_rgba(255,255,255,0.35)]'
          : 'bg-gradient-to-b from-slate-800/95 to-slate-900/95 text-sky-300 border border-white/10 hover:border-sky-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
    },
    {
      id: 'youtube',
      label: 'YouTube',
      icon: <Play className="w-5 h-5 fill-current ml-0.5" />,
      running: hasActiveTrack,
      accentClass:
        activeDrawer === 'youtube'
          ? 'bg-gradient-to-b from-rose-500 to-red-600 text-white shadow-[0_8px_20px_rgba(244,63,94,0.45),inset_0_1px_0_rgba(255,255,255,0.35)]'
          : 'bg-gradient-to-b from-slate-800/95 to-slate-900/95 text-rose-400 border border-white/10 hover:border-rose-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
    },
    {
      id: 'workspace',
      label: 'Workspace',
      icon: <CalendarCheck2 className="w-5 h-5" />,
      running: hasPendingTasks || hasWorkspaceConnected,
      accentClass:
        activeDrawer === 'workspace'
          ? 'bg-gradient-to-b from-cyan-400 to-blue-600 text-white shadow-[0_8px_20px_rgba(34,211,238,0.45),inset_0_1px_0_rgba(255,255,255,0.35)]'
          : 'bg-gradient-to-b from-slate-800/95 to-slate-900/95 text-cyan-300 border border-white/10 hover:border-cyan-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
    },
    {
      id: 'meetings',
      label: 'Meetings',
      icon: <AudioLines className="w-5 h-5" />,
      running: false,
      accentClass:
        activeDrawer === 'meetings'
          ? 'bg-gradient-to-b from-fuchsia-400 to-purple-600 text-white shadow-[0_8px_20px_rgba(217,70,239,0.45),inset_0_1px_0_rgba(255,255,255,0.35)]'
          : 'bg-gradient-to-b from-slate-800/95 to-slate-900/95 text-fuchsia-300 border border-white/10 hover:border-fuchsia-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
    },
    {
      id: 'vault',
      label: 'Vault & Git',
      icon: <BookOpen className="w-5 h-5" />,
      running: false,
      accentClass:
        activeDrawer === 'vault'
          ? 'bg-gradient-to-b from-teal-400 to-emerald-600 text-slate-950 shadow-[0_8px_20px_rgba(45,212,191,0.45),inset_0_1px_0_rgba(255,255,255,0.45)]'
          : 'bg-gradient-to-b from-slate-800/95 to-slate-900/95 text-teal-300 border border-white/10 hover:border-teal-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
    },
    {
      id: 'triggers',
      label: 'Triggers',
      icon: <Radio className="w-5 h-5" />,
      running: false,
      accentClass:
        activeDrawer === 'triggers'
          ? 'bg-gradient-to-b from-violet-400 to-indigo-600 text-white shadow-[0_8px_20px_rgba(139,92,246,0.45),inset_0_1px_0_rgba(255,255,255,0.35)]'
          : 'bg-gradient-to-b from-slate-800/95 to-slate-900/95 text-violet-300 border border-white/10 hover:border-violet-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
    },
    {
      id: 'macros',
      label: 'Memory & Macros',
      icon: <Layers className="w-5 h-5" />,
      running: false,
      accentClass:
        activeDrawer === 'macros'
          ? 'bg-gradient-to-b from-amber-400 to-orange-500 text-slate-950 shadow-[0_8px_20px_rgba(245,158,11,0.4),inset_0_1px_0_rgba(255,255,255,0.45)]'
          : 'bg-gradient-to-b from-slate-800/95 to-slate-900/95 text-amber-300 border border-white/10 hover:border-amber-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
    },
    {
      id: 'plugins',
      label: 'Plugins',
      icon: <Blocks className="w-5 h-5" />,
      running: hasActivePlugins,
      accentClass:
        activeDrawer === 'plugins'
          ? 'bg-gradient-to-b from-emerald-400 to-teal-600 text-slate-950 shadow-[0_8px_20px_rgba(16,185,129,0.4),inset_0_1px_0_rgba(255,255,255,0.45)]'
          : 'bg-gradient-to-b from-slate-800/95 to-slate-900/95 text-emerald-300 border border-white/10 hover:border-emerald-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
    },
  ];

  return (
    <div
      ref={dockWrapRef}
      className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center max-w-[96vw]"
    >
      {/* iOS Control Center Popover for Wake Mode & Voice Persona */}
      <AnimatePresence>
        {settingsOpen && !hudCollapsed && (
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            className="mb-3 w-72 p-3.5 rounded-[22px] bg-[#0B111E]/64 backdrop-blur-3xl backdrop-saturate-150 border border-white/18 shadow-[0_24px_60px_rgba(0,0,0,0.68),inset_0_1px_0_rgba(255,255,255,0.22)] origin-bottom"
          >
            {/* Wake Mode iOS Segmented Switch */}
            <div className="space-y-1.5 mb-3.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] font-medium text-slate-400">Input Mode</span>
                <span className="text-[11px] text-slate-500 font-mono">
                  {wakeMode === 'push-to-talk' ? 'Hold Space' : 'Open Mic'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/45 border border-white/8">
                {(
                  [
                    { id: 'push-to-talk', label: 'Push-to-Talk' },
                    { id: 'continuous', label: 'Continuous' },
                  ] as const
                ).map((mode) => {
                  const selected = wakeMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => onWakeModeChange(mode.id)}
                      className={`relative py-1.5 px-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        selected ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {selected && (
                        <motion.span
                          layoutId="ios-wake-pill"
                          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                          className="absolute inset-0 rounded-lg bg-slate-700/85 border border-white/12 shadow-sm"
                        />
                      )}
                      <span className="relative z-10">{mode.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Clap Twice Wake Toggle */}
            <div className="mb-3 flex items-center justify-between gap-3 px-2.5 py-2 rounded-xl bg-black/35 border border-white/8">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-200">Double-Clap Wake</p>
                <p className="text-[10px] text-slate-400">
                  {clapWakeEnabled ? (clapArmed ? 'Listening for 2 claps' : 'Click once to arm mic') : 'Off'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={clapWakeEnabled}
                onClick={() => onToggleClapWake(!clapWakeEnabled)}
                className={`relative w-10 h-5.5 rounded-full transition-colors shrink-0 cursor-pointer ${
                  clapWakeEnabled ? 'bg-sky-500' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    clapWakeEnabled ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Deep Reasoning Toggle */}
            {onToggleDeepThinking && (
              <div className="mb-3 flex items-center justify-between gap-3 px-2.5 py-2 rounded-xl bg-black/35 border border-white/8">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-200 inline-flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-indigo-300" />
                    <span>Deep Reasoning</span>
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {deepThinking ? 'Multi-step planning active' : 'Auto fast & adaptive'}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={deepThinking}
                  onClick={() => onToggleDeepThinking(!deepThinking)}
                  className={`relative w-10 h-5.5 rounded-full transition-colors shrink-0 cursor-pointer ${
                    deepThinking ? 'bg-indigo-500' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      deepThinking ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            )}

            {/* Multimodal Vision Selector */}
            {onChangeVisionMode && (
              <div className="space-y-1.5 mb-3.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-medium text-slate-400 inline-flex items-center gap-1.5">
                    <Eye className="w-3 h-3 text-emerald-400" />
                    <span>Live Vision</span>
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {visionMode === 'off' ? 'Standby' : visionMode === 'camera' ? 'Camera' : 'Screen'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-black/45 border border-white/8">
                  {(
                    [
                      { id: 'off', label: 'Off', icon: null },
                      { id: 'camera', label: 'Camera', icon: <Camera className="w-3 h-3" /> },
                      { id: 'screen', label: 'Screen', icon: <MonitorUp className="w-3 h-3" /> },
                    ] as const
                  ).map((opt) => {
                    const selected = visionMode === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onChangeVisionMode(opt.id)}
                        className={`py-1 px-1.5 rounded-lg text-[11px] font-medium inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          selected
                            ? opt.id === 'camera'
                              ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/40'
                              : opt.id === 'screen'
                                ? 'bg-sky-500/25 text-sky-200 border border-sky-400/40'
                                : 'bg-slate-700/85 text-white border border-white/12'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {opt.icon}
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Voice Persona Selection Rows */}
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 px-1 pb-1">
                <Volume2 className="w-3.5 h-3.5 text-sky-400" />
                <span className="text-[11px] font-medium text-slate-400">Voice Persona</span>
              </div>
              <div className="rounded-xl bg-black/35 border border-white/8 divide-y divide-white/6 overflow-hidden">
                {voices.map((v) => {
                  const selected = voiceName === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        onVoiceChange(v);
                        setSettingsOpen(false);
                      }}
                      className={`w-full px-3 py-2 flex items-center justify-between text-xs transition-colors ${
                        selected
                          ? 'bg-sky-500/15 text-sky-200 font-semibold'
                          : 'text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      <span>{v}</span>
                      {selected && <Check className="w-3.5 h-3.5 text-sky-400" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  onOpenAiSettings?.();
                }}
                className="flex-1 py-2 px-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/8 text-xs font-medium text-slate-200 inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Cpu className="w-3.5 h-3.5 text-violet-400" />
                <span>{aiProviderLabel || 'AI Provider'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  onOpenSetup();
                }}
                className="flex-1 py-2 px-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/8 text-xs font-medium text-slate-200 inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Settings2 className="w-3.5 h-3.5 text-sky-400" />
                <span>Setup</span>
              </button>
              {faceAuthLockAvailable && onLockWithFace && (
                <button
                  type="button"
                  onClick={() => {
                    setSettingsOpen(false);
                    onLockWithFace();
                  }}
                  className="flex-1 py-2 px-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/8 text-xs font-medium text-amber-200 inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Face Lock</span>
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main iOS Floating Glass Dock */}
      <AnimatePresence initial={false} mode="wait">
        {!hudCollapsed ? (
          <motion.div
            key="ios-dock-expanded"
            initial={{ y: 40, opacity: 0, scale: 0.94 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 48, opacity: 0, scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            className="flex flex-col items-center"
          >
            <div
              onMouseMove={(e) => mouseX.set(e.clientX)}
              onMouseLeave={() => mouseX.set(Infinity)}
              className="px-2.5 sm:px-3.5 pt-2.5 pb-1.5 rounded-[24px] sm:rounded-[28px] bg-[#0B111E]/58 backdrop-blur-3xl backdrop-saturate-150 border border-white/18 shadow-[0_22px_56px_rgba(0,0,0,0.62),inset_0_1px_0_rgba(255,255,255,0.24)] flex items-end gap-1.5 sm:gap-2.5 max-w-[94vw] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {/* Primary Voice Core Squircle */}
              <DockItemButton
                mouseX={mouseX}
                label={
                  isConnected
                    ? 'Stop Voice'
                    : isConnecting
                      ? 'Connecting...'
                      : `Speak with ${assistantName}`
                }
                isActive={isConnected}
                isRunning={isConnecting}
                disabled={isConnecting}
                onClick={onToggleVoiceSession}
                squircleClassName={
                  isConnected
                    ? 'bg-gradient-to-b from-rose-500 to-red-600 text-white shadow-[0_8px_22px_rgba(244,63,94,0.45),inset_0_1px_0_rgba(255,255,255,0.35)]'
                    : 'bg-gradient-to-b from-sky-400 to-cyan-500 text-slate-950 shadow-[0_8px_22px_rgba(56,189,248,0.4),inset_0_1px_0_rgba(255,255,255,0.55)]'
                }
              >
                {isConnecting ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : isConnected ? (
                  <Square className="w-4 h-4 fill-current" />
                ) : (
                  <Mic className="w-5 h-5" />
                )}
              </DockItemButton>

              {/* Dynamic Live Mic Mute & Interrupt Squircles */}
              <AnimatePresence>
                {isConnected && (
                  <motion.div
                    key="dock-mute-tile"
                    initial={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                  >
                    <DockItemButton
                      mouseX={mouseX}
                      label={isMicMuted ? 'Unmute Mic' : 'Mute Mic'}
                      isActive={isMicMuted}
                      onClick={onToggleMute}
                      squircleClassName={
                        isMicMuted
                          ? 'bg-gradient-to-b from-amber-400 to-amber-600 text-slate-950 shadow-[0_6px_16px_rgba(245,158,11,0.35),inset_0_1px_0_rgba(255,255,255,0.4)]'
                          : 'bg-gradient-to-b from-slate-800/95 to-slate-900/95 text-sky-300 border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                      }
                    >
                      {isMicMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    </DockItemButton>
                  </motion.div>
                )}

                {isAssistantSpeaking && (
                  <motion.div
                    key="dock-interrupt-tile"
                    initial={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                  >
                    <DockItemButton
                      mouseX={mouseX}
                      label="Interrupt Speech"
                      isRunning
                      onClick={onInterruptSpeech}
                      squircleClassName="bg-gradient-to-b from-amber-500/25 to-amber-600/25 text-amber-300 border border-amber-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
                    >
                      <VolumeX className="w-5 h-5" />
                    </DockItemButton>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* iOS Dock Vertical Hairline Divider */}
              <div className="w-px h-8 mb-2.5 bg-white/12 mx-0.5 shrink-0" aria-hidden="true" />

              {/* Jarvis Stage App Squircles */}
              {stageApps.map((app) => (
                <DockItemButton
                  key={app.id}
                  mouseX={mouseX}
                  label={app.label}
                  isActive={activeDrawer === app.id}
                  isRunning={app.running}
                  onClick={() => onSelectDrawer(activeDrawer === app.id ? null : app.id)}
                  squircleClassName={app.accentClass}
                >
                  {app.icon}
                </DockItemButton>
              ))}

              {/* Divider before Control Center Utility Tile */}
              <div className="w-px h-8 mb-2.5 bg-white/12 mx-0.5 shrink-0" aria-hidden="true" />

              {/* Voice & Input Mode Settings Squircle */}
              <DockItemButton
                mouseX={mouseX}
                label={`Voice: ${voiceName}`}
                isActive={settingsOpen}
                onClick={() => setSettingsOpen((prev) => !prev)}
                squircleClassName={
                  settingsOpen
                    ? 'bg-gradient-to-b from-slate-200 to-slate-400 text-slate-950 shadow-[0_8px_20px_rgba(226,232,240,0.28),inset_0_1px_0_rgba(255,255,255,0.65)]'
                    : 'bg-gradient-to-b from-slate-800/95 to-slate-900/95 text-slate-200 border border-white/10 hover:border-white/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                }
              >
                <SlidersHorizontal className="w-5 h-5" />
              </DockItemButton>
            </div>

            {/* iOS Home Indicator Bar to Tuck Dock */}
            <button
              type="button"
              onClick={() => onToggleCollapse(true)}
              aria-label="Hide dock controls"
              title="Hide Dock (H)"
              className="mt-2 py-1 px-4 group focus-visible:outline-none"
            >
              <span className="block w-24 h-1 rounded-full bg-white/25 group-hover:bg-white/55 transition-colors" />
            </button>
          </motion.div>
        ) : (
          <motion.button
            key="ios-home-indicator-pill"
            type="button"
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            onClick={() => onToggleCollapse(false)}
            aria-label="Show dock controls"
            title="Show Dock (H)"
            className="mb-1 px-5 py-2 rounded-full bg-[#0B111E]/75 backdrop-blur-md border border-white/10 hover:border-white/25 group shadow-lg"
          >
            <span className="block w-28 h-1 rounded-full bg-white/35 group-hover:bg-sky-300 transition-colors" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
};
