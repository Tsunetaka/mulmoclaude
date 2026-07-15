import type { VoiceInputStatusResponse } from "./useVoiceInput";

/** Derive the readiness flags the capture controller consumes from a
 *  raw `GET /api/transcribe/model` status. Both flags require the host
 *  to be capable and the feature enabled before the model state matters. */
export function deriveVoiceModelReadiness(status: VoiceInputStatusResponse): { ready: boolean; downloading: boolean } {
  const { capable, enabled, model } = status;
  return {
    ready: capable && enabled && model.state === "ready",
    downloading: capable && enabled && model.state === "downloading",
  };
}
