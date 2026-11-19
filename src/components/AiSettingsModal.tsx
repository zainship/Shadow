import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Cpu,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Loader2,
  Mic,
  Server,
  Sparkles,
  X,
} from 'lucide-react';
import { API_ORIGIN } from '../lib/apiBase';
import {
  aiRequestHeaders,
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
    description: 'Route commands, research, visuals & media to any model on OpenRouter.',
    icon: <KeyRound className="w-4 h-4 text-violet-400" />,
  },
];

export function AiSettingsModal({ open, settings, onSave, onClose }: AiSettingsModalProps) {
  const [draft, setDraft] = useState<AiSettings>(settings);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showOrKey, setShowOrKey] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [serverStatus, setServerStatus] = useState<{
    hasServerGeminiKey?: boolean;
    hasServerOpenRouterKey?: boolean;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setSavedFlash(false);
      setTestResult(null);
      void fetch(`${API_ORIGIN}/api/ai/status`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) setServerStatus(data);
        })
        .catch(() => null);
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
    setTestResult(null);
  };

  const normalizedDraft = (): AiSettings => ({
    ...draft,
    geminiKey: draft.geminiKey.trim(),
    openrouterKey: draft.openrouterKey.trim(),
    openrouterModel: draft.openrouterModel.trim(),
  });

  const handleSave = () => {
    onSave(normalizedDraft());
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1600);
  };

  const handleTestKey = async () => {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    const clean = normalizedDraft();
    try {
      const res = await fetch(`${API_ORIGIN}/api/ai/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...aiRequestHeaders(clean),
        },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        provider?: string;
        model?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setTestResult({ ok: false, text: data.error || 'Verification failed' });
      } else {
        setTestResult({
          ok: true,
          text: `Connected (${data.provider}${data.model ? ` · ${data.model}` : ''})`,
        });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        text: err instanceof Error ? err.message : 'Unable to reach Shadow server',
      });
    } finally {
      setTesting(false);
    }
  };

  const activeProviderRequiresKey =
    (draft.provider === 'gemini' && !draft.geminiKey.trim()) ||
    (draft.provider === 'openrouter' && !draft.openrouterKey.trim());

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/62 backdrop-blur-xl p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-[24px] border border-white/18 bg-[#0B1222]/72 backdrop-blur-3xl backdrop-saturate-150 p-5 shadow-[0_32px_90px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.22)]"
            initial={{ opacity: 0, scale: 0.94, y: 18, filter: 'blur(8px)' }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.95, y: 14, filter: 'blur(6px)' }}
            transition={{ type: 'spring', stiffness: 370, damping: 30, mass: 0.85 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-sky-400" />
                <h2 className="text-base font-semibold text-white">AI Provider &amp; API Keys (BYOK)</h2>
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
              Add your OpenRouter or Gemini key right here in the GUI — no <code className="text-slate-300">.env</code> editing required. Keys stay in local storage on this device and are sent only to your Shadow backend per request.
            </p>

            {serverStatus && !serverStatus.hasServerGeminiKey && !serverStatus.hasServerOpenRouterKey && draft.provider === 'server' && (
              <div className="mb-3 rounded-lg border border-amber-500/35 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-200">
                No server <code className="font-mono">.env</code> key detected locally. Select <strong>OpenRouter (BYOK)</strong> or <strong>Gemini (BYOK)</strong> below to enter your key in the GUI.
              </div>
            )}

            <div className="space-y-2 mb-4">
              {PROVIDER_OPTIONS.map((option) => {
                const active = draft.provider === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
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
                    type="button"
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
                      type="button"
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
                    OpenRouter Model (optional)
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
                    Any model id from openrouter.ai/models works. Blank uses openai/gpt-4o-mini.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Optional Gemini Key for Live Voice &amp; Neural TTS
                  </label>
                  <div className="relative">
                    <input
                      type={showGeminiKey ? 'text' : 'password'}
                      value={draft.geminiKey}
                      onChange={(e) => setDraft((p) => ({ ...p, geminiKey: e.target.value }))}
                      placeholder="AIza... (optional — instant browser speech runs without it)"
                      spellCheck={false}
                      autoComplete="off"
                      className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 pr-10 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-400/60 focus:outline-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowGeminiKey((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                      aria-label="Toggle Gemini key visibility"
                    >
                      {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {testResult && (
              <div
                className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
                  testResult.ok
                    ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                    : 'border-rose-500/40 bg-rose-950/40 text-rose-200'
                }`}
              >
                {testResult.text}
              </div>
            )}

            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 mb-4 flex gap-2">
              <Info className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Commands, web research, visual generation, morning briefs, and media lookups route directly to your chosen provider. When OpenRouter is selected without a Gemini key, spoken replies automatically use built-in browser speech.
                {draft.provider === 'openrouter' && !draft.geminiKey.trim() && (
                  <span className="flex items-center gap-1 mt-1 text-slate-300">
                    <Mic className="w-3 h-3" /> Real-time Live Audio sessions use Gemini (add a Gemini key above to enable both).
                  </span>
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  onSave({ ...draft, provider: 'server', geminiKey: '', openrouterKey: '', openrouterModel: '' });
                  setSavedFlash(true);
                  setTestResult(null);
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
                  type="button"
                  onClick={() => void handleTestKey()}
                  disabled={testing || activeProviderRequiresKey}
                  className="rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 px-3 py-2 text-xs font-medium text-slate-200 disabled:opacity-40 inline-flex items-center gap-1.5 transition"
                >
                  {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-sky-400" />}
                  <span>Verify Key</span>
                </button>
                <button
                  type="button"
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
