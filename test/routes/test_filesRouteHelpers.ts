// Unit tests for the pure helpers extracted from the `/api/files`
// route handlers: `buildGitignoreFilterChain` (walks the .gitignore
// chain from the workspace root down to a directory) and
// `decideContentResponse` (maps a classified file kind + byte size to
// the metadata-only preview response, or null to read as text).

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildGitignoreFilterChain, decideContentResponse } from "../../server/api/routes/files.js";

const KIB = 1024;
const MIB = 1024 * KIB;
const MAX_PREVIEW_BYTES = MIB;
const MAX_RAW_BYTES = 50 * MIB;

const META = { path: "dir/file.bin", size: 0, modifiedMs: 42 };
const metaOf = (size: number) => ({ ...META, size });

describe("buildGitignoreFilterChain", () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), "files-gitignore-"));
    // root/.gitignore is intentionally IGNORED by the chain (the
    // workspace root .gitignore is for git, not the Files UI).
    await writeFile(path.join(root, ".gitignore"), "*.secret\n");
    await mkdir(path.join(root, "a", "b"), { recursive: true });
    await writeFile(path.join(root, "a", ".gitignore"), "*.log\n");
    await writeFile(path.join(root, "a", "b", ".gitignore"), "*.tmp\n");
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns undefined when the target IS the root (no segments to walk)", () => {
    assert.equal(buildGitignoreFilterChain(root, root), undefined);
  });

  it("applies a sub-directory's own .gitignore", () => {
    const filter = buildGitignoreFilterChain(root, path.join(root, "a"));
    assert.ok(filter);
    assert.equal(filter.ignores("a/debug.log"), true);
    assert.equal(filter.ignores("a/debug.txt"), false);
  });

  it("inherits parent-directory rules down the chain", () => {
    const filter = buildGitignoreFilterChain(root, path.join(root, "a", "b"));
    assert.ok(filter);
    // From a/.gitignore (inherited) and b/.gitignore (local).
    assert.equal(filter.ignores("a/b/keep.log"), true);
    assert.equal(filter.ignores("a/b/scratch.tmp"), true);
    assert.equal(filter.ignores("a/b/keep.md"), false);
  });

  it("does NOT apply the workspace root .gitignore", () => {
    const filter = buildGitignoreFilterChain(root, path.join(root, "a"));
    assert.ok(filter);
    assert.equal(filter.ignores("a/token.secret"), false);
  });
});

describe("decideContentResponse", () => {
  it("returns null for small text so the caller reads it as text", () => {
    assert.equal(decideContentResponse("text", metaOf(100)), null);
  });

  it("returns null for text at exactly the preview byte cap (strict >)", () => {
    assert.equal(decideContentResponse("text", metaOf(MAX_PREVIEW_BYTES)), null);
  });

  it("returns metadata-only (no message) for previewable media kinds", () => {
    for (const kind of ["image", "pdf", "audio", "video"] as const) {
      const result = decideContentResponse(kind, metaOf(100));
      assert.ok(result);
      assert.equal(result.kind, kind);
      assert.equal("message" in result, false);
      assert.equal(result.path, META.path);
      assert.equal(result.modifiedMs, META.modifiedMs);
    }
  });

  it("returns a binary message for binary files", () => {
    const result = decideContentResponse("binary", metaOf(100));
    assert.ok(result);
    assert.equal(result.kind, "binary");
    assert.equal(result.message, "Binary file — preview not supported");
  });

  it("flags oversized text with the text-specific message", () => {
    const size = 2 * MIB; // above preview cap, below the raw cap
    const result = decideContentResponse("text", metaOf(size));
    assert.ok(result);
    assert.equal(result.kind, "too-large");
    assert.equal(result.message, `Text file too large to preview (${size} bytes)`);
  });

  it("flags files past the raw byte cap with the generic message", () => {
    const size = MAX_RAW_BYTES + 1;
    const result = decideContentResponse("image", metaOf(size));
    assert.ok(result);
    assert.equal(result.kind, "too-large");
    assert.equal(result.message, `File too large to preview (${size} bytes)`);
  });
});
