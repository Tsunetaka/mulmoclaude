// Evaluation-only injectable clock. When MULMOCLAUDE_FAKE_NOW is set to
// a parseable date/datetime string, every reconcile pass derives "now"
// from it instead of the wall clock — letting evaluation runs and tests
// advance time deterministically (a `triggerField` coming due, a `spawn`
// successor's own trigger firing later) without waiting for real days to
// pass. Unset or unparseable (i.e. normal operation) → real wall clock.
// Read per call, so a long-lived server picks up changes without restart.
export function evalNow(): Date {
  const raw = process.env.MULMOCLAUDE_FAKE_NOW;
  if (!raw) return new Date();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
