// Pure, framework-neutral helpers for the browser voice-capture controller.
// Kept separate from `client.ts` so the audio math and VAD state machine can be
// unit-tested without a DOM / MediaRecorder / Web Audio environment.

export function computeRms(buffer: Float32Array): number {
  let sum = 0;
  for (const sample of buffer) sum += sample * sample;
  return Math.sqrt(sum / buffer.length);
}

/** The recorder mime can carry a codec suffix (`audio/webm;codecs=opus`); the
 *  Blob container type is just the part before the `;`. */
export function containerTypeFromMime(mimeType: string): string {
  return mimeType.split(";")[0] || "audio/webm";
}

export interface VadState {
  readonly hasSpeech: boolean;
  readonly silenceStart: number | null;
}

export interface VadConfig {
  readonly speechRms: number;
  readonly silenceMs: number;
  readonly maxSegmentMs: number;
}

export interface VadDecision {
  readonly hasSpeech: boolean;
  readonly silenceStart: number | null;
  readonly cut: boolean;
}

function isSpeech(rms: number, config: VadConfig): boolean {
  return rms > config.speechRms;
}

function nextSilenceStart(state: VadState, rms: number, nowMs: number, config: VadConfig): number | null {
  if (isSpeech(rms, config)) return null;
  if (state.hasSpeech && state.silenceStart === null) return nowMs;
  return state.silenceStart;
}

function silenceExceeded(state: VadState, rms: number, nowMs: number, config: VadConfig): boolean {
  if (isSpeech(rms, config) || !state.hasSpeech || state.silenceStart === null) return false;
  return nowMs - state.silenceStart > config.silenceMs;
}

/** Advance the pause-detector one tick: fold the current RMS/time into the
 *  segment state and decide whether the segment should be force-cut (either a
 *  long-enough silence after speech, or the max-segment length reached). */
export function evaluateVad(state: VadState, segmentStartMs: number, rms: number, nowMs: number, config: VadConfig): VadDecision {
  const hasSpeech = isSpeech(rms, config) || state.hasSpeech;
  const silenceStart = nextSilenceStart(state, rms, nowMs, config);
  const maxCut = hasSpeech && nowMs - segmentStartMs > config.maxSegmentMs;
  return { hasSpeech, silenceStart, cut: silenceExceeded(state, rms, nowMs, config) || maxCut };
}
