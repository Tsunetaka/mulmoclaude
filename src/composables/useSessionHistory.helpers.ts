import type { SessionSummary } from "../types/session";

/** Return a new session list with `isBookmarked` set to `bookmarked` on
 *  the session whose id matches `sessionId`. Non-matching sessions are
 *  returned by reference; the input array is never mutated. */
export function applyBookmarkFlag(sessions: SessionSummary[], sessionId: string, bookmarked: boolean): SessionSummary[] {
  return sessions.map((session) => (session.id === sessionId ? { ...session, isBookmarked: bookmarked } : session));
}
