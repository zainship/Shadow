import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell,
  Brain,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  Mic,
  Play,
  Plus,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { getApiOrigin, parseJsonSafely } from '../lib/apiBase';
import {
  aiRequestHeaders,
  DEFAULT_AI_SETTINGS,
  OPENROUTER_MODEL_SUGGESTIONS,
  type AiProviderChoice,
  type AiSettings,
} from '../lib/aiSettings';
import {
  averageDescriptors,
  DEFAULT_FACE_THRESHOLD,
  extractFaceDescriptorFromVideo,
  sha256Hex,
  stopMediaStream,
} from '../lib/faceAuth';
import {
  probeSystemPermissions,
  requestCameraAccess,
  requestMicrophoneAccess,
  requestNativeOsPermission,
  requestNotificationAccess,
  type OsPermissionSnapshot,
  type OsPermissionState,
} from '../lib/osPermissions';
import type {
  FaceAuthProfile,
  MemoryCategory,
  MemoryImportance,
  SetupConfig,
  ShadowPermissions,
} from '../types/assistant';

export interface SeedMemoryDraft {
  id: string;
  category: MemoryCategory;
  content: string;
  importance: MemoryImportance;
}

interface FirstLaunchSetupModalProps {
  open: boolean;
  isFirstLaunch: boolean;
  initialConfig: SetupConfig;
  initialAiSettings?: AiSettings;
  existingFaceAuth: FaceAuthProfile | null;
  onClose?: () => void;
  onSaveAiSettings?: (next: AiSettings) => void;
  onConfirmPolicyChange?: (confirm: boolean) => void;
  onComplete: (result: {
    config: SetupConfig;
    aiSettings?: AiSettings;
    seedMemories: SeedMemoryDraft[];
    faceAuthProfile?: Omit<FaceAuthProfile, 'uid' | 'createdAt' | 'updatedAt'> | null;
    clearFaceAuth?: boolean;
  }) => Promise<void>;
}

const STEPS = [
  { id: 'identity', label: 'Identity' },
  { id: 'ai', label: 'AI & Keys' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'memory', label: 'Memory' },
  { id: 'face', label: 'Face Auth' },
] as const;

const PERMISSION_ITEMS: Array<{
  key: keyof ShadowPermissions;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    key: 'browser',
    label: 'Browser Automation',
    description: 'Open sites, inspect DOM selectors, fill & submit web forms, and extract data.',
    icon: <Globe className="w-4 h-4 text-sky-400" />,
  },
  {
    key: 'research',
    label: 'Deep Web Research',
    description: 'Search live sources, verify links, and deliver spoken briefings.',
    icon: <Compass className="w-4 h-4 text-sky-400" />,
  },
  {
    key: 'youtube',
    label: 'YouTube Media',
    description: 'Search and play any song or video via voice command.',
    icon: <Play className="w-4 h-4 text-sky-400" />,
  },
  {
    key: 'memory',
    label: 'Long-Term Memory',
    description: 'Remember your facts, preferences, projects, and routines across sessions.',
    icon: <Brain className="w-4 h-4 text-sky-400" />,
  },
  {
    key: 'faceAuth',
    label: 'Facial Recognition Lock',
    description: 'Require face authentication to unlock your assistant on launch.',
    icon: <ShieldCheck className="w-4 h-4 text-sky-400" />,
  },
];

