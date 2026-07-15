// In-flight bookkeeping for detached worker sessions launched via the
// `spawnBackgroundChat` MCP tool with `hidden: true` (origin
// `system`). Both the tool handler (which reserves a slot before
// `startChat`) and `runAgentInBackground`'s `finally` (which releases
// it when the worker finishes) run in the same Express process, so
// this module-level Set is the single shared owner of the count.
//
// Purpose: a runaway guard. Without a cap, a misbehaving agent could
// fan out an unbounded number of parallel `claude` subprocesses. The
// cap is small on purpose — the intended use is "stay one or two
// lessons ahead", not a job queue.

const MAX_BACKGROUND_SESSIONS = 4;

const inFlight = new Set<string>();

/** Atomically reserve a slot for a hidden worker session: returns
 *  `false` (without reserving) when the cap is already reached,
 *  otherwise reserves and returns `true`. The check and the insert
 *  happen together with no `await` in between, so concurrent handler
 *  calls can't all pass a separate "is there room?" check and then
 *  each launch — which would briefly exceed the cap. The caller MUST
 *  pair a `true` result with `releaseBackgroundSession` (on the
 *  worker's completion, and as rollback if the launch itself fails). */
export function tryReserveBackgroundSession(chatSessionId: string): boolean {
  if (inFlight.size >= MAX_BACKGROUND_SESSIONS) return false;
  inFlight.add(chatSessionId);
  return true;
}

/** Unconditionally mark a session as in-flight (bypasses the cap).
 *  Production code uses `tryReserveBackgroundSession`; this exists for
 *  tests that need to fill the cap deterministically. */
export function reserveBackgroundSession(chatSessionId: string): void {
  inFlight.add(chatSessionId);
}

/** Release a hidden worker session's slot. Idempotent / safe to call
 *  for non-background sessions (no-op when the id was never reserved),
 *  so the agent run's `finally` can call it without branching. */
export function releaseBackgroundSession(chatSessionId: string): void {
  inFlight.delete(chatSessionId);
}

// ── Completion hooks ────────────────────────────────────────────────
//
// A generic, one-shot callback fired when a hidden worker session finishes
// (success or error). Any host spawner of hidden workers can register one to
// learn the outcome without polling — the agent-ingest dispatcher uses it to
// track consecutive failures and raise/clear a failure bell. Best-effort: a
// server restart mid-run drops the Map, but the next scheduled tick
// re-dispatches anyway, so nothing is permanently lost.

/** Outcome handed to a completion hook. */
export type CompletionHook = (outcome: { didError: boolean }) => void | Promise<void>;

const completionHooks = new Map<string, CompletionHook>();

// Hook keys are server-generated session ids (`randomUUID()`). Validate the
// shape before using a session id to look up + invoke a hook, so a malformed or
// foreign id can never select an unexpected call target (defensive — and it
// keeps the dynamic call off a request-derived, unvalidated string).
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Register a one-shot completion hook for a hidden worker session. Replaces
 *  any existing hook for the same id (last writer wins). */
export function registerCompletionHook(chatSessionId: string, hook: CompletionHook): void {
  completionHooks.set(chatSessionId, hook);
}

/** Drop a hook registered pre-dispatch when the dispatch never spawned a run,
 *  so `finalizeRun` will never fire it. No-op when none is registered. */
export function unregisterCompletionHook(chatSessionId: string): void {
  completionHooks.delete(chatSessionId);
}

/** Run the one-shot completion hook for a session, if one is registered, then
 *  remove it (so it can't fire twice). No-op when none is registered.
 *
 *  Owning the lookup+invocation here — rather than exposing a `takeHook` that
 *  the caller invokes — keeps the call target a closure WE registered under a
 *  server-generated id, never a value the caller selects by a request-derived
 *  key at its own call site (which static analysis flags as a dynamic-dispatch
 *  risk). The hook is best-effort: a throwing hook rejects the returned promise
 *  for the caller to catch+log. */
export async function runCompletionHook(chatSessionId: string, outcome: { didError: boolean }): Promise<void> {
  if (!SESSION_ID_RE.test(chatSessionId)) return;
  const hook = completionHooks.get(chatSessionId);
  if (!hook) return;
  completionHooks.delete(chatSessionId);
  await hook(outcome);
}

export { MAX_BACKGROUND_SESSIONS };
