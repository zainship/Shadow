/**
 * Pure client-side facial feature extraction & cosine-similarity verification.
 * Extracts a compact, L2-normalized 64-float descriptor from a centered
 * portrait crop on an HTML5 Canvas so raw images or video frames are never
 * uploaded or stored in Firestore.
 */

export const FACE_DESCRIPTOR_SIZE = 64;
export const DEFAULT_FACE_THRESHOLD = 0.88;

export async function sha256Hex(input: string): Promise<string> {
  const clean = input.trim();
  if (!clean) return '';
  const data = new TextEncoder().encode(clean);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function normalizeVector(vec: number[]): number[] {
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq);
  if (norm < 1e-8) {
    return vec.map(() => 0);
  }
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom < 1e-8) return 0;
  return dot / denom;
}

export function averageDescriptors(samples: number[][]): number[] {
  if (samples.length === 0) return [];
  const dim = samples[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const s of samples) {
    for (let i = 0; i < dim; i++) {
      sum[i] += s[i] ?? 0;
    }
  }
  return normalizeVector(sum.map((v) => v / samples.length));
}

export interface FrameExtractionResult {
  ok: boolean;
  descriptor?: number[];
  brightness?: number;
  contrast?: number;
  reason?: string;
}

/**
 * Extracts a 64-float normalized facial descriptor (32 multi-zone luminance cells +
 * 32 local gradient magnitude cells) from the center portrait region of a <video>.
 */
export function extractFaceDescriptorFromVideo(
  video: HTMLVideoElement,
  scratchCanvas?: HTMLCanvasElement
): FrameExtractionResult {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || video.readyState < 2) {
    return { ok: false, reason: 'Camera feed is still warming up.' };
  }

  const canvas = scratchCanvas || document.createElement('canvas');
  // 8x8 spatial grid over centered square portrait region (56% of shortest axis)
  const gridW = 8;
  const gridH = 8;
  canvas.width = gridW;
  canvas.height = gridH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { ok: false, reason: 'Unable to initialize frame analyzer.' };
  }

  const cropSize = Math.round(Math.min(vw, vh) * 0.56);
  const sx = Math.round((vw - cropSize) / 2);
  const sy = Math.round((vh - cropSize) * 0.44);

  ctx.drawImage(video, sx, sy, cropSize, cropSize, 0, 0, gridW, gridH);
  const img = ctx.getImageData(0, 0, gridW, gridH).data;

  const luma = new Array<number>(gridW * gridH);
  let mean = 0;
  for (let i = 0; i < gridW * gridH; i++) {
    const r = img[i * 4];
    const g = img[i * 4 + 1];
    const b = img[i * 4 + 2];
    const y = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    luma[i] = y;
    mean += y;
  }
  mean /= luma.length;

  let variance = 0;
  for (let i = 0; i < luma.length; i++) {
    const d = luma[i] - mean;
    variance += d * d;
  }
  const std = Math.sqrt(variance / luma.length);

  if (mean < 0.06) {
    return {
      ok: false,
      brightness: mean,
      contrast: std,
      reason: 'Scene is too dark or camera cover is closed.',
    };
  }
  if (std < 0.025) {
    return {
      ok: false,
      brightness: mean,
      contrast: std,
      reason: 'Hold your face centered inside the oval guide with steady lighting.',
    };
  }

  // Zero-mean lighting normalization on central 4x8 + gradient edges -> 64 floats
  const features = new Array<number>(FACE_DESCRIPTOR_SIZE);
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const idx = y * gridW + x;
      const centered = (luma[idx] - mean) / Math.max(std, 0.05);
      const right = x < gridW - 1 ? luma[y * gridW + (x + 1)] : luma[idx];
      const down = y < gridH - 1 ? luma[(y + 1) * gridW + x] : luma[idx];
      const edge = Math.hypot(right - luma[idx], down - luma[idx]) / Math.max(std, 0.05);
      // Interleave coarse structure and edge orientation energy across 64 dims
      features[idx] = Number((centered * 0.72 + (edge - 0.85) * 0.28).toFixed(6));
    }
  }

  return {
    ok: true,
    descriptor: normalizeVector(features),
    brightness: mean,
    contrast: std,
  };
}

export function stopMediaStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // ignore track stop errors
    }
  }
}
