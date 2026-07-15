import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeAncestorDirs, withEntry, withoutEntry } from "../../src/composables/useFileTree.helpers.ts";

// Ancestor directory list a file's lazy-load walk iterates: shallowest
// first, EXCLUDING the file's own leaf, `[]` for a root-level file.

describe("computeAncestorDirs", () => {
  it("returns [] for the empty string", () => {
    assert.deepEqual(computeAncestorDirs(""), []);
  });

  it("returns [] for a single root-level segment (the file itself has no dir)", () => {
    assert.deepEqual(computeAncestorDirs("a"), []);
    assert.deepEqual(computeAncestorDirs("readme.md"), []);
  });

  it("returns the one parent dir for a file one level deep", () => {
    assert.deepEqual(computeAncestorDirs("a/b"), ["a"]);
  });

  it("returns every ancestor dir shallowest-first, excluding the leaf", () => {
    assert.deepEqual(computeAncestorDirs("a/b/c"), ["a", "a/b"]);
    assert.deepEqual(computeAncestorDirs("a/b/c/d.md"), ["a", "a/b", "a/b/c"]);
  });

  it("drops leading slashes as empty segments", () => {
    assert.deepEqual(computeAncestorDirs("/a/b"), ["a"]);
    assert.deepEqual(computeAncestorDirs("/a/b/c"), ["a", "a/b"]);
  });

  it("drops duplicate slashes as empty segments", () => {
    assert.deepEqual(computeAncestorDirs("a//b//c"), ["a", "a/b"]);
  });

  it("treats a slash-only path as having no real segments", () => {
    assert.deepEqual(computeAncestorDirs("/"), []);
    assert.deepEqual(computeAncestorDirs("///"), []);
  });
});

// Copy-on-write Map helpers: a `ref<Map>` only re-renders when the Map
// identity changes, so both MUST return a fresh Map and never mutate the
// input.

describe("withEntry", () => {
  it("returns a NEW Map with the key set, leaving the input untouched", () => {
    const original = new Map<string, number>([["a", 1]]);
    const next = withEntry(original, "b", 2);
    assert.notEqual(next, original);
    assert.deepEqual(
      [...next],
      [
        ["a", 1],
        ["b", 2],
      ],
    );
    assert.deepEqual([...original], [["a", 1]]);
  });

  it("overwrites an existing key on the copy only", () => {
    const original = new Map<string, number>([["a", 1]]);
    const next = withEntry(original, "a", 9);
    assert.equal(next.get("a"), 9);
    assert.equal(original.get("a"), 1);
  });
});

describe("withoutEntry", () => {
  it("returns a NEW Map without the key, leaving the input untouched", () => {
    const original = new Map<string, number>([
      ["a", 1],
      ["b", 2],
    ]);
    const next = withoutEntry(original, "a");
    assert.notEqual(next, original);
    assert.deepEqual([...next], [["b", 2]]);
    assert.deepEqual(
      [...original],
      [
        ["a", 1],
        ["b", 2],
      ],
    );
  });

  it("is a no-op copy when the key is absent", () => {
    const original = new Map<string, number>([["a", 1]]);
    const next = withoutEntry(original, "missing");
    assert.notEqual(next, original);
    assert.deepEqual([...next], [["a", 1]]);
  });
});
