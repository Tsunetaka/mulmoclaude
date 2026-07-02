import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createKeyedSerializer } from "../src/keyed-serializer.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const settle = () => new Promise<void>((r) => setTimeout(r, 5));

describe("createKeyedSerializer", () => {
  it("runs same-key tasks one at a time, in call order", async () => {
    const s = createKeyedSerializer();
    const log: string[] = [];
    const gate = defer<void>();

    const first = s.run("k", async () => {
      log.push("a-start");
      await gate.promise;
      log.push("a-end");
      return "a";
    });
    const second = s.run("k", async () => {
      log.push("b-start");
      return "b";
    });

    await settle();
    // Second task must not have started while the first is still in flight.
    assert.deepEqual(log, ["a-start"]);

    gate.resolve();
    assert.deepEqual(await Promise.all([first, second]), ["a", "b"]);
    assert.deepEqual(log, ["a-start", "a-end", "b-start"]);
  });

  it("runs different-key tasks concurrently", async () => {
    const s = createKeyedSerializer();
    const log: string[] = [];
    const gate = defer<void>();

    const k1 = s.run("k1", async () => {
      log.push("1-start");
      await gate.promise;
      return 1;
    });
    const k2 = s.run("k2", async () => {
      log.push("2-start");
      return 2;
    });

    await settle();
    // k2 is not blocked by k1's open gate — different key.
    assert.deepEqual([...log].sort(), ["1-start", "2-start"]);

    gate.resolve();
    assert.deepEqual(await Promise.all([k1, k2]), [1, 2]);
  });

  it("preserves FIFO order regardless of per-task duration", async () => {
    const s = createKeyedSerializer();
    const order: number[] = [];
    const tasks = [0, 1, 2, 3, 4].map((i) =>
      s.run("k", async () => {
        // Earlier-queued tasks sleep longer; only serialization keeps order.
        await new Promise((r) => setTimeout(r, (5 - i) * 2));
        order.push(i);
      }),
    );
    await Promise.all(tasks);
    assert.deepEqual(order, [0, 1, 2, 3, 4]);
  });

  it("does not let a rejected task block the next same-key task", async () => {
    const s = createKeyedSerializer();
    const first = s.run("k", async () => {
      throw new Error("boom");
    });
    const second = s.run("k", async () => "recovered");

    await assert.rejects(() => first, /boom/);
    assert.equal(await second, "recovered");
  });

  it("propagates the task's resolved value to the caller", async () => {
    const s = createKeyedSerializer();
    assert.equal(await s.run("k", async () => 42), 42);
  });
});
