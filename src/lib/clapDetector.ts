/**
 * Real-time acoustic double-clap detector & wake chime using Web Audio API.
 * Uses high-pass filtering (~950 Hz) + 20ms sub-frame transient energy analysis
 * to distinguish two crisp hand claps (130ms–780ms apart) from speech or room noise.
 */

export type ClapListenerStatus = 'idle' | 'listening' | 'needs-gesture' | 'denied' | 'error';

export class DoubleClapAnalyzer {
  private noiseFloor = 0.015;
  private hpPrevIn = 0;
  private hpPrevOut = 0;

  private lastClap1Time = 0;
  private clap1PeakRms = 0;
  private clap1EnergySum = 0;
  private clap1SamplesAfter = 0;
  private clap1SustainedHigh = false;
  private cooldownUntil = 0;

  // Tuned thresholds for crisp double-clap recognition
  private readonly minAbsRms = 0.045;
  private readonly minAbsPeak = 0.11;
  private readonly spikeRatio = 4.2;
  private readonly minGapMs = 130;
  private readonly maxGapMs = 780;
  private readonly cooldownMs = 1800;

  reset(): void {
    this.noiseFloor = 0.015;
    this.hpPrevIn = 0;
    this.hpPrevOut = 0;
    this.lastClap1Time = 0;
    this.clap1PeakRms = 0;
    this.clap1EnergySum = 0;
    this.clap1SamplesAfter = 0;
    this.clap1SustainedHigh = false;
  }

  /**
   * Processes a PCM Float32 buffer in ~20ms sub-frames and returns true
   * on the exact frame a valid double-clap completes.
   */
  processSamples(samples: Float32Array, sampleRate: number, nowMs = performance.now()): boolean {
    if (!samples.length || nowMs < this.cooldownUntil) {
      return false;
    }

    // 1st-order RC high-pass filter (~950 Hz) to suppress speech pitch & HVAC rumble
    const dt = 1 / Math.max(8000, sampleRate);
    const rc = 1 / (2 * Math.PI * 950);
    const alpha = rc / (rc + dt);

    const subFrameSize = Math.max(128, Math.round(sampleRate * 0.02));
    const totalSubFrames = Math.ceil(samples.length / subFrameSize);

    for (let f = 0; f < totalSubFrames; f++) {
      const start = f * subFrameSize;
      const end = Math.min(samples.length, start + subFrameSize);
      const count = end - start;
      if (count <= 0) continue;

      let sqSum = 0;
      let peak = 0;

      for (let i = start; i < end; i++) {
        const x = samples[i];
        const hp = alpha * (this.hpPrevOut + x - this.hpPrevIn);
        this.hpPrevIn = x;
        this.hpPrevOut = hp;

        const abs = Math.abs(hp);
        if (abs > peak) peak = abs;
        sqSum += hp * hp;
      }

      const rms = Math.sqrt(sqSum / count);
      const frameTime = nowMs + (f * count * 1000) / sampleRate;

      // Track whether Clap 1 actually decayed like a sharp impulse (not sustained yelling/music)
      if (this.lastClap1Time > 0 && frameTime - this.lastClap1Time <= 180) {
        this.clap1SamplesAfter++;
        this.clap1EnergySum += rms;
        if (
          this.clap1SamplesAfter >= 6 &&
          this.clap1EnergySum / this.clap1SamplesAfter > this.clap1PeakRms * 0.72
        ) {
          this.clap1SustainedHigh = true;
        }
      }

      // Expire old Clap 1 window
      if (this.lastClap1Time > 0 && frameTime - this.lastClap1Time > this.maxGapMs) {
        this.lastClap1Time = 0;
        this.clap1SustainedHigh = false;
      }

      const dynamicThreshold = Math.max(this.minAbsRms, this.noiseFloor * this.spikeRatio);
      const isSpike = rms > dynamicThreshold && peak > this.minAbsPeak;

      if (isSpike) {
        if (this.lastClap1Time === 0) {
          this.lastClap1Time = frameTime;
          this.clap1PeakRms = rms;
          this.clap1EnergySum = 0;
          this.clap1SamplesAfter = 0;
          this.clap1SustainedHigh = false;
        } else {
          const delta = frameTime - this.lastClap1Time;
          if (delta >= this.minGapMs && delta <= this.maxGapMs) {
            if (!this.clap1SustainedHigh) {
              // Valid double clap detected!
              this.reset();
              this.cooldownUntil = frameTime + this.cooldownMs;
              return true;
            }
            // Reject sustained noise and restart candidate cleanly
            this.lastClap1Time = frameTime;
            this.clap1PeakRms = rms;
            this.clap1EnergySum = 0;
            this.clap1SamplesAfter = 0;
            this.clap1SustainedHigh = false;
          }
        }
      } else {
        // Slowly adapt noise floor when not spiking
        this.noiseFloor = Math.max(0.004, this.noiseFloor * 0.94 + rms * 0.06);
      }
    }

    return false;
  }
}

export class StandbyClapListener {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private analyzer = new DoubleClapAnalyzer();
  private running = false;

  async start(onDoubleClap: () => void): Promise<ClapListenerStatus> {
    if (this.running) return 'listening';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      this.stream = stream;

      const ctx = new AudioContext();
      this.ctx = ctx;
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          this.stop();
          return 'needs-gesture';
        }
      }
      if ((ctx.state as string) !== 'running') {
        this.stop();
        return 'needs-gesture';
      }

      const source = ctx.createMediaStreamSource(stream);
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 850;

      const processor = ctx.createScriptProcessor(1024, 1, 1);
      this.source = source;
      this.filter = filter;
      this.processor = processor;
      this.analyzer.reset();

      processor.onaudioprocess = (e) => {
        if (!this.running) return;
        const samples = e.inputBuffer.getChannelData(0);
        if (this.analyzer.processSamples(samples, ctx.sampleRate)) {
          onDoubleClap();
        }
      };

      // Route through a silent gain node so audio never echoes to speakers
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;

      source.connect(filter);
      filter.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(ctx.destination);

      this.running = true;
      return 'listening';
    } catch (err) {
      this.stop();
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        return 'denied';
      }
      if (name === 'NotFoundError') {
        return 'error';
      }
      return 'needs-gesture';
    }
  }

  stop(): void {
    this.running = false;
    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch {
        // ignore
      }
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.filter) {
      try {
        this.filter.disconnect();
      } catch {
        // ignore
      }
      this.filter = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        // ignore
      }
      this.source = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      this.stream = null;
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close().catch(() => null);
      this.ctx = null;
    }
    this.analyzer.reset();
  }
}

export function playWakeChime(): void {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    const notes = [587.33, 880]; // D5 -> A5 crisp chime
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.085);

      gain.gain.setValueAtTime(0.0001, now + idx * 0.085);
      gain.gain.exponentialRampToValueAtTime(0.09, now + idx * 0.085 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.085 + 0.24);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.085);
      osc.stop(now + idx * 0.085 + 0.26);
    });

    window.setTimeout(() => {
      void ctx.close().catch(() => null);
    }, 600);
  } catch {
    // ignore audio chime errors
  }
}
