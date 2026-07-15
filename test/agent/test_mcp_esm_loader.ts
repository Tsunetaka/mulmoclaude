// Unit tests for the ESM resolver hook that plugs the Windows-Docker
// junction gap for ESM callers (#1982).
//
// The runtime hook itself is tested at the Node-loader integration
// level by `test/sandbox-repro/probe.ts` inside the Windows CI Docker
// job. Here we cover the pure helpers: specifier splitting, entry
// picking, and the file-system-anchored fallback resolver.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { splitScopedSpecifier, pickEntry, resolveFromFallback } from "../../server/agent/mcp-esm-loader.mjs";

describe("splitScopedSpecifier", () => {
  it("splits a bare @mulmoclaude package into pkg + '.' subpath", () => {
    assert.deepEqual(splitScopedSpecifier("@mulmoclaude/x-plugin"), {
      pkg: "@mulmoclaude/x-plugin",
      subpath: ".",
    });
  });

  it("splits a subpath specifier into pkg + './sub' subpath", () => {
    assert.deepEqual(splitScopedSpecifier("@mulmoclaude/core/util/log"), {
      pkg: "@mulmoclaude/core",
      subpath: "./util/log",
    });
  });

  // #2052: the loader hardcoded `@mulmoclaude/`. yarn junctions EVERY workspace
  // package, so `@mulmobridge/protocol` — which the MCP child reaches through
  // src/types/events.ts — dangled on Windows with no fallback and killed the
  // server at load.
  it("handles any workspace scope, not just @mulmoclaude", () => {
    assert.deepEqual(splitScopedSpecifier("@mulmobridge/protocol"), {
      pkg: "@mulmobridge/protocol",
      subpath: ".",
    });
    assert.deepEqual(splitScopedSpecifier("@receptron/task-scheduler/sub"), {
      pkg: "@receptron/task-scheduler",
      subpath: "./sub",
    });
  });
});

describe("pickEntry", () => {
  it("returns the string exports value when subpath is '.'", () => {
    assert.equal(pickEntry({ exports: "./dist/index.js" }, "."), "./dist/index.js");
  });

  it("returns null for a subpath when exports is a bare string (only '.' is valid)", () => {
    assert.equal(pickEntry({ exports: "./dist/index.js" }, "./sub"), null);
  });

  it("returns the ./sub value from an object exports map", () => {
    assert.equal(pickEntry({ exports: { ".": "./a.js", "./sub": "./b.js" } }, "./sub"), "./b.js");
  });

  it("prefers exports['.'].import.default over .default", () => {
    const manifest = {
      exports: { ".": { import: { default: "./dist/esm/index.js" }, default: "./dist/legacy.js" } },
    };
    assert.equal(pickEntry(manifest, "."), "./dist/esm/index.js");
  });

  it("falls back to exports['.'].default when import is missing", () => {
    assert.equal(pickEntry({ exports: { ".": { default: "./dist/legacy.js" } } }, "."), "./dist/legacy.js");
  });

  it("falls back to `main` when exports is absent and subpath is '.'", () => {
    assert.equal(pickEntry({ main: "./dist/index.js" }, "."), "./dist/index.js");
  });

  it("returns null when no entry matches", () => {
    assert.equal(pickEntry({ exports: { ".": "./a.js" } }, "./missing"), null);
    assert.equal(pickEntry({}, "."), null);
  });
});

describe("resolveFromFallback (fs-anchored)", () => {
  let tmpDir = "";
  let fallbackRoot = "";

  before(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "mulmo-esm-loader-"));
    fallbackRoot = path.join(tmpDir, "pkg_modules");
    // A pretend `@mulmoclaude/foo-plugin` with an exports.import.default entry.
    const pkgDir = path.join(fallbackRoot, "@mulmoclaude", "foo-plugin");
    mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
    writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@mulmoclaude/foo-plugin",
        exports: { ".": { import: { default: "./dist/index.js" } } },
      }),
    );
    writeFileSync(path.join(pkgDir, "dist", "index.js"), "export const x = 1;\n");
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns a file:// URL to the resolved entry when the package + entry both exist", () => {
    const url = resolveFromFallback("@mulmoclaude/foo-plugin", ".", fallbackRoot);
    assert.equal(url, pathToFileURL(path.join(fallbackRoot, "@mulmoclaude", "foo-plugin", "dist", "index.js")).href);
  });

  it("returns null when the package.json is missing", () => {
    assert.equal(resolveFromFallback("@mulmoclaude/nope-plugin", ".", fallbackRoot), null);
  });

  it("returns null when the entry file itself is missing on disk", () => {
    const pkgDir = path.join(fallbackRoot, "@mulmoclaude", "broken-plugin");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ main: "./dist/missing.js" }));
    assert.equal(resolveFromFallback("@mulmoclaude/broken-plugin", ".", fallbackRoot), null);
  });

  it("returns null when the package.json is unparseable", () => {
    const pkgDir = path.join(fallbackRoot, "@mulmoclaude", "corrupt-plugin");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(path.join(pkgDir, "package.json"), "{ not valid json");
    assert.equal(resolveFromFallback("@mulmoclaude/corrupt-plugin", ".", fallbackRoot), null);
  });
});
