// Regression for the fragmented-reply bug: while background agents were
// running, the main agent's reply arrived as dozens of separate cards, cut
// mid-word. A measured turn with four `Agent` calls in flight produced 79
// assistant text rows — median 33 characters, the shortest a single
// character — and every cut that landed inside a `**…**` span left literal
// asterisks showing on both sides of the break.
//
// The cause was that a tool call was treated as the end of the current text
// block without asking WHOSE tool call it was. That inference is sound for
// the main agent (its own tool call can only follow a finished block) and
// wrong for a subagent, whose calls arrive interleaved with the main agent's
// text deltas because both agents are working at the same time.
//
// This drives the real `applyAgentEvent` dispatcher with that interleaving.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyAgentEvent, type AgentEventContext } from "../../src/utils/agent/eventDispatch";
import { createEmptySession } from "../../src/utils/session/sessionFactory";
import { EVENT_TYPES } from "../../src/types/events";
import type { ActiveSession } from "../../src/types/session";
import type { SseEvent } from "../../src/types/sse";

async function replay(events: readonly SseEvent[]): Promise<ActiveSession> {
  const session = createEmptySession("s1", "general");
  const ctx: AgentEventContext = {
    session,
    refreshRoles: async () => undefined,
    scrollSidebarToBottom: () => undefined,
    onGenerationsDrained: () => undefined,
  };
  for (const event of events) {
    await applyAgentEvent(event, ctx);
  }
  return session;
}

function assistantTexts(session: ActiveSession): string[] {
  return session.toolResults
    .filter((result) => result.toolName === "text-response" && (result.data as { role?: string }).role === "assistant")
    .map((result) => (result.data as { text?: string }).text ?? "");
}

const delta = (message: string): SseEvent => ({ type: EVENT_TYPES.text, message, source: "assistant" });

const subagentCall = (toolUseId: string, toolName: string): SseEvent => ({
  type: EVENT_TYPES.toolCall,
  toolUseId,
  toolName,
  args: {},
  fromSubagent: true,
});

const mainCall = (toolUseId: string, toolName: string): SseEvent => ({
  type: EVENT_TYPES.toolCall,
  toolUseId,
  toolName,
  args: {},
});

describe("applyAgentEvent — a subagent's tool call is not a boundary in the reply", () => {
  it("keeps the reply in one card while background agents work", async () => {
    const session = await replay([
      delta("実機の真実は DD からしか取れません"),
      subagentCall("sub-1", "Bash"),
      delta("。\n\n残り3本（地区コ"),
      subagentCall("sub-2", "Read"),
      delta("ード／shp_／DD API）の結果を待っています。"),
    ]);
    assert.deepEqual(assistantTexts(session), ["実機の真実は DD からしか取れません。\n\n残り3本（地区コード／shp_／DD API）の結果を待っています。"]);
  });

  it("keeps a `**…**` span whole when a subagent interrupts inside it", async () => {
    // The visible symptom: both halves rendered their own literal `**`
    // because neither card held a complete bold span.
    const session = await replay([delta("索引列が無い）、**実機の真実は DD からしか取れません"), subagentCall("sub-1", "Bash"), delta("。**")]);
    const texts = assistantTexts(session);
    assert.equal(texts.length, 1);
    assert.match(texts[0] ?? "", /\*\*実機の真実は DD からしか取れません。\*\*/);
  });

  it("still splits on the MAIN agent's own tool call", async () => {
    // The per-block split is deliberate and must survive this fix — see
    // test_assistantTextInterrupt.ts for what depends on it.
    const session = await replay([delta("調べます。"), mainCall("main-1", "Bash"), delta("終わりました。")]);
    assert.deepEqual(assistantTexts(session), ["調べます。", "終わりました。"]);
  });

  it("still lists the subagent's tool calls in the history", async () => {
    // Suppressing the split must not suppress the activity: seeing what the
    // background agents ran is the point of showing them at all.
    const session = await replay([delta("4本走らせました"), subagentCall("sub-1", "Bash"), subagentCall("sub-2", "Grep")]);
    assert.deepEqual(
      session.toolCallHistory.map((entry) => entry.toolName),
      ["Bash", "Grep"],
    );
  });
});
