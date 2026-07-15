// Windows + Docker sandbox regression probe (#1946 / #1982).
//
// Runs INSIDE a Linux Docker container spawned from a Windows host by
// `.github/workflows/docker_sandbox_windows.yaml`, via tsx. Reproduces
// the exact bind-mount layout the mulmoclaude sandbox uses and:
//
//   1. asserts the environment reproduces the bug (primary NTFS
//      junction dangles as a Linux symlink to a Windows-style target
//      that doesn't exist inside the container)
//   2. asserts the shipped `resolvePresetRoot()` — imported from
//      `server/plugins/resolvePresetRoot.ts` — finds every preset
//      package via the NODE_PATH fallback
//
// Because the probe imports the SHIPPED resolver rather than an inline
// copy, breaking the fix in production breaks the probe. That's the
// point — this is regression coverage, not a canary of the probe's own
// inline code.
//
// Required container mounts (see the workflow for the full argv):
//   /app/node_modules                              — Windows FS via WSL2 (primary,
//                                                    junctions dangle here)
//   /app/pkg_modules/@mulmoclaude/<name>           — Windows FS per package (fallback)
//   /app/server-plugins                            — Windows FS: server/plugins/
//   /app/server/agent/mcp-esm-loader.mjs           — Windows FS: the ESM resolver hook
//                                                    (#1982) — resolve() live here
//   /app/server/agent/mcp-esm-bootstrap.mjs        — bootstrap that calls
//                                                    node:module.register(loader)
//   /repro                                         — Windows FS: test/sandbox-repro/
// NODE_PATH=/app/node_modules:/app/pkg_modules
//
// Runs on: node:22-slim + a global `tsx` install so this TS file can
// import the shipped `.ts` source directly. The workflow launches with
// `tsx --import file:///app/server/agent/mcp-esm-bootstrap.mjs` — the
// bootstrap registers the loader so the ESM step below exercises the
// shipped resolve hook end-to-end.
//
// The sibling `test/sandbox-repro/package.json` (`{ "type": "module" }`)
// is mounted as `/repro/package.json` so tsx transforms this probe as
// ESM — matching the real MCP server (ESM via the app's type:module
// package.json) and enabling the top-level `await` in the ESM check
// below. Without it, tsx treats an ambiguous `.ts` as CJS and esbuild
// rejects top-level await (`"cjs" output format`) — which broke this
// canary when an unpinned global `tsx` upgrade flipped that default.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { resolvePresetRoot } from "/app/server-plugins/resolvePresetRoot.ts";
// The list the shipped preset-loader ACTUALLY iterates over. Iterating
// this same list keeps the probe locked to production behavior — adding
// or removing a preset in preset-list.ts automatically extends the
// regression coverage here. A previous version of the probe hardcoded a
// package list that drifted (missed edgar/email, included non-preset
// entries like x-plugin/core); Codex flagged this on PR #1984.
import { PRESET_PLUGINS } from "/app/server-plugins/preset-list.ts";

const localRequire = createRequire(import.meta.url);

let failures = 0;
function step(name: string, check: () => void): void {
  try {
    check();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures++;
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  FAIL  ${name}\n        ${message}`);
  }
}

// Legacy parent-walk-only implementation — matches server/plugins/preset-loader.ts
// BEFORE PR #1984's fix. Kept inline so the probe can confirm the environment
// actually reproduces the bug (this walker MUST return null for @mulmoclaude/*
// inside the container). If a future runner or WSL2 update stops dangling the
// junction, this check fails loudly and tells us the whole probe stopped
// exercising the failure mode.
function resolvePresetRoot_legacy(packageName: string, startDir: string): string | null {
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, "node_modules", packageName);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ── 1. Environment sanity — the sandbox mount layout ──────────────────

step("primary /app/node_modules/@mulmoclaude/x-plugin dangles inside the container", () => {
  const primary = "/app/node_modules/@mulmoclaude/x-plugin/package.json";
  if (existsSync(primary)) {
    throw new Error("primary path resolves — junction did not dangle, env not reproducing #1946");
  }
});

step("fallback /app/pkg_modules/@mulmoclaude/x-plugin/package.json is present", () => {
  const fallback = "/app/pkg_modules/@mulmoclaude/x-plugin/package.json";
  if (!existsSync(fallback)) throw new Error("fallback mount missing from container");
});

// ── 2. Node's built-in resolver honours NODE_PATH ─────────────────────

step("Node's own resolver includes the NODE_PATH fallback root", () => {
  const paths = localRequire.resolve.paths("@mulmoclaude/x-plugin");
  if (!paths || !paths.includes("/app/pkg_modules")) {
    throw new Error(`resolve.paths did not include /app/pkg_modules; got: ${JSON.stringify(paths)}`);
  }
});

// ── 3. Bug-environment confirmation — the parent-walk-only implementation must fail ─

step("legacy parent-walk resolver returns null for @mulmoclaude/spotify-plugin (proves env reproduces the bug)", () => {
  const resolved = resolvePresetRoot_legacy("@mulmoclaude/spotify-plugin", "/app/server-plugins");
  if (resolved !== null) throw new Error(`legacy walker unexpectedly resolved to ${resolved}`);
});

// ── 4. Shipped resolver — MUST resolve every preset via the fallback ──

if (PRESET_PLUGINS.length === 0) {
  failures++;
  console.log("  FAIL  PRESET_PLUGINS is empty — nothing to verify, and the shipped preset-loader has nothing to load");
}
for (const preset of PRESET_PLUGINS) {
  step(`shipped resolvePresetRoot() finds ${preset.packageName} via NODE_PATH`, () => {
    const resolved = resolvePresetRoot(preset.packageName);
    if (resolved === null) throw new Error(`shipped resolver returned null — fallback path did not resolve`);
    if (!resolved.startsWith("/app/pkg_modules/")) throw new Error(`resolved outside fallback root: ${resolved}`);
  });
}

step("shipped resolvePresetRoot() returns null for a non-existent preset name", () => {
  const resolved = resolvePresetRoot("@mulmoclaude/definitely-does-not-exist-plugin");
  if (resolved !== null) throw new Error(`shipped resolver returned ${resolved} for a non-existent package`);
});

// ── 5. ESM path — the class of bug that #1982 fixed ───────────────────
// The workflow launches this file with `tsx --import <mcp-esm-loader>`
// so the loader is registered on this process. Dynamic `import()` goes
// through the same ESM resolver chain the failing MCP server used
// (`server/agent/mcp-tools/index.ts:2` static import). Without the
// loader (or with a regression), Node's ESM resolver would fail on the
// dangling `@mulmoclaude/*` junction — NODE_PATH does not help ESM.

async function esmImportCheck(): Promise<void> {
  try {
    // Bare specifier is critical: this is the shape production code
    // uses and the exact shape that fails without the loader.
    const mod = await import("@mulmoclaude/x-plugin");
    if (typeof mod !== "object" || mod === null) {
      throw new Error(`ESM import returned non-object: ${typeof mod}`);
    }
  } catch (err) {
    throw new Error(`ESM import failed — loader hook not effective. ${err instanceof Error ? err.message : String(err)}`);
  }
}
try {
  await esmImportCheck();
  console.log("  ok    ESM import('@mulmoclaude/x-plugin') resolves via mcp-esm-loader");
} catch (err) {
  failures++;
  const message = err instanceof Error ? err.message : String(err);
  console.log(`  FAIL  ESM import('@mulmoclaude/x-plugin') resolves via mcp-esm-loader\n        ${message}`);
}

// ──────────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
