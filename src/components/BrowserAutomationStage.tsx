import React, { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  BookmarkPlus,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  ExternalLink,
  Globe,
  Loader2,
  MousePointerClick,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { AutomationRunState, AutomationStep, RuntimeKind } from '../types/assistant';
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
  onExecutePlan?: (plan: { goal: string; targetUrl: string; steps: AutomationStep[] }) => void;
  onClearRun?: () => void;
}

const DEMO_PLANS: Array<{
  id: string;
  label: string;
  subtitle: string;
  goal: string;
  targetUrl: string;
  steps: AutomationStep[];
  fallbackPrompt: string;
}> = [
  {
    id: 'httpbin-form',
    label: 'Demo: Fill & Submit Web Form',
    subtitle: 'Stateful cookie session, field matching, & live POST JSON response',
    goal: 'Fill & submit pizza order form on httpbin.org',
    targetUrl: 'https://httpbin.org/forms/post',
    fallbackPrompt:
      'Open https://httpbin.org/forms/post and fill customer name Jordan Lee, phone 555-0192, email jordan@example.com, medium size, bacon topping, and submit',
    steps: [
      {
        action: 'navigate',
        selector: 'document',
        value: 'https://httpbin.org/forms/post',
        description: 'Open httpbin order form',
      },
      {
        action: 'fill',
        selector: 'custname',
        value: 'Jordan Lee',
        description: 'Enter customer name',
      },
      {
        action: 'fill',
        selector: 'custtel',
        value: '555-0192',
        description: 'Enter telephone number',
      },
      {
        action: 'fill',
        selector: 'custemail',
        value: 'jordan@example.com',
        description: 'Enter customer email',
      },
      {
        action: 'select',
        selector: 'size',
        value: 'medium',
        description: 'Select medium pizza size',
      },
      {
        action: 'fill',
        selector: 'comments',
        value: 'Leave at reception desk',
        description: 'Add delivery instructions',
      },
      {
        action: 'submit',
        selector: 'form',
        value: '',
        description: 'Submit form via HTTP POST',
      },
    ],
  },
  {
    id: 'hn-extract',
    label: 'Demo: Extract Hacker News',
    subtitle: 'Live DOM scraping of top stories & outbound URLs',
    goal: 'Extract front page stories from Hacker News',
    targetUrl: 'https://news.ycombinator.com',
    fallbackPrompt: 'Open https://news.ycombinator.com and extract the front page headlines',
    steps: [
      {
        action: 'navigate',
        selector: 'document',
        value: 'https://news.ycombinator.com',
        description: 'Navigate to Hacker News front page',
      },
      {
        action: 'extract',
        selector: '.titleline > a',
        value: '',
        description: 'Extract top 25 story titles and links',
      },
    ],
  },
  {
    id: 'wiki-pwa',
    label: 'Demo: Inspect & Extract Wikipedia',
    subtitle: 'Structured section extraction on Progressive Web Apps',
    goal: 'Extract section headings on Progressive Web Apps (Wikipedia)',
    targetUrl: 'https://en.wikipedia.org/wiki/Progressive_web_app',
    fallbackPrompt:
      'Open https://en.wikipedia.org/wiki/Progressive_web_app and extract key section headings',
    steps: [
      {
        action: 'navigate',
        selector: 'document',
        value: 'https://en.wikipedia.org/wiki/Progressive_web_app',
        description: 'Load Wikipedia PWA article',
      },
      {
        action: 'extract',
        selector: '#mw-content-text h2, #mw-content-text h3',
        value: '',
        description: 'Extract structured article section headings',
      },
    ],
  },
];

