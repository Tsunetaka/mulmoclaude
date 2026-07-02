// In-memory index of `<pagesDir>/*.md` keyed by slug (= filename
// without the `.md` extension). Kept fresh via `pagesDir` mtime —
// adding, removing, or renaming a file under `pagesDir` advances the
// directory's mtime on every major filesystem we target (macOS APFS,
// Linux ext4, Windows NTFS), so one cheap `stat()` per request is
// enough to decide whether to rebuild.

import { readDirSafeAsync, statSafeAsync } from "./fs.js";

export interface PageIndex {
  mtimeMs: number;
  /** slug → filename (e.g. "sakura-internet" → "sakura-internet.md"). */
  slugs: Map<string, string>;
}

// Keyed by `pagesDir`: the engine is workspace-injected and may be
// called with more than one pages directory in a single process. A
// single global slot would let one workspace's slug map be returned
// for another whenever their mtimes happen to tie (Codex P2 on #1876).
const cache = new Map<string, PageIndex>();

/**
 * Get the page index for `pagesDir`. Returns a cached value as long as
 * THAT directory's mtime hasn't advanced; otherwise rebuilds. Safe to
 * call concurrently — racing builds produce the same result.
 */
export async function getPageIndex(pagesDir: string): Promise<PageIndex> {
  const stat = await statSafeAsync(pagesDir);
  if (!stat) {
    // Dir doesn't exist yet (never ingested). Return empty but don't
    // cache a stale-forever value — the next call re-stats.
    return { mtimeMs: 0, slugs: new Map() };
  }
  const cached = cache.get(pagesDir);
  if (cached && cached.mtimeMs >= stat.mtimeMs) return cached;
  const entries = await readDirSafeAsync(pagesDir);
  const slugs = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const { name } = entry;
    if (!name.endsWith(".md")) continue;
    slugs.set(name.slice(0, -".md".length), name);
  }
  const built: PageIndex = { mtimeMs: stat.mtimeMs, slugs };
  cache.set(pagesDir, built);
  return built;
}

/** Test-only: drop the module-level cache (all directories). */
export function __resetPageIndexCache(): void {
  cache.clear();
}
