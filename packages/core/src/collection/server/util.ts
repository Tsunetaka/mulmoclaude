// Tiny self-contained helpers ported from the host (server/utils/errors.ts,
// server/utils/time.ts) so the engine carries no dependency on host utils.

/** Human-readable message from an unknown thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const ONE_SECOND_MS = 1_000;
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
