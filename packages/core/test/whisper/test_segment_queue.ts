import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createSegmentQueue, type VoiceCaptureCallbacks, type VoiceCaptureTransport } from "../../src/whisper/client.ts";

// The queue's send path runs blobs through `blobToDataUrl`, which uses the web
// `FileReader` — absent in Node. Install a deterministic stub that resolves on a
// microtask so `sendSegment` reaches the transport with a data URL.
class FakeFileReader {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result: string | null = null;
  error: unknown = null;
  readAsDataURL(__blob: Blob): void {
    queueMicrotask(() => {
      this.result = "data:audio/webm;base64,AAAA";
      this.onload?.();
    });
  }
}
Object.defineProperty(globalThis, "FileReader", { value: FakeFileReader, configurable: true, writable: true });

function transportWith(transcribe: () => Promise<{ text: string }>): VoiceCaptureTransport {
  return { transcribe, getStatus: () => Promise.resolve({ ready: true, downloading: false }) };
}

// Tracks the +1/-1 pending deltas and lets a test await the moment the counter
// returns to zero (every enqueued send has settled, success or failure).
function pendingTracker(): { setPending: (delta: number) => void; deltas: number[]; whenIdle: () => Promise<void> } {
  const deltas: number[] = [];
  let sum = 0;
  let resolveIdle: (() => void) | null = null;
  const setPending = (delta: number): void => {
    deltas.push(delta);
    sum += delta;
    if (sum === 0 && resolveIdle) {
      resolveIdle();
      resolveIdle = null;
    }
  };
  const whenIdle = (): Promise<void> =>
    new Promise((resolve) => {
      if (sum === 0) resolve();
      else resolveIdle = resolve;
    });
  return { setPending, deltas, whenIdle };
}

function callbackCollector(): { transcripts: string[]; errors: string[]; emptyCount: () => number; callbacks: VoiceCaptureCallbacks } {
  const transcripts: string[] = [];
  const errors: string[] = [];
  let emptyCount = 0;
  const callbacks: VoiceCaptureCallbacks = {
    onTranscript: (text) => transcripts.push(text),
    onEmpty: () => {
      emptyCount += 1;
    },
    onError: (message) => errors.push(message),
  };
  return { transcripts, errors, emptyCount: () => emptyCount, callbacks };
}

function blob(): Blob {
  return new Blob(["audio"]);
}

describe("createSegmentQueue", () => {
  it("delivers transcripts in capture order even when the first send is slower", async () => {
    const pending = pendingTracker();
    const sink = callbackCollector();
    let call = 0;
    const transcribe = (): Promise<{ text: string }> => {
      call += 1;
      const nth = call;
      const text = nth === 1 ? "first" : "second";
      const delayMs = nth === 1 ? 20 : 1;
      return new Promise((resolve) => setTimeout(() => resolve({ text }), delayMs));
    };
    const queue = createSegmentQueue({
      transport: transportWith(transcribe),
      language: () => "en",
      callbacks: sink.callbacks,
      setPending: pending.setPending,
      getGeneration: () => 0,
    });
    queue.enqueue(blob(), 0);
    queue.enqueue(blob(), 0);
    await pending.whenIdle();
    assert.deepEqual(sink.transcripts, ["first", "second"]);
    assert.deepEqual(pending.deltas, [1, 1, -1, -1]);
  });

  it("routes an empty (whitespace-only) transcript to onEmpty", async () => {
    const pending = pendingTracker();
    const sink = callbackCollector();
    const queue = createSegmentQueue({
      transport: transportWith(() => Promise.resolve({ text: "   " })),
      language: () => "en",
      callbacks: sink.callbacks,
      setPending: pending.setPending,
      getGeneration: () => 0,
    });
    queue.enqueue(blob(), 0);
    await pending.whenIdle();
    assert.equal(sink.emptyCount(), 1);
    assert.deepEqual(sink.transcripts, []);
    assert.deepEqual(pending.deltas, [1, -1]);
  });

  it("reports onError when the transport throws and the generation still matches", async () => {
    const pending = pendingTracker();
    const sink = callbackCollector();
    const queue = createSegmentQueue({
      transport: transportWith(() => Promise.reject(new Error("boom"))),
      language: () => "en",
      callbacks: sink.callbacks,
      setPending: pending.setPending,
      getGeneration: () => 0,
    });
    queue.enqueue(blob(), 0);
    await pending.whenIdle();
    assert.deepEqual(sink.errors, ["boom"]);
    assert.deepEqual(pending.deltas, [1, -1]);
  });

  it("drops a segment stale at the entry guard without calling the transport", async () => {
    const pending = pendingTracker();
    const sink = callbackCollector();
    let transcribeCalls = 0;
    const queue = createSegmentQueue({
      transport: transportWith(() => {
        transcribeCalls += 1;
        return Promise.resolve({ text: "late" });
      }),
      language: () => "en",
      callbacks: sink.callbacks,
      setPending: pending.setPending,
      getGeneration: () => 1,
    });
    queue.enqueue(blob(), 0);
    await pending.whenIdle();
    assert.equal(transcribeCalls, 0);
    assert.deepEqual(sink.transcripts, []);
    assert.equal(sink.emptyCount(), 0);
    assert.deepEqual(sink.errors, []);
    assert.deepEqual(pending.deltas, [1, -1]);
  });

  it("drops a transcript when the generation advances during transcription", async () => {
    const pending = pendingTracker();
    const sink = callbackCollector();
    let current = 0;
    let transcribeCalls = 0;
    const queue = createSegmentQueue({
      transport: transportWith(() => {
        transcribeCalls += 1;
        current = 1;
        return Promise.resolve({ text: "late" });
      }),
      language: () => "en",
      callbacks: sink.callbacks,
      setPending: pending.setPending,
      getGeneration: () => current,
    });
    queue.enqueue(blob(), 0);
    await pending.whenIdle();
    assert.equal(transcribeCalls, 1);
    assert.deepEqual(sink.transcripts, []);
    assert.equal(sink.emptyCount(), 0);
    assert.deepEqual(pending.deltas, [1, -1]);
  });

  it("suppresses onError when the generation advances before the failure settles", async () => {
    const pending = pendingTracker();
    const sink = callbackCollector();
    let current = 0;
    let transcribeCalls = 0;
    const queue = createSegmentQueue({
      transport: transportWith(() => {
        transcribeCalls += 1;
        current = 1;
        return Promise.reject(new Error("boom"));
      }),
      language: () => "en",
      callbacks: sink.callbacks,
      setPending: pending.setPending,
      getGeneration: () => current,
    });
    queue.enqueue(blob(), 0);
    await pending.whenIdle();
    assert.equal(transcribeCalls, 1);
    assert.deepEqual(sink.errors, []);
    assert.deepEqual(pending.deltas, [1, -1]);
  });
});
