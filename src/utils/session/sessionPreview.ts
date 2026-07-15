// Selection helpers for the session-history sidebar row.
//
// The AI summary (chat indexer) is preferred over the raw first user
// message when it's meaningful. "Meaningful" excludes undefined / empty
// / whitespace-only strings — otherwise a summarizer that returns "   "
// would blank out the row (no visible text, no tooltip, no aria label).

export interface SessionPreviewInput {
  summary?: string;
  preview: string;
}

export function resolveSessionSummary(summary: string | undefined): string | null {
  const trimmed = summary?.trim();
  return trimmed || null;
}

// `null` means "nothing to show" — the template turns that into the
// localised `noMessages` placeholder. Not baked in here to keep this
// pure (no i18n dependency).
export function resolveSessionPrimaryText(session: SessionPreviewInput): string | null {
  const summary = resolveSessionSummary(session.summary);
  if (summary) return summary;
  return session.preview || null;
}

export function sessionHasVisibleSummary(session: SessionPreviewInput): boolean {
  return resolveSessionSummary(session.summary) !== null;
}
