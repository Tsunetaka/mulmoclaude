import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createStreamParser, blockToEvent, type ClaudeContentBlock, type RawStreamEvent } from "../../server/agent/stream.ts";
import { EVENT_TYPES } from "../../src/types/events.ts";

describe("blockToEvent", () => {
  it("emits text event for text blocks", () => {
    const result = blockToEvent({ type: "text", text: "hello" }, "assistant");
    assert.deepEqual(result, { type: EVENT_TYPES.text, message: "hello" });
  });

  it("emits toolCall for tool_use blocks", () => {
    const result = blockToEvent(
      {
        type: "tool_use",
        id: "t1",
        name: "Bash",
        input: { command: "ls" },
      },
      "assistant",
    );
    assert.equal(result?.type, EVENT_TYPES.toolCall);
  });

  it("returns null for unknown block types", () => {
    assert.equal(blockToEvent({ type: "thinking" }, "assistant"), null);
  });
});

describe("createStreamParser — delta streaming", () => {
  it("emits text events from stream_event text_delta", () => {
    const parser = createStreamParser();
    const events = parser.parse({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "hello " },
      },
    });
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { type: EVENT_TYPES.text, message: "hello " });
  });

  it("suppresses assistant text block after deltas were streamed", () => {
    const parser = createStreamParser();
    // Stream a delta first
    parser.parse({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "streamed" },
      },
    });
    // Then assistant event with full text
    const events = parser.parse({
      type: "assistant",
      message: { content: [{ type: "text", text: "streamed" }] },
    });
    // Should have status but NO text (filtered as duplicate)
    const textEvents = events.filter((evt) => evt.type === EVENT_TYPES.text);
    assert.equal(textEvents.length, 0);
    assert.ok(events.some((evt) => evt.type === EVENT_TYPES.status));
  });

  it("suppresses result text after deltas were streamed", () => {
    const parser = createStreamParser();
    parser.parse({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "streamed" },
      },
    });
    // Result should only emit session_id, not text
    const events = parser.parse({
      type: "result",
      result: "streamed",
      session_id: "sess-1",
    });
    assert.equal(events.length, 1);
    const [event] = events;
    assert.ok(event);
    assert.equal(event.type, EVENT_TYPES.claudeSessionId);
  });
});

describe("createStreamParser — no deltas (fallback)", () => {
  it("emits text from assistant block when no deltas preceded", () => {
    const parser = createStreamParser();
    const events = parser.parse({
      type: "assistant",
      message: { content: [{ type: "text", text: "direct reply" }] },
    });
    const textEvents = events.filter((evt) => evt.type === EVENT_TYPES.text);
    assert.equal(textEvents.length, 1);
    const [textEvent] = textEvents;
    assert.ok(textEvent);
    assert.equal(textEvent.message, "direct reply");
  });

  it("suppresses result text after assistant block emitted text", () => {
    const parser = createStreamParser();
    parser.parse({
      type: "assistant",
      message: { content: [{ type: "text", text: "from block" }] },
    });
    const events = parser.parse({
      type: "result",
      result: "from block",
    });
    // No text event from result (already emitted via assistant)
    const textEvents = events.filter((evt) => evt.type === EVENT_TYPES.text);
    assert.equal(textEvents.length, 0);
  });

  it("falls back to result text when neither delta nor assistant text existed", () => {
    const parser = createStreamParser();
    // Only a result event, no assistant blocks
    const events = parser.parse({
      type: "result",
      result: "fallback text",
      session_id: "s1",
    });
    assert.equal(events.length, 2);
    const [textEvent, sessionIdEvent] = events;
    assert.deepEqual(textEvent, {
      type: EVENT_TYPES.text,
      message: "fallback text",
    });
    assert.ok(sessionIdEvent);
    assert.equal(sessionIdEvent.type, EVENT_TYPES.claudeSessionId);
  });
});

