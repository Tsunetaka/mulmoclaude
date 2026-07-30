// Declarative retrieval config for the "Feeds" mechanism. A Feed is a
// CollectionSchema plus this `ingest` block, registered as data (NOT as
// a skill) under `<workspace>/feeds/<slug>/schema.json`. The host's
// retrieval engine reads it to periodically refill the collection's
// records via the shared collections io layer.
//
// The ingest vocab (INGEST_KINDS / FEED_SCHEDULES + their literal-union types)
// lives in the sibling `../collection` subpath alongside the schema contract, so
// the package's schema validator can enforce it. Re-exported here so the feeds
// engine's existing importers resolve them unchanged.
import { INGEST_KINDS, FEED_SCHEDULES, type IngestKind, type FeedSchedule } from "../collection/index.js";
// Type-only: keeps zod out of this module's runtime graph (the feeds engine
// imports it browser-free through `../collection`'s type surface).
import type { z } from "zod";
import type { AgentIngestZ, DeclarativeIngestZ } from "../collection/core/schemaZ";
//
// Two flavours: the declarative kinds (`rss`/`atom`/`http-json`) fetch-and-map,
// and `agent` dispatches a hidden worker. The `code` kind (LLM-generated
// deterministic transform) is still reserved for a future retriever.

// The agent ingest kind. Defined HERE (not imported from `../collection`) on
// purpose: the engine only needs the literal to branch, and re-importing it as a
// VALUE keeps this module free of a value dependency on the collection vocab.
// Core owns its own copy for the schema validator; this matches the same literal.
export const AGENT_INGEST_KIND = "agent" as const;
export type AgentIngestKind = typeof AGENT_INGEST_KIND;

export { INGEST_KINDS, FEED_SCHEDULES, type IngestKind, type FeedSchedule };

const FEED_SCHEDULE_SET: ReadonlySet<string> = new Set(FEED_SCHEDULES);

export function isFeedSchedule(value: unknown): value is FeedSchedule {
  return typeof value === "string" && FEED_SCHEDULE_SET.has(value);
}

/** Default cap on stored records per feed when `ingest.maxItems` is
 *  omitted. Keeps high-volume feeds (news / podcasts) bounded. */
export const DEFAULT_FEED_MAX_ITEMS = 100;

/** Declarative field map: target collection field name → source path
 *  into the raw item (dot/bracket path, e.g. `"title"` or
 *  `"data.name"`). */
export type IngestFieldMap = Record<string, string>;

/** Declarative retrieval (`rss`/`atom`/`http-json`): the host fetches `url`
 *  and projects each item through `map` (target field → source path; a
 *  `http-json` feed may add `itemsAt`, a dot/bracket path to the items
 *  array; `idFrom` derives the primaryKey; `maxItems` caps stored records,
 *  default {@link DEFAULT_FEED_MAX_ITEMS}, `0` = keep everything). The
 *  canonical loose contract stays the minimal `CollectionIngest`; this
 *  feeds subtype is derived from the zod source of truth
 *  (`collection/core/schemaZ` `DeclarativeIngestZ`), so the engine and the
 *  schema validator can never drift. */
export type DeclarativeIngestSpec = z.infer<typeof DeclarativeIngestZ>;

/** Agent-performed retrieval (`kind: "agent"`). No `url`/`map`: the host seeds
 *  a hidden background worker (origin `system`) in `role` with `template` + a
 *  summary of every record, and the worker edits the records itself via the
 *  collections io layer. Valid on any collection (primarily skill-backed).
 *  Derived from `AgentIngestZ` in `collection/core/schemaZ`. */
export type AgentIngestSpec = z.infer<typeof AgentIngestZ>;

/** The `ingest` block carried on a `CollectionSchema`, discriminated on `kind`. */
export type IngestSpec = DeclarativeIngestSpec | AgentIngestSpec;
