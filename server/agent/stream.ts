import { EVENT_TYPES } from "../../src/types/events.js";

// Text the CLI injects into the conversation as a `user`-role message rather
// than the assistant producing it — today that is the SKILL.md body it
// synthesises after a `Skill` tool call. Kept OFF the wire protocol on purpose:
// it is never broadcast to session subscribers, because a consumer that
// accumulates `text` events (the bridge relay) would post injected context as
// the assistant's reply. `handleAgentEvent` decides what it actually is.
export const INJECTED_TEXT = "injected_text";

/** `fromSubagent` below marks an event a SUBAGENT produced (a `Task` /
 *  `Agent` tool's own turn), not the main agent whose reply the user is
 *  reading.
 *
 *  It exists because a subagent's events are NOT a boundary in the main
 *  agent's text: with background agents running, their `tool_use` /
 *  `tool_result` blocks arrive INTERLEAVED with the main agent's text
 *  deltas, so anything that treats "a non-text event arrived" as "the
 *  current text block ended" cuts the reply mid-word — and, when the cut
 *  lands inside a `**…**` span, splits the markdown so both halves render
 *  literal asterisks. Consumers that close a text block must skip events
 *  carrying the flag (via `isFromSubagent`); consumers that merely display
 *  tool activity should keep showing them.
 *
 *  Written inline on each variant rather than mixed in from a shared named
 *  type on purpose: `AgentEvent` is passed to `pushSessionEvent`, which
 *  takes `Record<string, unknown>`, and only object literal types get the
 *  implicit index signature that assignment needs. An intersection with a
 *  declared interface loses it and fails the whole union. */
export type AgentEvent =
  | { type: typeof EVENT_TYPES.status; message: string }
  | { type: typeof EVENT_TYPES.text; message: string }
  | { type: typeof INJECTED_TEXT; message: string }
  | { type: typeof EVENT_TYPES.toolResult; result: unknown }
  | { type: typeof EVENT_TYPES.error; message: string }
  | {
      type: typeof EVENT_TYPES.toolCall;
      toolUseId: string;
      toolName: string;
      args: unknown;
      fromSubagent?: true;
    }
  | {
      type: typeof EVENT_TYPES.toolCallResult;
      toolUseId: string;
      content: string;
      /** Anthropic's `tool_result` block carries `is_error: true` when
       *  the MCP server (or other tool) reported an error. Surfaced
       *  here so the failure monitor (#1353) can attribute repeated
       *  errors to a specific MCP server and warn / notify. */
      isError?: boolean;
      fromSubagent?: true;
    }
  | { type: typeof EVENT_TYPES.claudeSessionId; id: string };

/** True when an `AgentEvent` came from a subagent. A type-safe `in` check,
 *  so it can be applied to the whole union rather than only the two
 *  variants that carry the flag. */
export function isFromSubagent(event: AgentEvent): boolean {
  return "fromSubagent" in event && event.fromSubagent === true;
}

export interface ClaudeContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  /** Text content — present in `text` type blocks. */
  text?: string;
  /** Tool-result error flag from the Anthropic API. Present on
   *  `tool_result` blocks when the tool itself reported failure
   *  (MCP server returned an error, 401, ECONNREFUSED, …). */
  is_error?: boolean;
}

export interface ClaudeMessage {
  content?: ClaudeContentBlock[];
}

export type ClaudeStreamEvent =
  { type: "assistant"; message: ClaudeMessage } | { type: "user"; message: ClaudeMessage } | { type: "result"; result: string; session_id?: string };

// stream_event sub-types emitted when --include-partial-messages is on.
export interface StreamEventDelta {
  type: "content_block_delta";
  index: number;
  delta: { type: string; text?: string };
}

export interface RawStreamEvent {
  type: string;
  message?: ClaudeMessage;
  result?: string;
  session_id?: string;
  /** Present when type === "stream_event". Carries partial text
   *  deltas for real-time streaming. */
  event?: StreamEventDelta | { type: string };
  /** The `tool_use` id of the `Task` / `Agent` call that launched the
   *  SUBAGENT this message belongs to. The CLI sets it on every message a
   *  subagent produces and leaves it absent (or null) on the main agent's
   *  own — so its presence is the only way to tell the two apart in a
   *  single interleaved stream. Read via `isSubagentMessage`. */
  parent_tool_use_id?: string | null;
}

