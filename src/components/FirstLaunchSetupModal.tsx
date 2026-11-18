import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Brain,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  FolderOpen,
  Globe,
  Laptop,
  Lock,
  Play,
  Plus,
  ShieldCheck,
  Terminal,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import {
  averageDescriptors,
  DEFAULT_FACE_THRESHOLD,
  extractFaceDescriptorFromVideo,
  sha256Hex,
  stopMediaStream,
} from '../lib/faceAuth';
import { DEFAULT_PERMISSIONS } from '../lib/setupStorage';
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
  existingFaceAuth: FaceAuthProfile | null;
  onClose?: () => void;
  onComplete: (result: {
    config: SetupConfig;
    seedMemories: SeedMemoryDraft[];
    faceAuthProfile?: Omit<FaceAuthProfile, 'uid' | 'createdAt' | 'updatedAt'> | null;
    clearFaceAuth?: boolean;
  }) => Promise<void>;
}

const STEPS = [
  { id: 'identity', label: 'Identity' },
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
    key: 'files',
    label: 'Files & Folders',
    description: 'Read, write, search, organize, and manage files on your laptop.',
    icon: <FolderOpen className="w-4 h-4 text-sky-400" />,
  },
  {
    key: 'apps',
    label: 'Desktop Apps',
    description: 'Open, focus, quit, and automate installed desktop applications.',
    icon: <Laptop className="w-4 h-4 text-sky-400" />,
  },
  {
    key: 'terminal',
    label: 'Terminal & Background Jobs',
    description: 'Run shell commands and persistent background processes.',
    icon: <Terminal className="w-4 h-4 text-sky-400" />,
  },
  {
    key: 'browser',
    label: 'Browser Automation',
    description: 'Open sites, inspect pages, fill forms, and run multi-step web flows.',
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
  existingFaceAuth,
  onClose,
  onComplete,
}) => {
  const [stepIdx, setStepIdx] = useState(0);
  const [userPreferredName, setUserPreferredName] = useState(initialConfig.userPreferredName);
  const [assistantName, setAssistantName] = useState(initialConfig.assistantName || 'Shadow');
  const [permissions, setPermissions] = useState<ShadowPermissions>({ ...initialConfig.permissions });
  const [faceAuthEnabled, setFaceAuthEnabled] = useState(initialConfig.faceAuthEnabled);
  const [clapWakeEnabled, setClapWakeEnabled] = useState(initialConfig.clapWakeEnabled);

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

  // Reset form state when modal opens
  useEffect(() => {
    if (!open) return;
    setStepIdx(0);
    setUserPreferredName(initialConfig.userPreferredName);
    setAssistantName(initialConfig.assistantName || 'Shadow');
    setPermissions({ ...initialConfig.permissions });
    setFaceAuthEnabled(initialConfig.faceAuthEnabled);
    setClapWakeEnabled(initialConfig.clapWakeEnabled);
    setEnrolledDescriptor(existingFaceAuth?.descriptor ?? null);
    setClearExistingFace(false);
    setSeedMemories([]);
    setBackupPin('');
    setCameraError(null);
    setCaptureProgress(0);
  }, [open, initialConfig, existingFaceAuth]);

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

      await onComplete({
        config: {
          userPreferredName: normalizedUser,
          assistantName: normalizedAssistant,
          setupCompleted: true,
          faceAuthEnabled: finalFaceEnabled,
          clapWakeEnabled,
          permissions,
        },
        seedMemories,
        faceAuthProfile: facePayload,
        clearFaceAuth: clearExistingFace,
      });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const activeStep = STEPS[stepIdx];
  const displayAssistant = assistantName.trim() || 'Shadow';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-[#0D111A] border border-slate-800 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4 bg-[#090C14]">
          <div className="space-y-0.5">
            <h2 className="text-base font-semibold text-slate-100">
              {isFirstLaunch ? 'First-Launch Laptop Setup' : `${displayAssistant} Setup & Permissions`}
            </h2>
            <p className="text-xs text-slate-400">
              Personalize identity, grant laptop permissions, seed memory, and configure face lock.
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
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Stepper Bar */}
        <div className="px-6 py-3 border-b border-slate-800/80 bg-[#0A0E17] grid grid-cols-4 gap-2">
          {STEPS.map((s, idx) => {
            const isActive = idx === stepIdx;
            const isDone = idx < stepIdx;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setStepIdx(idx)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-sky-500/15 text-sky-300 border border-sky-500/40'
                    : isDone
                      ? 'bg-slate-800/70 text-slate-200 border border-slate-700/60'
                      : 'text-slate-500 hover:text-slate-300 border border-transparent'
                }`}
              >
                <span className="font-mono text-[11px] opacity-80">{idx + 1}.</span>
                <span>{s.label}</span>
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
                    Used across voice greetings, live captions, system prompts, and the desktop HUD.
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

            {activeStep.id === 'permissions' && (
              <motion.div
                key="step-permissions"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.16 }}
                className="space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-400">
                    Choose which laptop capabilities {displayAssistant} is permitted to execute.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPermissions({ ...DEFAULT_PERMISSIONS })}
                      className="px-2.5 py-1 rounded-md border border-slate-700 bg-[#070A10] text-[11px] text-slate-200 hover:border-sky-500/50 whitespace-nowrap"
                    >
                      Allow All
                    </button>
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
                          faceAuth: false,
                        })
                      }
                      className="px-2.5 py-1 rounded-md border border-slate-700 bg-[#070A10] text-[11px] text-slate-300 hover:border-slate-500 whitespace-nowrap"
                    >
                      Web &amp; Media Only
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
                        className={`p-3.5 rounded-xl border text-left transition-colors flex items-start gap-3 ${
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
                              {enabled ? 'Granted' : 'Blocked'}
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
                      placeholder="e.g., My main projects live in ~/Developer and I prefer VS Code + Chrome."
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
        <div className="px-6 py-4 border-t border-slate-800 bg-[#090C14] flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={stepIdx === 0}
            onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
            className="px-3.5 py-2 rounded-xl border border-slate-700 bg-[#0D111A] text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>

          <div className="flex items-center gap-2">
            {stepIdx < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => setStepIdx((i) => Math.min(STEPS.length - 1, i + 1))}
                className="px-4 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-semibold hover:bg-sky-400 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleFinish()}
                className="px-4 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-semibold hover:bg-sky-400 disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{saving ? 'Saving Setup...' : `Activate ${displayAssistant}`}</span>
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};
