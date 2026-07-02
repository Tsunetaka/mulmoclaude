import { SESSION_ORIGINS, type SessionSummary } from "../../types/session";

// A session counts as "long-running" once its activity span — most
// recent update minus start — reaches a full day. Separates sustained
// conversations from one-shot sessions in the history filter.
export const LONG_RUNNING_THRESHOLD_MS = 24 * 60 * 60 * 1000;

type Span = Pick<SessionSummary, "startedAt" | "updatedAt">;

// Elapsed time between a session's start and its most recent activity.
// Unparseable timestamps yield 0 so a corrupt row is treated as short
// rather than crashing the filter.
export function sessionDurationMs(session: Span): number {
  const startedMs = Date.parse(session.startedAt);
  const updatedMs = Date.parse(session.updatedAt);
  if (Number.isNaN(startedMs) || Number.isNaN(updatedMs)) return 0;
  return Math.max(0, updatedMs - startedMs);
}

export function isLongRunning(session: Span): boolean {
  return sessionDurationMs(session) >= LONG_RUNNING_THRESHOLD_MS;
}

type OriginedSpan = Span & Pick<SessionSummary, "origin">;

// The long-running filter targets sustained conversations the user had.
// A scheduler-origin session is excluded even past 24h: a recurring
// schedule keeps one session alive for days, so its span trivially
// crosses the threshold without being a real back-and-forth. Other
// origins (human, skill, bridge, plugin) stay — those are conversations.
export function isLongRunningConversation(session: OriginedSpan): boolean {
  return isLongRunning(session) && session.origin !== SESSION_ORIGINS.scheduler;
}
