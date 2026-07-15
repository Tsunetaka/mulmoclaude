import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseContentLength, pickModelStatus, type ModelStatus } from "../../src/whisper/models.ts";

describe("parseContentLength", () => {
  it("parses a numeric header", () => {
    assert.equal(parseContentLength("12345"), 12345);
  });

  it("treats a missing header as 0", () => {
    assert.equal(parseContentLength(null), 0);
  });

  it("treats an empty / non-numeric header as 0", () => {
    assert.equal(parseContentLength(""), 0);
    assert.equal(parseContentLength("not-a-number"), 0);
  });

  it("parses a header with surrounding whitespace", () => {
    assert.equal(parseContentLength(" 42 "), 42);
  });
});

describe("pickModelStatus", () => {
  it("prefers an in-flight download even when the file is ready", () => {
    const live: ModelStatus = { state: "downloading", progress: 0.5 };
    assert.deepEqual(pickModelStatus(live, true), live);
  });

  it("reports ready when the file is on disk and nothing is downloading", () => {
    assert.deepEqual(pickModelStatus(undefined, true), { state: "ready" });
  });

  it("lets an on-disk file override a stale error state", () => {
    assert.deepEqual(pickModelStatus({ state: "error", error: "boom" }, true), { state: "ready" });
  });

  it("keeps the last error when the file is not ready", () => {
    const live: ModelStatus = { state: "error", error: "boom" };
    assert.deepEqual(pickModelStatus(live, false), live);
  });

  it("falls back to idle when there is no live state and no file", () => {
    assert.deepEqual(pickModelStatus(undefined, false), { state: "idle" });
  });
});
