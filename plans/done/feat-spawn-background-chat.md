# feat: `spawnBackgroundChat` — a generic detached-session primitive

## Motivation

When a learner opens **Lesson 1** of a lessons-collection course, they wait
**minutes** before any text appears: lessons are authored just-in-time, and
`presentHtml` only renders *after* the whole HTML page has generated. There is no
background thread to hide that behind — the runtime agent (`claude` CLI subprocess)
runs only inside its conversational turns, and Claude Code's `Task` subagent is
**blocking** (the parent turn doesn't advance until the subagent returns), so it
buys context isolation, not latency hiding.

The real lever is that **each MulmoClaude chat session is its own `claude`
subprocess**, so a *second* session runs genuinely in parallel. The host already has
the primitive: `startChat()` (`server/api/routes/agent.ts:137`) launches a run
fire-and-forget — it calls `runAgentInBackground(...)` (not awaited) and returns
`{ kind: "started", chatSessionId }` immediately. It's already used headless by the
scheduler and by runtime plugins (`ChatRuntimeApi.start()`).

What's missing is a way for the **agent itself** (any role/skill, not just runtime
plugins) to launch such a detached session, and a way to keep those sessions out of
the user's sidebar when they're pure plumbing.

This plan adds a generic, agent-callable MCP tool:

```ts
spawnBackgroundChat({ message: string, role: string, hidden: boolean }) → { chatId: string }
```

- **Generic** — not lessons-specific. Any skill/collection that wants lazy
  background work uses it. (First consumer: lessons-collection prefetch — Phase 5.)
- **Available to every role**, like a built-in (Bash/Read/Write) — no
  `role.availablePlugins` opt-in.
- **`hidden`** controls user visibility (see below).

## Design

### `hidden` → session origin mapping

Every session carries an `origin` tag (`src/types/session.ts:10`), persisted in meta
and used by the history sidebar (`src/config/historyFilters.ts`). Today the `all`
filter lists **every** session regardless of origin — there is no "hidden".

- **`hidden: true`** → tag the worker `SESSION_ORIGINS.system` (new). The
  session-list path **excludes** this origin entirely — it shows under *no* sidebar
  filter. Lessons calls it this way.
- **`hidden: false`** → tag `SESSION_ORIGINS.skill` (it *is* an agent/skill-spawned
  chat): a normal, visible session reachable under the **Skill** filter, for callers
  that *want* the user to see/jump into the spawned chat.

`system` is deliberately **not** added to `historyFilters.ts` — it has no pill; it's
internal-only.

### Fire-and-forget

`spawnBackgroundChat`'s handler runs in the Express process (pure MCP tool handlers
do — `mcp-tools/index.ts`), so it imports `startChat` directly, calls it with a fresh
`randomUUID()` chatSessionId, and returns `{ chatId }` without awaiting the run.
`startChat` is already non-blocking, so no new wrapper is needed.

### Lifecycle of a `system` session

`runAgentInBackground`'s `finally` block (`agent.ts:958-1021`) currently fires, for
**every** completed run: the chat-indexer (summary/title — an LLM cost), wiki
backlinks, and the journal. For a `system` worker these are waste + pollution. So:

- **Skip** chat-index, wiki-backlinks, and journal for `origin === system`.
- **Auto-delete on success, retain on error**: track whether the run errored; in the
  `finally`, if `origin === system` and no error → `deleteSessionFiles(chatSessionId)`;
  on error → keep the files so the failure is inspectable.

(Completion notifications are already commented out at `agent.ts:960-991`, so there's
nothing to suppress there.)

### Runaway guard

`spawnBackgroundChat` must not let the agent spawn a fleet:

