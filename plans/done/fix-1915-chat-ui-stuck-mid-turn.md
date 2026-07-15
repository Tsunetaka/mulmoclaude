# fix(#1915): chat UI stops updating mid-turn / thinking indicator stuck

## Summary

Three complementary fixes so the "考え中…" indicator can never stay stuck when the server actually finished the run:

- **A** — `handleSessionFinished` flips `session.isRunning = false` locally the instant the `session_finished` event arrives, instead of waiting for the separate `sessions` channel notification to arrive on a different socket.io frame.
- **B** — new `usePubSub().onReconnect(callback)` API. `App.vue` registers a catch-up handler that refetches `refreshSessionStates()` + the current session's transcript on every socket.io reconnect, since the pub/sub server has no replay buffer for events published during the down window.
- **D** — the same catch-up runs on `document.visibilitychange → visible`, covering Safari's silent tab throttling (WebSocket looks `connected` server-side while delivery stops on the client — there's no `disconnect` event to hook on, so B alone doesn't cover it).

**Not included** — the issue's proposed Fix C (await `persistHasUnread` in `endRun`). I traced the cursor logic; `changeMs = max(jsonl mtime, index.indexedAt, meta mtime)` in `server/api/routes/sessions.ts:212`, and jsonl mtime is dominant during a live turn. There is no real race — a session-finished summary always makes it into the diff and `applyLiveState` folds `live.isRunning = false` onto the summary. Fix C is dead-code hardening; skipping it.

## Items to Confirm / Review

- [ ] **Fix A trusts the event fully.** After this PR, `session.isRunning=false` is a client-side derivative of `session_finished` instead of only ever coming from the server-authoritative `sessions` list. The mutation is instant and would only be "wrong" if `session_finished` were published before the run actually ended — but `endRun()` sets `session.isRunning = false` before publishing, so the event's semantics are safe to trust.
- [ ] **Reconnect handler runs on every socket bounce.** When the user has 20+ subscribed sessions open (a rare but real state), the catch-up will fetch session states + one transcript per bounce. Cheap in practice (transcript API is per-session, sessions list is a single `?since=` diff), but flag if you want the transcript refresh to skip when the current session was already up-to-date.
- [ ] **`visibilitychange` fires on every tab-switch.** On a busy user (many tab flips per minute), the catch-up call rate could spike. `refreshSessionStates` is `?since=cursor`-scoped so idle calls return an empty diff — server load stays low. Still worth naming here.
- [ ] **Safari-throttling assumption.** The reporter is on M4 MacBook Air + Safari. Safari's silent throttling is my leading suspect based on the symptom shape (delivery stops mid-turn, tab looked foreground, no server error). If the true cause is a different flow (network hiccup only), Fix B alone would cover it — D is defense-in-depth.

## User Prompt

> Bug で優先度高くて対応したほうが良いのを順次。
> これって本当にバグ？再度見直してね。最良の方法をみつけて。一旦、issueの詳細は無視して、調査、再提案を。
> issue に記載した上で実装して。

## Analysis notes (posted as [issue #1915 comment](https://github.com/receptron/mulmoclaude/issues/1915#issuecomment-4869813016))

### Why Fix C is unnecessary

`endRun()` (`server/events/session-store/index.ts:178`) doesn't await `persistHasUnread`, but the cursor filter in the `/sessions` route uses `changeMs = max(jsonl mtime, index.indexedAt, meta mtime)`. During a live turn the jsonl mtime ticks on every agent event, so at the moment `notifySessionsChanged()` runs, the session's `changeMs` is already `> cursor`. The diff includes the session; `applyLiveState` folds the correct `live.isRunning = false` onto the summary. No race.

### The Safari factor the issue missed

Reporter env: M4 MacBook Air, Safari. Safari has documented WebSocket-delivery pauses under:
- backgrounded / hidden tabs (aggressive throttling)
- high-CPU or resource-pressure states
- suspend/resume cycles

The socket.io connection stays `connected` server-side (no `disconnect` fires) while the client stops receiving frames. When the tab comes back to foreground, socket.io does NOT re-fire `connect` because from its POV nothing broke. Fix B (reconnect handler) alone can't catch this. Fix D (visibilitychange) is what actually resolves it on Safari.

## Test plan

- [x] `yarn format` / `yarn lint` (0 errors, 26 pre-existing warnings) / `yarn typecheck` / `yarn build`
- Manual e2e (macOS Safari):
  1. Start a session, ask something that takes a full turn.
  2. Mid-turn, switch away from the tab for ~30s, come back. Confirm the "considering..." spinner is not stuck and the tool calls / final text render without a page reload.
  3. Same but with DevTools throttling → Offline for ~5s → back online. Confirm reconnect catch-up fires and the transcript catches up.
- Manual e2e (Chrome/Chromium):
  1. Same offline-toggle test. Confirm the reconnect path works on non-Safari too.

## Implementation

- `src/composables/usePubSub.ts` — new `onReconnect(callback): Unsubscribe`. Tracks `hasConnectedOnce` module-side so the initial `connect` doesn't fire the handler; every subsequent one does. Handler set is cleared when the socket is fully disconnected (nobody subscribed) so a fresh session doesn't inherit stale handlers.
- `src/App.vue` — Fix A (immediate `isRunning=false` in `handleSessionFinished`) + `catchUpMissedEvents(reason)` helper registered with both `pubsubOnReconnect` and `document.visibilitychange`. Cleaned up in `onScopeDispose`.

Files touched: 2. LOC delta: ~50.

## Out of scope

- **Automated tests** — `usePubSub` opens a real socket.io connection at module init; mocking `io()` cleanly is out of scope for this fix. `handleSessionFinished` and `catchUpMissedEvents` live inside `App.vue`'s setup closure and would need a Playwright/e2e harness to exercise. The manual test plan above is the verification path; a follow-up PR can extract `catchUpMissedEvents` to a pure module and add unit tests once the shape has bedded in.
- **Chat-index reindexer overhead** (#1929) — separate scheduler bug, tracked separately per user instruction.
