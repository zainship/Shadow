import { useCallback, useEffect, useState } from 'react';
import { getApiOrigin, parseJsonSafely } from '../lib/apiBase';

export interface NetworkTelemetry {
  isOnline: boolean;
  latencyMs: number | null;
  quality: 'good' | 'fair' | 'poor' | 'offline';
}

export function useNetworkTelemetry(isActive: boolean): NetworkTelemetry {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const measureLatency = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOnline(false);
      setLatencyMs(null);
      return;
    }

    const started = performance.now();
    try {
      const res = await fetch(`${getApiOrigin()}/api/health?t=${Date.now()}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await parseJsonSafely<{ ok?: boolean; service?: string }>(res);
        if (data?.ok && data?.service === 'shadow-desktop-server') {
          const rtt = Math.max(1, Math.round(performance.now() - started));
          setIsOnline(true);
          setLatencyMs(rtt);
          return;
        }
      }
    } catch {
      // Fall back to Navigator Network Information RTT if available
    }

    const navConn = (
      navigator as unknown as { connection?: { rtt?: number } }
    ).connection;
    if (typeof navConn?.rtt === 'number' && navConn.rtt > 0) {
      setLatencyMs(Math.round(navConn.rtt));
    } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOnline(false);
      setLatencyMs(null);
    } else {
      setIsOnline(true);
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void measureLatency();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setLatencyMs(null);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    void measureLatency();
    const intervalMs = isActive ? 8000 : 25000;
    const timer = window.setInterval(() => {
      void measureLatency();
    }, intervalMs);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.clearInterval(timer);
    };
  }, [isActive, measureLatency]);

  const quality: NetworkTelemetry['quality'] = !isOnline
    ? 'offline'
    : latencyMs === null
      ? 'good'
      : latencyMs <= 160
        ? 'good'
        : latencyMs <= 420
          ? 'fair'
          : 'poor';

  return {
    isOnline,
    latencyMs,
    quality,
  };
}
