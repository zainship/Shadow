import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  History,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Sunrise,
  Volume2,
  X,
} from 'lucide-react';
import type { MorningBrief, MorningBriefConfig, VoiceName } from '../types/assistant';

interface MorningBriefStageProps {
  brief: MorningBrief | null;
  history: MorningBrief[];
  config: MorningBriefConfig;
  voices: VoiceName[];
  isRunning: boolean;
  onRunNow: () => void;
  onSaveConfig: (config: MorningBriefConfig) => void;
  onSpeak: (text: string) => void;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

function timeOfDay(epoch: number): string {
  return new Date(epoch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function MorningBriefStage({
  brief,
  history,
  config,
  voices,
  isRunning,
  onRunNow,
  onSaveConfig,
  onSpeak,
}: MorningBriefStageProps) {
  const [selected, setSelected] = useState<MorningBrief | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState<MorningBriefConfig>(config);
  const [topicInput, setTopicInput] = useState('');

  useEffect(() => {
    setDraft(config);
  }, [config]);

  const displayed = selected ?? brief;
  const providerLabel = displayed?.provider || '—';

  const topicDrafts = useMemo(() => draft.topics, [draft.topics]);

  const addTopic = () => {
    const t = topicInput.trim();
    if (!t || topicDrafts.length >= 4) return;
    setDraft((prev) => ({ ...prev, topics: [...prev.topics, t] }));
    setTopicInput('');
  };

  const removeTopic = (topic: string) => {
    setDraft((prev) => ({ ...prev, topics: prev.topics.filter((t) => t !== topic) }));
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-4 py-4 text-sm text-slate-200 md:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-orange-400/30 bg-orange-400/10 p-2">
            <Sunrise className="h-5 w-5 text-orange-300" />
          </div>
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-slate-100">
              Morning Brief
            </h2>
            <p className="text-xs text-slate-400">
              {config.enabled
                ? `Scheduled daily at ${config.time} · ${config.topics.length} topic${config.topics.length === 1 ? '' : 's'}`
                : 'Schedule disabled — run it manually or enable it below'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              showSettings
                ? 'border-orange-400/40 bg-orange-400/10 text-orange-200'
                : 'border-white/10 bg-white/[0.04] text-slate-300 hover:border-orange-400/40 hover:text-orange-200'
            }`}
          >
            <Settings2 className="h-3.5 w-3.5" /> Settings
          </button>
          <button
            type="button"
            onClick={onRunNow}
            disabled={isRunning}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-orange-400 to-rose-500 px-3.5 py-2 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(251,113,133,0.4)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isRunning ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Compiling…
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" /> Run now
              </>
            )}
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-3">
              <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <span className="text-xs font-medium text-slate-200">Daily schedule</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.enabled}
                  onClick={() => setDraft((prev) => ({ ...prev, enabled: !prev.enabled }))}
                  className={`relative h-5 w-9 rounded-full transition-colors ${
                    draft.enabled ? 'bg-orange-400' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                      draft.enabled ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </label>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <span className="text-xs font-medium text-slate-200">Brief time</span>
                <input
                  type="time"
                  value={draft.time}
                  onChange={(e) => setDraft((prev) => ({ ...prev, time: e.target.value || '08:00' }))}
                  className="rounded-md border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-100 outline-none focus:border-orange-400/50"
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <span className="text-xs font-medium text-slate-200">Voice</span>
                <select
                  value={draft.voiceName}
                  onChange={(e) => setDraft((prev) => ({ ...prev, voiceName: e.target.value as VoiceName }))}
                  className="rounded-md border border-white/10 bg-slate-900/80 px-2 py-1 text-xs text-slate-100 outline-none focus:border-orange-400/50"
                >
                  {voices.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <span className="text-xs text-slate-300">
                  Speak on unlock
                  <span className="block text-[10px] text-slate-500">Plays the audio digest after face unlock</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.speakOnUnlock}
                  onClick={() => setDraft((prev) => ({ ...prev, speakOnUnlock: !prev.speakOnUnlock }))}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                    draft.speakOnUnlock ? 'bg-orange-400' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                      draft.speakOnUnlock ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </label>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-slate-200">
                Topics <span className="text-slate-500">(max 4, researched daily)</span>
              </span>
              <div className="flex flex-wrap gap-2">
                {topicDrafts.map((topic) => (
                  <span
                    key={topic}
                    className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-xs text-slate-200"
                  >
                    {topic}
                    <button
                      type="button"
                      onClick={() => removeTopic(topic)}
                      className="text-slate-500 transition-colors hover:text-rose-300"
                      aria-label={`Remove topic ${topic}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {topicDrafts.length === 0 && (
                  <span className="text-xs text-slate-500">No topics yet — add a few below.</span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  value={topicInput}
                  onChange={(e) => setTopicInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTopic();
                    }
                  }}
                  placeholder="e.g. weather in Karachi, crypto markets…"
                  className="flex-1 rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-orange-400/50"
                />
                <button
                  type="button"
                  onClick={addTopic}
                  disabled={topicDrafts.length >= 4 || !topicInput.trim()}
                  className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-orange-400/40 disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </div>
              <button
                type="button"
                onClick={() => onSaveConfig(draft)}
                className="mt-1 self-start rounded-lg bg-gradient-to-b from-orange-400 to-rose-500 px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              >
                Save settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Brief body */}
      {displayed ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <div>
              <p className="font-[family-name:var(--font-display)] text-base font-semibold text-slate-100">
                {displayed.headline}
              </p>
              <p className="text-[11px] text-slate-500">
                {displayed.date} · {timeOfDay(displayed.generatedAt)} · {providerLabel}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {selected && (
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 hover:text-slate-100"
                >
                  Back to today
                </button>
              )}
              <button
                type="button"
                onClick={() => onSpeak(displayed.spokenSummary)}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-orange-400/40 hover:text-orange-200"
              >
                <Volume2 className="h-3.5 w-3.5" /> Speak
              </button>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {displayed.sections.map((section, i) => (
              <div
                key={`${displayed.id}-${i}`}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
              >
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-orange-200">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-orange-400/15 text-[10px] font-bold text-orange-300">
                    {i + 1}
                  </span>
                  {section.title}
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {section.bullets.map((bullet, j) => (
                    <li key={j} className="flex gap-2 text-xs leading-relaxed text-slate-300">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-500" />
                      {bullet}
                    </li>
                  ))}
                </ul>
                {section.sources.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/5 pt-2.5">
                    {section.sources.map((source) => (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-slate-400 transition-colors hover:border-sky-400/40 hover:text-sky-300"
                      >
                        <ExternalLink className="h-2.5 w-2.5" />
                        {hostOf(source.url)}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {displayed.action && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <div>
                <p className="text-xs font-semibold text-amber-200">Suggested first move</p>
                <p className="text-xs leading-relaxed text-slate-300">{displayed.action}</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-14 text-center">
          <Sunrise className="h-10 w-10 text-orange-300/70" />
          <p className="font-[family-name:var(--font-display)] text-base font-semibold text-slate-200">
            No brief yet
          </p>
          <p className="max-w-md text-xs leading-relaxed text-slate-400">
            Shadow researches your topics, verifies the sources, and distills everything into a
            60-second spoken digest. Enable the daily schedule in Settings, or run the first one now.
          </p>
          <button
            type="button"
            onClick={onRunNow}
            disabled={isRunning}
            className="mt-1 flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-orange-400 to-rose-500 px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" /> {isRunning ? 'Compiling…' : 'Run my first brief'}
          </button>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-slate-300">
            <History className="h-3.5 w-3.5 text-slate-400" /> Past briefs
          </p>
          <div className="flex flex-col divide-y divide-white/5">
            {history.slice(0, 10).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelected(item.id === selected?.id ? null : item)}
                className="flex items-center justify-between gap-3 px-1 py-2 text-left transition-colors hover:bg-white/[0.03]"
              >
                <span className="flex items-center gap-2.5 overflow-hidden">
                  <span className="w-16 shrink-0 text-[11px] text-slate-500">{item.date}</span>
                  <span className="truncate text-xs text-slate-300">{item.headline}</span>
                </span>
                {selected?.id === item.id ? (
                  <ChevronUp className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
