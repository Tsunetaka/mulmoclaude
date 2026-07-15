import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTaskFinishedPush } from "../../server/agent/webPush.js";

describe("buildTaskFinishedPush", () => {
  it("uses the ✅ title on success and the ⚠️ title on error", () => {
    assert.ok(buildTaskFinishedPush("hello", false).title.startsWith("✅"));
    assert.ok(buildTaskFinishedPush("hello", true).title.startsWith("⚠️"));
  });

  it("uses the first user message as the body", () => {
    assert.equal(buildTaskFinishedPush("Summarise this article", false).body, "Summarise this article");
  });

  it("falls back to a generic body when the message is missing or blank", () => {
    assert.equal(buildTaskFinishedPush(undefined, false).body, "Task complete");
    assert.equal(buildTaskFinishedPush("   ", false).body, "Task complete");
    assert.equal(buildTaskFinishedPush("", false).body, "Task complete");
  });

  it("caps the body length (ellipsis included in the budget)", () => {
    const long = "x".repeat(500);
    const { body } = buildTaskFinishedPush(long, false);
    assert.ok(body.length <= 160, `body length ${body.length} exceeds cap`);
    assert.ok(body.endsWith("…"));
  });
});
