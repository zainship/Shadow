import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Check,
  Copy,
  Download,
  Image as ImageIcon,
  Maximize2,
  RefreshCw,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  GeneratedVisual,
  VisualAspectRatio,
  VisualStyle,
} from '../types/assistant';
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

interface VisualsStageProps {
  visual: GeneratedVisual | null;
  history: GeneratedVisual[];
  isGenerating: boolean;
  onGenerateVisual: (input: {
    prompt: string;
    style: VisualStyle;
    aspectRatio: VisualAspectRatio;
    refineFromSvg?: string;
  }) => Promise<void>;
  onSelectVisual: (visual: GeneratedVisual) => void;
  onDeleteVisual: (visual: GeneratedVisual) => void;
}

const PRESET_PROMPTS: Array<{
  title: string;
  prompt: string;
  style: VisualStyle;
  aspectRatio: VisualAspectRatio;
}> = [
  {
    title: 'Voice AI Architecture Diagram',
    prompt:
      'Clean system architecture diagram showing Microphone Audio -> WebSocket Bridge -> Gemini Live Core -> Tool Router -> Laptop Agent & 3D Arc Reactor',
    style: 'diagram',
    aspectRatio: '16:9',
  },
  {
    title: 'Quarterly Revenue Comparison Chart',
    prompt:
      'Modern dark-glass executive bar and trend line chart comparing Q1 through Q4 SaaS revenue ($1.2M, $1.8M, $2.6M, $3.9M) with percentage growth callouts',
    style: 'chart',
    aspectRatio: '16:9',
  },
  {
    title: 'Solar System Orbital Illustration',
    prompt:
      'Minimalist astronomical vector illustration of the inner and outer planets orbiting a glowing sun with orbital rings and subtle starfield',
    style: 'illustration',
    aspectRatio: '1:1',
  },
  {
    title: 'macOS Dashboard Wireframe',
    prompt:
      'Sleek dark macOS desktop workspace wireframe with sidebar navigation, top status bar, analytics area chart, and recent activity feed',
    style: 'wireframe',
    aspectRatio: '16:9',
  },
];

function svgToDataUri(svgMarkup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
}

