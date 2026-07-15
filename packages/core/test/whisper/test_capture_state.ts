import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createCaptureState, type VoiceCaptureState } from "../../src/whisper/client.ts";

function collector(): { states: VoiceCaptureState[]; onState: (state: VoiceCaptureState) => void } {
  const states: VoiceCaptureState[] = [];
  return { states, onState: (state) => states.push(state) };
}

describe("createCaptureState", () => {
  it("does not emit on creation", () => {
    const { states, onState } = collector();
    createCaptureState(onState);
    assert.equal(states.length, 0);
  });

  it("emits with all three flags when available flips", () => {
    const { states, onState } = collector();
    const state = createCaptureState(onState);
    state.setAvailable(true);
    assert.deepEqual(states, [{ available: true, listening: false, transcribing: false }]);
  });

  it("does not emit when a setter writes the current value", () => {
    const { states, onState } = collector();
    const state = createCaptureState(onState);
    state.setAvailable(false);
    state.setListening(false);
    assert.equal(states.length, 0);
    state.setAvailable(true);
    state.setAvailable(true);
    assert.equal(states.length, 1);
  });

  it("tracks listening and exposes it via isListening", () => {
    const { states, onState } = collector();
    const state = createCaptureState(onState);
    assert.equal(state.isListening(), false);
    state.setListening(true);
    assert.equal(state.isListening(), true);
    assert.deepEqual(states.at(-1), { available: false, listening: true, transcribing: false });
    state.setListening(false);
    assert.equal(state.isListening(), false);
  });

  it("setPending(+1) turns transcribing on and setPending(-1) turns it back off", () => {
    const { states, onState } = collector();
    const state = createCaptureState(onState);
    state.setPending(1);
    assert.deepEqual(states.at(-1), { available: false, listening: false, transcribing: true });
    state.setPending(-1);
    assert.deepEqual(states.at(-1), { available: false, listening: false, transcribing: false });
    assert.equal(states.length, 2);
  });

  it("counts nested pending: only the 0<->positive edges emit", () => {
    const { states, onState } = collector();
    const state = createCaptureState(onState);
    state.setPending(1); // 0 -> 1, edge: emit (transcribing true)
    state.setPending(1); // 1 -> 2, still positive: no emit
    state.setPending(-1); // 2 -> 1, still positive: no emit
    assert.equal(states.length, 1);
    state.setPending(-1); // 1 -> 0, edge: emit (transcribing false)
    assert.equal(states.length, 2);
    assert.deepEqual(
      states.map((snapshot) => snapshot.transcribing),
      [true, false],
    );
  });

  it("does not throw when no onState is provided", () => {
    const state = createCaptureState();
    assert.doesNotThrow(() => {
      state.setAvailable(true);
      state.setListening(true);
      state.setPending(1);
      state.setPending(-1);
    });
    assert.equal(state.isListening(), true);
  });
});
