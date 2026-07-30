import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeStoryPath, slugify, storyFilePath } from "../src/core/paths";

describe("slugify", () => {
  it("collapses punctuation and case", () => {
    assert.equal(slugify("The Life of a Star!"), "the-life-of-a-star");
  });

  it("falls back for empty / undefined / non-ASCII-only input", () => {
    assert.equal(slugify(undefined), "story");
    assert.equal(slugify(""), "story");
    assert.equal(slugify("星の一生"), "story");
  });

  it("strips leading/trailing hyphens", () => {
    assert.equal(slugify("--hello--"), "hello");
  });
});

describe("storyFilePath", () => {
  it("builds stories/<slug>-<epoch>.json", () => {
    const now = new Date(1700000000000);
    assert.equal(storyFilePath("My Story", now), "stories/my-story-1700000000000.json");
  });
});

describe("normalizeStoryPath", () => {
  it("accepts the canonical stories/ form", () => {
    assert.equal(normalizeStoryPath("stories/foo.json"), "stories/foo.json");
  });

  it("accepts a bare filename and re-roots it under stories/", () => {
    assert.equal(normalizeStoryPath("foo.json"), "stories/foo.json");
  });

  it("accepts nested paths", () => {
    assert.equal(normalizeStoryPath("stories/__movies__/bar.mp4"), "stories/__movies__/bar.mp4");
  });

  it("accepts the workspace-relative artifacts/stories/ spelling", () => {
    assert.equal(normalizeStoryPath("artifacts/stories/foo.json"), "stories/foo.json");
    assert.equal(normalizeStoryPath("artifacts/stories/__movies__/bar.mp4"), "stories/__movies__/bar.mp4");
  });

  it("keeps a bare artifacts/ segment as a name under stories/", () => {
    assert.equal(normalizeStoryPath("artifacts/foo.json"), "stories/artifacts/foo.json");
  });

  it("rejects artifacts/stories with no remainder", () => {
    assert.equal(normalizeStoryPath("artifacts/stories"), null);
  });

  it("rejects traversal, absolute, and non-canonical segments", () => {
    assert.equal(normalizeStoryPath("../secrets.json"), null);
    assert.equal(normalizeStoryPath("stories/../../etc/passwd"), null);
    assert.equal(normalizeStoryPath("/etc/passwd"), null);
    assert.equal(normalizeStoryPath("C:/windows/system32"), null);
    assert.equal(normalizeStoryPath("stories//foo.json"), null);
    assert.equal(normalizeStoryPath("stories/./foo.json"), null);
    assert.equal(normalizeStoryPath("stories\\foo.json"), null);
    assert.equal(normalizeStoryPath(""), null);
    assert.equal(normalizeStoryPath("stories"), null);
  });
});
