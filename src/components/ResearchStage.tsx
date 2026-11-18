import React, { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowUpRight,
  BookOpen,
  Compass,
  Globe,
  Loader2,
  Search,
  Trash2,
  Volume2,
} from 'lucide-react';
import type { ResearchReport } from '../types/assistant';
import {
  MAC_GLASS_BTN_PRIMARY,
  MAC_GLASS_BTN_SECONDARY,
  MAC_GLASS_CARD,
  MAC_GLASS_INPUT_WRAP,
  MAC_GLASS_SIDEBAR,
  MAC_GLASS_SUBSURFACE,
  MAC_GLASS_TOOLBAR,
  MacSegmentedControl,
} from './MacWindowShell';

interface ResearchStageProps {
  report: ResearchReport | null;
  history: ResearchReport[];
  isResearching: boolean;
  onRunResearch: (query: string, depth: 'quick' | 'deep', urls: string[]) => void;
  onSelectReport: (report: ResearchReport) => void;
  onDeleteReport: (report: ResearchReport) => void;
  onSpeakBrief: (text: string) => void;
  onInspectSourceUrl: (url: string) => void;
}

export const ResearchStage: React.FC<ResearchStageProps> = ({
  report,
  history,
  isResearching,
  onRunResearch,
  onSelectReport,
  onDeleteReport,
  onSpeakBrief,
  onInspectSourceUrl,
}) => {
  const [queryInput, setQueryInput] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [depth, setDepth] = useState<'quick' | 'deep'>('deep');
  const prefersReduced = useReducedMotion();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = queryInput.trim();
    if (!q || isResearching) return;
    const parsedUrls = urlInput
      .split(/[\s,]+/)
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//i.test(u));
    onRunResearch(q, depth, parsedUrls);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Safari-style Frosted Glass Command Toolbar */}
      <div className={MAC_GLASS_TOOLBAR}>
        <form onSubmit={handleSubmit} className="flex-1 min-w-[260px] flex flex-wrap items-center gap-2.5">
          <div className={`flex-1 min-w-[200px] ${MAC_GLASS_INPUT_WRAP}`}>
            <Search className="w-4 h-4 text-indigo-300/80 shrink-0" />
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Ask Shadow to research any topic, comparison, or live web subject..."
              className="w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>

          <div className={`${MAC_GLASS_INPUT_WRAP} w-full sm:w-56`}>
            <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Optional URLs (comma-separated)"
              className="w-full bg-transparent text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>

          <MacSegmentedControl
            layoutId="mac-research-depth"
            value={depth}
            onChange={setDepth}
            options={[
              { id: 'quick', label: 'Quick' },
              { id: 'deep', label: 'Deep' },
            ]}
          />

          <button
            type="submit"
            disabled={!queryInput.trim() || isResearching}
            className={MAC_GLASS_BTN_PRIMARY}
          >
            {isResearching ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Researching...</span>
              </>
            ) : (
              <span>Research</span>
            )}
          </button>
        </form>
      </div>

      {/* Main Reader Canvas + Translucent History Sidebar */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-white/10 overflow-hidden">
        {/* Left: Structured Grounded Report */}
        <div className="xl:col-span-8 p-6 overflow-y-auto space-y-6">
          {isResearching && !report ? (
            <motion.div
              initial={prefersReduced ? false : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.25 }}
              className="py-20 flex flex-col items-center justify-center text-center space-y-3"
            >
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/15 border border-indigo-400/30 flex items-center justify-center shadow-[0_0_30px_rgba(99,102,241,0.2)]">
                <Loader2 className="w-6 h-6 text-indigo-300 animate-spin" />
              </div>
              <h3 className="text-base font-semibold text-slate-100">
                Running Live Grounded Research
              </h3>
              <p className="text-xs text-slate-400 max-w-md">
                Querying Google Search, inspecting primary source pages, and synthesizing a verified briefing.
              </p>
            </motion.div>
          ) : !report ? (
            <motion.div
              initial={prefersReduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="py-14 flex flex-col items-center justify-center text-center space-y-5"
            >
              <div className="w-13 h-13 rounded-2xl bg-gradient-to-b from-indigo-400/20 to-indigo-600/15 border border-indigo-400/25 flex items-center justify-center text-indigo-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
                <Compass className="w-6 h-6" />
              </div>
              <div className="max-w-lg space-y-2">
                <h3 className="text-lg font-semibold text-slate-100">
                  Deep Web Research &amp; Source Verification
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Ask Shadow by voice or enter a topic above to run live Google Search grounding, cross-check primary URLs, extract structured comparisons, and listen to an executive briefing.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() =>
                    onRunResearch(
                      'Compare Tauri v2 vs Electron in 2026 for memory usage, bundle size, and Rust IPC security',
                      'deep',
                      []
                    )
                  }
                  className={MAC_GLASS_BTN_SECONDARY}
                >
                  Demo: Tauri v2 vs Electron
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onRunResearch(
                      'Latest advances in Playwright browser automation and headless DOM agents',
                      'deep',
                      []
                    )
                  }
                  className={MAC_GLASS_BTN_SECONDARY}
                >
                  Demo: Browser Agent Trends
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={report.id}
              initial={prefersReduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 340, damping: 30 }}
              className="space-y-6"
            >
              {/* Report Title & Unboxed Metadata */}
              <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-white/10">
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="capitalize text-indigo-300 font-medium">
                      {report.depth} research
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {report.sources.length} verified sources
                    </span>
                    {isResearching && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-sky-300">Updating...</span>
                      </>
                    )}
                  </div>
                  <h3 className="text-lg font-semibold text-slate-50 leading-snug">
                    {report.query}
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={() => onSpeakBrief(report.spokenSummary || report.executiveSummary)}
                  className={MAC_GLASS_BTN_SECONDARY}
                >
                  <Volume2 className="w-3.5 h-3.5 text-sky-300" />
                  <span>Speak Briefing</span>
                </button>
              </div>

              {/* Executive Summary */}
              <section className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-300">Executive Summary</h4>
                <p className="text-sm text-slate-200 leading-relaxed">{report.executiveSummary}</p>
              </section>

              {/* Key Findings */}
              {report.keyFindings.length > 0 && (
                <section className="space-y-3 pt-3 border-t border-white/10">
                  <h4 className="text-xs font-semibold text-slate-300">Key Findings</h4>
                  <ol className="space-y-2.5">
                    {report.keyFindings.map((finding, i) => (
                      <motion.li
                        key={i}
                        initial={prefersReduced ? false : { opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: Math.min(i * 0.03, 0.2), duration: 0.22 }}
                        className="flex items-start gap-3 text-sm text-slate-300 leading-relaxed"
                      >
                        <span className="font-mono tabular-nums text-xs text-indigo-300 pt-1 w-5 shrink-0">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span>{finding}</span>
                      </motion.li>
                    ))}
                  </ol>
                </section>
              )}

              {/* Structured Comparison / Metrics */}
              {report.comparisonPoints.length > 0 && (
                <section className="space-y-3 pt-3 border-t border-white/10">
                  <h4 className="text-xs font-semibold text-slate-300">Structured Breakdown</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {report.comparisonPoints.map((pt, i) => (
                      <div key={i} className={`p-3.5 space-y-1 ${MAC_GLASS_CARD}`}>
                        <p className="text-xs font-semibold text-slate-100">{pt.label}</p>
                        <p className="text-xs text-slate-400 leading-relaxed">{pt.detail}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Verified Grounding Sources */}
              {report.sources.length > 0 && (
                <section className="space-y-3 pt-3 border-t border-white/10">
                  <h4 className="text-xs font-semibold text-slate-300">
                    Verified Sources ({report.sources.length})
                  </h4>
                  <div className={`divide-y divide-white/8 overflow-hidden ${MAC_GLASS_SUBSURFACE}`}>
                    {report.sources.map((src, i) => (
                      <div
                        key={`${src.url}-${i}`}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors"
                      >
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-w-0 flex-1 group"
                        >
                          <p className="text-xs font-medium text-slate-200 group-hover:text-sky-300 truncate transition-colors">
                            {src.title}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                            {src.domain}
                          </p>
                        </a>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => onInspectSourceUrl(src.url)}
                            className="px-2.5 py-1 rounded-lg border border-white/12 bg-white/[0.05] text-[11px] font-medium text-slate-200 hover:bg-white/[0.1] hover:border-sky-400/40 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                          >
                            Inspect Page
                          </button>
                          <a
                            href={src.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open ${src.title}`}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-sky-300 hover:bg-white/[0.08] transition-colors"
                          >
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Follow-up Research Angles */}
              {report.followUpQuestions.length > 0 && (
                <section className="space-y-2.5 pt-3 border-t border-white/10">
                  <h4 className="text-xs font-semibold text-slate-300">Explore Follow-Ups</h4>
                  <div className="flex flex-wrap gap-2">
                    {report.followUpQuestions.map((q, i) => (
                      <button
                        key={i}
                        type="button"
                        disabled={isResearching}
                        onClick={() => onRunResearch(q, depth, [])}
                        className="px-3 py-1.5 rounded-[10px] border border-white/10 bg-white/[0.04] hover:bg-white/[0.09] hover:border-indigo-400/40 text-xs text-slate-200 disabled:opacity-40 text-left transition-all cursor-pointer"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </motion.div>
          )}
        </div>

        {/* Right: Search Queries + Research History (macOS Finder-style vibrancy sidebar) */}
        <div className={`xl:col-span-4 p-5 overflow-y-auto space-y-6 ${MAC_GLASS_SIDEBAR}`}>
          {report && report.groundingSearchQueries.length > 0 && (
            <div className="space-y-2.5 pb-5 border-b border-white/10">
              <h4 className="text-xs font-semibold text-slate-300">Search Queries Executed</h4>
              <ul className="space-y-1.5">
                {report.groundingSearchQueries.map((sq, i) => (
                  <li key={i} className="text-xs font-mono text-slate-400 flex items-start gap-2">
                    <span className="text-indigo-400/70 select-none">·</span>
                    <span className="break-words">{sq}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-indigo-300" />
                <span>Saved Briefings</span>
              </h4>
              <span className="font-mono tabular-nums text-xs text-slate-500">{history.length}</span>
            </div>

            {history.length === 0 ? (
              <p className="text-xs text-slate-500 py-8 text-center">
                Completed research briefings will appear here.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {history.map((item) => {
                  const isActive = report?.id === item.id;
                  return (
                    <li
                      key={item.id}
                      className={`p-2.5 rounded-xl border transition-all flex items-start gap-2 ${
                        isActive
                          ? 'bg-indigo-500/12 border-indigo-400/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
                          : 'border-transparent hover:bg-white/[0.04]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectReport(item)}
                        className="flex-1 min-w-0 text-left group space-y-0.5 cursor-pointer"
                      >
                        <p
                          className={`text-xs font-medium line-clamp-2 ${
                            isActive ? 'text-indigo-200' : 'text-slate-200 group-hover:text-white'
                          }`}
                        >
                          {item.query}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          <span className="capitalize">{item.depth}</span>
                          <span aria-hidden="true"> · </span>
                          <span className="font-mono tabular-nums">
                            {item.sources.length} sources
                          </span>
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteReport(item)}
                        aria-label={`Delete research ${item.query}`}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-white/[0.08] shrink-0 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
