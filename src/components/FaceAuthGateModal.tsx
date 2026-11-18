import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Camera, KeyRound, Lock, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  cosineSimilarity,
  DEFAULT_FACE_THRESHOLD,
  extractFaceDescriptorFromVideo,
  sha256Hex,
  stopMediaStream,
} from '../lib/faceAuth';
import type { FaceAuthProfile } from '../types/assistant';

interface FaceAuthGateModalProps {
  open: boolean;
  assistantName: string;
  userPreferredName?: string;
  faceAuthProfile: FaceAuthProfile;
  onUnlock: () => void;
}

export const FaceAuthGateModal: React.FC<FaceAuthGateModalProps> = ({
  open,
  assistantName,
  userPreferredName,
  faceAuthProfile,
  onUnlock,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [similarityPct, setSimilarityPct] = useState<number | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  const threshold = faceAuthProfile.threshold || DEFAULT_FACE_THRESHOLD;

  const stopCamera = () => {
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setScanning(false);
  };

  useEffect(() => {
    if (!open) {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [open]);

  const startAndScan = async () => {
    setCameraError(null);
    setSimilarityPct(null);
    setScanning(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);

      const scratch = document.createElement('canvas');
      let bestScore = 0;

      for (let i = 0; i < 20; i++) {
        if (!videoRef.current || !streamRef.current) break;
        const res = extractFaceDescriptorFromVideo(videoRef.current, scratch);
        if (res.ok && res.descriptor) {
          const score = cosineSimilarity(faceAuthProfile.descriptor, res.descriptor);
          if (score > bestScore) bestScore = score;
          setSimilarityPct(Math.max(0, Math.min(100, Math.round(score * 100))));
          if (score >= threshold) {
            stopCamera();
            onUnlock();
            return;
          }
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      setScanning(false);
      setCameraError(
        `Face did not reach verification threshold (${Math.round(bestScore * 100)}% vs ${Math.round(threshold * 100)}%). Retry in steady lighting or use your backup PIN.`
      );
    } catch (err) {
      setScanning(false);
      setCameraActive(false);
      setCameraError(
        err instanceof Error
          ? err.message
          : 'Camera unavailable. Use your backup PIN to unlock.'
      );
    }
  };

  const handlePinUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(null);
    if (!faceAuthProfile.passcodeHash) {
      setPinError('No backup PIN was set during enrollment.');
      return;
    }
    const candidateHash = await sha256Hex(pinInput);
    if (candidateHash === faceAuthProfile.passcodeHash) {
      stopCamera();
      setPinInput('');
      onUnlock();
    } else {
      setPinError('Incorrect backup PIN.');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#04060B]/95 backdrop-blur-lg p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md rounded-2xl bg-[#0D111A] border border-slate-800 shadow-2xl overflow-hidden p-6 space-y-5"
      >
        <div className="text-center space-y-1">
          <div className="w-10 h-10 rounded-full bg-sky-500/15 border border-sky-500/30 flex items-center justify-center mx-auto mb-2">
            <Lock className="w-5 h-5 text-sky-400" />
          </div>
          <h2 className="text-base font-semibold text-slate-100">
            {assistantName} Security Lock
          </h2>
          <p className="text-xs text-slate-400">
            {userPreferredName
              ? `Verify it's ${userPreferredName} to unlock laptop controls and memory.`
              : 'Verify your face to unlock laptop controls and memory.'}
          </p>
        </div>

        {/* Camera Viewport */}
        <div className="relative aspect-[4/3] rounded-xl bg-[#070A10] border border-slate-800 overflow-hidden flex items-center justify-center">
          <video
            ref={videoRef}
            playsInline
            muted
            className={`w-full h-full object-cover scale-x-[-1] ${cameraActive ? 'block' : 'hidden'}`}
          />
          {cameraActive && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`w-36 h-48 rounded-[50%] border-2 ${
                  scanning ? 'border-sky-400' : 'border-amber-400/80'
                }`}
              />
            </div>
          )}
          {!cameraActive && (
            <div className="text-center p-6 space-y-2">
              <ShieldCheck className="w-8 h-8 text-slate-500 mx-auto" />
              <p className="text-xs text-slate-400">Ready for facial verification</p>
            </div>
          )}
          {similarityPct !== null && (
            <div className="absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-md bg-black/75 border border-slate-700 text-[11px] font-mono text-sky-300">
              Match: {similarityPct}%
            </div>
          )}
        </div>

        <button
          type="button"
          disabled={scanning}
          onClick={() => void startAndScan()}
          className="w-full py-2.5 rounded-xl bg-sky-500 text-slate-950 text-xs font-semibold hover:bg-sky-400 disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          <Camera className="w-4 h-4" />
          <span>{scanning ? 'Scanning Face...' : 'Verify Face to Unlock'}</span>
        </button>

        {cameraError && (
          <div className="p-3 rounded-lg bg-amber-950/50 border border-amber-500/30 text-xs text-amber-200 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>{cameraError}</span>
          </div>
        )}

        {/* Backup PIN Unlock */}
        {faceAuthProfile.passcodeHash ? (
          <form onSubmit={(e) => void handlePinUnlock(e)} className="pt-2 border-t border-slate-800 space-y-2">
            <label className="block text-[11px] text-slate-400 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" />
              <span>Or unlock with Backup PIN</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="Enter backup PIN"
                className="flex-1 px-3 py-2 rounded-lg bg-[#070A10] border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
              />
              <button
                type="submit"
                className="px-3.5 py-2 rounded-lg border border-slate-700 bg-[#070A10] text-xs font-medium text-slate-200 hover:bg-slate-800"
              >
                Unlock
              </button>
            </div>
            {pinError && <p className="text-[11px] text-red-400">{pinError}</p>}
          </form>
        ) : (
          cameraError && (
            <button
              type="button"
              onClick={() => {
                stopCamera();
                onUnlock();
              }}
              className="w-full py-2 rounded-lg border border-slate-700 bg-[#070A10] text-xs text-slate-300 hover:bg-slate-800"
            >
              Continue (No Camera / No Backup PIN Set)
            </button>
          )
        )}
      </motion.div>
    </div>
  );
};
