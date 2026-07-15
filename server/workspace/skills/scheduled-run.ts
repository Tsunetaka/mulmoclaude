// Shared dispatch for a scheduled or manually-triggered skill / user task:
// spawn its chat, record the run (history + last/next-run state), and surface a
// dispatch error. Used by both the skill scheduler and the user-task scheduler
// so each run wrapper stays a thin description of *what* to dispatch.

import { recordExternalRun, type TaskTrigger } from "../../events/scheduler-adapter.js";
import type { TaskSchedule } from "../../events/task-manager/index.js";
import type { SessionOrigin } from "../../../src/types/session.js";
import { log } from "../../system/logger/index.js";
import { makeUuid } from "../../utils/id.js";
import { errorMessage } from "../../utils/errors.js";
import { registerCompletionHook, unregisterCompletionHook } from "../../agent/backgroundSessions.js";

type StartChat = (params: { message: string; roleId: string; chatSessionId: string; origin?: SessionOrigin }) => Promise<{ kind: string; error?: string }>;

export interface ScheduledDispatch {
  /** Task-manager id (`skill.<name>` / `user.<uuid>`) — state/log key. */
  id: string;
  name: string;
  schedule: TaskSchedule;
  /** `/skill-name` for a skill, the prompt for a user task. */
  message: string;
  roleId: string;
  origin: SessionOrigin;
  trigger: TaskTrigger;
  /** Logger scope + a label for the thrown-on-failure message. */
  logScope: string;
  failureLabel: string;
  startChat: StartChat;
}

/** Dispatch one scheduled task's chat and record the run. Returns the spawned
 *  chat session id; throws on a dispatch error so the task-manager tick logs the
 *  failure.
 *
 *  Outcome recording (#2057): a spawned chat can still fail its FIRST turn — the
 *  MCP broker loses the startup race and the run does nothing — yet `startChat`
 *  returns success the moment it *spawns*. Recording at dispatch would log that
 *  as `"result":"success"` with an 8 ms duration, hiding the failure from
 *  unattended operation. So:
 *   - a DISPATCH failure (never spawned) is recorded immediately, then rethrown;
 *   - a successful dispatch records the REAL outcome from the turn's completion
 *     hook, giving an honest success/error verdict and a real duration. */
export async function fireScheduledChat(dispatch: ScheduledDispatch): Promise<string> {
  const { name, message, roleId, origin, logScope, failureLabel, startChat } = dispatch;
  const chatSessionId = makeUuid();
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  log.info(logScope, "running scheduled task", { name, roleId, chatSessionId });

  // Register BEFORE dispatch: `startChat` fire-and-forgets the background run,
  // so a fast-failing turn can reach `finalizeRun` before we'd otherwise get to
  // register — dropping the run record entirely. Registering first makes the
  // hook atomic with the spawn; the dispatch-failure branch rolls it back.
  registerCompletionHook(chatSessionId, ({ didError }) =>
    recordRun(dispatch, chatSessionId, startedAt, startMs, didError ? `${failureLabel} run did not complete successfully` : null),
  );

  const failure = await dispatchFailure(() => startChat({ message, roleId, chatSessionId, origin }));

  if (failure !== null) {
    // No turn spawned → the hook will never fire. Drop it and record now.
    unregisterCompletionHook(chatSessionId);
    await recordRun(dispatch, chatSessionId, startedAt, startMs, failure);
    throw new Error(`${failureLabel} failed: ${failure}`);
  }

  log.info(logScope, "scheduled task dispatched", { name, chatSessionId });
  return chatSessionId;
}

/** Persist one run's state + history entry. `runError` null = success. */
async function recordRun(dispatch: ScheduledDispatch, chatSessionId: string, startedAt: string, startMs: number, runError: string | null): Promise<void> {
  await recordExternalRun({
    id: dispatch.id,
    name: dispatch.name,
    schedule: dispatch.schedule,
    scheduledFor: startedAt,
    startedAt,
    durationMs: Date.now() - startMs,
    trigger: dispatch.trigger,
    errorMessage: runError,
    chatSessionId,
  });
}

/** Run the dispatch and normalize its outcome to an error string (or null on
 *  success), collapsing both an `{ kind: "error" }` result and a thrown/rejected
 *  promise into the same failure so neither escapes the run record. */
async function dispatchFailure(dispatch: () => Promise<{ kind: string; error?: string }>): Promise<string | null> {
  try {
    const result = await dispatch();
    return result.kind === "error" ? (result.error ?? "unknown") : null;
  } catch (err) {
    return errorMessage(err);
  }
}