/** Whether a raw CLI event belongs to a subagent rather than the main agent.
 *
 *  Kept as a predicate rather than an inline truthiness check so the empty
 *  string is handled explicitly: an empty `parent_tool_use_id` names no tool
 *  call, and treating it as "from a subagent" would silently discard the main
 *  agent's own prose. */
export function isSubagentMessage(event: RawStreamEvent): boolean {
  return typeof event.parent_tool_use_id === "string" && event.parent_tool_use_id.length > 0;
}

/** `role` is the role of the MESSAGE the block came from, not the block's own
 *  kind. A text block only counts as assistant prose when the assistant wrote
 *  it; the same block shape under a `user` message is context the CLI injected
 *  (see `INJECTED_TEXT`). Required rather than defaulted: defaulting to
 *  `assistant` is precisely the assumption that produced #2821, and a silent
 *  default would let a new call site reintroduce it. */
export function blockToEvent(block: ClaudeContentBlock, role: "assistant" | "user"): AgentEvent | null {
  if (block.type === "text" && typeof block.text === "string") {
    return {
      type: role === "user" ? INJECTED_TEXT : EVENT_TYPES.text,
      message: block.text,
    };
  }
  if (block.type === "tool_use" && block.id && block.name) {
    return {
      type: EVENT_TYPES.toolCall,
      toolUseId: block.id,
      toolName: block.name,
      args: block.input,
    };
  }
  if (block.type === "tool_result" && block.tool_use_id) {
    const raw = block.content;
    const content = typeof raw === "string" ? raw : raw === undefined ? "" : JSON.stringify(raw);
    const event: AgentEvent = {
      type: EVENT_TYPES.toolCallResult,
      toolUseId: block.tool_use_id,
      content,
    };
    if (block.is_error === true) event.isError = true;
    return event;
  }
  return null;
}

// Extract a text delta from a stream_event, or null if the event
// isn't a text delta. Keeps the main parse function under the
// cognitive-complexity cap.
function extractTextDelta(event: RawStreamEvent): string | null {
  if (event.type !== "stream_event" || !event.event) return null;
  const inner = event.event;
  if (inner.type !== "content_block_delta" || !("delta" in inner) || inner.delta.type !== "text_delta" || typeof inner.delta.text !== "string") {
    return null;
  }
  return inner.delta.text;
}

// Filter assistant block events: when deltas already streamed the
// text, remove text-type events to prevent duplication.
function filterAssistantBlocks(blockEvents: AgentEvent[], deltaStreamed: boolean): AgentEvent[] {
  // eslint-disable-next-line sonarjs/no-selector-parameter -- `deltaStreamed` is parser state, not a caller-chosen mode (the single call site passes a variable). Folding the branch back into parse() measured cognitive complexity 16 against the cap of 15.
  return deltaStreamed ? blockEvents.filter((agentEvent) => agentEvent.type !== EVENT_TYPES.text) : blockEvents;
}

// Everything a SUBAGENT emits, mapped for display only.
//
// Two kinds of block are deliberately DROPPED rather than forwarded:
//
//   - text, both `text_delta` chunks and whole `text` blocks. The main
//     agent's card holds the reply the user is reading; appending another
//     agent's prose to it would interleave two voices in one bubble. The
//     whole-block case happens to be suppressed today by
//     `filterAssistantBlocks` once deltas have streamed — but only as a
//     side effect of duplicate detection, so it would return the moment a
//     turn produced no deltas. Dropping it here makes that intentional.
//   - the "Thinking..." status, which reports what the MAIN turn is doing.
//     Emitting it for a subagent makes the spinner describe a different
//     agent's progress.
//
// Tool calls and results ARE forwarded, tagged: the tool-call history
// showing what the subagents did is useful. The tag is what stops a
// consumer from reading them as a boundary in the main agent's text.
function parseSubagentEvent(event: RawStreamEvent): AgentEvent[] {
  if (event.type !== "assistant" && event.type !== "user") return [];
  const content = event.message?.content;
  if (!Array.isArray(content)) return [];
  const role = event.type === "user" ? "user" : "assistant";
  return content
    .map((block) => blockToEvent(block, role))
    .filter((agentEvent): agentEvent is AgentEvent => agentEvent !== null)
    .filter((agentEvent) => agentEvent.type === EVENT_TYPES.toolCall || agentEvent.type === EVENT_TYPES.toolCallResult)
    .map((agentEvent) => ({ ...agentEvent, fromSubagent: true as const }));
}

