// Path helpers for the non-skill Feeds registry. Each feed lives at
// `<workspace>/feeds/<slug>/schema.json` (a CollectionSchema + `ingest`
// block) with its retrieval state alongside at
// `<workspace>/feeds/<slug>/_state.json`. Records land wherever the
// schema's `dataPath` points (validated by `resolveDataDir`), exactly
// like every other collection.
//
// Pure root→path functions: `workspaceRoot` is always passed in (the host
// supplies its default). Slugs reaching these helpers must already have
// passed `safeSlugName` — these joins do not re-sanitize.

import path from "node:path";

export const FEEDS_DIR = "feeds";
export const FEED_STATE_FILE = "_state.json";

/** Where retrieval state for NON-feed collections with an `ingest` block
 *  (`kind: "agent"`) lives — one file per collection, OUTSIDE the collection's
 *  dataDir (where `listItems` would read it as a record) and outside `feeds/`
 *  (a schema-less `feeds/<slug>/` dir confuses feed discovery). Mirrors the
 *  host's `WORKSPACE_DIRS.ingestState`. */
export const INGEST_STATE_DIR = "data/ingest-state";

/** Absolute path to the feeds registry root for a workspace. */
export function feedsRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, FEEDS_DIR);
}

/** Absolute path to one feed's directory (`<root>/<slug>/`). */
export function feedDir(slug: string, workspaceRoot: string): string {
  return path.join(feedsRoot(workspaceRoot), slug);
}

/** Absolute path to one feed's retrieval-state file. */
export function feedStatePath(slug: string, workspaceRoot: string): string {
  return path.join(feedsRoot(workspaceRoot), slug, FEED_STATE_FILE);
}

/** Directory holding retrieval state for NON-feed collections with an
 *  `ingest` block (`kind: "agent"`). One file per collection. */
export function ingestStateDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, INGEST_STATE_DIR);
}

/** Absolute path to a non-feed collection's ingest-state file
 *  (`data/ingest-state/<slug>.json`). Kept OUT of the collection's dataDir
 *  (where `listItems` would read it as a record) and out of `feeds/` (a
 *  schema-less `feeds/<slug>/` dir confuses feed discovery). */
export function ingestStatePath(slug: string, workspaceRoot: string): string {
  return path.join(ingestStateDir(workspaceRoot), `${slug}.json`);
}
