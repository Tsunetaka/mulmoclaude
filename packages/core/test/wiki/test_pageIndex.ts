import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { __resetPageIndexCache, getPageIndex } from "../../src/wiki/server/pageIndex.ts";

// Bump a directory's mtime to the given ms epoch so tests can force
// the cache-invalidation path without waiting on real mtime
// granularity (which is 1-second on some filesystems).
async function setMtime(dir: string, mtimeMs: number): Promise<void> {
  const secs = mtimeMs / 1000;
  await utimes(dir, secs, secs);
}

describe("getPageIndex", () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "wiki-pages-"));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    __resetPageIndexCache();
  });

  it("returns an empty map when the directory is missing", async () => {
    const missing = path.join(dir, "does-not-exist");
    const idx = await getPageIndex(missing);
    assert.equal(idx.slugs.size, 0);
  });

  it("builds a slug → filename map from the dir's .md files", async () => {
    await writeFile(path.join(dir, "sakura-internet.md"), "# Sakura");
    await writeFile(path.join(dir, "gmo-gpu-cloud.md"), "# GMO");
    await writeFile(path.join(dir, "readme.txt"), "not md");

    const idx = await getPageIndex(dir);
    assert.equal(idx.slugs.get("sakura-internet"), "sakura-internet.md");
    assert.equal(idx.slugs.get("gmo-gpu-cloud"), "gmo-gpu-cloud.md");
    // Non-md file ignored.
    assert.equal(idx.slugs.has("readme"), false);
  });

  it("returns the cached map on the second call when mtime hasn't moved", async () => {
    await writeFile(path.join(dir, "alpha.md"), "a");
    const first = await getPageIndex(dir);
    // Same reference means cache hit. If the index were rebuilt a
    // fresh Map would be created.
    const second = await getPageIndex(dir);
    assert.equal(first, second);
  });

  it("rebuilds when the directory mtime advances", async () => {
    await writeFile(path.join(dir, "alpha.md"), "a");
    const first = await getPageIndex(dir);
    assert.ok(first.slugs.has("alpha"));

    // Add a new file + fake the mtime advancing (some filesystems
    // have second-granularity mtimes — bump manually to avoid race).
    await writeFile(path.join(dir, "beta.md"), "b");
    await setMtime(dir, first.mtimeMs + 1000);

    const second = await getPageIndex(dir);
    assert.notEqual(first, second, "cache entry should be rebuilt");
    assert.ok(second.slugs.has("beta"), "new file picked up");
    assert.ok(second.slugs.has("alpha"), "old entry still present");
  });

  it("removes deleted files on rebuild", async () => {
    await writeFile(path.join(dir, "gamma.md"), "g");
    await writeFile(path.join(dir, "delta.md"), "d");
    const first = await getPageIndex(dir);
    assert.ok(first.slugs.has("gamma"));

    await rm(path.join(dir, "gamma.md"));
    await setMtime(dir, first.mtimeMs + 1000);

    const second = await getPageIndex(dir);
    assert.equal(second.slugs.has("gamma"), false);
    assert.ok(second.slugs.has("delta"));
  });

  it("keys the cache per directory — two pages dirs with equal mtime don't cross-contaminate (#1876 Codex P2)", async () => {
    const dirA = await mkdtemp(path.join(tmpdir(), "wiki-A-"));
    const dirB = await mkdtemp(path.join(tmpdir(), "wiki-B-"));
    try {
      await writeFile(path.join(dirA, "alpha-page.md"), "a");
      await writeFile(path.join(dirB, "beta-page.md"), "b");
      // Force identical mtimes so a mtime-only cache would mistakenly
      // serve A's map for B (the bug this guards against).
      await setMtime(dirA, 1_700_000_000_000);
      await setMtime(dirB, 1_700_000_000_000);

      const idxA = await getPageIndex(dirA);
      const idxB = await getPageIndex(dirB);

      assert.ok(idxA.slugs.has("alpha-page"), "dir A resolves its own page");
      assert.ok(idxB.slugs.has("beta-page"), "dir B resolves its own page");
      assert.equal(idxB.slugs.has("alpha-page"), false, "dir B must NOT see dir A's page");
      assert.equal(idxA.slugs.has("beta-page"), false, "dir A must NOT see dir B's page");
    } finally {
      await rm(dirA, { recursive: true, force: true });
      await rm(dirB, { recursive: true, force: true });
    }
  });
});
