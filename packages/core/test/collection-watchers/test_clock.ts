// evalNow (clock.ts): the evaluation-only injectable clock. Unset →
// wall clock; MULMOCLAUDE_FAKE_NOW set to a parseable date → that date,
// re-read per call; unparseable → falls back to the wall clock rather
// than freezing time at Invalid Date.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { evalNow } from "../../src/collection-watchers/index.ts";

const ORIGINAL = process.env.MULMOCLAUDE_FAKE_NOW;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MULMOCLAUDE_FAKE_NOW;
  else process.env.MULMOCLAUDE_FAKE_NOW = ORIGINAL;
});

test("unset → real wall clock (within tolerance)", () => {
  delete process.env.MULMOCLAUDE_FAKE_NOW;
  const delta = Math.abs(evalNow().getTime() - Date.now());
  assert.ok(delta < 5_000, `evalNow drifted ${delta}ms from wall clock`);
});

test("set to an ISO date → that civil date, per call", () => {
  process.env.MULMOCLAUDE_FAKE_NOW = "2030-03-01T09:00:00";
  const fake = evalNow();
  assert.equal(fake.getFullYear(), 2030);
  assert.equal(fake.getMonth() + 1, 3);
  assert.equal(fake.getDate(), 1);
  // re-read per call: changing the env changes the next call
  process.env.MULMOCLAUDE_FAKE_NOW = "2031-12-31";
  assert.equal(evalNow().getFullYear(), 2031);
});

test("unparseable → falls back to wall clock", () => {
  process.env.MULMOCLAUDE_FAKE_NOW = "not-a-date";
  const delta = Math.abs(evalNow().getTime() - Date.now());
  assert.ok(delta < 5_000, `fallback drifted ${delta}ms from wall clock`);
});
