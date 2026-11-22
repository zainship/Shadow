import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandAttachment, VisionSourceMode } from '../types/assistant';

interface UseVisionStreamOptions {
  liveStreamEnabled: boolean;
  onVideoFrame?: (base64Jpeg: string) => void;
}

export interface VisionStreamController {
  visionMode: VisionSourceMode;
  stream: MediaStream | null;
  visionError: string | null;
  startVision: (mode: Exclude<VisionSourceMode, 'off'>) => Promise<boolean>;
  stopVision: () => void;
  captureSnapshot: () => CommandAttachment | null;
  clearVisionError: () => void;
}

export function useVisionStream({
  liveStreamEnabled,
  onVideoFrame,
}: UseVisionStreamOptions): VisionStreamController {
  const [visionMode, setVisionMode] = useState<VisionSourceMode>('off');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [visionError, setVisionError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const onFrameRef = useRef(onVideoFrame);
  onFrameRef.current = onVideoFrame;

  const stopVision = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoElRef.current) {
      videoElRef.current.srcObject = null;
    }
    setStream(null);
    setVisionMode('off');
  }, []);

  const captureFrameBase64 = useCallback((): string | null => {
    const video = videoElRef.current;
    if (!video || !streamRef.current || video.readyState < 2 || video.videoWidth <= 0) {
      return null;
    }
    if (!canvasElRef.current) {
      canvasElRef.current = document.createElement('canvas');
    }
    const canvas = canvasElRef.current;
    const maxW = 640;
    const scale = video.videoWidth > maxW ? maxW / video.videoWidth : 1;
    const targetW = Math.max(160, Math.round(video.videoWidth * scale));
    const targetH = Math.max(90, Math.round(video.videoHeight * scale));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, targetW, targetH);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
    const commaIdx = dataUrl.indexOf(',');
    return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : null;
  }, []);

  const captureSnapshot = useCallback((): CommandAttachment | null => {
    if (visionMode === 'off') return null;
    const base64 = captureFrameBase64();
    if (!base64) return null;
    return {
      name: visionMode === 'screen' ? 'screen-share.jpg' : 'camera-frame.jpg',
      mimeType: 'image/jpeg',
      dataBase64: base64,
    };
  }, [visionMode, captureFrameBase64]);

  const startVision = useCallback(
    async (mode: Exclude<VisionSourceMode, 'off'>): Promise<boolean> => {
      setVisionError(null);
      if (visionMode === mode && streamRef.current) {
        return true;
      }
      stopVision();

      try {
        if (!navigator.mediaDevices) {
          throw new Error('Media devices API unavailable in this browser context.');
        }
        const media =
          mode === 'camera'
            ? await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 } },
                audio: false,
              })
            : await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 2, max: 5 } },
                audio: false,
              });

        const videoTrack = media.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.onended = () => {
            stopVision();
          };
        }

        if (!videoElRef.current) {
          const vid = document.createElement('video');
          vid.muted = true;
          vid.playsInline = true;
          videoElRef.current = vid;
        }
        videoElRef.current.srcObject = media;
        await videoElRef.current.play().catch(() => null);

        streamRef.current = media;
        setStream(media);
        setVisionMode(mode);
        return true;
      } catch (err) {
        const isDenied =
          err instanceof DOMException &&
          (err.name === 'NotAllowedError' || err.name === 'AbortError');
        setVisionError(
          isDenied
            ? `${mode === 'screen' ? 'Screen share' : 'Camera'} permission cancelled or denied.`
            : err instanceof Error
              ? err.message
              : `Unable to start ${mode}.`
        );
        stopVision();
        return false;
      }
    },
    [visionMode, stopVision]
  );

  // Throttled <= 1 FPS live video stream when Gemini Live voice session is connected
  useEffect(() => {
    if (visionMode === 'off' || !liveStreamEnabled || !stream) {
      return;
    }
    const interval = window.setInterval(() => {
      const frame = captureFrameBase64();
      if (frame && onFrameRef.current) {
        onFrameRef.current(frame);
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [visionMode, liveStreamEnabled, stream, captureFrameBase64]);

  useEffect(() => {
    return () => {
      stopVision();
    };
  }, [stopVision]);

  return {
    visionMode,
    stream,
    visionError,
    startVision,
    stopVision,
    captureSnapshot,
    clearVisionError: () => setVisionError(null),
  };
}