1. **No nesting** — refuse if the *calling* session is itself `origin === system`
   (read the caller's origin via `ctx.sessionId`). A background worker cannot spawn
   more background workers.
2. **Concurrency cap** — a module-level counter of in-flight `system` sessions
   (incremented on spawn, decremented when the run's `finally` deletes/finishes);
   reject with a tool-result error (which the LLM can read and degrade gracefully)
   when over the cap (start: `MAX_BACKGROUND_SESSIONS = 4`).

## Per-file edits

### Phase 1 — the `system` origin (host, data model)

- **`src/types/session.ts`**
  - Add `system: "system"` to `SESSION_ORIGINS` (`:10`). The `SessionOrigin` union
    and `isSessionOrigin` pick it up automatically (both derive from
    `SESSION_ORIGINS`).
- **`src/config/historyFilters.ts`** — **no change** (intentionally: `system` gets no
  filter pill). Add a one-line comment noting `system` is excluded by design.

### Phase 2 — exclude `system` from listings (host, API)

- **`server/api/routes/sessions.ts`** — in `loadSessionRow` (`:177`), after
  `readSessionMeta`, `if (meta.origin === SESSION_ORIGINS.system) return null;`. This
  is the single choke point feeding both the list route and the cursor diff
  (`loadAllSessions`). Import `SESSION_ORIGINS` (currently only the type is imported).
- **`server/workspace/chat-index/indexer.ts`** (verify) — ensure the indexer doesn't
  separately surface `system` sessions; primary suppression is the Phase-4 skip, but
  confirm no other enumerator lists them.

### Phase 3 — the `spawnBackgroundChat` MCP tool (host)

- **`server/agent/mcp-tools/spawnBackgroundChat.ts`** (new) — `McpTool` with:
  - `definition.inputSchema`: `message` (string, required), `role` (string,
    required), `hidden` (boolean, required).
  - `prompt`: explains it launches a parallel detached chat; `hidden: true` for
    invisible workers (artifact pre-generation), `hidden: false` for a visible chat
    the user can open; returns `{ chatId }`; fire-and-forget (does not wait for the
    work to finish).
  - `handler(args, ctx)`: validate args; enforce runaway guard (no nesting via
    `ctx.sessionId` origin lookup + concurrency cap); `origin = hidden ?
    SESSION_ORIGINS.system : SESSION_ORIGINS.skill`; `const chatId = randomUUID();`
    `await startChat({ message, roleId: role, chatSessionId: chatId, origin });`
    return `JSON.stringify({ chatId })`.
  - `alwaysActive: true` (see Phase 4).
- **`server/agent/mcp-tools/index.ts`**
  - Add `alwaysActive?: boolean` to the `McpTool` interface.
  - Add `spawnBackgroundChat` to the `mcpTools` array.
- **`src/config/toolNames.ts`** — add `spawnBackgroundChat: "spawnBackgroundChat"`
  alongside `readXPost`/`searchX`/`notify` (`:61-63`).

### Phase 4 — "always active" gating + lifecycle (host)

- **`server/agent/activeTools.ts`** — in the static-MCP loop, treat `alwaysActive`
  tools as allowed regardless of `role.availablePlugins`:
  `const isAllowed = tool.alwaysActive === true || allowed.has(toolName);`
  This makes the tool appear in every role's published MCP list **and** its system
  prompt section (both derive from `getActiveToolDescriptors`). `--allowedTools`
  already passes the `mcp__mulmoclaude` wildcard (`config.ts:309`), so permission is
  covered.
- **`server/api/routes/agent.ts`** — in `runAgentInBackground`:
  - Track a `didError` flag (set in the `catch` at `:948`).
  - In the `finally` (`:958-1021`): when `params.origin === SESSION_ORIGINS.system`,
    skip the chat-index enqueue (`:997`), wiki-backlinks (`:1005`), and journal
    (`:993`); and after `endRun`, `if (!didError) await deleteSessionFiles(chatSessionId)`.
  - Decrement the background-session counter here (shared with Phase 3's guard) —
    keep the counter in a small dedicated module (e.g.
    `server/agent/backgroundSessions.ts`) imported by both the tool handler and this
    finally, so the data model has one owner.

### Phase 5 — consumer: lessons-collection recipe (docs only; independently shippable after 1–4)

`server/workspace/helps/lessons-collection.md`:

- **Pre-author Lesson 1 at course creation** — in "Plan the course", after
  `presentCollection`, `Write` Lesson 1's HTML to disk and set its `lesson` path so
  the very first **Learn** click presents-by-path instantly (no background trick can
  cover a cold start with nothing on screen).
- **Prefetch the next lesson** — in the `learn`/`continue` templates and the teaching
  loop: when finishing lesson N, call `spawnBackgroundChat({ role: "tutor", hidden:
  true, message: "<author lesson N+1 from its objective, Write the HTML to
  artifacts/html/lessons-<topic>/<id>.html, set the record's lesson field, do NOT
  presentHtml, then stop>" })`. By the time the learner reaches N+1 the file exists →
  present-by-path → instant. Graceful fallback: if `lesson` is still empty (worker not
  done / failed), author inline as today.
- Add a short rationale paragraph (the worker uses `Write`, never `presentHtml`,
  because no one is viewing its canvas).

> Phase 5 is a separate concern from the host primitive. Ship Phases 1–4 first
> (generic, testable on their own); lessons-collection is the first consumer.

## Testing

- **Unit (`test/agent/`)**:
  - `spawnBackgroundChat` handler: arg validation; `hidden` → origin mapping; nesting
    refusal when caller is `system`; concurrency cap rejection.
  - `activeTools`: `alwaysActive` tool present for a role with empty
    `availablePlugins`.
  - `sessions` listing: a `system`-origin session is excluded from `loadAllSessions`.
- **e2e-live** (optional follow-up): a course Learn click renders within a tight
  bound on the second lesson (prefetch warmed); first lesson instant (pre-authored).
- Manual: confirm `system` sessions never appear in the sidebar under any filter, and
  that files are deleted on success / retained on error.

## Out of scope / follow-ups

- A declarative "on-action → fire background action for the next record" Collections
  feature (host-driven prefetch) — bigger no-code-platform surface; revisit later.
- Surfacing in-flight `system` workers anywhere in the UI (a debug-only view).
- `selectedImageData`/attachments passthrough for spawned chats (not needed for
  artifact authoring).
