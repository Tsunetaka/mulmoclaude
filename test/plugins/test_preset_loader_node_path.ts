// Verifies that `resolvePresetRoot()` in server/plugins/preset-loader.ts
// consults NODE_PATH (via Node's own `require.resolve.paths()`), closing
// the #1982 gap that was left over from the #1946 fix (PR #1974).
//
// The real bug only reproduces on Windows + Docker sandbox (an absolute
// NTFS junction inside node_modules dangles when the workspace is
// bind-mounted into a Linux container). The RESOLUTION happens in Node,
// so a POSIX host can exercise the exact code path with a dangling
// symlink stand-in. Skipped on a Windows host — creating symlinks there
// needs elevated privileges and, more importantly, the CI coverage for
// the real Windows-host + Docker-Linux-container path lives in
// `.github/workflows/docker_sandbox_windows.yaml`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const SKIP = process.platform === "win32";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const localRequire = createRequire(import.meta.url);
// Absolute path to the file under test; resolved relative to this test so
// the same command works whether the runner cwds to the repo root or elsewhere.
const PRESET_LOADER_PATH = resolve(__dirname, "..", "..", "server", "plugins", "preset-loader.ts");
// Absolute path to tsx's loader entry (`./dist/loader.mjs` per its exports
// map) so `--import` in the child resolves regardless of the child's cwd —
// the isolated tmp cwds we spawn from don't have tsx on their resolution
// path, which would otherwise ERR_MODULE_NOT_FOUND at startup.
const TSX_LOADER_PATH = localRequire.resolve("tsx");

// Spawn a child Node process so NODE_PATH is honoured — the env var is
// read once at startup, so setting `process.env.NODE_PATH` in the parent
// test process is a no-op. tsx's loader is attached via `--import` so
// the child can `import` the .ts source directly (mirrors how the server
// tsx-runs it in production).
function runResolveInChild(nodePath: string, packageName: string, cwd: string): string {
  const loaderUrl = pathToFileURL(PRESET_LOADER_PATH).href;
  const script = `
    const { resolvePresetRoot } = await import(${JSON.stringify(loaderUrl)});
    const r = resolvePresetRoot(${JSON.stringify(packageName)});
    process.stdout.write(r === null ? "NULL" : r);
  `;
  const tsxLoaderUrl = pathToFileURL(TSX_LOADER_PATH).href;
  return execFileSync(process.execPath, ["--import", tsxLoaderUrl, "--input-type=module", "-e", script], {
    cwd,
    env: { ...process.env, NODE_PATH: nodePath },
    encoding: "utf-8",
  });
}

describe("resolvePresetRoot NODE_PATH fallback (#1982)", { skip: SKIP }, () => {
  it("finds a preset package via NODE_PATH when the primary walk fails to reach it", () => {
    const root = mkdtempSync(join(tmpdir(), "mc-preset-nodepath-"));
    try {
      // fallback root: NODE_PATH points here, the "real" package lives inside.
      const fallback = join(root, "pkg_modules");
      const real = join(fallback, "@mock", "preset");
      mkdirSync(real, { recursive: true });
      writeFileSync(join(real, "package.json"), JSON.stringify({ name: "@mock/preset", version: "1.0.0" }));

      // Run the resolver from an isolated cwd so the parent walk can't hit
      // the repo's real `node_modules`. This proves the NODE_PATH branch
      // actually did the work.
      const isolatedCwd = mkdtempSync(join(tmpdir(), "mc-preset-cwd-"));
      try {
        const out = runResolveInChild(fallback, "@mock/preset", isolatedCwd);
        assert.equal(out, real, `resolver should have returned the fallback path, got ${out}`);
      } finally {
        rmSync(isolatedCwd, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips a dangling primary link and falls through to NODE_PATH (the Windows-junction case in POSIX terms)", () => {
    const root = mkdtempSync(join(tmpdir(), "mc-preset-dangling-"));
    try {
      // Primary: a dangling symlink at cwd/node_modules/@mock/preset. In
      // the real bug this is a Windows NTFS junction whose target is
      // reachable on the host but not inside the Linux container.
      const primary = join(root, "node_modules");
      mkdirSync(join(primary, "@mock"), { recursive: true });
      symlinkSync(join(root, "absent-target"), join(primary, "@mock", "preset"));

      // Fallback root that NODE_PATH points at.
      const fallback = join(root, "pkg_modules");
      const real = join(fallback, "@mock", "preset");
      mkdirSync(real, { recursive: true });
      writeFileSync(join(real, "package.json"), JSON.stringify({ name: "@mock/preset", version: "1.0.0" }));

      // cwd is `root`, so the parent walk hits `root/node_modules/@mock/preset`
      // (the dangling symlink) first — `existsSync` returns false for it,
      // so the resolver should move on and try the NODE_PATH entry.
      const out = runResolveInChild(fallback, "@mock/preset", root);
      assert.equal(out, real, `resolver should have skipped the dangling primary and found the fallback, got ${out}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns NULL when neither the parent walk nor NODE_PATH contains the package", () => {
    const isolatedCwd = mkdtempSync(join(tmpdir(), "mc-preset-cwd-"));
    const emptyFallback = mkdtempSync(join(tmpdir(), "mc-preset-empty-"));
    try {
      const out = runResolveInChild(emptyFallback, "@mock/definitely-does-not-exist", isolatedCwd);
      assert.equal(out, "NULL", `expected NULL for a missing package, got ${out}`);
    } finally {
      rmSync(isolatedCwd, { recursive: true, force: true });
      rmSync(emptyFallback, { recursive: true, force: true });
    }
  });
});
