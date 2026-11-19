import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AlertTriangle, Check, FolderOpen, Laptop, ShieldAlert, Terminal, X } from 'lucide-react';
import { MAC_SPRING_SHEET } from './MacWindowShell';

export interface LaptopPermissionRequest {
  id: string;
  toolName: string;
  category: 'files' | 'apps' | 'terminal';
  title: string;
  summary: string;
  detailText: string;
  isHighRisk: boolean;
  wasCategoryBlocked: boolean;
}

interface LaptopPermissionModalProps {
  request: LaptopPermissionRequest | null;
  assistantName: string;
  runtimeLabel: string;
  onDeny: () => void;
  onAllowOnce: () => void;
  onAlwaysAllowCategory: () => void;
}

export const LaptopPermissionModal: React.FC<LaptopPermissionModalProps> = ({
  request,
  assistantName,
  runtimeLabel,
  onDeny,
  onAllowOnce,
  onAlwaysAllowCategory,
}) => {
  const prefersReduced = useReducedMotion();

  const icon =
    request?.category === 'files' ? (
      <FolderOpen className="w-5 h-5 text-sky-300" />
    ) : request?.category === 'apps' ? (
      <Laptop className="w-5 h-5 text-emerald-300" />
    ) : (
      <Terminal className="w-5 h-5 text-amber-300" />
    );

  const categoryLabel =
    request?.category === 'files'
      ? 'Files & Folders'
      : request?.category === 'apps'
        ? 'Desktop Apps'
        : 'Terminal Commands';

  return (
    <AnimatePresence>
      {request && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-md p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="laptop-perm-title"
        >
          <motion.div
            initial={
              prefersReduced
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.94, y: 14, filter: 'blur(6px)' }
            }
            animate={
              prefersReduced
                ? { opacity: 1 }
                : { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }
            }
            exit={
              prefersReduced
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.96, y: 8, filter: 'blur(4px)' }
            }
            transition={MAC_SPRING_SHEET}
            className="w-full max-w-md rounded-2xl border border-white/20 bg-[#0B1222]/80 backdrop-blur-3xl backdrop-saturate-150 shadow-[0_32px_90px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.22)] overflow-hidden text-slate-100"
          >
            <div className="px-5 py-4 border-b border-white/12 bg-white/[0.04] flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl border border-white/15 bg-white/[0.06] flex items-center justify-center shrink-0">
                  {icon}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 id="laptop-perm-title" className="text-sm font-semibold text-slate-100">
                      Laptop Permission Request
                    </h2>
                    {request.isHighRisk && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-[10px] font-medium text-amber-200">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        <span>Elevated</span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {assistantName} wants to run an action via{' '}
                    <span className="text-slate-200 font-medium">{runtimeLabel}</span>
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onDeny}
                aria-label="Deny permission"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/[0.08] transition-colors shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5">
              {request.wasCategoryBlocked && (
                <div className="rounded-xl border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 flex items-start gap-2">
                  <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    <strong>{categoryLabel}</strong> is currently set to require approval. Grant
                    once or enable it below.
                  </span>
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-slate-200">{request.title}</p>
                <p className="text-xs text-slate-400 mt-0.5">{request.summary}</p>
              </div>

              <div className="rounded-xl border border-white/12 bg-black/40 p-3 font-mono text-[11px] text-sky-200 max-h-36 overflow-y-auto break-all whitespace-pre-wrap">
                {request.detailText}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onDeny}
                  className="px-3.5 py-2 rounded-xl border border-rose-400/35 bg-rose-500/15 hover:bg-rose-500/25 text-xs font-medium text-rose-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Deny
                </button>
                <button
                  type="button"
                  onClick={onAlwaysAllowCategory}
                  className="px-3.5 py-2 rounded-xl border border-white/16 bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Always Allow {categoryLabel}
                </button>
                <button
                  type="button"
                  onClick={onAllowOnce}
                  className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Allow Once</span>
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
