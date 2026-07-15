import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveVoiceModelReadiness } from "../../src/composables/useVoiceInput.helpers.ts";
import type { VoiceInputStatusResponse, VoiceModelStatus } from "../../src/composables/useVoiceInput.ts";

// Pure derivation of the capture controller's readiness flags from a
// raw `GET /api/transcribe/model` status. Every flag is gated on both
// `capable` and `enabled`, then the model's own state.

function status(capable: boolean, enabled: boolean, state: VoiceModelStatus["state"]): VoiceInputStatusResponse {
  return { capable, enabled, model: { name: "whisper", state } };
}

describe("deriveVoiceModelReadiness", () => {
  it("is ready only when capable, enabled, and model state is 'ready'", () => {
    assert.deepEqual(deriveVoiceModelReadiness(status(true, true, "ready")), { ready: true, downloading: false });
  });

  it("is downloading only when capable, enabled, and model state is 'downloading'", () => {
    assert.deepEqual(deriveVoiceModelReadiness(status(true, true, "downloading")), { ready: false, downloading: true });
  });

  it("is neither ready nor downloading for idle and error states", () => {
    for (const state of ["idle", "error"] as const) {
      assert.deepEqual(deriveVoiceModelReadiness(status(true, true, state)), { ready: false, downloading: false }, `state=${state}`);
    }
  });

  it("forces both flags false when not capable, regardless of state", () => {
    for (const state of ["ready", "downloading", "idle", "error"] as const) {
      assert.deepEqual(deriveVoiceModelReadiness(status(false, true, state)), { ready: false, downloading: false }, `state=${state}`);
    }
  });

  it("forces both flags false when not enabled, regardless of state", () => {
    for (const state of ["ready", "downloading", "idle", "error"] as const) {
      assert.deepEqual(deriveVoiceModelReadiness(status(true, false, state)), { ready: false, downloading: false }, `state=${state}`);
    }
  });

  it("forces both flags false when neither capable nor enabled", () => {
    assert.deepEqual(deriveVoiceModelReadiness(status(false, false, "ready")), { ready: false, downloading: false });
  });
});
