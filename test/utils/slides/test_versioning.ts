import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextIncrement, nextBranch, allowedOps, formatVersion, releasedVersionFromFilename } from "../../../src/utils/slides/versioning.js";

// ── nextIncrement ─────────────────────────────────────────────────────────────

describe("nextIncrement", () => {
  it("bumps a single-segment version to the sibling max + 1", () => {
    assert.equal(nextIncrement("v013", ["v013", "v001"]), "v014");
  });

  it("uses the sibling max, not the selected version, so a non-latest pick still avoids collision", () => {
    assert.equal(nextIncrement("v001", ["v005", "v001"]), "v006");
  });

  it("bumps only the last segment of a branch version, holding the prefix", () => {
    assert.equal(nextIncrement("v002-001", ["v002-001"]), "v002-002");
  });

  it("ignores siblings of a different prefix when incrementing a branch", () => {
    assert.equal(nextIncrement("v002-001", ["v002-001", "v003-009", "v002-001-005"]), "v002-002");
  });

  it("considers base itself even when absent from siblings", () => {
    assert.equal(nextIncrement("v013", []), "v014");
  });

  it("ignores non-version strings in the sibling set", () => {
    assert.equal(nextIncrement("v001", ["ReleasedVersion", "notes", "v004"]), "v005");
  });
});

// ── nextBranch ────────────────────────────────────────────────────────────────

describe("nextBranch", () => {
  it("adds -001 when the base has no branches yet", () => {
    assert.equal(nextBranch("v001", []), "v001-001");
  });

  it("adds a branch to a released version regardless of increment siblings", () => {
    assert.equal(nextBranch("v013", ["v013", "v001"]), "v013-001");
  });

  it("uses the max existing branch + 1", () => {
    assert.equal(nextBranch("v001", ["v001-001", "v001-002"]), "v001-003");
  });

  it("nests a further branch level under a branch version", () => {
    assert.equal(nextBranch("v002-001", ["v002-001"]), "v002-001-001");
  });

  it("does not count deeper siblings as direct branches", () => {
    assert.equal(nextBranch("v001", ["v001-001-009"]), "v001-001");
  });
});

// ── allowedOps ────────────────────────────────────────────────────────────────

describe("allowedOps", () => {
  it("forbids continue for released-derived edits", () => {
    assert.deepEqual(allowedOps("released"), ["increment", "branch"]);
  });

  it("allows continue for editing-derived edits", () => {
    assert.deepEqual(allowedOps("editing"), ["increment", "branch", "continue"]);
  });
});

// ── formatVersion ─────────────────────────────────────────────────────────────

describe("formatVersion", () => {
  it("zero-pads the base segment", () => {
    assert.equal(formatVersion([7]), "v007");
  });

  it("zero-pads branch segments", () => {
    assert.equal(formatVersion([2, 1, 12]), "v002-001-012");
  });
});

// ── releasedVersionFromFilename ───────────────────────────────────────────────

describe("releasedVersionFromFilename", () => {
  it("extracts the version from a dated filename", () => {
    assert.equal(releasedVersionFromFilename("GIT-00003 タイトル_20260620_v013.pptx"), "v013");
  });

  it("extracts the version from an undated filename", () => {
    assert.equal(releasedVersionFromFilename("GIT-00003 タイトル_v005.pptx"), "v005");
  });

  it("returns null when no version marker is present", () => {
    assert.equal(releasedVersionFromFilename("random.pptx"), null);
  });
});
