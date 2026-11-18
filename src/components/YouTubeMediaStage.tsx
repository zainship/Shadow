import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  ExternalLink,
  Music,
  Pause,
  Play,
  Search,
  SkipForward,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { YouTubeTrack } from '../types/assistant';
import {
  MAC_GLASS_BTN_PRIMARY,
  MAC_GLASS_BTN_SECONDARY,
  MAC_GLASS_INPUT_WRAP,
  MAC_GLASS_SIDEBAR,
  MAC_GLASS_TOOLBAR,
} from './MacWindowShell';

interface YouTubeMediaStageProps {
  currentTrack: YouTubeTrack | null;
  queue: YouTubeTrack[];
  pendingPlayerAction: { action: string; seconds?: number; nonce: number } | null;
  onSearchAndPlay: (query: string, mediaType: 'song' | 'video') => void;
  onSelectTrack: (track: YouTubeTrack) => void;
  onRemoveTrack: (track: YouTubeTrack) => void;
}

export const YouTubeMediaStage: React.FC<YouTubeMediaStageProps> = ({
  currentTrack,
  queue,
  pendingPlayerAction,
  onSearchAndPlay,
  onSelectTrack,
  onRemoveTrack,
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const prefersReduced = useReducedMotion();

  const sendYouTubeCommand = (func: string, args: unknown[] = []) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      JSON.stringify({
        event: 'command',
        func,
        args,
      }),
      '*'
    );
  };

  // Execute voice-driven YouTube control actions (pause, play, mute, next, seek, stop)
  useEffect(() => {
    if (!pendingPlayerAction) return;
    const { action, seconds } = pendingPlayerAction;
    if (action === 'pause') {
      sendYouTubeCommand('pauseVideo');
      setIsPaused(true);
    } else if (action === 'play') {
      sendYouTubeCommand('playVideo');
      setIsPaused(false);
    } else if (action === 'mute') {
      sendYouTubeCommand('mute');
      setIsMuted(true);
    } else if (action === 'unmute') {
      sendYouTubeCommand('unMute');
      setIsMuted(false);
    } else if (action === 'stop') {
      sendYouTubeCommand('stopVideo');
      setIsPaused(true);
    } else if (action === 'seek' && typeof seconds === 'number') {
      sendYouTubeCommand('seekTo', [seconds, true]);
    } else if (action === 'next' && queue.length > 0) {
      const idx = currentTrack
        ? queue.findIndex((t) => t.videoId === currentTrack.videoId)
        : -1;
      const nextTrack = queue[(idx + 1) % queue.length];
      if (nextTrack) onSelectTrack(nextTrack);
    } else if (action === 'previous' && queue.length > 0) {
      const idx = currentTrack
        ? queue.findIndex((t) => t.videoId === currentTrack.videoId)
        : 0;
      const prevTrack = queue[(idx - 1 + queue.length) % queue.length];
      if (prevTrack) onSelectTrack(prevTrack);
    }
  }, [pendingPlayerAction]);

  useEffect(() => {
    setIsPaused(false);
  }, [currentTrack?.videoId]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    onSearchAndPlay(q, 'video');
    setSearchQuery('');
  };

  const handleTogglePlayPause = () => {
    if (isPaused) {
      sendYouTubeCommand('playVideo');
      setIsPaused(false);
    } else {
      sendYouTubeCommand('pauseVideo');
      setIsPaused(true);
    }
  };

  const handleToggleMute = () => {
    if (isMuted) {
      sendYouTubeCommand('unMute');
      setIsMuted(false);
    } else {
      sendYouTubeCommand('mute');
      setIsMuted(true);
    }
  };

  const handleNext = () => {
    if (queue.length === 0) return;
    const idx = currentTrack ? queue.findIndex((t) => t.videoId === currentTrack.videoId) : -1;
    const next = queue[(idx + 1) % queue.length];
    if (next) onSelectTrack(next);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Apple Music / QuickTime Frosted Search Toolbar */}
      <div className={MAC_GLASS_TOOLBAR}>
        <form onSubmit={handleSearchSubmit} className="flex-1 min-w-[240px] flex items-center gap-2.5">
          <div className={`flex-1 ${MAC_GLASS_INPUT_WRAP}`}>
            <Search className="w-4 h-4 text-rose-300/80 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search any song, artist, or YouTube video..."
              className="w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={!searchQuery.trim()}
            className="px-3.5 py-1.5 rounded-[10px] bg-gradient-to-b from-rose-500 to-red-600 text-white text-xs font-semibold shadow-[0_4px_14px_rgba(244,63,94,0.35),inset_0_1px_0_rgba(255,255,255,0.3)] hover:brightness-110 active:scale-[0.97] disabled:opacity-40 transition-all whitespace-nowrap shrink-0 cursor-pointer"
          >
            Play on YouTube
          </button>
        </form>
      </div>

      {/* Main Theater Player + Apple Music Queue Sidebar */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-white/10 overflow-hidden">
        {/* Left: Embedded YouTube IFrame Player */}
        <div className="xl:col-span-8 p-5 flex flex-col gap-4 overflow-y-auto">
          {currentTrack ? (
            <motion.div
              key={currentTrack.videoId}
              initial={prefersReduced ? false : { opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="flex flex-col gap-4"
            >
              <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black border border-white/12 shadow-[0_20px_50px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.12)]">
                <iframe
                  ref={iframeRef}
                  key={currentTrack.videoId}
                  src={`https://www.youtube.com/embed/${currentTrack.videoId}?autoplay=1&enablejsapi=1&rel=0`}
                  title={currentTrack.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="w-full h-full border-0"
                />
              </div>

              {/* QuickTime Frosted Transport Bar */}
              <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <h3 className="text-sm font-semibold text-slate-50 truncate">
                    {currentTrack.title}
                  </h3>
                  <p className="text-xs text-slate-400">
                    <span>{currentTrack.channel}</span>
                    <span aria-hidden="true"> · </span>
                    <span className="capitalize">{currentTrack.mediaType}</span>
                    {currentTrack.duration && (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span className="font-mono tabular-nums">{currentTrack.duration}</span>
                      </>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleTogglePlayPause}
                    className={MAC_GLASS_BTN_PRIMARY}
                  >
                    {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                    <span>{isPaused ? 'Resume' : 'Pause'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleMute}
                    className={MAC_GLASS_BTN_SECONDARY}
                  >
                    {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    <span>{isMuted ? 'Unmute' : 'Mute'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleNext}
                    disabled={queue.length < 2}
                    className={MAC_GLASS_BTN_SECONDARY}
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                    <span>Next</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      sendYouTubeCommand('stopVideo');
                      setIsPaused(true);
                    }}
                    className={MAC_GLASS_BTN_SECONDARY}
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>Stop</span>
                  </button>
                  <a
                    href={`https://www.youtube.com/watch?v=${currentTrack.videoId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={MAC_GLASS_BTN_SECONDARY}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>YouTube</span>
                  </a>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              initial={prefersReduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="flex-1 py-16 flex flex-col items-center justify-center text-center space-y-5"
            >
              <div className="w-13 h-13 rounded-2xl bg-gradient-to-b from-rose-500/20 to-red-600/15 border border-rose-400/25 flex items-center justify-center text-rose-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
                <Music className="w-6 h-6" />
              </div>
              <div className="max-w-md space-y-2">
                <h3 className="text-lg font-semibold text-slate-100">
                  YouTube Audio &amp; Video Player
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Tell Shadow to play any song, music mix, or video on YouTube—or search above. Playback responds to voice commands like pause, mute, or next track.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => onSearchAndPlay('Lofi Girl beats to relax study to', 'song')}
                  className={MAC_GLASS_BTN_SECONDARY}
                >
                  Play Lofi Focus Mix
                </button>
                <button
                  type="button"
                  onClick={() => onSearchAndPlay('Hans Zimmer Time Live', 'song')}
                  className={MAC_GLASS_BTN_SECONDARY}
                >
                  Play Hans Zimmer Live
                </button>
              </div>
            </motion.div>
          )}
        </div>

        {/* Right: Up Next & Playback History Sidebar */}
        <div className={`xl:col-span-4 p-5 overflow-y-auto space-y-3 ${MAC_GLASS_SIDEBAR}`}>
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-slate-300">Playback History &amp; Queue</h4>
            <span className="font-mono tabular-nums text-xs text-slate-500">{queue.length}</span>
          </div>

          {queue.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">
              Requested songs and videos will appear here.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {queue.map((track, idx) => {
                const isActive = currentTrack?.videoId === track.videoId;
                return (
                  <li
                    key={track.id || `${track.videoId}-${idx}`}
                    className={`p-2 rounded-xl border transition-all flex items-center gap-3 ${
                      isActive
                        ? 'bg-rose-500/12 border-rose-400/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
                        : 'border-transparent hover:bg-white/[0.04]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectTrack(track)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left group cursor-pointer"
                    >
                      <img
                        src={
                          track.thumbnailUrl ||
                          `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`
                        }
                        alt={track.title}
                        referrerPolicy="no-referrer"
                        className="w-16 h-10 object-cover rounded-lg border border-white/12 shrink-0 bg-slate-900 shadow-sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-xs font-medium truncate ${
                            isActive ? 'text-rose-200' : 'text-slate-200 group-hover:text-white'
                          }`}
                        >
                          {track.title}
                        </p>
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">
                          {track.channel} · {track.mediaType}
                        </p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveTrack(track)}
                      aria-label={`Remove ${track.title}`}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-white/[0.08] transition-colors shrink-0 cursor-pointer"
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
  );
};
