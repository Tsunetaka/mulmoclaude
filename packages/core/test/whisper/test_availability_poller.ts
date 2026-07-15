import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createAvailabilityPoller, type VoiceCaptureTransport } from "../../src/whisper/client.ts";

interface Status {
  ready: boolean;
  downloading: boolean;
}

interface FakeInterval {
  readonly handle: number;
  readonly callback: () => void;
  readonly intervalMs: number;
  cleared: boolean;
}

interface FakeTimers {
  activeCount: () => number;
  createdCount: () => number;
  clearCalls: () => number;
}

// The poller reaches for `window.setInterval` / `window.clearInterval`. Install a
// deterministic stub on globalThis so we can assert on the timer lifecycle
// without real time. `configurable` lets each test reinstall a fresh one.
function installFakeTimers(): FakeTimers {
  const intervals: FakeInterval[] = [];
  let nextHandle = 1;
  let clearCalls = 0;
  const setIntervalFn = (callback: () => void, intervalMs: number): number => {
    const handle = nextHandle;
    nextHandle += 1;
    intervals.push({ handle, callback, intervalMs, cleared: false });
    return handle;
  };
  const clearIntervalFn = (handle: number): void => {
    clearCalls += 1;
    const found = intervals.find((interval) => interval.handle === handle);
    if (found) found.cleared = true;
  };
  Object.defineProperty(globalThis, "window", {
    value: { setInterval: setIntervalFn, clearInterval: clearIntervalFn },
    configurable: true,
    writable: true,
  });
  return {
    activeCount: () => intervals.filter((interval) => !interval.cleared).length,
    createdCount: () => intervals.length,
    clearCalls: () => clearCalls,
  };
}

function transportWith(getStatus: () => Promise<Status>): VoiceCaptureTransport {
  return { getStatus, transcribe: () => Promise.resolve({ text: "" }) };
}

function availableSpy(): { calls: boolean[]; fn: (value: boolean) => void } {
  const calls: boolean[] = [];
  return { calls, fn: (value) => calls.push(value) };
}

describe("createAvailabilityPoller", () => {
  it("fails closed and does not poll when getStatus throws", async () => {
    const timers = installFakeTimers();
    const available = availableSpy();
    const poller = createAvailabilityPoller(
      transportWith(() => Promise.reject(new Error("down"))),
      available.fn,
    );
    await poller.refresh();
    assert.deepEqual(available.calls, [false]);
    assert.equal(timers.createdCount(), 0);
    assert.equal(timers.activeCount(), 0);
  });

  it("reports ready and starts no timer when not downloading", async () => {
    const timers = installFakeTimers();
    const available = availableSpy();
    const poller = createAvailabilityPoller(
      transportWith(() => Promise.resolve({ ready: true, downloading: false })),
      available.fn,
    );
    await poller.refresh();
    assert.deepEqual(available.calls, [true]);
    assert.equal(timers.createdCount(), 0);
  });

  it("starts exactly one interval while downloading and never a second", async () => {
    const timers = installFakeTimers();
    const available = availableSpy();
    const poller = createAvailabilityPoller(
      transportWith(() => Promise.resolve({ ready: false, downloading: true })),
      available.fn,
    );
    await poller.refresh();
    assert.equal(timers.createdCount(), 1);
    assert.equal(timers.activeCount(), 1);
    await poller.refresh();
    assert.equal(timers.createdCount(), 1);
    assert.deepEqual(available.calls, [false, false]);
  });

  it("clears the interval once downloading finishes", async () => {
    const timers = installFakeTimers();
    const available = availableSpy();
    let downloading = true;
    const poller = createAvailabilityPoller(
      transportWith(() => Promise.resolve({ ready: !downloading, downloading })),
      available.fn,
    );
    await poller.refresh();
    assert.equal(timers.activeCount(), 1);
    downloading = false;
    await poller.refresh();
    assert.equal(timers.activeCount(), 0);
    assert.deepEqual(available.calls, [false, true]);
  });

  it("tears the interval down and fails closed when getStatus throws mid-download", async () => {
    const timers = installFakeTimers();
    const available = availableSpy();
    let online = true;
    const poller = createAvailabilityPoller(
      transportWith(() => (online ? Promise.resolve({ ready: false, downloading: true }) : Promise.reject(new Error("down")))),
      available.fn,
    );
    await poller.refresh();
    assert.equal(timers.activeCount(), 1);
    online = false;
    await poller.refresh();
    assert.equal(timers.activeCount(), 0);
    assert.equal(available.calls.at(-1), false);
  });

  it("stop() clears an active interval and is idempotent", async () => {
    const timers = installFakeTimers();
    const available = availableSpy();
    const poller = createAvailabilityPoller(
      transportWith(() => Promise.resolve({ ready: false, downloading: true })),
      available.fn,
    );
    await poller.refresh();
    assert.equal(timers.activeCount(), 1);
    poller.stop();
    assert.equal(timers.activeCount(), 0);
    assert.equal(timers.clearCalls(), 1);
    poller.stop();
    assert.equal(timers.clearCalls(), 1);
  });
});
