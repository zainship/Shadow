import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Cpu, Eye, EyeOff, Info, KeyRound, Mic, Server, X } from 'lucide-react';
import {
  OPENROUTER_MODEL_SUGGESTIONS,
  type AiProviderChoice,
  type AiSettings,
} from '../lib/aiSettings';

interface AiSettingsModalProps {
  open: boolean;
  settings: AiSettings;
  onSave: (settings: AiSettings) => void;
  onClose: () => void;
}

const PROVIDER_OPTIONS: Array<{
  id: AiProviderChoice;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    id: 'server',
    label: 'Server Default',
    description: 'Use the key configured on the Shadow server (AI Studio secrets / .env).',
    icon: <Server className="w-4 h-4 text-sky-400" />,
  },
  {
    id: 'gemini',
    label: 'Gemini (BYOK)',
    description: 'Bring your own Google AI Studio key. Powers voice, TTS, visuals & research.',
    icon: <Cpu className="w-4 h-4 text-emerald-400" />,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (BYOK)',
    description: 'Use an OpenRouter key for the assistant brain: commands, research, visuals & media.',
    icon: <KeyRound className="w-4 h-4 text-violet-400" />,
  },
];

export function AiSettingsModal({ open, settings, onSave, onClose }: AiSettingsModalProps) {
  const [draft, setDraft] = useState<AiSettings>(settings);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showOrKey, setShowOrKey] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setSavedFlash(false);
    }
  }, [open, settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const pickProvider = (provider: AiProviderChoice) => {
    setDraft((prev) => ({ ...prev, provider }));
  };

  const handleSave = () => {
    onSave({
      ...draft,
      geminiKey: draft.geminiKey.trim(),
      openrouterKey: draft.openrouterKey.trim(),
      openrouterModel: draft.openrouterModel.trim(),
    });
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1600);
  };

  const activeProviderRequiresKey =
    (draft.provider === 'gemini' && !draft.geminiKey.trim()) ||
    (draft.provider === 'openrouter' && !draft.openrouterKey.trim());

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0b1120]/95 p-5 shadow-2xl"
            initial={{ opacity: 0, scale: 0.96, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 14 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-sky-400" />
                <h2 className="text-base font-semibold text-white">AI Provider (BYOK)</h2>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-white/10 transition"
                aria-label="Close AI settings"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              Keys are stored only in this browser and sent directly to your Shadow server per
              request — they are never written to Firestore or shared with third parties.
            </p>

            <div className="space-y-2 mb-4">
              {PROVIDER_OPTIONS.map((option) => {
                const active = draft.provider === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => pickProvider(option.id)}
                    className={`w-full flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition ${
                      active
                        ? 'border-sky-400/60 bg-sky-400/10'
                        : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                    }`}
                  >
                    <div className="mt-0.5">{option.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{option.label}</span>
                        {active && <Check className="w-3.5 h-3.5 text-sky-400" />}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                        {option.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {draft.provider === 'gemini' && (
              <div className="mb-4">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Gemini API key
                </label>
                <div className="relative">
                  <input
                    type={showGeminiKey ? 'text' : 'password'}
                    value={draft.geminiKey}
                    onChange={(e) => setDraft((p) => ({ ...p, geminiKey: e.target.value }))}
                    placeholder="AIza..."
                    spellCheck={false}
                    autoComplete="off"
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 pr-10 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-400/60 focus:outline-none font-mono"
                  />
                  <button
                    onClick={() => setShowGeminiKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    aria-label="Toggle key visibility"
                  >
                    {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  Get one at aistudio.google.com/apikey.
                </p>
              </div>
            )}

            {draft.provider === 'openrouter' && (
              <div className="mb-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    OpenRouter API key
                  </label>
                  <div className="relative">
                    <input
                      type={showOrKey ? 'text' : 'password'}
                      value={draft.openrouterKey}
                      onChange={(e) => setDraft((p) => ({ ...p, openrouterKey: e.target.value }))}
                      placeholder="sk-or-v1-..."
                      spellCheck={false}
                      autoComplete="off"
                      className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 pr-10 text-sm text-slate-100 placeholder-slate-500 focus:border-violet-400/60 focus:outline-none font-mono"
                    />
                    <button
                      onClick={() => setShowOrKey((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                      aria-label="Toggle key visibility"
                    >
                      {showOrKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    Get one at openrouter.ai/keys.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Model (optional)
                  </label>
                  <input
                    type="text"
                    value={draft.openrouterModel}
                    onChange={(e) => setDraft((p) => ({ ...p, openrouterModel: e.target.value }))}
                    placeholder="e.g. openai/gpt-4o-mini"
                    spellCheck={false}
                    autoComplete="off"
                    list="openrouter-model-suggestions"
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-violet-400/60 focus:outline-none font-mono"
                  />
                  <datalist id="openrouter-model-suggestions">
                    {OPENROUTER_MODEL_SUGGESTIONS.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    Any model id from openrouter.ai/models works. Leave blank for the server
                    default (OPENROUTER_MODEL).
                  </p>
                </div>
              </div>
            )}

            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 mb-4 flex gap-2">
              <Info className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Text commands, research, visual synthesis and media lookups run on your chosen
                provider. Only voice sessions &amp; speech synthesis require Gemini (the Live voice
                protocol and audio generation are Gemini-only).
                {draft.provider === 'openrouter' && (
                  <span className="flex items-center gap-1 mt-1 text-slate-300">
                    <Mic className="w-3 h-3" /> Voice won&apos;t work while OpenRouter is selected.
                  </span>
                )}
              </p>
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => {
                  onSave({ ...draft, provider: 'server', geminiKey: '', openrouterKey: '', openrouterModel: '' });
                  setSavedFlash(true);
                  window.setTimeout(() => setSavedFlash(false), 1600);
                }}
                className="text-xs text-slate-400 hover:text-slate-200 transition"
              >
                Reset to server default
              </button>
              <div className="flex items-center gap-2">
                {savedFlash && (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Saved
                  </span>
                )}
                <button
                  onClick={handleSave}
                  disabled={activeProviderRequiresKey}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                    activeProviderRequiresKey
                      ? 'bg-white/5 text-slate-500 cursor-not-allowed'
                      : 'bg-sky-500 hover:bg-sky-400 text-white'
                  }`}
                >
                  {activeProviderRequiresKey ? 'Enter a key to save' : 'Save settings'}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
