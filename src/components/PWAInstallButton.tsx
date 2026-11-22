import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { MAC_SPRING_CONTROL } from './MacWindowShell';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <motion.button
        type="button"
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.96 }}
        transition={MAC_SPRING_CONTROL}
        onClick={() => void install()}
        title="Install Shadow as a standalone app"
        className="px-3 py-1.5 rounded-lg border border-sky-400/35 bg-sky-500/15 backdrop-blur-2xl backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] text-xs font-medium text-sky-200 hover:bg-sky-500/25 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="w-3.5 h-3.5 text-sky-300" />
        <span>Install App</span>
      </motion.button>
    );
  }

  if (isIOS) {
    return (
      <>
        <motion.button
          type="button"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.96 }}
          transition={MAC_SPRING_CONTROL}
          onClick={() => setShowIOSGuide(true)}
          className="px-3 py-1.5 rounded-lg border border-white/16 bg-white/[0.06] backdrop-blur-2xl backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] text-xs font-medium text-slate-200 hover:bg-white/[0.12] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Share className="w-3.5 h-3.5 text-sky-400" />
          <span>Install</span>
        </motion.button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-md p-4">
            <div className="w-full max-w-sm rounded-2xl bg-[#070B12]/95 border border-white/15 p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">Install Shadow on iPhone / iPad</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Close"
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="text-xs text-slate-300 space-y-2 list-decimal list-inside leading-relaxed">
                <li>
                  Tap the <strong className="text-white">Share</strong> button in the Safari toolbar.
                </li>
                <li>
                  Scroll down and select <strong className="text-white">Add to Home Screen</strong>.
                </li>
                <li>
                  Tap <strong className="text-white">Add</strong> to launch Shadow as a standalone app.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-medium text-white transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
