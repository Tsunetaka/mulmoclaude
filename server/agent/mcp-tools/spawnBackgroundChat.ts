// `spawnBackgroundChat` launches a SECOND, parallel chat session via
// the host's `startChat` (each session is its own `claude`
// subprocess, so the worker runs genuinely concurrently with the
// caller's conversation — unlike Claude Code's blocking `Task`
// subagent). It's a generic primitive: any role/skill can use it to
// do work off the critical path (the first consumer is the
// lessons-collection recipe, which pre-authors the next lesson's HTML
// while the learner reads the current one).
//
// `startChat` is already fire-and-forget — it kicks off
// `runAgentInBackground` (not awaited) and returns once the run is
// launched — so this handler returns the new `chatId` immediately
// without waiting for the worker to finish.
//
// `hidden` controls whether the user ever sees the spawned session:
//   - true  → origin `system`; excluded from every session listing
//             (no sidebar entry under any filter). For invisible
//             plumbing like artifact pre-generation.
//   - false → origin `skill`; a normal visible chat, reachable under
//             the "Skill" history filter. For when the user should be
//             able to open the spawned chat.
//
// Deps are injected so the unit test can assert the origin mapping,
// the no-nesting refusal, and the concurrency cap without spawning
// real subprocesses.

import { randomUUID } from "node:crypto";
import { SESSION_ORIGINS, type SessionOrigin } from "../../../src/types/session.js";
import { readSessionMeta } from "../../utils/files/session-io.js";
// `agent.ts` is imported TYPE-ONLY: a value import would form a runtime
// module cycle (agent.ts → agent/index → config → activeTools →
// mcp-tools/index → here) that triggers a TDZ error while index.ts
// builds its `mcpTools` array. `startChat` is loaded lazily via dynamic
// import in the production singleton instead.
import type { StartChatParams, StartChatResult } from "../../api/routes/agent.js";
import { tryReserveBackgroundSession, releaseBackgroundSession, MAX_BACKGROUND_SESSIONS } from "../backgroundSessions.js";
import type { McpToolContext } from "./index.js";

export type StartChatFn = (params: StartChatParams) => Promise<StartChatResult>;
export type ReadSessionOriginFn = (sessionId: string) => Promise<SessionOrigin | undefined>;

export interface SpawnBackgroundChatDeps {
  startChat: StartChatFn;
  /** Look up the calling session's origin so a hidden worker can be
   *  refused permission to spawn further hidden workers (no nesting). */
  readSessionOrigin: ReadSessionOriginFn;
}

// The tool's runtime behavior. Extracted from the factory's returned object so
// `makeSpawnBackgroundChatTool` stays under the max-lines threshold; `deps` is
// threaded in explicitly. Behavior is unchanged — covered by
// test/agent/test_spawnBackgroundChat.ts.
async function spawnBackgroundChatHandler(deps: SpawnBackgroundChatDeps, args: Record<string, unknown>, ctx?: McpToolContext): Promise<string> {
  const message = typeof args.message === "string" ? args.message.trim() : "";
  if (!message) return "spawnBackgroundChat: `message` is required (non-empty string).";
  const role = typeof args.role === "string" ? args.role.trim() : "";
  if (!role) return "spawnBackgroundChat: `role` is required (non-empty string — the role id the worker runs in).";
  const { hidden } = args;
  if (typeof hidden !== "boolean") return "spawnBackgroundChat: `hidden` is required (boolean).";

  // No nesting: a hidden worker session must not fan out further hidden
  // workers. Only enforced when we know the caller's session.
  if (ctx?.sessionId) {
    const parentOrigin = await deps.readSessionOrigin(ctx.sessionId);
    if (parentOrigin === SESSION_ORIGINS.system) {
      return "spawnBackgroundChat: refused — a background worker session cannot spawn further background sessions. Do the work inline instead.";
    }
  }

  const origin: SessionOrigin = hidden ? SESSION_ORIGINS.system : SESSION_ORIGINS.skill;
  const chatId = randomUUID();

  // Runaway guard: reserve the slot ATOMICALLY and BEFORE launching so
  // concurrent calls can't all pass a check-then-reserve split and over-spawn.
  // Released in runAgentInBackground's finally, or rolled back here on failure.
  if (hidden && !tryReserveBackgroundSession(chatId)) {
    return `spawnBackgroundChat: refused — too many background sessions already in flight (max ${MAX_BACKGROUND_SESSIONS}). Do the work inline instead.`;
  }

  const result = await deps.startChat({ message, roleId: role, chatSessionId: chatId, origin });
  if (result.kind === "error") {
    if (hidden) releaseBackgroundSession(chatId); // roll back the reservation
    return `spawnBackgroundChat: failed to start chat: ${result.error}`;
  }
  return JSON.stringify({ chatId, hidden });
}

export function makeSpawnBackgroundChatTool(deps: SpawnBackgroundChatDeps) {
  return {
    definition: {
      name: "spawnBackgroundChat",
      description:
        "Launch a separate, parallel chat session that runs its own agent turn concurrently with this conversation, then returns immediately (fire-and-forget). Use it to do work off the critical path — e.g. pre-generate an artifact the user will need soon — without blocking the current turn. Returns the new session's chatId.",
      inputSchema: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description:
              "The first user turn for the spawned session — a complete, self-contained instruction, since the worker shares none of this conversation's context. State exactly what to produce and where to write it, and tell it to finish silently (do not present anything) when done.",
          },
          role: {
            type: "string",
            description: "Role id the spawned session runs in (e.g. the same role that owns the task). Determines which tools the worker has.",
          },
          hidden: {
            type: "boolean",
            description:
              "true → invisible worker the user never sees (use for background plumbing like artifact pre-generation). false → a normal visible chat the user can open from history.",
          },
        },
        required: ["message", "role", "hidden"],
      },
    },

    // Generic host infrastructure — available to every role, not gated
    // by `role.availablePlugins`. See `McpTool.alwaysActive`.
    alwaysActive: true,

    prompt:
      "Use `spawnBackgroundChat` to run work in parallel with the current conversation instead of making the user wait for it inline. The classic case: while the user is reading or working through the current item, spawn a hidden worker to pre-generate the NEXT artifact they'll need, so it's ready instantly when they reach it. " +
      "Set `hidden: true` for invisible background work (the session never appears in the user's history); `hidden: false` only when the user should be able to open the spawned chat themselves. " +
      "The `message` must be fully self-contained — the worker shares NONE of this chat's context — and should instruct the worker to write its output to disk and stop without presenting anything (no one is viewing its canvas). It returns right away with a `chatId`; it does NOT wait for the worker to finish, so always keep a graceful fallback (do the work inline) in case the worker hasn't finished by the time its output is needed.",

    handler: (args: Record<string, unknown>, ctx?: McpToolContext): Promise<string> => spawnBackgroundChatHandler(deps, args, ctx),
  };
}

export const spawnBackgroundChat = makeSpawnBackgroundChatTool({
  // Dynamic import (call-time) breaks the module cycle with agent.ts —
  // see the type-only import note above. The module is cached after the
  // first call, so this costs nothing on the hot path.
  startChat: async (params) => {
    const { startChat } = await import("../../api/routes/agent.js");
    return startChat(params);
  },
  readSessionOrigin: async (sessionId) => (await readSessionMeta(sessionId))?.origin,
});
