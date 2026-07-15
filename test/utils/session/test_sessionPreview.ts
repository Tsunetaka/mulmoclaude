import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSessionSummary, resolveSessionPrimaryText, sessionHasVisibleSummary } from "../../../src/utils/session/sessionPreview.js";

describe("resolveSessionSummary", () => {
  it("returns the trimmed summary when non-empty", () => {
    assert.equal(resolveSessionSummary("  User discussed Rails migration  "), "User discussed Rails migration");
  });

  it("returns null for undefined", () => {
    assert.equal(resolveSessionSummary(undefined), null);
  });

  it("returns null for empty string", () => {
    assert.equal(resolveSessionSummary(""), null);
  });

  it("returns null for whitespace-only (spaces / tabs / newlines) — the Codex #1959 blank-row guard", () => {
    assert.equal(resolveSessionSummary("   "), null);
    assert.equal(resolveSessionSummary("\t\t"), null);
    assert.equal(resolveSessionSummary("\n \n"), null);
  });
});

describe("resolveSessionPrimaryText", () => {
  it("prefers a meaningful summary over the preview", () => {
    const result = resolveSessionPrimaryText({ summary: "AI summary", preview: "Hello" });
    assert.equal(result, "AI summary");
  });

  it("trims the summary before returning", () => {
    const result = resolveSessionPrimaryText({ summary: "  padded summary  ", preview: "Hello" });
    assert.equal(result, "padded summary");
  });

  it("falls back to the preview when summary is missing", () => {
    const result = resolveSessionPrimaryText({ preview: "Hello" });
    assert.equal(result, "Hello");
  });

  it("falls back to the preview when summary is whitespace-only", () => {
    const result = resolveSessionPrimaryText({ summary: "   ", preview: "Hello" });
    assert.equal(result, "Hello");
  });

  it("returns null when both summary and preview are absent — the caller supplies the localised noMessages placeholder", () => {
    assert.equal(resolveSessionPrimaryText({ preview: "" }), null);
    assert.equal(resolveSessionPrimaryText({ summary: "  ", preview: "" }), null);
  });

  it("does not fall through to preview when summary is meaningful — even if preview is longer", () => {
    const result = resolveSessionPrimaryText({ summary: "AI", preview: "A much longer first message" });
    assert.equal(result, "AI");
  });
});

describe("sessionHasVisibleSummary", () => {
  it("is true only when the summary is non-whitespace", () => {
    assert.equal(sessionHasVisibleSummary({ summary: "yes", preview: "" }), true);
    assert.equal(sessionHasVisibleSummary({ summary: "  padded  ", preview: "" }), true);
  });

  it("is false when summary is missing / empty / whitespace", () => {
    assert.equal(sessionHasVisibleSummary({ preview: "hi" }), false);
    assert.equal(sessionHasVisibleSummary({ summary: "", preview: "hi" }), false);
    assert.equal(sessionHasVisibleSummary({ summary: "   ", preview: "hi" }), false);
  });
});
