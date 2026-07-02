// Regression test for #1878: two concurrent first messages for the
// same external chat must NOT each create a separate internal session.
// The mock store models the async fs read/write with a 1ms delay so
// that, without serialization, both turns observe "no state" and call
// resetChatState twice. With the relay's per-external-chat serializer
// the second turn waits and reuses the first turn's session.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES } from "@mulmobridge/protocol";
import { createRelay } from "../src/relay.ts";
import type { RelayDeps } from "../src/relay.ts";
import type { ChatStateStore, TransportChatState } from "../src/chat-state.ts";
import type { Logger, OnSessionEventFn, Role, StartChatFn } from "../src/types.ts";

const silentLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

const tick = () => new Promise<void>((r) => setTimeout(r, 1));

interface MockStore {
  store: ChatStateStore;
  resetCount: () => number;
  sessionIds: () => string[];
}

function makeStore(): MockStore {
  const states = new Map<string, TransportChatState>();
  const slot = (transportId: string, externalChatId: string) => `${transportId}:${externalChatId}`;
  let resetCount = 0;
  let seq = 0;

  const store: ChatStateStore = {
    async getChatState(transportId, externalChatId) {
      await tick();
      return states.get(slot(transportId, externalChatId)) ?? null;
    },
    async setChatState(transportId, state) {
      await tick();
      states.set(slot(transportId, state.externalChatId), state);
    },
    async resetChatState(transportId, externalChatId, roleId) {
      resetCount++;
      const now = new Date().toISOString();
      const state: TransportChatState = {
        externalChatId,
        sessionId: `sess-${++seq}`,
        roleId,
        startedAt: now,
        updatedAt: now,
      };
      await tick();
      states.set(slot(transportId, externalChatId), state);
      return state;
    },
    async connectSession() {
      return null;
    },
    generateSessionId: (transportId, externalChatId) => `${transportId}-${externalChatId}-gen`,
  };

  return {
    store,
    resetCount: () => resetCount,
    sessionIds: () => [...states.values()].map((s) => s.sessionId),
  };
}

const getRole = (id: string): Role => ({ id, name: id });

function makeDeps(store: ChatStateStore, startChat: StartChatFn): RelayDeps {
  const onSessionEvent: OnSessionEventFn = (_sessionId, listener) => {
    // Finish the agent turn on the next tick so collectAgentReply resolves.
    setTimeout(() => listener({ type: EVENT_TYPES.sessionFinished }), 1);
    return () => {};
  };
  return {
    store,
    handleCommand: async () => null,
    startChat,
    onSessionEvent,
    getRole,
    defaultRoleId: "general",
    logger: silentLogger,
  };
}

describe("relay serialization (#1878)", () => {
  it("creates one session when two first messages arrive concurrently", async () => {
    const mock = makeStore();
    const startedWith: string[] = [];
    const startChat: StartChatFn = async (params) => {
      startedWith.push(params.chatSessionId);
      return { kind: "started", chatSessionId: params.chatSessionId };
    };
    const relay = createRelay(makeDeps(mock.store, startChat));

    const [first, second] = await Promise.all([
      relay({ transportId: "t", externalChatId: "c", text: "first" }),
      relay({ transportId: "t", externalChatId: "c", text: "second" }),
    ]);

    assert.equal(first.kind, "ok");
    assert.equal(second.kind, "ok");
    assert.equal(mock.resetCount(), 1, "a new session must be created exactly once");
    assert.equal(new Set(mock.sessionIds()).size, 1, "only one session is stored");
    assert.equal(startedWith.length, 2);
    assert.equal(startedWith[0], startedWith[1], "both turns reuse the same session id");
  });

  it("does not block turns for different external chats", async () => {
    const mock = makeStore();
    const startChat: StartChatFn = async (params) => ({ kind: "started", chatSessionId: params.chatSessionId });
    const relay = createRelay(makeDeps(mock.store, startChat));

    const results = await Promise.all([
      relay({ transportId: "t", externalChatId: "a", text: "x" }),
      relay({ transportId: "t", externalChatId: "b", text: "y" }),
    ]);

    assert.deepEqual(
      results.map((r) => r.kind),
      ["ok", "ok"],
    );
    assert.equal(mock.resetCount(), 2, "each distinct chat gets its own session");
  });
});
