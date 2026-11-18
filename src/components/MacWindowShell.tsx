import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Maximize2, Minimize2, Minus, X } from 'lucide-react';

export const MAC_GLASS_TOOLBAR =
  'px-5 py-3 border-b border-white/10 bg-white/[0.03] backdrop-blur-md flex flex-wrap items-center gap-3 shrink-0';

export const MAC_GLASS_INPUT_WRAP =
  'flex items-center gap-2 px-3 py-1.5 rounded-[10px] bg-black/35 border border-white/10 focus-within:border-sky-400/60 focus-within:bg-black/45 focus-within:ring-2 focus-within:ring-sky-400/15 transition-all';

export const MAC_GLASS_FIELD =
  'w-full px-3 py-1.5 rounded-[10px] bg-black/35 border border-white/10 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400/60 focus:bg-black/45 focus:ring-2 focus:ring-sky-400/15 transition-all';

export const MAC_GLASS_BTN_PRIMARY =
  'px-3.5 py-1.5 rounded-[10px] bg-gradient-to-b from-sky-400 to-sky-500 text-slate-950 text-xs font-semibold shadow-[0_4px_14px_rgba(56,189,248,0.32),inset_0_1px_0_rgba(255,255,255,0.45)] hover:brightness-110 active:scale-[0.97] disabled:opacity-40 transition-all inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer';

export const MAC_GLASS_BTN_SECONDARY =
  'px-3 py-1.5 rounded-[10px] border border-white/12 bg-white/[0.06] hover:bg-white/[0.11] hover:border-white/20 text-xs font-medium text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] active:scale-[0.97] disabled:opacity-40 transition-all inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer';

export const MAC_GLASS_SIDEBAR = 'bg-white/[0.02] backdrop-blur-md';

export const MAC_GLASS_CARD =
  'rounded-xl bg-white/[0.035] border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]';

export const MAC_GLASS_SUBSURFACE =
  'rounded-xl bg-black/30 border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]';

interface MacWindowFrameProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  isMaximized?: boolean;
  onClose: () => void;
  onMinimize?: () => void;
  onToggleMaximize?: () => void;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}

export const MacWindowFrame: React.FC<MacWindowFrameProps> = ({
  title,
  subtitle,
  icon,
  isMaximized = false,
  onClose,
  onMinimize,
  onToggleMaximize,
  headerRight,
  children,
}) => {
  return (
    <div className="flex flex-col h-full rounded-[20px] bg-[#0B111E]/76 backdrop-blur-2xl border border-white/14 shadow-[0_32px_90px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.16)] overflow-hidden">
      {/* Authentic macOS Vibrancy Title Bar */}
      <div className="h-11 px-4 border-b border-white/10 bg-white/[0.04] backdrop-blur-xl flex items-center justify-between gap-4 shrink-0 select-none">
        {/* Left: Interactive macOS Traffic Lights */}
        <div className="group/lights flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            title="Close (Esc)"
            className="w-3.5 h-3.5 rounded-full bg-[#FF5F57] border border-black/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] flex items-center justify-center text-black/75 hover:brightness-110 active:scale-90 transition-all cursor-pointer"
          >
            <X className="w-2.5 h-2.5 opacity-0 group-hover/lights:opacity-100 transition-opacity stroke-[2.5]" />
          </button>

          <button
            type="button"
            onClick={onMinimize || onClose}
            aria-label={`Minimize ${title}`}
            title="Minimize to Dock"
            className="w-3.5 h-3.5 rounded-full bg-[#FEBC2E] border border-black/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] flex items-center justify-center text-black/75 hover:brightness-110 active:scale-90 transition-all cursor-pointer"
          >
            <Minus className="w-2.5 h-2.5 opacity-0 group-hover/lights:opacity-100 transition-opacity stroke-[2.5]" />
          </button>

          <button
            type="button"
            onClick={onToggleMaximize}
            disabled={!onToggleMaximize}
            aria-label={isMaximized ? `Restore ${title} size` : `Expand ${title}`}
            title={isMaximized ? 'Restore Window' : 'Expand Window'}
            className="w-3.5 h-3.5 rounded-full bg-[#28C840] border border-black/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] flex items-center justify-center text-black/75 hover:brightness-110 active:scale-90 disabled:opacity-50 transition-all cursor-pointer"
          >
            {isMaximized ? (
              <Minimize2 className="w-2 h-2 opacity-0 group-hover/lights:opacity-100 transition-opacity stroke-[2.5]" />
            ) : (
              <Maximize2 className="w-2 h-2 opacity-0 group-hover/lights:opacity-100 transition-opacity stroke-[2.5]" />
            )}
          </button>
        </div>

        {/* Center: App Window Title & Icon */}
        <div
          onDoubleClick={onToggleMaximize}
          className="flex items-center justify-center gap-2 min-w-0 flex-1"
        >
          {icon && (
            <span className="w-5 h-5 rounded-md bg-white/[0.08] border border-white/12 flex items-center justify-center shrink-0">
              {icon}
            </span>
          )}
          <span className="text-xs font-semibold text-slate-100 tracking-tight truncate">
            {title}
          </span>
          {subtitle && (
            <>
              <span className="text-slate-500 hidden sm:inline" aria-hidden="true">
                ·
              </span>
              <span className="text-[11px] text-slate-400 truncate hidden sm:inline">
                {subtitle}
              </span>
            </>
          )}
        </div>

        {/* Right: Toolbar slot or balanced spacer */}
        <div className="min-w-[58px] flex items-center justify-end gap-2 shrink-0">
          {headerRight}
        </div>
      </div>

      {/* Window Content Surface */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
};

export interface MacSegmentOption<T extends string> {
  id: T;
  label: string;
}

interface MacSegmentedControlProps<T extends string> {
  options: ReadonlyArray<MacSegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  layoutId: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function MacSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  layoutId,
  size = 'sm',
  className = '',
}: MacSegmentedControlProps<T>) {
  const prefersReduced = useReducedMotion();

  return (
    <div
      className={`inline-flex items-center gap-0.5 p-0.5 rounded-[10px] bg-black/35 border border-white/10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] shrink-0 ${className}`}
    >
      {options.map((opt) => {
        const selected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`relative rounded-[8px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              size === 'md' ? 'px-3 py-1.5 text-xs' : 'px-2.5 py-1 text-xs'
            } ${selected ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {selected && (
              <motion.span
                layoutId={layoutId}
                transition={
                  prefersReduced
                    ? { duration: 0.01 }
                    : { type: 'spring', stiffness: 460, damping: 34 }
                }
                className="absolute inset-0 rounded-[8px] bg-white/[0.14] border border-white/15 shadow-[0_1px_4px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.16)]"
              />
            )}
            <span className="relative z-10 tabular-nums">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

interface MacToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  accent?: 'sky' | 'emerald';
}

export const MacToggleSwitch: React.FC<MacToggleSwitchProps> = ({
  checked,
  onChange,
  label,
  accent = 'sky',
}) => {
  const activeBg =
    accent === 'emerald'
      ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.45)]'
      : 'bg-sky-500 shadow-[0_0_12px_rgba(56,189,248,0.45)]';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative w-9 h-5 rounded-full transition-all duration-200 shrink-0 cursor-pointer border border-white/10 ${
        checked ? activeBg : 'bg-white/[0.12]'
      }`}
    >
      <span
        className={`block w-3.5 h-3.5 rounded-full bg-white shadow-md transition-transform duration-200 ${
          checked ? 'translate-x-4.5' : 'translate-x-1'
        }`}
      />
    </button>
  );
};
