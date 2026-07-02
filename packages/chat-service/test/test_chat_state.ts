// Pins `connectSession`'s two-mode contract added for #1888:
//   - roleId passed → persisted state's role is replaced by the caller's value
//   - roleId omitted → persisted state's role is preserved (HTTP /connect path)
// The rest of `chat-state.ts` is exercised through the surrounding command +
// relay tests; this file only guards the roleId propagation semantics.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createChatStateStore, isSafeSessionId } from "../src/chat-state.ts";
import type { Logger } from "../src/types.ts";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("chat-state.connectSession — roleId propagation (issue #1888)", () => {
  let transportsDir: string;

  beforeEach(() => {
    transportsDir = mkdtempSync(path.join(tmpdir(), "chat-state-"));
  });

  afterEach(() => {
    rmSync(transportsDir, { recursive: true, force: true });
  });

  it("replaces roleId when the caller passes one (the /switch path)", async () => {
    const store = createChatStateStore({ transportsDir, logger: silentLogger });
    await store.resetChatState("telegram", "chat-1", "general");
    const updated = await store.connectSession("telegram", "chat-1", "office-session", "office");
    assert.ok(updated);
    assert.equal(updated?.sessionId, "office-session");
    assert.equal(updated?.roleId, "office", "the target session's role must overwrite the prior role");
    // Re-read to confirm the file-backed copy matches (this is the value the
    // next relay's startChat will pick up).
    const reloaded = await store.getChatState("telegram", "chat-1");
    assert.equal(reloaded?.roleId, "office");
  });

  it("preserves roleId when the caller omits it (the HTTP /connect path)", async () => {
    const store = createChatStateStore({ transportsDir, logger: silentLogger });
    await store.resetChatState("telegram", "chat-1", "general");
    const updated = await store.connectSession("telegram", "chat-1", "some-session");
    assert.ok(updated);
    assert.equal(updated?.sessionId, "some-session");
    assert.equal(updated?.roleId, "general", "omitted roleId ⇒ keep the existing one (backward-compat for /connect)");
  });

  it("returns null when the chat state doesn't exist yet", async () => {
    const store = createChatStateStore({ transportsDir, logger: silentLogger });
    const result = await store.connectSession("telegram", "never-seen", "sess", "office");
    assert.equal(result, null);
  });

  it("refuses to persist an unsafe sessionId even when the chat state exists (defense-in-depth for #1896)", async () => {
    // Belt-and-suspenders with the /connect route's entry-level check: if
    // some other caller (test harness, alternate transport, direct store
    // access) reaches connectSession with a hostile sessionId, the store
    // MUST NOT write it to state — otherwise a later /history read would
    // pipe it into `readSessionJsonl` (no traversal guard).
    const store = createChatStateStore({ transportsDir, logger: silentLogger });
    const seeded = await store.resetChatState("telegram", "chat-1", "general");
    const originalSessionId = seeded.sessionId;

    for (const hostile of ["../etc/passwd", "..", "sess/../evil", "a/b", ""]) {
      const result = await store.connectSession("telegram", "chat-1", hostile, "office");
      assert.equal(result, null, `hostile sessionId ${JSON.stringify(hostile)} must be refused`);
      // State file must be untouched — no persistence of the hostile value.
      const reloaded = await store.getChatState("telegram", "chat-1");
      assert.equal(reloaded?.sessionId, originalSessionId, `state must not be poisoned by ${JSON.stringify(hostile)}`);
    }
  });
});

describe("isSafeSessionId (exported by chat-state)", () => {
  it("accepts every legitimate session-id form", () => {
    // UUID v4 (server-side sessions)
    assert.ok(isSafeSessionId("001dfd79-d6c5-4be4-9afa-454675aafc1e"));
    // transport-chat-timestamp triple (chat-state's own generateSessionId)
    assert.ok(isSafeSessionId("telegram-chat123-1719822000000"));
    // 16-hex short IDs
    assert.ok(isSafeSessionId("a1b2c3d4e5f60718"));
    // Dotted legacy names
    assert.ok(isSafeSessionId("session.v2.abc"));
  });

  it("rejects path-traversal + separator + empty inputs", () => {
    for (const hostile of ["", "..", "../etc/passwd", "../../secret", "chat/../../etc", "..\\windows\\file", "sess/../evil", "a/b", "a\\b", "a".repeat(201)]) {
      assert.equal(isSafeSessionId(hostile), false, `${JSON.stringify(hostile)} must be rejected`);
    }
  });
});
