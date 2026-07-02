// Shared pagination for the collection/feed record handlers.
//
// The command channel writes the result INSIDE the command document, and
// Firestore caps a document at 1 MiB. offset/limit slice the records; limit is
// clamped to [1, MAX_LIMIT] (default 50) so a runaway page can't blow that
// budget. Params arrive as JSON over the channel, so coerce defensively.
import type { JsonObject, JsonValue } from "../commandChannel.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const toInt = (value: JsonValue): number | null => {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(num) ? Math.floor(num) : null;
};

export const clampOffset = (value: JsonValue): number => Math.max(0, toInt(value) ?? 0);

export const clampLimit = (value: JsonValue): number => {
  const num = toInt(value);
  if (num === null || num <= 0) return DEFAULT_LIMIT;
  return Math.min(num, MAX_LIMIT);
};

// Build the paginated result. `detail` (a CollectionDetail) and `items`
// (CollectionItem[]) are plain JSON, but their interfaces lack an index
// signature so they don't structurally match JsonValue — the cast is safe.
export const pageResult = (detail: unknown, items: unknown[], offset: number, limit: number): JsonObject =>
  ({ collection: detail, items: items.slice(offset, offset + limit), total: items.length, offset, limit }) as unknown as JsonObject;