export const VisualsStage: React.FC<VisualsStageProps> = ({
  visual,
  history,
  isGenerating,
  onGenerateVisual,
  onSelectVisual,
  onDeleteVisual,
}) => {
  const [promptInput, setPromptInput] = useState('');
  const [style, setStyle] = useState<VisualStyle>('auto');
  const [aspectRatio, setAspectRatio] = useState<VisualAspectRatio>('16:9');
  const [refineInput, setRefineInput] = useState('');
  const [zoomPct, setZoomPct] = useState(100);
  const [canvasBackdrop, setCanvasBackdrop] = useState<'dark' | 'grid' | 'light'>('dark');
  const [copiedSvg, setCopiedSvg] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const prefersReduced = useReducedMotion();

  const activeDataUri = useMemo(
    () => (visual?.svgMarkup ? svgToDataUri(visual.svgMarkup) : ''),
    [visual?.svgMarkup]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = promptInput.trim();
    if (!clean || isGenerating) return;
    await onGenerateVisual({ prompt: clean, style, aspectRatio });
    setPromptInput('');
    setZoomPct(100);
  };

  const handleRefineSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = refineInput.trim();
    if (!clean || !visual || isGenerating) return;
    await onGenerateVisual({
      prompt: clean,
      style: visual.kind,
      aspectRatio: visual.aspectRatio,
      refineFromSvg: visual.svgMarkup,
    });
    setRefineInput('');
  };

  const handleDownloadSvg = () => {
    if (!visual) return;
    const blob = new Blob([visual.svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = visual.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48) || 'visual';
    a.href = url;
    a.download = `${slug}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPng = () => {
    if (!visual || !activeDataUri) return;
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = visual.width * scale;
      canvas.height = visual.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const slug =
          visual.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48) || 'visual';
        a.href = url;
        a.download = `${slug}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/png');
    };
    img.src = activeDataUri;
  };

  const handleCopySvg = async () => {
    if (!visual) return;
    try {
      await navigator.clipboard.writeText(visual.svgMarkup);
      setCopiedSvg(true);
      setTimeout(() => setCopiedSvg(false), 1800);
    } catch {
      // ignore clipboard permissions error
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top Preview-style Prompt & Visual Controls Toolbar */}
      <form onSubmit={handleSubmit} className={MAC_GLASS_TOOLBAR}>
        <div className={`flex-1 min-w-[240px] ${MAC_GLASS_INPUT_WRAP}`}>
          <ImageIcon className="w-4 h-4 text-purple-300/85 shrink-0" />
          <input
            type="text"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            placeholder="Describe a diagram, chart, wireframe, or illustration to generate..."
            className="w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
        </div>

        <MacSegmentedControl
          layoutId="mac-visual-style"
          value={style}
          onChange={setStyle}
          className="hidden md:inline-flex"
          options={[
            { id: 'auto', label: 'Auto' },
            { id: 'diagram', label: 'Diagram' },
            { id: 'chart', label: 'Chart' },
            { id: 'illustration', label: 'Art' },
            { id: 'wireframe', label: 'UI' },
          ]}
        />

        <MacSegmentedControl
          layoutId="mac-visual-ratio"
          value={aspectRatio}
          onChange={setAspectRatio}
          options={[
            { id: '16:9', label: '16:9' },
            { id: '1:1', label: '1:1' },
            { id: '4:3', label: '4:3' },
            { id: '3:4', label: '3:4' },
          ]}
        />

        <button
          type="submit"
          disabled={isGenerating || !promptInput.trim()}
          className={MAC_GLASS_BTN_PRIMARY}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
          <span>{isGenerating ? 'Generating...' : 'Generate'}</span>
        </button>
      </form>

      {/* Main Split Workspace: Visual Viewport + Library Sidebar */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-white/10 overflow-hidden">
        {/* Left: Primary Visual Canvas */}
        <div className="xl:col-span-8 flex flex-col overflow-hidden">
          {isGenerating ? (
            <div className="flex-1 p-6 flex flex-col justify-center items-center space-y-5">
              <div className="w-full max-w-2xl aspect-video rounded-2xl border border-white/10 bg-white/[0.03] animate-pulse flex flex-col items-center justify-center gap-3 p-6">
                <ImageIcon className="w-8 h-8 text-purple-300/70" />
                <p className="text-sm font-medium text-slate-200">
                  Synthesizing vector visual...
                </p>
                <p className="text-xs text-slate-400 text-center max-w-md">
                  Composing layout geometry, gradients, and typography for your interface.
                </p>
              </div>
            </div>
          ) : !visual ? (
            <motion.div
              initial={prefersReduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="flex-1 p-8 flex flex-col items-center justify-center text-center space-y-6 overflow-y-auto"
            >
              <div className="w-13 h-13 rounded-2xl bg-gradient-to-b from-purple-400/25 to-indigo-600/15 border border-purple-400/30 flex items-center justify-center text-purple-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
                <ImageIcon className="w-6 h-6" />
              </div>
              <div className="max-w-md space-y-2">
                <h3 className="text-lg font-semibold text-slate-100">Shadow Visual Studio</h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Ask Shadow by voice or describe any diagram, chart, wireframe, or vector artwork above. Generated visuals open right here with zoom, refinement, and SVG/PNG export.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl text-left">
                {PRESET_PROMPTS.map((preset) => (
                  <button
                    key={preset.title}
                    type="button"
                    onClick={() =>
                      void onGenerateVisual({
                        prompt: preset.prompt,
                        style: preset.style,
                        aspectRatio: preset.aspectRatio,
                      })
                    }
                    className={`p-3.5 text-left transition-colors hover:bg-white/[0.06] cursor-pointer space-y-1 ${MAC_GLASS_CARD}`}
                  >
                    <p className="text-xs font-semibold text-slate-100">{preset.title}</p>
                    <p className="text-[11px] text-slate-400 line-clamp-2">{preset.prompt}</p>
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Visual Header & Canvas Controls */}
              <div className="px-5 py-3 border-b border-white/10 bg-white/[0.02] flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div className="min-w-0 space-y-0.5">
                  <h3 className="text-sm font-semibold text-slate-50 truncate">{visual.title}</h3>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    <span className="capitalize">{visual.kind}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {visual.width}×{visual.height} ({visual.aspectRatio})
                    </span>
                    {visual.palette.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          {visual.palette.slice(0, 4).map((hex) => (
                            <span
                              key={hex}
                              title={hex}
                              style={{ backgroundColor: hex }}
                              className="w-2.5 h-2.5 rounded-full border border-white/25 inline-block"
                            />
                          ))}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <MacSegmentedControl
                    layoutId="mac-visual-backdrop"
                    value={canvasBackdrop}
                    onChange={setCanvasBackdrop}
                    options={[
                      { id: 'dark', label: 'Dark' },
                      { id: 'grid', label: 'Grid' },
                      { id: 'light', label: 'Light' },
                    ]}
                  />
                  <div className="inline-flex items-center rounded-xl bg-black/35 border border-white/10 p-0.5">
                    <button
                      type="button"
                      onClick={() => setZoomPct((z) => Math.max(50, z - 25))}
                      aria-label="Zoom out"
                      className="p-1.5 rounded-lg text-slate-300 hover:bg-white/10 cursor-pointer"
                    >
                      <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoomPct(100)}
                      className="px-2 text-[11px] font-mono tabular-nums text-slate-200 cursor-pointer"
                    >
                      {zoomPct}%
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoomPct((z) => Math.min(200, z + 25))}
                      aria-label="Zoom in"
                      className="p-1.5 rounded-lg text-slate-300 hover:bg-white/10 cursor-pointer"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLightboxOpen(true)}
                    aria-label="Inspect fullscreen"
                    className={MAC_GLASS_BTN_SECONDARY}
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Expand</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopySvg()}
                    className={MAC_GLASS_BTN_SECONDARY}
                  >
                    {copiedSvg ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span className="hidden sm:inline">{copiedSvg ? 'Copied' : 'SVG'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadSvg}
                    className={MAC_GLASS_BTN_SECONDARY}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>SVG</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadPng}
                    className={MAC_GLASS_BTN_PRIMARY}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>PNG</span>
                  </button>
                </div>
              </div>

              {/* Zoomable Canvas Viewport */}
              <div
                className={`flex-1 overflow-auto p-5 flex items-center justify-center ${
                  canvasBackdrop === 'light'
                    ? 'bg-slate-100'
                    : canvasBackdrop === 'grid'
                      ? 'bg-[#090F1C] bg-[radial-gradient(rgba(255,255,255,0.1)_1px,transparent_1px)] [background-size:18px_18px]'
                      : 'bg-[#070B14]'
                }`}
              >
                <motion.div
                  key={visual.id}
                  initial={prefersReduced ? false : { opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  style={{ width: `${zoomPct}%` }}
                  className="max-w-full flex items-center justify-center"
                >
                  <img
                    src={activeDataUri}
                    alt={visual.title}
                    className="w-full h-auto max-h-[52vh] object-contain rounded-xl border border-white/12 shadow-[0_20px_50px_rgba(0,0,0,0.45)]"
                  />
                </motion.div>
              </div>

              {/* Bottom Refine / Iterate Prompt Bar */}
              <form
                onSubmit={handleRefineSubmit}
                className="px-5 py-3 border-t border-white/10 bg-white/[0.025] flex items-center gap-2.5 shrink-0"
              >
                <div className={`flex-1 ${MAC_GLASS_INPUT_WRAP}`}>
                  <input
                    type="text"
                    value={refineInput}
                    onChange={(e) => setRefineInput(e.target.value)}
                    placeholder="Refine this visual (e.g. add labels, change color theme to emerald, highlight Step 3)..."
                    className="w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!refineInput.trim() || isGenerating}
                  className={MAC_GLASS_BTN_SECONDARY}
                >
                  Refine Visual
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Right: Generated Visuals Gallery Sidebar */}
        <div className={`xl:col-span-4 p-4 overflow-y-auto space-y-3 ${MAC_GLASS_SIDEBAR}`}>
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
            <h4 className="text-xs font-semibold text-slate-200">
              Visual Library ({history.length})
            </h4>
            {visual && (
              <span className="text-[11px] text-slate-400 truncate max-w-[160px]">
                {visual.summary}
              </span>
            )}
          </div>

          {history.length === 0 ? (
            <div className="py-12 px-3 text-center text-xs text-slate-500">
              Generated diagrams, charts, and artwork will stay organized here for instant reopening.
            </div>
          ) : (
            <div className="space-y-2.5">
              {history.map((item) => {
                const selected = visual?.id === item.id;
                const thumbUri = svgToDataUri(item.svgMarkup);
                return (
                  <div
                    key={item.id}
                    className={`group p-2.5 rounded-xl border transition-colors ${
                      selected
                        ? 'bg-purple-500/12 border-purple-400/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
                        : `${MAC_GLASS_SUBSURFACE} hover:bg-white/[0.05]`
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectVisual(item);
                        setZoomPct(100);
                      }}
                      className="w-full text-left space-y-2 cursor-pointer"
                    >
                      <div className="aspect-video w-full rounded-lg overflow-hidden bg-black/40 border border-white/8">
                        <img
                          src={thumbUri}
                          alt={item.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-100 truncate">
                            {item.title}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            <span className="capitalize">{item.kind}</span>
                            <span aria-hidden="true"> · </span>
                            <span className="font-mono">{item.aspectRatio}</span>
                          </p>
                        </div>
                      </div>
                    </button>
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => onDeleteVisual(item)}
                        aria-label={`Delete ${item.title}`}
                        className="p-1 rounded-md text-slate-500 hover:text-rose-400 hover:bg-white/[0.08] transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen Lightbox Inspection Modal */}
      <AnimatePresence>
        {lightboxOpen && visual && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightboxOpen(false)}
            className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xl p-6 flex flex-col items-center justify-center"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-6xl max-h-full flex flex-col gap-3"
            >
              <div className="flex items-center justify-between text-slate-100">
                <div>
                  <h4 className="text-base font-semibold">{visual.title}</h4>
                  <p className="text-xs text-slate-400">{visual.summary}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setLightboxOpen(false)}
                  aria-label="Close fullscreen preview"
                  className={MAC_GLASS_BTN_SECONDARY}
                >
                  <X className="w-4 h-4" />
                  <span>Close</span>
                </button>
              </div>
              <div className="flex-1 min-h-0 flex items-center justify-center rounded-2xl border border-white/15 bg-[#070B14] p-4 overflow-auto">
                <img
                  src={activeDataUri}
                  alt={visual.title}
                  className="max-w-full max-h-[78vh] object-contain rounded-lg"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