export const BrowserAutomationStage: React.FC<BrowserAutomationStageProps> = ({
  run,
  onInspectUrl,
  onSaveAsMacro,
  onRunQuickDemo,
  onExecutePlan,
  onClearRun,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [copiedBlock, setCopiedBlock] = useState<'extract' | 'submit' | null>(null);
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

  const handleTaskPromptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = taskPrompt.trim();
    if (!clean) return;
    setTaskPrompt('');
    onRunQuickDemo(clean);
  };

  const handleCopyJson = async (kind: 'extract' | 'submit', data: unknown) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopiedBlock(kind);
      window.setTimeout(() => setCopiedBlock((prev) => (prev === kind ? null : prev)), 1800);
    } catch {
      // ignore clipboard blocks
    }
  };

  const handleRerunCurrent = () => {
    if (!run || !onExecutePlan) return;
    onExecutePlan({
      goal: run.goal,
      targetUrl: run.targetUrl,
      steps: run.steps.map(({ action, selector, value, description }) => ({
        action,
        selector,
        value,
        description,
      })),
    });
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
              placeholder="Enter website URL to inspect DOM selectors..."
              className="w-full bg-transparent text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>
          <button type="submit" className={MAC_GLASS_BTN_SECONDARY}>
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Inspect</span>
          </button>
        </form>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {run && onExecutePlan && run.status !== 'running' && (
            <button type="button" onClick={handleRerunCurrent} className={MAC_GLASS_BTN_SECONDARY}>
              <Play className="w-3.5 h-3.5 text-emerald-300" />
              <span>Re-run</span>
            </button>
          )}
          {run && onClearRun && (
            <button type="button" onClick={onClearRun} className={MAC_GLASS_BTN_SECONDARY}>
              <RotateCcw className="w-3.5 h-3.5" />
              <span>New Task</span>
            </button>
          )}
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
          className="flex-1 p-6 sm:p-8 overflow-y-auto flex flex-col items-center justify-center text-center space-y-6"
        >
          <div className="w-13 h-13 rounded-2xl bg-gradient-to-b from-sky-400/20 to-blue-600/15 border border-sky-400/25 flex items-center justify-center text-sky-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
            <MousePointerClick className="w-6 h-6" />
          </div>

          <div className="max-w-lg space-y-2">
            <h3 className="text-lg font-semibold text-slate-100">Browser Automation Engine</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Stateful cookie sessions, DOM selector discovery, multi-field form filling, real HTTP POST submission, and structured data extraction.
            </p>
          </div>

          {/* Direct Natural-Language Automation Prompt */}
          <form onSubmit={handleTaskPromptSubmit} className="w-full max-w-xl flex items-center gap-2">
            <div className={`flex-1 ${MAC_GLASS_INPUT_WRAP}`}>
              <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
              <input
                type="text"
                value={taskPrompt}
                onChange={(e) => setTaskPrompt(e.target.value)}
                placeholder="Describe any web task (e.g. Open example.com and extract all links)..."
                className="w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={!taskPrompt.trim()}
              className={`${MAC_GLASS_BTN_PRIMARY} disabled:opacity-40`}
            >
              <Play className="w-3.5 h-3.5" />
              <span>Run</span>
            </button>
          </form>

          {/* Verified Real Automation Demos */}
          <div className="w-full max-w-2xl grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
            {DEMO_PLANS.map((demo) => (
              <button
                key={demo.id}
                type="button"
                onClick={() => {
                  if (onExecutePlan) {
                    onExecutePlan({
                      goal: demo.goal,
                      targetUrl: demo.targetUrl,
                      steps: demo.steps,
                    });
                  } else {
                    onRunQuickDemo(demo.fallbackPrompt);
                  }
                }}
                className={`${MAC_GLASS_CARD} p-3.5 hover:border-sky-400/45 hover:bg-white/[0.06] transition-all space-y-1.5 cursor-pointer group`}
              >
                <p className="text-xs font-semibold text-slate-100 group-hover:text-sky-300 transition-colors">
                  {demo.label}
                </p>
                <p className="text-[11px] text-slate-400 leading-snug">{demo.subtitle}</p>
              </button>
            ))}
          </div>
        </motion.div>
      ) : (
        <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-white/10 overflow-hidden">
          {/* Left: Step Execution Timeline */}
          <div className="xl:col-span-5 p-5 overflow-y-auto space-y-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                <span>Headless HTTP/DOM Engine</span>
                <span className="font-mono tabular-nums text-sky-300">
                  {run.steps.filter((s) => s.status === 'completed').length}/{run.steps.length} steps
                  {typeof run.totalDurationMs === 'number' ? ` · ${run.totalDurationMs}ms` : ''}
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
                        : step.status === 'failed'
                          ? 'bg-rose-500/[0.08] border-rose-400/35'
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
                        <span className="inline-flex items-center gap-1.5 text-xs shrink-0">
                          {typeof step.durationMs === 'number' && step.status !== 'pending' && (
                            <span className="text-[10px] font-mono tabular-nums text-slate-500">
                              {step.durationMs}ms
                            </span>
                          )}
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
                        {step.matchedSelector || step.selector
                          ? ` · ${step.matchedSelector || step.selector}`
                          : ''}
                        {step.value ? ` → "${step.value}"` : ''}
                      </p>
                      {step.detail && (
                        <p
                          className={`text-[11px] truncate ${
                            step.status === 'failed' ? 'text-rose-300' : 'text-slate-400'
                          }`}
                        >
                          {step.detail}
                        </p>
                      )}
                    </div>
                  </motion.li>
                );
              })}
            </ol>
          </div>

          {/* Right: Live Target DOM, Extracted Data & Form Submission Output */}
          <div className={`xl:col-span-7 p-5 overflow-y-auto space-y-5 ${MAC_GLASS_SIDEBAR}`}>
            {/* HTTP Form Submission Result */}
            {run.submissionResult && (
              <div className="p-4 rounded-xl bg-emerald-500/[0.07] border border-emerald-400/30 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Send className="w-4 h-4 text-emerald-300 shrink-0" />
                    <h4 className="text-xs font-semibold text-emerald-200 truncate">
                      Form Submission Response ({run.submissionResult.method}{' '}
                      {run.submissionResult.statusCode})
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopyJson(
                        'submit',
                        run.submissionResult?.parsedJson ?? run.submissionResult?.bodyPreview
                      )
                    }
                    className="px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[11px] text-slate-200 inline-flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    {copiedBlock === 'submit' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-300" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[11px] font-mono text-slate-400 truncate">
                  {run.submissionResult.actionUrl} · {run.submissionResult.contentType || 'response'}
                </p>
                <pre className="p-3 rounded-lg bg-black/50 border border-white/10 text-[11px] font-mono text-slate-200 overflow-x-auto max-h-56 leading-relaxed">
                  {run.submissionResult.parsedJson
                    ? JSON.stringify(run.submissionResult.parsedJson, null, 2)
                    : run.submissionResult.bodyPreview}
                </pre>
              </div>
            )}

            {/* Structured Extracted Data */}
            {run.extractedItems && run.extractedItems.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h5 className="text-xs font-semibold text-sky-300 inline-flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5" />
                    <span>Extracted Structured Data ({run.extractedItems.length})</span>
                  </h5>
                  <button
                    type="button"
                    onClick={() => void handleCopyJson('extract', run.extractedItems)}
                    className="px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[11px] text-slate-200 inline-flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    {copiedBlock === 'extract' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-300" />
                        <span>Copied JSON</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy JSON</span>
                      </>
                    )}
                  </button>
                </div>
                <div className={`divide-y divide-white/8 overflow-hidden ${MAC_GLASS_SUBSURFACE}`}>
                  {run.extractedItems.map((item, i) => (
                    <div
                      key={`${item.label}-${i}`}
                      className="px-3.5 py-2 flex items-center justify-between gap-3 text-xs hover:bg-white/[0.03] transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="font-mono text-[10px] text-slate-500 w-4 shrink-0">
                          {i + 1}.
                        </span>
                        <span className="text-slate-100 truncate">{item.label}</span>
                      </div>
                      {item.href && (
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-400 hover:text-sky-300 shrink-0 inline-flex items-center gap-1 text-[11px]"
                        >
                          <span>Open</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                      {run.inspection.headings.slice(0, 8).map((h, i) => (
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
                      {run.inspection.links.slice(0, 8).map((lnk, i) => (
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
