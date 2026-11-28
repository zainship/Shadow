import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Trash2,
  X,
} from 'lucide-react';
import type { ShadowErrorEntry } from '../lib/errorStore';

interface ErrorInspectorModalProps {
  open: boolean;
  errors: ShadowErrorEntry[];
  onClose: () => void;
  onDismissError: (id: string) => void;
  onClearAll: () => void;
}

function formatErrorTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatCopyText(err: ShadowErrorEntry): string {
  return [
    `[${new Date(err.timestamp).toISOString()}] ${err.source} — ${err.title}`,
    err.endpoint ? `Endpoint: ${err.endpoint}` : '',
    err.statusCode ? `Status: ${err.statusCode}` : '',
    `Message: ${err.message}`,
    err.rawDetail ? `\nTechnical Details:\n${err.rawDetail}` : '',
    err.stack ? `\nStack Trace:\n${err.stack}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export const ErrorInspectorModal: React.FC<ErrorInspectorModalProps> = ({
  open,
  errors,
  onClose,
  onDismissError,
  onClearAll,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  if (!open) return null;

  const handleCopy = async (err: ShadowErrorEntry) => {
    try {
      await navigator.clipboard.writeText(formatCopyText(err));
      setCopiedId(err.id);
      window.setTimeout(() => setCopiedId((prev) => (prev === err.id ? null : prev)), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleCopyAll = async () => {
    try {
      const payload = errors.map(formatCopyText).join('\n\n---\n\n');
      await navigator.clipboard.writeText(payload);
      setCopiedId('__all__');
      window.setTimeout(() => setCopiedId((prev) => (prev === '__all__' ? null : prev)), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Detailed Error Diagnostics"
    >
      <div
        className="w-full max-w-3xl max-h-[84vh] flex flex-col rounded-2xl bg-[#080D18] border border-rose-500/30 shadow-[0_32px_90px_rgba(0,0,0,0.85)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-8 h-8 rounded-xl bg-rose-500/15 border border-rose-400/35 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4 text-rose-300" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-100 leading-tight">
                Error Details
              </h2>
              <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
                {errors.length === 0
                  ? 'No errors recorded in this session'
                  : `${errors.length} recorded ${errors.length === 1 ? 'error' : 'errors'} · Full upstream diagnostics`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {errors.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => void handleCopyAll()}
                  className="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {copiedId === '__all__' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-slate-300" />
                  )}
                  <span>{copiedId === '__all__' ? 'Copied All' : 'Copy All'}</span>
                </button>
                <button
                  type="button"
                  onClick={onClearAll}
                  className="px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 text-xs font-medium text-rose-200 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear All</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close error details"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {errors.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <p className="text-sm text-slate-300">No errors have occurred.</p>
              <p className="text-xs text-slate-500">
                Any WebSocket drops, API failures, Gemini errors, Workspace rejections, or runtime exceptions will appear here with full diagnostics.
              </p>
            </div>
          ) : (
            errors.map((err, idx) => {
              const hasTech = Boolean(err.rawDetail || err.stack);
              const isOpen = expandedIds[err.id] ?? idx === 0;
              return (
                <div
                  key={err.id}
                  className="p-4 rounded-xl bg-[#0D1322] border border-rose-500/20 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-400 font-mono tabular-nums">
                        <span className="text-rose-300 font-semibold font-sans">{err.source}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatErrorTime(err.timestamp)}</span>
                        {err.statusCode !== undefined && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-300">HTTP {err.statusCode}</span>
                          </>
                        )}
                        {err.endpoint && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-300 break-all">{err.endpoint}</span>
                          </>
                        )}
                      </div>
                      <h3 className="text-sm font-semibold text-slate-100 break-words">
                        {err.title}
                      </h3>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleCopy(err)}
                        title="Copy detailed error report"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                      >
                        {copiedId === err.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDismissError(err.id)}
                        title="Dismiss error"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <p className="text-sm text-rose-100 leading-relaxed whitespace-pre-wrap break-words">
                    {err.message}
                  </p>

                  {hasTech && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedIds((prev) => ({ ...prev, [err.id]: !isOpen }))
                        }
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
                      >
                        {isOpen ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                        <span>{isOpen ? 'Hide Technical Details' : 'Show Technical Details'}</span>
                      </button>

                      {isOpen && (
                        <div className="mt-2 space-y-2">
                          {err.rawDetail && (
                            <pre className="p-3 rounded-lg bg-black/55 border border-white/10 text-[11px] leading-relaxed font-mono text-slate-200 overflow-x-auto whitespace-pre-wrap break-words">
                              {err.rawDetail}
                            </pre>
                          )}
                          {err.stack && (
                            <pre className="p-3 rounded-lg bg-black/55 border border-white/10 text-[11px] leading-relaxed font-mono text-slate-400 overflow-x-auto whitespace-pre-wrap break-words">
                              {err.stack}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