describe("createStreamParser — multi-turn reset", () => {
  it("resets flags after result so next turn works independently", () => {
    const parser = createStreamParser();
    // Turn 1: delta streamed
    parser.parse({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "turn1" },
      },
    });
    parser.parse({ type: "result", result: "turn1" });
    // Turn 2: no deltas, assistant block only
    const events = parser.parse({
      type: "assistant",
      message: { content: [{ type: "text", text: "turn2" }] },
    });
    const textEvents = events.filter((evt) => evt.type === EVENT_TYPES.text);
    assert.equal(textEvents.length, 1);
    const [textEvent] = textEvents;
    assert.ok(textEvent);
    assert.equal(textEvent.message, "turn2");
  });
});

describe("createStreamParser — ignores non-text stream_events", () => {
  it("returns empty for message_start", () => {
    const parser = createStreamParser();
    const events = parser.parse({
      type: "stream_event",
      event: { type: "message_start" },
    } as RawStreamEvent);
    assert.equal(events.length, 0);
  });

  it("returns empty for content_block_start", () => {
    const parser = createStreamParser();
    const events = parser.parse({
      type: "stream_event",
      event: { type: "content_block_start" },
    } as RawStreamEvent);
    assert.equal(events.length, 0);
  });
});

// A subagent's messages ride the SAME stream as the main agent's, told apart
// only by `parent_tool_use_id`. Before this was read, every one of them was
// parsed as if the main agent had produced it — which is what cut replies
// into fragments once background agents were in flight.
describe("createStreamParser — subagent messages", () => {
  const subagentAssistant = (content: ClaudeContentBlock[]): RawStreamEvent => ({
    type: "assistant",
    parent_tool_use_id: "task_1",
    message: { content },
  });

  it("forwards a subagent's tool call tagged, and emits no status event", () => {
    const parser = createStreamParser();
    const events = parser.parse(subagentAssistant([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }]));
    assert.equal(events.length, 1, "the 'Thinking...' status belongs to the main turn, not a subagent's");
    assert.equal(events[0]?.type, EVENT_TYPES.toolCall);
    assert.equal((events[0] as { fromSubagent?: boolean }).fromSubagent, true);
  });

  it("tags a subagent's tool result too", () => {
    const parser = createStreamParser();
    const events = parser.parse({
      type: "user",
      parent_tool_use_id: "task_1",
      message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
    });
    assert.equal(events[0]?.type, EVENT_TYPES.toolCallResult);
    assert.equal((events[0] as { fromSubagent?: boolean }).fromSubagent, true);
  });

  it("drops a subagent's prose so it never lands in the main reply", () => {
    const parser = createStreamParser();
    assert.deepEqual(parser.parse(subagentAssistant([{ type: "text", text: "I'll grep for it." }])), []);
  });

  it("drops a subagent's text deltas", () => {
    const parser = createStreamParser();
    const events = parser.parse({
      type: "stream_event",
      parent_tool_use_id: "task_1",
      event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "grepping" } },
    });
    assert.deepEqual(events, []);
  });

  it("does not let a subagent's text suppress the main agent's result text", () => {
    // The dedup flags exist to stop ONE agent's text being emitted twice. A
    // subagent setting `textEmitted` would make the main agent's `result`
    // full text look like a duplicate of prose that was never shown — so the
    // reply would vanish entirely on a turn that streamed no deltas.
    const parser = createStreamParser();
    parser.parse(subagentAssistant([{ type: "text", text: "subagent prose" }]));
    const events = parser.parse({ type: "result", result: "the main reply" });
    assert.ok(events.some((event) => event.type === EVENT_TYPES.text && event.message === "the main reply"));
  });

  it("treats an empty parent_tool_use_id as the main agent", () => {
    // An empty string names no tool call. Reading it as "from a subagent"
    // would discard the main agent's own prose.
    const parser = createStreamParser();
    const events = parser.parse({ type: "assistant", parent_tool_use_id: "", message: { content: [{ type: "text", text: "mine" }] } });
    assert.ok(events.some((event) => event.type === EVENT_TYPES.text && event.message === "mine"));
  });
});
