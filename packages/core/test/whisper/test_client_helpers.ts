import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeRms, containerTypeFromMime, evaluateVad, type VadConfig, type VadState } from "../../src/whisper/client-helpers.ts";

const CONFIG: VadConfig = { speechRms: 0.015, silenceMs: 800, maxSegmentMs: 20_000 };

describe("computeRms", () => {
  it("computes the root-mean-square of the samples", () => {
    assert.equal(computeRms(new Float32Array([0.5, -0.5])), 0.5);
  });

  it("is zero for pure silence", () => {
    assert.equal(computeRms(new Float32Array([0, 0, 0, 0])), 0);
  });

  it("is the magnitude for a single sample", () => {
    assert.equal(computeRms(new Float32Array([1])), 1);
  });

  it("is NaN for an empty buffer (0/0)", () => {
    assert.ok(Number.isNaN(computeRms(new Float32Array(0))));
  });
});

describe("containerTypeFromMime", () => {
  it("strips a codec suffix", () => {
    assert.equal(containerTypeFromMime("audio/webm;codecs=opus"), "audio/webm");
  });

  it("passes through a bare mime type", () => {
    assert.equal(containerTypeFromMime("audio/mp4"), "audio/mp4");
  });

  it("falls back to audio/webm for an empty string", () => {
    assert.equal(containerTypeFromMime(""), "audio/webm");
  });
});

describe("evaluateVad", () => {
  const speaking: VadState = { hasSpeech: true, silenceStart: null };

  it("marks speech and clears any pending silence when loud", () => {
    const state: VadState = { hasSpeech: false, silenceStart: 500 };
    assert.deepEqual(evaluateVad(state, 0, 0.05, 1_000, CONFIG), { hasSpeech: true, silenceStart: null, cut: false });
  });

  it("starts the silence clock on the first quiet tick after speech", () => {
    assert.deepEqual(evaluateVad(speaking, 0, 0.001, 1_000, CONFIG), { hasSpeech: true, silenceStart: 1_000, cut: false });
  });

  it("cuts once the silence exceeds the threshold", () => {
    const state: VadState = { hasSpeech: true, silenceStart: 100 };
    assert.deepEqual(evaluateVad(state, 0, 0.001, 1_000, CONFIG), { hasSpeech: true, silenceStart: 100, cut: true });
  });

  it("does not cut before the silence threshold is passed", () => {
    const state: VadState = { hasSpeech: true, silenceStart: 500 };
    assert.equal(evaluateVad(state, 0, 0.001, 1_000, CONFIG).cut, false);
  });

  it("treats rms exactly at the threshold as silence (strictly greater is speech)", () => {
    assert.deepEqual(evaluateVad(speaking, 0, CONFIG.speechRms, 1_000, CONFIG), { hasSpeech: true, silenceStart: 1_000, cut: false });
  });

  it("does not cut at exactly the silence boundary (strictly greater)", () => {
    const state: VadState = { hasSpeech: true, silenceStart: 200 };
    assert.equal(evaluateVad(state, 0, 0.001, 1_000, CONFIG).cut, false);
  });

  it("force-cuts a long unbroken utterance even while still speaking", () => {
    assert.deepEqual(evaluateVad(speaking, 0, 0.05, 25_000, CONFIG), { hasSpeech: true, silenceStart: null, cut: true });
  });

  it("never cuts before any speech is detected", () => {
    const state: VadState = { hasSpeech: false, silenceStart: null };
    assert.deepEqual(evaluateVad(state, 0, 0.001, 25_000, CONFIG), { hasSpeech: false, silenceStart: null, cut: false });
  });
});
