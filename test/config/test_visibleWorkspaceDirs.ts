import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isVisibleTopLevel, VISIBLE_TOP_LEVEL_DIRS } from "../../src/config/visibleWorkspaceDirs.js";

describe("isVisibleTopLevel", () => {
  it("returns true for the three whitelisted user-content buckets", () => {
    assert.equal(isVisibleTopLevel("data"), true);
    assert.equal(isVisibleTopLevel("artifacts"), true);
    assert.equal(isVisibleTopLevel("config"), true);
  });

  it("returns false for the known agent-internal top-level dirs", () => {
    assert.equal(isVisibleTopLevel("conversations"), false);
    assert.equal(isVisibleTopLevel("feeds"), false);
  });

  it("returns false for VCS and CI dirs", () => {
    assert.equal(isVisibleTopLevel(".git"), false);
    assert.equal(isVisibleTopLevel(".github"), false);
  });

  it("returns false for an unknown top-level dir — safe-side hiding", () => {
    assert.equal(isVisibleTopLevel("workbench"), false);
    assert.equal(isVisibleTopLevel("scratch"), false);
    assert.equal(isVisibleTopLevel(""), false);
  });

  it("is case-sensitive — 'Data' is not the same as 'data'", () => {
    assert.equal(isVisibleTopLevel("Data"), false);
    assert.equal(isVisibleTopLevel("CONFIG"), false);
  });

  it("does not match a path — only a bare top-level name", () => {
    // Callers pass `node.name`, never `node.path`, so a slashed input
    // is a caller bug. Guard against it silently succeeding.
    assert.equal(isVisibleTopLevel("data/wiki"), false);
    assert.equal(isVisibleTopLevel("/data"), false);
  });
});

describe("VISIBLE_TOP_LEVEL_DIRS", () => {
  it("stays in sync with what the helper accepts", () => {
    for (const name of VISIBLE_TOP_LEVEL_DIRS) {
      assert.equal(isVisibleTopLevel(name), true, `helper should accept whitelisted '${name}'`);
    }
  });

  it("has no duplicates", () => {
    const set = new Set(VISIBLE_TOP_LEVEL_DIRS);
    assert.equal(set.size, VISIBLE_TOP_LEVEL_DIRS.length);
  });
});