// Stateful parser that deduplicates text across the three stages
// Claude CLI emits: stream_event deltas → assistant content blocks
// → result full text. Uses two flags:
//
//   textStreamedFromDeltas — true once text_delta chunks have been
//     emitted from stream_event. Controls whether the full-text
//     `assistant` block is filtered as a duplicate of those chunks.
//
//   textEmitted — true once ANY text (delta or assistant block) has
//     been emitted, so the `result` event can suppress its duplicate
//     full-text copy. Prevents text loss when `assistant` arrives
//     without preceding `stream_event` deltas (short replies, CLI
//     version without `--include-partial-messages`, etc.).
export function createStreamParser(): {
  parse: (event: RawStreamEvent) => AgentEvent[];
} {
  let textStreamedFromDeltas = false;
  let textEmitted = false;

  // The turn's closing event: emits the full reply text only if nothing
  // already did, hands over the session id, and resets the dedup state for
  // the next turn. Split out of `parse` so the subagent guard there fits
  // inside the cognitive-complexity cap.
  function handleResult(event: RawStreamEvent): AgentEvent[] {
    const events: AgentEvent[] = [];
    if (!textEmitted && event.result) {
      events.push({ type: EVENT_TYPES.text, message: event.result });
    }
    if (event.session_id) {
      events.push({
        type: EVENT_TYPES.claudeSessionId,
        id: event.session_id,
      });
    }
    textStreamedFromDeltas = false;
    textEmitted = false;
    return events;
  }

  function parse(event: RawStreamEvent): AgentEvent[] {
    // Subagent messages ride the SAME stream as the main agent's, so they
    // must be separated before any of the dedup state below is touched:
    // letting a subagent set `textEmitted` would suppress the main agent's
    // own `result` text as a "duplicate" of prose that was never shown.
    if (isSubagentMessage(event)) return parseSubagentEvent(event);
    // Handle streaming text deltas from --include-partial-messages.
    const delta = extractTextDelta(event);
    if (delta !== null) {
      textStreamedFromDeltas = true;
      textEmitted = true;
      return [{ type: EVENT_TYPES.text, message: delta }];
    }
    if (event.type === "stream_event") return [];

    if (event.type === "result") return handleResult(event);

    if (event.type !== "assistant" && event.type !== "user") {
      return [];
    }

    const role = event.type === "user" ? "user" : "assistant";
    const content = event.message?.content;
    const blockEvents = Array.isArray(content)
      ? content.map((block) => blockToEvent(block, role)).filter((agentEvent): agentEvent is AgentEvent => agentEvent !== null)
      : [];

    if (event.type === "assistant") {
      const filtered = filterAssistantBlocks(blockEvents, textStreamedFromDeltas);
      if (filtered.some((agentEvent) => agentEvent.type === EVENT_TYPES.text)) {
        textEmitted = true;
      }
      return [{ type: EVENT_TYPES.status, message: "Thinking..." }, ...filtered];
    }
    return blockEvents;
  }

  return { parse };
}

// Stateless convenience: one throwaway parser per event, so no dedup
// state survives the call. The agent loop must keep a single
// createStreamParser() across the whole turn instead — dedup works by
// remembering what earlier events in that turn already emitted, which
// a per-event parser can never observe.
export function parseStreamEvent(event: RawStreamEvent): AgentEvent[] {
  return createStreamParser().parse(event);
}