export const FirstLaunchSetupModal: React.FC<FirstLaunchSetupModalProps> = ({
  open,
  isFirstLaunch,
  initialConfig,
  initialAiSettings,
  existingFaceAuth,
  onClose,
  onSaveAiSettings,
  onComplete,
}) => {
  const [stepIdx, setStepIdx] = useState(0);
  const [userPreferredName, setUserPreferredName] = useState(initialConfig.userPreferredName);
  const [assistantName, setAssistantName] = useState(initialConfig.assistantName || 'Shadow');
  const [permissions, setPermissions] = useState<ShadowPermissions>({ ...initialConfig.permissions });
  const [osSnapshot, setOsSnapshot] = useState<OsPermissionSnapshot | null>(null);
  const [requestingOsKind, setRequestingOsKind] = useState<string | null>(null);
  const [permFeedback, setPermFeedback] = useState<string | null>(null);
  const [faceAuthEnabled, setFaceAuthEnabled] = useState(initialConfig.faceAuthEnabled);
  const [clapWakeEnabled, setClapWakeEnabled] = useState(initialConfig.clapWakeEnabled);

  // BYOK / AI Provider state
  const [aiDraft, setAiDraft] = useState<AiSettings>(initialAiSettings || DEFAULT_AI_SETTINGS);
  const [showOrKey, setShowOrKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [keyTestResult, setKeyTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [serverAiStatus, setServerAiStatus] = useState<{
    hasServerGeminiKey?: boolean;
    hasServerOpenRouterKey?: boolean;
  } | null>(null);

  // Memory seeding state
  const [seedMemories, setSeedMemories] = useState<SeedMemoryDraft[]>([]);
  const [draftContent, setDraftContent] = useState('');
  const [draftCategory, setDraftCategory] = useState<MemoryCategory>('preference');
  const [draftImportance, setDraftImportance] = useState<MemoryImportance>('normal');

  // Facial recognition enrollment state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [enrolledDescriptor, setEnrolledDescriptor] = useState<number[] | null>(
    existingFaceAuth?.descriptor ?? null
  );
  const [clearExistingFace, setClearExistingFace] = useState(false);
  const [backupPin, setBackupPin] = useState('');
  const [saving, setSaving] = useState(false);

  const refreshOsPermissions = async () => {
    const snap = await probeSystemPermissions();
    setOsSnapshot(snap);
  };

  // Reset form state when modal opens
  useEffect(() => {
    if (!open) return;
    setStepIdx(0);
    setUserPreferredName(initialConfig.userPreferredName);
    setAssistantName(initialConfig.assistantName || 'Shadow');
    setPermissions({ ...initialConfig.permissions });
    setPermFeedback(null);
    setFaceAuthEnabled(initialConfig.faceAuthEnabled);
    setClapWakeEnabled(initialConfig.clapWakeEnabled);
    setAiDraft(initialAiSettings || DEFAULT_AI_SETTINGS);
    setKeyTestResult(null);
    setEnrolledDescriptor(existingFaceAuth?.descriptor ?? null);
    setClearExistingFace(false);
    setSeedMemories([]);
    setBackupPin('');
    setCameraError(null);
    setCaptureProgress(0);
    void refreshOsPermissions();
    void fetch(`${getApiOrigin()}/api/ai/status`)
      .then((r) => (r.ok ? parseJsonSafely<{ hasServerGeminiKey?: boolean; hasServerOpenRouterKey?: boolean }>(r) : null))
      .then((data) => {
        if (data) setServerAiStatus(data);
      })
      .catch(() => null);
  }, [open, initialConfig, initialAiSettings, existingFaceAuth]);

  const handleRequestDevicePermission = async (
    kind: 'microphone' | 'camera' | 'notifications' | 'files' | 'automation'
  ) => {
    setRequestingOsKind(kind);
    setPermFeedback(null);
    try {
      if (kind === 'microphone') {
        const res = await requestMicrophoneAccess();
        if (res.state === 'denied') {
          const nativeRes = await requestNativeOsPermission('microphone');
          setPermFeedback(
            nativeRes.message ||
              res.error ||
              'Microphone access denied. Enable Microphone in OS Privacy Settings.'
          );
        } else {
          setPermFeedback('Microphone permission granted.');
        }
      } else if (kind === 'camera') {
        const res = await requestCameraAccess();
        if (res.state === 'denied') {
          const nativeRes = await requestNativeOsPermission('camera');
          setPermFeedback(
            nativeRes.message ||
              res.error ||
              'Camera access denied. Enable Camera in OS Privacy Settings.'
          );
        } else {
          setPermFeedback('Camera permission granted.');
        }
      } else if (kind === 'notifications') {
        const state = await requestNotificationAccess();
        if (state === 'denied') {
          const nativeRes = await requestNativeOsPermission('notifications');
          setPermFeedback(
            nativeRes.message || 'Notifications blocked. Allow them in browser/OS Settings.'
          );
        } else {
          setPermFeedback(
            state === 'granted' ? 'Desktop notifications granted.' : 'Notification prompt dismissed.'
          );
        }
      } else if (kind === 'files' || kind === 'automation') {
        const nativeRes = await requestNativeOsPermission(kind);
        setPermFeedback(
          nativeRes.message ||
            (kind === 'files'
              ? 'Local folder access verified.'
              : 'OS desktop automation permission checked.')
        );
      }
      await refreshOsPermissions();
    } finally {
      setRequestingOsKind(null);
    }
  };

  const handleRequestAllDevicePermissions = async () => {
    setRequestingOsKind('all');
    setPermFeedback(null);
    try {
      await requestMicrophoneAccess();
      await requestCameraAccess();
      await requestNotificationAccess();
      if (osSnapshot?.isTauri) {
        await requestNativeOsPermission('files');
        await requestNativeOsPermission('automation');
      }
      await refreshOsPermissions();
      setPermFeedback('System permission prompts completed. Review status badges below.');
    } finally {
      setRequestingOsKind(null);
    }
  };

  const stopCamera = () => {
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  // Ensure camera shuts off whenever step changes away from Face Auth or modal closes
  useEffect(() => {
    if (!open || STEPS[stepIdx].id !== 'face') {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [open, stepIdx]);

  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err) {
      setCameraError(
        err instanceof Error
          ? err.message
          : 'Unable to access webcam. You can still set a backup passcode or skip Face Auth.'
      );
      setCameraActive(false);
    }
  };

  const handleEnrollFace = async () => {
    if (!videoRef.current || !cameraActive || capturing) return;
    setCameraError(null);
    setCapturing(true);
    setCaptureProgress(0);

    const scratch = document.createElement('canvas');
    const samples: number[][] = [];
    const targetSamples = 3;

    try {
      for (let attempt = 0; attempt < 12 && samples.length < targetSamples; attempt++) {
        const res = extractFaceDescriptorFromVideo(videoRef.current, scratch);
        if (res.ok && res.descriptor) {
          samples.push(res.descriptor);
          setCaptureProgress(samples.length);
        } else if (attempt === 11 && samples.length === 0) {
          setCameraError(res.reason || 'Could not detect clear facial lighting.');
        }
        await new Promise((r) => setTimeout(r, 240));
      }

      if (samples.length === targetSamples) {
        const merged = averageDescriptors(samples);
        setEnrolledDescriptor(merged);
        setClearExistingFace(false);
        setFaceAuthEnabled(true);
        setPermissions((prev) => ({ ...prev, faceAuth: true }));
        stopCamera();
      } else if (samples.length > 0) {
        const merged = averageDescriptors(samples);
        setEnrolledDescriptor(merged);
        setClearExistingFace(false);
        setFaceAuthEnabled(true);
        setPermissions((prev) => ({ ...prev, faceAuth: true }));
        stopCamera();
      }
    } finally {
      setCapturing(false);
    }
  };

  const handleAddMemoryDraft = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = draftContent.trim();
    if (!clean) return;
    setSeedMemories((prev) => [
      {
        id: `seed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        category: draftCategory,
        content: clean.slice(0, 600),
        importance: draftImportance,
      },
      ...prev,
    ]);
    setDraftContent('');
  };

  const normalizedAiDraft = (): AiSettings => ({
    provider: aiDraft.provider,
    geminiKey: aiDraft.geminiKey.trim(),
    openrouterKey: aiDraft.openrouterKey.trim(),
    openrouterModel: aiDraft.openrouterModel.trim(),
  });

  const handleTestAiKey = async () => {
    if (testingKey) return;
    setTestingKey(true);
    setKeyTestResult(null);
    const clean = normalizedAiDraft();
    try {
      const res = await fetch(`${getApiOrigin()}/api/ai/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...aiRequestHeaders(clean),
        },
        body: JSON.stringify({}),
      });
      const data = await parseJsonSafely<{
        ok?: boolean;
        provider?: string;
        model?: string;
        error?: string;
      }>(res);
      if (!res.ok || !data?.ok) {
        setKeyTestResult({
          ok: false,
          text:
            data?.error ||
            (data
              ? 'Verification failed'
              : 'Static PWA mode: enter a Shadow Server URL in AI Keys to test server keys.'),
        });
      } else {
        setKeyTestResult({
          ok: true,
          text: `Connected (${data.provider}${data.model ? ` · ${data.model}` : ''})`,
        });
      }
    } catch (err) {
      setKeyTestResult({
        ok: false,
        text: err instanceof Error ? err.message : 'Unable to reach Shadow server',
      });
    } finally {
      setTestingKey(false);
    }
  };

  const handleFinish = async () => {
    setSaving(true);
    stopCamera();
    try {
      const normalizedAssistant = (assistantName.trim() || 'Shadow').slice(0, 60);
      const normalizedUser = userPreferredName.trim().slice(0, 80);
      const hasFaceNow = Boolean(enrolledDescriptor && enrolledDescriptor.length >= 16 && !clearExistingFace);
      const finalFaceEnabled = Boolean(faceAuthEnabled && permissions.faceAuth && hasFaceNow);

      let facePayload: Omit<FaceAuthProfile, 'uid' | 'createdAt' | 'updatedAt'> | null = null;
      if (hasFaceNow && enrolledDescriptor) {
        const passcodeHash = backupPin.trim()
          ? await sha256Hex(backupPin.trim())
          : existingFaceAuth?.passcodeHash || '';
        facePayload = {
          descriptor: enrolledDescriptor,
          sampleCount: 3,
          threshold: DEFAULT_FACE_THRESHOLD,
          passcodeHash,
        };
      }

      const finalAiSettings = normalizedAiDraft();
      onSaveAiSettings?.(finalAiSettings);

      await onComplete({
        config: {
          userPreferredName: normalizedUser,
          assistantName: normalizedAssistant,
          setupCompleted: true,
          faceAuthEnabled: finalFaceEnabled,
          clapWakeEnabled,
          permissions,
        },
        aiSettings: finalAiSettings,
        seedMemories,
        faceAuthProfile: facePayload,
        clearFaceAuth: clearExistingFace,
      });
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    // Still render AnimatePresence wrapper for smooth Mac sheet exit transitions
  }

  const activeStep = STEPS[stepIdx];
  const displayAssistant = assistantName.trim() || 'Shadow';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xl p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 20, filter: 'blur(8px)' }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.95, y: 14, filter: 'blur(6px)' }}
            transition={{ type: 'spring', stiffness: 370, damping: 30, mass: 0.85 }}
            className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-[22px] bg-[#0B111E]/72 backdrop-blur-3xl backdrop-saturate-150 border border-white/18 shadow-[0_32px_90px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.2)] overflow-hidden"
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-white/12 flex items-center justify-between gap-4 bg-white/[0.04]">
              <div className="space-y-0.5">
                <h2 className="text-base font-semibold text-slate-100">
                  {isFirstLaunch ? 'First-Launch PWA Setup' : `${displayAssistant} Setup & Permissions`}
                </h2>
                <p className="text-xs text-slate-400">
                  Personalize identity, grant browser permissions, seed memory, and configure face lock.
                </p>
              </div>

              {!isFirstLaunch && onClose && (
                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    onClose();
                  }}
                  aria-label="Close setup"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Stepper Bar */}
            <div className="px-6 py-3 border-b border-white/10 bg-black/25 grid grid-cols-2 sm:grid-cols-5 gap-2">
              {STEPS.map((s, idx) => {
                const isActive = idx === stepIdx;
                const isDone = idx < stepIdx;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStepIdx(idx)}
                    className={`relative px-3 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                      isActive
                        ? 'text-sky-200'
                        : isDone
                          ? 'bg-white/[0.05] text-slate-200 border border-white/10'
                          : 'text-slate-500 hover:text-slate-300 border border-transparent'
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="setup-active-step-pill"
                        transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                        className="absolute inset-0 rounded-lg bg-sky-500/20 border border-sky-400/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]"
                      />
                    )}
                    <span className="relative z-10 font-mono text-[11px] opacity-80">{idx + 1}.</span>
                    <span className="relative z-10">{s.label}</span>
                  </button>
                );
              })}
            </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            {activeStep.id === 'identity' && (
              <motion.div
                key="step-identity"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.16 }}
                className="space-y-5"
              >
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    What should {displayAssistant} call you?
                  </label>
                  <input
                    type="text"
                    value={userPreferredName}
                    onChange={(e) => setUserPreferredName(e.target.value)}
                    placeholder="e.g., Alex, Boss, Captain"
                    maxLength={80}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#070A10] border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                  />
                  <div className="flex flex-wrap gap-2 pt-1">
                    {['Boss', 'Sir', 'Alex', 'Chief'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setUserPreferredName(preset)}
                        className="px-2.5 py-1 rounded-md border border-slate-800 bg-[#070A10] text-[11px] text-slate-300 hover:border-sky-500/50"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5 pt-2">
                  <label className="block text-xs font-medium text-slate-300">
                    Assistant Name
                  </label>
                  <input
                    type="text"
                    value={assistantName}
                    onChange={(e) => setAssistantName(e.target.value)}
                    placeholder="Shadow"
                    maxLength={60}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#070A10] border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                  />
                  <p className="text-xs text-slate-500">
                    Used across voice greetings, live captions, system prompts, and the PWA HUD.
                  </p>
                </div>

                <label className="mt-2 p-3.5 rounded-xl bg-[#070A10] border border-slate-800 flex items-center justify-between gap-3 cursor-pointer">
                  <div className="space-y-0.5">
                    <p className="text-xs font-medium text-slate-200">
                      Double-Clap Hands-Free Activation
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Automatically wake and start listening whenever you clap twice.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={clapWakeEnabled}
                    onChange={(e) => setClapWakeEnabled(e.target.checked)}
                    className="rounded border-slate-700 bg-[#0D111A]"
                  />
                </label>
              </motion.div>
            )}

            {activeStep.id === 'ai' && (
              <motion.div
                key="step-ai"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.16 }}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <h3 className="text-sm font-medium text-slate-100 flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-sky-400" />
                    <span>AI Provider &amp; API Keys (No .env Needed)</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Connect your own OpenRouter or Gemini key right here. Keys stay in browser storage on this device and route requests straight from your backend.
                  </p>
                </div>

                {serverAiStatus && !serverAiStatus.hasServerGeminiKey && !serverAiStatus.hasServerOpenRouterKey && aiDraft.provider === 'server' && (
                  <div className="rounded-xl border border-amber-500/35 bg-amber-950/40 px-3.5 py-2.5 text-xs text-amber-200">
                    No server <code className="font-mono">.env</code> key was detected. Pick <strong>OpenRouter (BYOK)</strong> or <strong>Gemini (BYOK)</strong> below and paste your API key.
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {(
                    [
                      {
                        id: 'openrouter' as AiProviderChoice,
                        label: 'OpenRouter (BYOK)',
                        sub: 'GPT-4o, Claude, Llama, DeepSeek & more',
                        icon: <KeyRound className="w-4 h-4 text-violet-400" />,
                      },
                      {
                        id: 'gemini' as AiProviderChoice,
                        label: 'Gemini (BYOK)',
                        sub: 'Google AI Studio + Live Voice + TTS',
                        icon: <Cpu className="w-4 h-4 text-emerald-400" />,
                      },
                      {
                        id: 'server' as AiProviderChoice,
                        label: 'Server Default',
                        sub: 'Use backend environment keys if set',
                        icon: <Server className="w-4 h-4 text-sky-400" />,
                      },
                    ] as const
                  ).map((opt) => {
                    const active = aiDraft.provider === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setAiDraft((prev) => ({ ...prev, provider: opt.id }));
                          setKeyTestResult(null);
                        }}
                        className={`p-3 rounded-xl border text-left transition-colors flex flex-col gap-1 ${
                          active
                            ? 'bg-sky-500/12 border-sky-500/50'
                            : 'bg-[#070A10] border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-100">
                            {opt.icon}
                            <span>{opt.label}</span>
                          </span>
                          {active && <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
                        </div>
                        <span className="text-[11px] text-slate-400 leading-snug">{opt.sub}</span>
                      </button>
                    );
                  })}
                </div>

                {aiDraft.provider === 'openrouter' && (
                  <div className="space-y-3 pt-1">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        OpenRouter API Key
                      </label>
                      <div className="relative">
                        <input
                          type={showOrKey ? 'text' : 'password'}
                          value={aiDraft.openrouterKey}
                          onChange={(e) => setAiDraft((p) => ({ ...p, openrouterKey: e.target.value }))}
                          placeholder="sk-or-v1-..."
                          spellCheck={false}
                          autoComplete="off"
                          className="w-full px-3.5 py-2 pr-10 rounded-xl bg-[#070A10] border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-400 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowOrKey((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-100"
                          aria-label="Toggle OpenRouter key visibility"
                        >
                          {showOrKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">
                          OpenRouter Model (optional)
                        </label>
                        <input
                          type="text"
                          value={aiDraft.openrouterModel}
                          onChange={(e) => setAiDraft((p) => ({ ...p, openrouterModel: e.target.value }))}
                          placeholder="openai/gpt-4o-mini"
                          spellCheck={false}
                          autoComplete="off"
                          list="setup-openrouter-models"
                          className="w-full px-3.5 py-2 rounded-xl bg-[#070A10] border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-400 font-mono"
                        />
                        <datalist id="setup-openrouter-models">
                          {OPENROUTER_MODEL_SUGGESTIONS.map((m) => (
                            <option key={m} value={m} />
                          ))}
                        </datalist>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">
                          Companion Gemini Key (optional for Live Voice)
                        </label>
                        <div className="relative">
                          <input
                            type={showGeminiKey ? 'text' : 'password'}
                            value={aiDraft.geminiKey}
                            onChange={(e) => setAiDraft((p) => ({ ...p, geminiKey: e.target.value }))}
                            placeholder="AIza... (speech falls back to browser TTS)"
                            spellCheck={false}
                            autoComplete="off"
                            className="w-full px-3.5 py-2 pr-10 rounded-xl bg-[#070A10] border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400 font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => setShowGeminiKey((v) => !v)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-100"
                            aria-label="Toggle Gemini key visibility"
                          >
                            {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {aiDraft.provider === 'gemini' && (
                  <div className="space-y-1.5 pt-1">
                    <label className="block text-xs font-medium text-slate-300">
                      Gemini API Key (Google AI Studio)
                    </label>
                    <div className="relative">
                      <input
                        type={showGeminiKey ? 'text' : 'password'}
                        value={aiDraft.geminiKey}
                        onChange={(e) => setAiDraft((p) => ({ ...p, geminiKey: e.target.value }))}
                        placeholder="AIza..."
                        spellCheck={false}
                        autoComplete="off"
                        className="w-full px-3.5 py-2 pr-10 rounded-xl bg-[#070A10] border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowGeminiKey((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-100"
                        aria-label="Toggle Gemini key visibility"
                      >
                        {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <button
                    type="button"
                    disabled={
                      testingKey ||
                      (aiDraft.provider === 'openrouter' && !aiDraft.openrouterKey.trim()) ||
                      (aiDraft.provider === 'gemini' && !aiDraft.geminiKey.trim())
                    }
                    onClick={() => void handleTestAiKey()}
                    className="px-3.5 py-2 rounded-xl border border-slate-700 bg-[#070A10] text-xs font-medium text-slate-200 hover:border-sky-500/50 disabled:opacity-40 inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {testingKey ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                    )}
                    <span>Verify API Key</span>
                  </button>

                  {keyTestResult && (
                    <span
                      className={`text-xs ${
                        keyTestResult.ok ? 'text-emerald-300' : 'text-rose-300'
                      }`}
                    >
                      {keyTestResult.text}
                    </span>
                  )}
                </div>
              </motion.div>
            )}

            {activeStep.id === 'permissions' && (
              <motion.div
                key="step-permissions"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.16 }}
                className="space-y-4"
              >
                {/* Real Browser & Device Permissions */}
                <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/12 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-sky-400" />
                        <span>Browser &amp; Device Permissions</span>
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Grant native browser access for Microphone, Camera, and Notifications.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={requestingOsKind !== null}
                      onClick={() => void handleRequestAllDevicePermissions()}
                      className="px-3 py-1.5 rounded-lg bg-sky-500 text-slate-950 text-[11px] font-semibold hover:bg-sky-400 disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {requestingOsKind === 'all' ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3" />
                      )}
                      <span>Request All Permissions</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(
                      [
                        {
                          id: 'microphone' as const,
                          label: 'Microphone',
                          state: osSnapshot?.microphone ?? ('prompt' as OsPermissionState),
                          icon: <Mic className="w-3.5 h-3.5 text-sky-300" />,
                        },
                        {
                          id: 'camera' as const,
                          label: 'Camera (Face Auth)',
                          state: osSnapshot?.camera ?? ('prompt' as OsPermissionState),
                          icon: <Camera className="w-3.5 h-3.5 text-emerald-300" />,
                        },
                        {
                          id: 'notifications' as const,
                          label: 'Notifications',
                          state: osSnapshot?.notifications ?? ('prompt' as OsPermissionState),
                          icon: <Bell className="w-3.5 h-3.5 text-amber-300" />,
                        },
                      ] as const
                    ).map((item) => {
                      const badgeClass =
                        item.state === 'granted'
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/35'
                          : item.state === 'denied'
                            ? 'bg-rose-500/20 text-rose-300 border-rose-400/35'
                            : 'bg-amber-500/15 text-amber-200 border-amber-400/30';
                      const badgeText =
                        item.state === 'granted'
                          ? 'Granted'
                          : item.state === 'denied'
                            ? 'Blocked'
                            : item.state === 'unsupported'
                              ? 'N/A'
                              : 'Ask';
                      return (
                        <div
                          key={item.id}
                          className="p-2.5 rounded-xl bg-[#070A10]/80 border border-white/10 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="shrink-0">{item.icon}</span>
                            <div className="min-w-0">
                              <p className="text-[11px] font-medium text-slate-200 truncate">
                                {item.label}
                              </p>
                              <span
                                className={`inline-block mt-0.5 text-[10px] font-medium px-1.5 py-0.2 rounded border ${badgeClass}`}
                              >
                                {badgeText}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={requestingOsKind !== null || item.state === 'unsupported'}
                            onClick={() => void handleRequestDevicePermission(item.id)}
                            className="px-2.5 py-1 rounded-lg border border-white/14 bg-white/[0.06] hover:bg-white/[0.12] text-[11px] font-medium text-slate-100 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            {requestingOsKind === item.id
                              ? 'Checking...'
                              : item.state === 'denied'
                                ? 'Settings'
                                : item.state === 'granted'
                                  ? 'Re-check'
                                  : 'Grant'}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {permFeedback && (
                    <p className="text-[11px] text-sky-200 bg-sky-500/10 border border-sky-400/30 rounded-lg px-2.5 py-1.5">
                      {permFeedback}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-400">
                    Choose which web capabilities {displayAssistant} is permitted to execute.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setPermissions({
                          files: false,
                          apps: false,
                          terminal: false,
                          browser: true,
                          research: true,
                          youtube: true,
                          memory: true,
                          faceAuth: true,
                        })
                      }
                      className="px-2.5 py-1 rounded-md border border-slate-700 bg-[#070A10] text-[11px] text-slate-200 hover:border-sky-500/50 whitespace-nowrap cursor-pointer"
                    >
                      Enable All PWA Features
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {PERMISSION_ITEMS.map((item) => {
                    const enabled = permissions[item.key];
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() =>
                          setPermissions((prev) => ({
                            ...prev,
                            [item.key]: !prev[item.key],
                          }))
                        }
                        className={`p-3.5 rounded-xl border text-left transition-colors flex items-start gap-3 cursor-pointer ${
                          enabled
                            ? 'bg-sky-500/10 border-sky-500/40'
                            : 'bg-[#070A10] border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="mt-0.5 shrink-0">{item.icon}</div>
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-100">
                              {item.label}
                            </span>
                            <span
                              className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                                enabled
                                  ? 'bg-sky-500/20 text-sky-300'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {enabled ? 'Granted' : 'Ask / Off'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            {item.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {activeStep.id === 'memory' && (
              <motion.div
                key="step-memory"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.16 }}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <h3 className="text-sm font-medium text-slate-100 flex items-center gap-2">
                    <Brain className="w-4 h-4 text-sky-400" />
                    <span>Teach {displayAssistant} About You</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Add facts, workspace paths, coding tools, or routines. {displayAssistant} also learns automatically when you speak.
                  </p>
                </div>

                <form onSubmit={handleAddMemoryDraft} className="space-y-2.5">
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={draftContent}
                      onChange={(e) => setDraftContent(e.target.value)}
                      placeholder="e.g., I prefer concise morning briefs on AI news and structured JSON output."
                      maxLength={600}
                      className="flex-1 min-w-[220px] px-3.5 py-2 rounded-xl bg-[#070A10] border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                    />
                    <select
                      value={draftCategory}
                      onChange={(e) => setDraftCategory(e.target.value as MemoryCategory)}
                      className="px-2.5 py-2 rounded-xl bg-[#070A10] border border-slate-700 text-xs text-slate-200 focus:outline-none"
                    >
                      <option value="preference">Preference</option>
                      <option value="fact">Fact</option>
                      <option value="project">Project</option>
                      <option value="routine">Routine</option>
                      <option value="person">Person</option>
                    </select>
                    <select
                      value={draftImportance}
                      onChange={(e) => setDraftImportance(e.target.value as MemoryImportance)}
                      className="px-2.5 py-2 rounded-xl bg-[#070A10] border border-slate-700 text-xs text-slate-200 focus:outline-none"
                    >
                      <option value="normal">Normal</option>
                      <option value="high">High Priority</option>
                      <option value="low">Low</option>
                    </select>
                    <button
                      type="submit"
                      className="px-3.5 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-semibold hover:bg-sky-400 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Remember</span>
                    </button>
                  </div>
                </form>

                {seedMemories.length > 0 ? (
                  <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-[#070A10]">
                    {seedMemories.map((item) => (
                      <div key={item.id} className="px-3.5 py-2.5 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-2 text-[11px] text-sky-400 capitalize">
                            <span>{item.category}</span>
                            {item.importance === 'high' && (
                              <span className="text-amber-300">· Priority</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-200 break-words">{item.content}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setSeedMemories((prev) => prev.filter((m) => m.id !== item.id))
                          }
                          className="p-1.5 text-slate-500 hover:text-red-400"
                          aria-label="Remove memory"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-500">
                    No initial memories queued yet. Add any preferences above or skip to continue.
                  </div>
                )}
              </motion.div>
            )}

            {activeStep.id === 'face' && (
              <motion.div
                key="step-face"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.16 }}
                className="space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium text-slate-100 flex items-center gap-2">
                      <UserCheck className="w-4 h-4 text-sky-400" />
                      <span>Facial Recognition Authentication</span>
                    </h3>
                    <p className="text-xs text-slate-400">
                      Only a compact numeric vector is saved—raw camera photos are never stored or uploaded.
                    </p>
                  </div>

                  <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={faceAuthEnabled}
                      disabled={!enrolledDescriptor || clearExistingFace}
                      onChange={(e) => setFaceAuthEnabled(e.target.checked)}
                      className="rounded border-slate-700 bg-[#070A10]"
                    />
                    <span>Lock on startup</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                  {/* Camera Frame */}
                  <div className="relative aspect-[4/3] rounded-xl bg-[#070A10] border border-slate-800 overflow-hidden flex items-center justify-center">
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      className={`w-full h-full object-cover scale-x-[-1] ${
                        cameraActive ? 'block' : 'hidden'
                      }`}
                    />
                    {cameraActive && (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <div
                          className={`w-36 h-48 rounded-[50%] border-2 transition-colors ${
                            capturing ? 'border-emerald-400' : 'border-sky-400/70'
                          }`}
                        />
                      </div>
                    )}
                    {!cameraActive && (
                      <div className="p-6 text-center space-y-2">
                        <Camera className="w-8 h-8 text-slate-500 mx-auto" />
                        <p className="text-xs text-slate-400">
                          {enrolledDescriptor && !clearExistingFace
                            ? 'Face descriptor enrolled cleanly.'
                            : 'Camera is currently off.'}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Enrollment Controls & Backup PIN */}
                  <div className="space-y-3">
                    {enrolledDescriptor && !clearExistingFace && (
                      <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-2 text-xs text-emerald-300">
                        <span className="inline-flex items-center gap-1.5">
                          <Check className="w-4 h-4" />
                          <span>Face ID Enrolled</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setClearExistingFace(true);
                            setEnrolledDescriptor(null);
                            setFaceAuthEnabled(false);
                          }}
                          className="text-red-300 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {!cameraActive ? (
                        <button
                          type="button"
                          onClick={() => void startCamera()}
                          className="px-3.5 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-semibold hover:bg-sky-400 inline-flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>
                            {enrolledDescriptor && !clearExistingFace ? 'Re-Enroll Face' : 'Start Camera'}
                          </span>
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={capturing}
                            onClick={() => void handleEnrollFace()}
                            className="px-3.5 py-2 rounded-xl bg-emerald-500 text-slate-950 text-xs font-semibold hover:bg-emerald-400 disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>
                              {capturing
                                ? `Scanning (${captureProgress}/3)...`
                                : 'Capture & Enroll Face'}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={stopCamera}
                            className="px-3 py-2 rounded-xl border border-slate-700 bg-[#070A10] text-xs text-slate-300 hover:bg-slate-800"
                          >
                            Stop Camera
                          </button>
                        </>
                      )}
                    </div>

                    {cameraError && (
                      <p className="text-xs text-amber-300 bg-amber-950/50 border border-amber-500/30 rounded-lg px-3 py-2">
                        {cameraError}
                      </p>
                    )}

                    <div className="pt-2 space-y-1.5">
                      <label className="block text-xs font-medium text-slate-300 flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-slate-400" />
                        <span>Optional Backup PIN (Recommended)</span>
                      </label>
                      <input
                        type="password"
                        value={backupPin}
                        onChange={(e) => setBackupPin(e.target.value)}
                        placeholder={
                          existingFaceAuth?.passcodeHash
                            ? 'Leave blank to keep existing PIN'
                            : '4–12 characters for camera-free unlock'
                        }
                        maxLength={24}
                        className="w-full px-3 py-2 rounded-xl bg-[#070A10] border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer Controls */}
        <div className="px-6 py-4 border-t border-white/12 bg-white/[0.03] flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={stepIdx === 0}
            onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
            className="px-3.5 py-2 rounded-xl border border-white/14 bg-white/[0.06] text-xs font-medium text-slate-200 hover:bg-white/[0.12] active:scale-[0.96] disabled:opacity-40 inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-all cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>

          <div className="flex items-center gap-2">
            {stepIdx < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => setStepIdx((i) => Math.min(STEPS.length - 1, i + 1))}
                className="px-4 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-semibold hover:bg-sky-400 active:scale-[0.96] inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-all cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleFinish()}
                className="px-4 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-semibold hover:bg-sky-400 active:scale-[0.96] disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{saving ? 'Saving Setup...' : `Activate ${displayAssistant}`}</span>
              </button>
            )}
          </div>
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
