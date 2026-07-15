// ESM resolver hook installed via `tsx --import ...` on the Docker
// sandbox MCP child (#1982).
//
// Problem: NODE_PATH is a CJS-only mechanism (Node's ESM resolver
// never consults it — per spec). On Windows the yarn-workspace
// `node_modules/@mulmoclaude/*` links are NTFS junctions that dangle
// inside the Linux container; PR #1974 added `/app/pkg_modules/*` as
// a NODE_PATH fallback which fixed CJS, but static ESM imports like
// `import { readXPost } from "@mulmoclaude/x-plugin"` in
// `server/agent/mcp-tools/index.ts` fail before any of that fires,
// because the ESM loader has no equivalent to NODE_PATH.
//
// Fix: when a scoped specifier fails default resolution, read the
// corresponding package.json under `/app/pkg_modules/` and return the
// resolved entry file URL. Supports both exports-map and legacy `main`
// shapes, plus subpath imports (`@scope/pkg/sub`). Any scope, because
// yarn junctions every workspace package — `@mulmobridge/protocol`
// dangles on Windows exactly like `@mulmoclaude/*` (#2052).
//
// No-op on Linux/macOS Docker (primary resolution succeeds via POSIX
// symlinks in `/app/node_modules`, the catch never fires). Only
// registered when the MCP child is spawned in Docker mode (config.ts:
// buildMulmoclaudeServer). Native (DISABLE_SANDBOX) mode never loads
// this file.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FALLBACK_ROOT = "/app/pkg_modules";

// Exported for the unit test (test/agent/test_mcp_esm_loader.ts). The
// runtime hook does not consume the export.
//
// Any scope, not just `@mulmoclaude/`: yarn junctions every workspace package,
// so `@mulmobridge/protocol` dangles on Windows exactly like `@mulmoclaude/*`
// does. Hardcoding one scope here mirrored the same omission in config.ts's
// `scopedPackageName`, and left the MCP child unable to load (#2052).
export function splitScopedSpecifier(specifier) {
  const parts = specifier.split("/");
  const pkg = `${parts[0]}/${parts[1]}`;
  const subpath = parts.length > 2 ? `./${parts.slice(2).join("/")}` : ".";
  return { pkg, subpath };
}

// Walk a conditional-export block preferring `import.default` >
// `import` > `default`, matching Node's conditional-export precedence
// for the "import" condition set.
function pickConditional(entry) {
  const importCond = entry.import;
  if (typeof importCond === "string") return importCond;
  if (importCond && typeof importCond === "object" && typeof importCond.default === "string") {
    return importCond.default;
  }
  return typeof entry.default === "string" ? entry.default : null;
}

// Pick an entry file for the given subpath from a package.json's
// `exports` or `main`. Handles the shapes we actually ship:
//   - `"exports": "./dist/index.js"`
//   - `"exports": { ".": "./dist/index.js" }`
//   - `"exports": { ".": { "import": "./dist/index.js" } }`
//   - `"exports": { ".": { "import": { "default": "./dist/index.js" } } }`
//   - `"main": "./dist/index.js"` (fallback, subpath === "." only)
export function pickEntry(manifest, subpath) {
  const { exports: exp, main } = manifest;
  if (typeof exp === "string") return subpath === "." ? exp : null;
  if (exp && typeof exp === "object") {
    const entry = exp[subpath];
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object") return pickConditional(entry);
  }
  return subpath === "." && typeof main === "string" ? main : null;
}

export function resolveFromFallback(pkg, subpath, fallbackRoot = FALLBACK_ROOT) {
  const pkgDir = path.join(fallbackRoot, pkg);
  const pkgJsonPath = path.join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) return null;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  } catch {
    return null;
  }
  const entry = pickEntry(manifest, subpath);
  if (!entry) return null;
  const absPath = path.join(pkgDir, entry);
  if (!existsSync(absPath)) return null;
  return pathToFileURL(absPath).href;
}

export async function resolve(specifier, context, nextResolve) {
  // Only scoped bare specifiers (`@scope/pkg[/sub]`) can be workspace junctions.
  if (!specifier.startsWith("@") || !specifier.includes("/")) {
    return nextResolve(specifier, context);
  }
  try {
    return await nextResolve(specifier, context);
  } catch (primaryErr) {
    const { pkg, subpath } = splitScopedSpecifier(specifier);
    const url = resolveFromFallback(pkg, subpath);
    if (!url) throw primaryErr;
    return { url, shortCircuit: true, format: "module" };
  }
}
