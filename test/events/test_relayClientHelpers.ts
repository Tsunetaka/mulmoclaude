import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildExternalChatId,
  buildRelayUrl,
  formatReplyText,
  isRelayMessage,
  isTerminalCloseCode,
  nextReconnectMs,
} from "../../server/events/relay-client-helpers.js";

describe("buildRelayUrl", () => {
  it("appends the token as a query param", () => {
    assert.equal(buildRelayUrl("wss://relay.example.com/ws", "abc123"), "wss://relay.example.com/ws?token=abc123");
  });

  it("preserves an existing path and query, overwriting only token", () => {
    assert.equal(buildRelayUrl("wss://relay.example.com/ws?token=stale&region=us", "fresh"), "wss://relay.example.com/ws?token=fresh&region=us");
  });

  it("URL-encodes tokens with reserved characters", () => {
    assert.equal(buildRelayUrl("wss://relay.example.com/", "a b&c=d"), "wss://relay.example.com/?token=a+b%26c%3Dd");
  });

  it("throws on a malformed base URL (mirrors the try/catch at the call site)", () => {
    assert.throws(() => buildRelayUrl("not a url", "abc"));
  });
});

describe("nextReconnectMs", () => {
  const MAX = 30_000;

  it("doubles below the cap", () => {
    assert.equal(nextReconnectMs(1_000, MAX), 2_000);
    assert.equal(nextReconnectMs(2_000, MAX), 4_000);
  });

  it("caps at the maximum", () => {
    assert.equal(nextReconnectMs(20_000, MAX), MAX);
  });

  it("returns the cap exactly when doubling lands on it", () => {
    assert.equal(nextReconnectMs(15_000, MAX), MAX);
  });

  it("never exceeds the cap even when current already exceeds it", () => {
    assert.equal(nextReconnectMs(40_000, MAX), MAX);
  });

  it("doubles zero to zero (degenerate boundary)", () => {
    assert.equal(nextReconnectMs(0, MAX), 0);
  });
});

describe("isTerminalCloseCode", () => {
  it("treats policy-violation and custom auth codes as terminal", () => {
    assert.equal(isTerminalCloseCode(1008), true);
    assert.equal(isTerminalCloseCode(4401), true);
    assert.equal(isTerminalCloseCode(4403), true);
  });

  it("treats normal and transient close codes as non-terminal", () => {
    assert.equal(isTerminalCloseCode(1000), false);
    assert.equal(isTerminalCloseCode(1006), false);
    assert.equal(isTerminalCloseCode(4400), false);
  });
});

describe("buildExternalChatId", () => {
  it("joins platform and chatId with a double underscore", () => {
    assert.equal(buildExternalChatId("line", "abc"), "line__abc");
  });

  it("avoids the single-dash collision between (google-chat, X) and (google, chat-X)", () => {
    assert.notEqual(buildExternalChatId("google-chat", "X"), buildExternalChatId("google", "chat-X"));
  });

  it("handles empty components", () => {
    assert.equal(buildExternalChatId("", ""), "__");
  });
});

describe("isRelayMessage", () => {
  const valid = {
    id: "msg-1",
    platform: "line",
    senderId: "u-1",
    chatId: "c-1",
    text: "hello",
    receivedAt: "2026-07-09T00:00:00Z",
  };

  it("accepts a well-formed message (extra fields allowed)", () => {
    assert.equal(isRelayMessage(valid), true);
    assert.equal(isRelayMessage({ ...valid, replyToken: "tok", extra: 1 }), true);
  });

  it("rejects non-objects", () => {
    assert.equal(isRelayMessage(null), false);
    assert.equal(isRelayMessage(undefined), false);
    assert.equal(isRelayMessage("hello"), false);
    assert.equal(isRelayMessage(42), false);
  });

  it("rejects when a required field is missing", () => {
    const noId: Record<string, unknown> = { ...valid };
    delete noId.id;
    assert.equal(isRelayMessage(noId), false);
  });

  it("rejects wrong-typed required fields", () => {
    assert.equal(isRelayMessage({ ...valid, id: 123 }), false);
    assert.equal(isRelayMessage({ ...valid, platform: null }), false);
  });

  it("rejects empty text and empty chatId", () => {
    assert.equal(isRelayMessage({ ...valid, text: "" }), false);
    assert.equal(isRelayMessage({ ...valid, chatId: "" }), false);
  });
});

describe("formatReplyText", () => {
  it("returns the reply for an ok result", () => {
    assert.equal(formatReplyText({ kind: "ok", reply: "done" }), "done");
  });

  it("prefixes error results with 'Error: '", () => {
    assert.equal(formatReplyText({ kind: "error", status: 500, message: "boom" }), "Error: boom");
  });

  it("handles empty strings on both branches", () => {
    assert.equal(formatReplyText({ kind: "ok", reply: "" }), "");
    assert.equal(formatReplyText({ kind: "error", status: 400, message: "" }), "Error: ");
  });
});
