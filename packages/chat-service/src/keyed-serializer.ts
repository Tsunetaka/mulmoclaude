// @package-contract — see ./types.ts
//
// Per-key serialization primitive. `run(key, task)` guarantees that
// for any single key, tasks execute one-at-a-time in call order;
// tasks under different keys run concurrently. The bridge relay uses
// it to serialize all turns for one external chat so two concurrent
// first messages can't each create a separate session (#1878).
//
// In-memory and DI-free, matching push-queue.ts: a single server
// process owns every relay turn. Each per-key chain entry is dropped
// once its tail settles, so the map doesn't grow without bound.

export interface KeyedSerializer {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
}

export function createKeyedSerializer(): KeyedSerializer {
  const tails = new Map<string, Promise<unknown>>();

  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      // `prev` is a swallowed tail that never rejects, so the next
      // task always starts regardless of how the previous one settled.
      const prev = tails.get(key) ?? Promise.resolve();
      const result = prev.then(() => task());
      // Swallow the outcome (so the chain never breaks), then drop the
      // map entry — but only when no later task has chained onto this
      // tail, so unrelated keys never leave stale entries behind.
      const tail: Promise<void> = result
        .then(
          () => {},
          () => {},
        )
        .then(() => {
          if (tails.get(key) === tail) tails.delete(key);
        });
      tails.set(key, tail);
      return result;
    },
  };
}
