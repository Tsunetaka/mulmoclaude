import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeBufferedIntoDraft } from "../../../src/utils/chat/buffer.js";

describe("mergeBufferedIntoDraft", () => {
  it("joins buffered messages then the live draft with a single newline, oldest-first", () => {
    assert.equal(mergeBufferedIntoDraft(["one", "two"], "three"), "one\ntwo\nthree");
  });

  it("returns the draft alone when nothing is buffered", () => {
    assert.equal(mergeBufferedIntoDraft([], "draft"), "draft");
  });

  it("returns buffered messages alone when the draft is empty", () => {
    assert.equal(mergeBufferedIntoDraft(["one", "two"], ""), "one\ntwo");
  });

  it("drops empty / whitespace-only parts and trims the rest", () => {
    assert.equal(mergeBufferedIntoDraft(["  one  ", "   ", ""], "  two  "), "one\ntwo");
  });

  it("preserves newlines inside a single message", () => {
    assert.equal(mergeBufferedIntoDraft(["line1\nline2"], ""), "line1\nline2");
  });

  it("returns an empty string when everything is empty", () => {
    assert.equal(mergeBufferedIntoDraft([], ""), "");
    assert.equal(mergeBufferedIntoDraft(["", "  "], "   "), "");
  });
});
