// Unit tests for `resolveArtifactRequestPath` and `makeCachedRealpath`,
// the shared plumbing behind the `/artifacts/{images,html,svg}` static
// mounts. The three mounts used to inline the same decode + traversal +
// dotfile guard; these lock the extracted helper's behaviour so a future
// change can't silently loosen one mount's path safety.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { resolveArtifactRequestPath, makeCachedRealpath } from "../../../server/utils/files/safe.ts";

let rootDir: string;
let rootReal: string;

before(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), "mulmoclaude-artifact-guard-"));
  rootReal = await realpath(rootDir);
  await writeFile(path.join(rootReal, "img.png"), "x");
  await mkdir(path.join(rootReal, "sub"), { recursive: true });
  await writeFile(path.join(rootReal, "sub", "nested.png"), "x");
  await writeFile(path.join(rootReal, ".hidden.png"), "x");
  await mkdir(path.join(rootReal, ".secret"), { recursive: true });
  await writeFile(path.join(rootReal, ".secret", "in.png"), "x");
});

after(async () => {
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
});

describe("resolveArtifactRequestPath — accepts in-root files", () => {
  it("returns the decoded relPath for a flat file", () => {
    assert.equal(resolveArtifactRequestPath(rootReal, "/img.png", false), "img.png");
  });

  it("returns the decoded relPath for a nested file", () => {
    assert.equal(resolveArtifactRequestPath(rootReal, "/sub/nested.png", false), "sub/nested.png");
  });

  it("decodes percent-encoded segments", () => {
    assert.equal(resolveArtifactRequestPath(rootReal, "/sub%2Fnested.png", false), "sub/nested.png");
  });
});

describe("resolveArtifactRequestPath — rejects", () => {
  it("returns null for a malformed percent-escape (fail closed, no throw)", () => {
    assert.equal(resolveArtifactRequestPath(rootReal, "/%ZZ.png", false), null);
    assert.equal(resolveArtifactRequestPath(rootReal, "/%.png", false), null);
  });

  it("returns null for a traversal escape", () => {
    assert.equal(resolveArtifactRequestPath(rootReal, "/../outside.png", false), null);
  });

  it("returns null for a file that does not exist on disk", () => {
    assert.equal(resolveArtifactRequestPath(rootReal, "/missing.png", false), null);
  });
});

describe("resolveArtifactRequestPath — dotfile policy", () => {
  it("rejects a dotfile when denyDotfiles is true", () => {
    assert.equal(resolveArtifactRequestPath(rootReal, "/.hidden.png", true), null);
    assert.equal(resolveArtifactRequestPath(rootReal, "/.secret/in.png", true), null);
  });

  it("allows the same dotfile when denyDotfiles is false (images mount defers to express.static)", () => {
    assert.equal(resolveArtifactRequestPath(rootReal, "/.hidden.png", false), ".hidden.png");
  });

  it("rejects a dotfile hidden behind an encoded backslash on the deny path", () => {
    assert.equal(resolveArtifactRequestPath(rootReal, "/sub%5C.hidden.png", true), null);
  });
});

describe("makeCachedRealpath", () => {
  it("resolves and caches the directory's realpath", async () => {
    const get = makeCachedRealpath(rootDir);
    assert.equal(await get(), rootReal);
    assert.equal(await get(), rootReal);
  });

  it("returns null until the directory exists, then resolves once created", async () => {
    const missing = path.join(rootReal, "not-yet");
    const get = makeCachedRealpath(missing);
    assert.equal(await get(), null);
    await mkdir(missing, { recursive: true });
    assert.equal(await get(), await realpath(missing));
  });
});
