// Validates the Node resolution assumption the #1946 fix (approach A′) rests
// on: when a workspace package's PRIMARY `node_modules` entry is a dangling
// symlink — exactly the Windows yarn-workspace junction that points at a host
// path absent inside the Linux container — CJS resolution treats it as missing
// and falls through to the next NODE_PATH root (`/app/pkg_modules`).
//
// The real bug only reproduces on Windows, but the RESOLUTION happens inside a
// Linux container, so a POSIX host (Linux/macOS CI) is the accurate place to
// prove it. Skipped on a Windows host — creating a symlink there needs elevated
// privileges and, more importantly, isn't the production OS. Spawns a real
// child `node` so NODE_PATH is honoured (it's read once at startup).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

describe("NODE_PATH fallback past a dangling workspace junction (#1946)", { skip: process.platform === "win32" }, () => {
  it("resolves @mulmoclaude/x-plugin from the fallback root when the primary entry dangles", () => {
    const root = mkdtempSync(join(tmpdir(), "mc-nodepath-"));
    try {
      const primary = join(root, "node_modules");
      const fallback = join(root, "pkg_modules");
      // Primary: a dangling symlink, like a Windows junction whose absolute
      // host target does not exist inside the container.
      mkdirSync(join(primary, "@mulmoclaude"), { recursive: true });
      symlinkSync(join(root, "absent-host-path"), join(primary, "@mulmoclaude", "x-plugin"));
      // Fallback: the real package at the junction-free scoped root.
      const real = join(fallback, "@mulmoclaude", "x-plugin");
      mkdirSync(real, { recursive: true });
      writeFileSync(join(real, "package.json"), JSON.stringify({ name: "@mulmoclaude/x-plugin", main: "index.js" }));
      writeFileSync(join(real, "index.js"), "module.exports = 'RESOLVED_FROM_FALLBACK';");

      // Run from `root` so the dangling `root/node_modules/@mulmoclaude/x-plugin`
      // sits in the normal resolution walk — proving Node SKIPS it (not errors)
      // before NODE_PATH's fallback resolves it. cwd isolation also keeps the
      // repo's real installed x-plugin (which would win from the repo cwd) out
      // of the walk. Mirrors the container's NODE_PATH=/app/node_modules:/app/pkg_modules.
      const out = execFileSync(process.execPath, ["-e", "process.stdout.write(require('@mulmoclaude/x-plugin'))"], {
        cwd: root,
        env: { ...process.env, NODE_PATH: `${primary}:${fallback}` },
        encoding: "utf-8",
      });
      assert.equal(out, "RESOLVED_FROM_FALLBACK");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
