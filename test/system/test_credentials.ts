// Tests for the pure response-detection predicate of
// `server/system/credentials.ts`. `looksLikeClaudeResponse` decides
// whether PTY output looks like a real Claude reply (conversational
// opener AND >= 20 chars) versus an error chunk that should time out.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { looksLikeClaudeResponse } from "../../server/system/credentials.js";

describe("looksLikeClaudeResponse", () => {
  it("returns true for a conversational opener with enough text", () => {
    assert.equal(looksLikeClaudeResponse("Hello! How can I help you today?"), true);
  });

  it("returns true for an `I'm` opener (straight apostrophe) past the length floor", () => {
    assert.equal(looksLikeClaudeResponse("I'm here to help you out."), true);
  });

  it("returns true for an `I'm` opener (curly apostrophe) past the length floor", () => {
    assert.equal(looksLikeClaudeResponse("I’m ready to assist you now."), true);
  });

  it("returns false when the opener matches but the text is too short (< 20 chars)", () => {
    assert.equal(looksLikeClaudeResponse("Hi there"), false);
  });

  it("returns false at the boundary (exactly 19 chars, matching opener)", () => {
    const text = "Hi! short reply...."; // 19 chars, matches "Hi"
    assert.equal(text.length, 19);
    assert.equal(looksLikeClaudeResponse(text), false);
  });

  it("returns true at the boundary (exactly 20 chars, matching opener)", () => {
    const text = "Hi! twentycharsxxxxx"; // 20 chars, matches "Hi"
    assert.equal(text.length, 20);
    assert.equal(looksLikeClaudeResponse(text), true);
  });

  it("returns false for a login-error chunk", () => {
    assert.equal(looksLikeClaudeResponse("Please log in"), false);
  });

  it("returns false for an invalid-credentials chunk", () => {
    assert.equal(looksLikeClaudeResponse("Invalid credentials"), false);
  });

  it("returns false for long text without a conversational opener", () => {
    assert.equal(looksLikeClaudeResponse("Please log in to continue your session now."), false);
  });

  it("returns false for an empty string", () => {
    assert.equal(looksLikeClaudeResponse(""), false);
  });
});
