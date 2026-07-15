// Isolated preset-package resolver for the Docker sandbox.
//
// Pulled out of `preset-loader.ts` so it can be verified independently
// against the actual bug environment (Windows NTFS junctions bind-
// mounted into a Linux container). The sandbox regression probe at
// `.github/workflows/docker_sandbox_windows.yaml` +
// `test/sandbox-repro/probe.ts` imports THIS file so it exercises the
// exact shipped resolver, not an inline copy that could drift.
//
// Depends only on `node:fs` / `node:module` / `node:path` so the probe
// can `tsx` it inside a plain `node:22-slim` container without dragging
// in the full server import graph (logger, plugin registry, etc.).

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// Anchored at this module so `require.resolve.paths(pkg)` returns the same
// list Node's own CJS resolver would search from here — parent walk plus
// NODE_PATH entries.
const localRequire = createRequire(import.meta.url);

/** Resolve the on-disk root of a preset package. Delegates the search path
 *  list to Node's `require.resolve.paths(<pkg>)` so we stay in lockstep with
 *  the CJS resolver on every layout the installer might choose:
 *
 *    - yarn workspaces: deps hoisted to the repo root's `node_modules`
 *    - npm flat install: package's `node_modules` directly
 *    - npm nested install: under a parent package's `node_modules`
 *    - NODE_PATH fallback: the Docker sandbox mounts each
 *      `@mulmoclaude/*` workspace at `/app/pkg_modules/@mulmoclaude/<name>`
 *      and appends `/app/pkg_modules` to NODE_PATH so CJS resolution
 *      falls through when the primary `node_modules` link dangles inside
 *      the container (#1946 on Windows). The old hand-rolled parent-walk
 *      didn't consult NODE_PATH, silently dropping every preset — the
 *      #1982 gap this delegation closes.
 *
 *  Why the `existsSync` gate instead of `require.resolve('<pkg>/package.json')`:
 *  many packages (including `@gui-chat-plugin/*`) ship an `exports` field
 *  that doesn't expose `./package.json`, so the ESM/CJS resolver throws
 *  `ERR_PACKAGE_PATH_NOT_EXPORTED`. Doing the final `<dir>/<pkg>/package.json`
 *  check ourselves sidesteps the exports gate. */
export function resolvePresetRoot(packageName: string): string | null {
  const paths = localRequire.resolve.paths(packageName);
  if (!paths) return null;
  for (const dir of paths) {
    const candidate = path.join(dir, packageName);
    if (existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }
  return null;
}
