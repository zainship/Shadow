import React, { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  BookmarkPlus,
  CheckCircle2,
  Clock,
  ExternalLink,
  Globe,
  Loader2,
  MousePointerClick,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import type { AutomationRunState, RuntimeKind } from '../types/assistant';
import {
  MAC_GLASS_BTN_PRIMARY,
  MAC_GLASS_BTN_SECONDARY,
  MAC_GLASS_CARD,
  MAC_GLASS_INPUT_WRAP,
  MAC_GLASS_SIDEBAR,
  MAC_GLASS_SUBSURFACE,
  MAC_GLASS_TOOLBAR,
} from './MacWindowShell';

interface BrowserAutomationStageProps {
  run: AutomationRunState | null;
  runtime: RuntimeKind;
  onInspectUrl: (url: string) => void;
  onSaveAsMacro: (run: AutomationRunState) => void;
  onRunQuickDemo: (command: string) => void;
}

export const BrowserAutomationStage: React.FC<BrowserAutomationStageProps> = ({
  run,
  runtime,
  onInspectUrl,
  onSaveAsMacro,
  onRunQuickDemo,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const prefersReduced = useReducedMotion();

  const activeUrl = run?.inspection?.finalUrl || run?.targetUrl || '';
  const statusCode = run?.inspection?.statusCode;
  const statusHealthy = typeof statusCode === 'number' && statusCode >= 200 && statusCode < 400;

  const handleInspectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const target = urlInput.trim() || activeUrl;
    if (!target) return;
    onInspectUrl(target);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Safari-style Unified Address & Action Toolbar */}
      <div className={MAC_GLASS_TOOLBAR}>
        <form onSubmit={handleInspectSubmit} className="flex-1 min-w-[240px] flex items-center gap-2.5">
          <div className={`flex-1 ${MAC_GLASS_INPUT_WRAP}`}>
            {statusCode ? (
              <span
                title={`HTTP ${statusCode}`}
                className={`w-2 h-2 rounded-full shrink-0 ${
                  statusHealthy
                    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]'
                    : 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]'
                }`}
              />
            ) : (
              <Globe className="w-4 h-4 text-sky-300/80 shrink-0" />
            )}
            <input
              type="text"
              value={urlInput || activeUrl}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Enter website URL to inspect or command Shadow by voice..."
              className="w-full bg-transparent text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>
          <button type="submit" className={MAC_GLASS_BTN_SECONDARY}>
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Inspect</span>
          </button>
        </form>

        <div className="flex items-center gap-2 shrink-0">
          {activeUrl && !activeUrl.toLowerCase().startsWith('desktop://') && (
            <a
              href={activeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={MAC_GLASS_BTN_SECONDARY}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open Site</span>
            </a>
          )}
          {run && run.steps.length > 0 && (
            <button
              type="button"
              onClick={() => onSaveAsMacro(run)}
              className={MAC_GLASS_BTN_PRIMARY}
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              <span>Save Macro</span>
            </button>
          )}
        </div>
      </div>

      {/* Automation Content */}
      {!run ? (
        <motion.div
          initial={prefersReduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className="flex-1 p-8 flex flex-col items-center justify-center text-center space-y-5"
        >
          <div className="w-13 h-13 rounded-2xl bg-gradient-to-b from-sky-400/20 to-blue-600/15 border border-sky-400/25 flex items-center justify-center text-sky-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
            <MousePointerClick className="w-6 h-6" />
          </div>
          <div className="max-w-md space-y-2">
            <h3 className="text-lg font-semibold text-slate-100">Browser Automation Stage</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Ask Shadow to open any website, fill multi-field forms, click controls, or extract structured page data. Live steps and inspected DOM form fields appear here.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={() =>
                onRunQuickDemo(
                  'Open https://httpbin.org/forms/post and fill customer name Jordan Lee, phone 555-0192, email jordan@example.com, medium pizza with bacon, and submit'
                )
              }
              className={MAC_GLASS_BTN_SECONDARY}
            >
              Demo: Fill Delivery Form
            </button>
            <button
              type="button"
              onClick={() =>
                onRunQuickDemo('Open https://news.ycombinator.com and extract the front page headlines')
              }
              className={MAC_GLASS_BTN_SECONDARY}
            >
              Demo: Inspect Hacker News
            </button>
            <button
              type="button"
              onClick={() =>
                onRunQuickDemo(
                  'Arrange Google Chrome, Visual Studio Code, Terminal, and Notes into a grid layout on my laptop screen'
                )
              }
              className={MAC_GLASS_BTN_SECONDARY}
            >
              Demo: Tile Windows (Grid)
            </button>
          </div>
        </motion.div>
      ) : (
        <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-white/10 overflow-hidden">
          {/* Left: Step Execution Timeline */}
          <div className="xl:col-span-5 p-5 overflow-y-auto space-y-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                <span>
                  {runtime === 'tauri-desktop' ? 'Laptop Chromium Playwright' : 'Cloud DOM Inspector'}
                </span>
                <span className="font-mono tabular-nums text-sky-300">
                  {run.steps.filter((s) => s.status === 'completed').length}/{run.steps.length} steps
                </span>
              </div>
              <h3 className="text-base font-semibold text-slate-50">{run.goal}</h3>
            </div>

            <ol className="space-y-2 pt-2 border-t border-white/10">
              {run.steps.map((step, idx) => {
                const isRunning = step.status === 'running';
                return (
                  <motion.li
                    key={`${step.action}-${idx}`}
                    initial={prefersReduced ? false : { opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(idx * 0.04, 0.25), duration: 0.22 }}
                    className={`p-3 rounded-xl border transition-all flex items-start gap-3 ${
                      isRunning
                        ? 'bg-sky-500/12 border-sky-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                        : 'bg-white/[0.025] border-white/8'
                    }`}
                  >
                    <span className="font-mono tabular-nums text-xs text-slate-500 pt-0.5 w-5 shrink-0">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-100">
                          {step.description}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs shrink-0">
                          {step.status === 'completed' && (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-300">Done</span>
                            </>
                          )}
                          {step.status === 'running' && (
                            <>
                              <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin" />
                              <span className="text-sky-300">Running</span>
                            </>
                          )}
                          {step.status === 'failed' && (
                            <>
                              <XCircle className="w-3.5 h-3.5 text-rose-400" />
                              <span className="text-rose-300">Failed</span>
                            </>
                          )}
                          {step.status === 'pending' && (
                            <>
                              <Clock className="w-3.5 h-3.5 text-slate-500" />
                              <span className="text-slate-400">Queued</span>
                            </>
                          )}
                        </span>
                      </div>
                      <p className="text-xs font-mono text-slate-400 truncate">
                        {step.action}
                        {step.selector ? ` · ${step.selector}` : ''}
                        {step.value ? ` → "${step.value}"` : ''}
                      </p>
                    </div>
                  </motion.li>
                );
              })}
            </ol>
          </div>

          {/* Right: Live Target DOM & Web Inspector Glass Pane */}
          <div className={`xl:col-span-7 p-5 overflow-y-auto space-y-5 ${MAC_GLASS_SIDEBAR}`}>
            {run.inspection ? (
              <motion.div
                initial={prefersReduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25 }}
                className="space-y-5"
              >
                <div className="space-y-1 pb-4 border-b border-white/10">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                    <span>Target Page Snapshot</span>
                    <span className="font-mono tabular-nums text-slate-300">
                      HTTP {run.inspection.statusCode || '—'}
                    </span>
                  </div>
                  <h4 className="text-base font-semibold text-slate-50">
                    {run.inspection.title}
                  </h4>
                  <p className="text-xs font-mono text-slate-400 truncate">
                    {run.inspection.finalUrl}
                  </p>
                </div>

                {/* Detected Form Fields & Live Automated Values */}
                {run.inspection.fields.length > 0 && (
                  <div className="space-y-3">
                    <h5 className="text-xs font-semibold text-slate-300">
                      Detected Form Fields ({run.inspection.fields.length})
                    </h5>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {run.inspection.fields.map((field, i) => {
                        const isFilled = Boolean(field.filledValue);
                        return (
                          <div
                            key={`${field.selector}-${i}`}
                            className={`p-3 space-y-1.5 transition-colors ${
                              isFilled
                                ? 'rounded-xl bg-sky-500/[0.08] border border-sky-400/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
                                : MAC_GLASS_CARD
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="font-medium text-slate-100 truncate">
                                {field.label}
                              </span>
                              <span className="font-mono text-[11px] text-slate-400 shrink-0">
                                {field.type}
                              </span>
                            </div>
                            <div className="px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/8 text-xs font-mono text-sky-300 min-h-[28px] truncate">
                              {field.filledValue || (
                                <span className="text-slate-600">{field.selector}</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Extracted Headings & Links */}
                {run.inspection.headings.length > 0 && (
                  <div className="space-y-2">
                    <h5 className="text-xs font-semibold text-slate-300">Page Headings</h5>
                    <ul className="space-y-1 text-xs text-slate-300">
                      {run.inspection.headings.slice(0, 6).map((h, i) => (
                        <li key={i} className="truncate">
                          · {h}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {run.inspection.links.length > 0 && (
                  <div className="space-y-2">
                    <h5 className="text-xs font-semibold text-slate-300">
                      Discovered Navigation Links
                    </h5>
                    <div className={`divide-y divide-white/8 overflow-hidden ${MAC_GLASS_SUBSURFACE}`}>
                      {run.inspection.links.slice(0, 6).map((lnk, i) => (
                        <a
                          key={i}
                          href={lnk.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3.5 py-2 flex items-center justify-between gap-3 text-xs text-slate-200 hover:bg-white/[0.04] transition-colors"
                        >
                          <span className="truncate">{lnk.text}</span>
                          <ExternalLink className="w-3 h-3 text-slate-400 shrink-0" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {run.inspection.excerpt && (
                  <div className="space-y-1.5">
                    <h5 className="text-xs font-semibold text-slate-300">Page Text Extract</h5>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {run.inspection.excerpt}
                    </p>
                  </div>
                )}
              </motion.div>
            ) : (
              <div className="py-12 text-center text-xs text-slate-400">
                Resolving target webpage DOM and form selectors...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
