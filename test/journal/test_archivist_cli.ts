// Tests for the pure helpers of `server/workspace/journal/archivist-cli.ts` —
// the argv builder + stdin payload composer used to invoke the claude CLI.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildClaudeCliArgs, buildCliPayload } from "../../server/workspace/journal/archivist-cli.js";

describe("buildClaudeCliArgs", () => {
  it("omits --model when no model is given", () => {
    assert.deepEqual(buildClaudeCliArgs(), ["-p", "--output-format", "text"]);
  });

  it("omits --model when model is undefined", () => {
    assert.deepEqual(buildClaudeCliArgs(undefined), ["-p", "--output-format", "text"]);
  });

  it("appends --model haiku after the base flags", () => {
    assert.deepEqual(buildClaudeCliArgs("haiku"), ["-p", "--output-format", "text", "--model", "haiku"]);
  });

  it("appends --model sonnet after the base flags", () => {
    assert.deepEqual(buildClaudeCliArgs("sonnet"), ["-p", "--output-format", "text", "--model", "sonnet"]);
  });

  it("returns a fresh array on each call (no shared mutable state)", () => {
    const first = buildClaudeCliArgs("haiku");
    const second = buildClaudeCliArgs();
    assert.notEqual(first, second);
    assert.deepEqual(second, ["-p", "--output-format", "text"]);
  });
});

describe("buildCliPayload", () => {
  it("joins system + user prompts with the ---separator", () => {
    assert.equal(buildCliPayload("SYS", "USER"), "SYS\n\n---\n\nUSER");
  });

  it("handles empty prompts", () => {
    assert.equal(buildCliPayload("", ""), "\n\n---\n\n");
  });

  it("handles an empty system prompt", () => {
    assert.equal(buildCliPayload("", "USER"), "\n\n---\n\nUSER");
  });

  it("handles an empty user prompt", () => {
    assert.equal(buildCliPayload("SYS", ""), "SYS\n\n---\n\n");
  });

  it("preserves multiline content verbatim", () => {
    assert.equal(buildCliPayload("line1\nline2", "a\nb\nc"), "line1\nline2\n\n---\n\na\nb\nc");
  });
});
