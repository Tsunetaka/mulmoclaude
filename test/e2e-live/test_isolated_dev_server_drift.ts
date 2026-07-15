import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { assertHostUntouched, snapshotHostFs, type HostFsBaseline } from "../../e2e-live/fixtures/isolated-dev-server.ts";

// Regression net for the Codex GHA review on PR #1506: the previous
// `assertHostUntouched` only checked top-level dir mtimes and missed
// in-place rewrites of existing files. The recursive walk added in
// the same PR closes that gap; these tests exercise the four drift
// shapes we now detect (modified, created, removed, absent-then-present)
// against a real tmpdir so a future refactor that re-introduces
// shallow checking fails immediately.

describe("isolated-dev-server.assertHostUntouched", () => {
  let workRoot: string;

  before(async () => {
    workRoot = await mkdtemp(path.join(tmpdir(), "mc-fresh-drift-"));
  });

  after(async () => {
    await rm(workRoot, { recursive: true, force: true });
  });

  afterEach(async () => {
    // Re-create a clean target dir per test so the cases stay isolated.
    await rm(path.join(workRoot, "target"), { recursive: true, force: true });
  });

  async function seedTarget(): Promise<string> {
    const target = path.join(workRoot, "target");
    await mkdir(path.join(target, "config"), { recursive: true });
    await mkdir(path.join(target, "skills", "mc-foo"), { recursive: true });
    await writeFile(path.join(target, "config", "settings.json"), '{"a":1}');
    await writeFile(path.join(target, "skills", "mc-foo", "SKILL.md"), "# foo\n");
    return target;
  }

  it("returns no error when nothing changed", async () => {
    const target = await seedTarget();
    const baseline = await snapshotHostFs(target);
    // `assertHostUntouched` throws on mismatch; wrapping in
    // `doesNotReject` makes the contract explicit for sonarjs (the
    // helper name pattern isn't recognised as an assertion by the
    // linter even though it internally throws).
    await assert.doesNotReject(assertHostUntouched([baseline]));
  });

  it("detects an in-place rewrite of an existing file (the Codex-flagged regression)", async () => {
    const target = await seedTarget();
    const baseline = await snapshotHostFs(target);
    // Advance the mtime of an existing file deterministically — same
    // shape as an isolation leak writing through to the host
    // `config/settings.json`. Parent dir mtime is NOT advanced by
    // this operation on most filesystems, which is exactly why the
    // pre-fix top-level check missed it.
    const target_file = path.join(target, "config", "settings.json");
    const futureMs = Date.now() + 60_000;
    await utimes(target_file, futureMs / 1000, futureMs / 1000);
    await assert.rejects(() => assertHostUntouched([baseline]), /mtime advanced/);
  });

  it("detects a newly created file under the snapshotted root", async () => {
    const target = await seedTarget();
    const baseline = await snapshotHostFs(target);
    await writeFile(path.join(target, "skills", "mc-foo", "extra.md"), "leaked\n");
    await assert.rejects(() => assertHostUntouched([baseline]), /created during test/);
  });

  it("detects a removed file under the snapshotted root", async () => {
    const target = await seedTarget();
    const baseline = await snapshotHostFs(target);
    await rm(path.join(target, "skills", "mc-foo", "SKILL.md"));
    await assert.rejects(() => assertHostUntouched([baseline]), /removed during test/);
  });

  it("detects an absent → present existence flip", async () => {
    const absentRoot = path.join(workRoot, "never-existed");
    // Take baseline first while the root is absent.
    const baseline: HostFsBaseline = await snapshotHostFs(absentRoot);
    assert.equal(baseline.existed, false);
    // Then create the root post-baseline.
    await mkdir(absentRoot, { recursive: true });
    await assert.rejects(() => assertHostUntouched([baseline]), /existence flipped/);
  });

  it("follows symlinked directories so in-place rewrites under them are detected (Codex iter-2 finding)", async () => {
    // The pre-fix walk gated recursion on `entry.isDirectory()`, which
    // returns false for symlink-to-dir entries — so a rewrite under
    // `~/.claude/skills/<slug>` symlinked to an external dir would be
    // missed. The post-fix walk uses `stat(full).isDirectory()` which
    // follows symlinks. This test pins that behaviour.
    const target = await seedTarget();
    // Real target dir living outside the snapshotted root.
    const externalDir = path.join(workRoot, "external-skill-target");
    await mkdir(externalDir, { recursive: true });
    const externalFile = path.join(externalDir, "linked-content.md");
    await writeFile(externalFile, "v1\n");
    // Symlink inside the snapshotted root pointing at the external dir.
    await symlink(externalDir, path.join(target, "skills", "linked-skill"), "dir");
    const baseline = await snapshotHostFs(target);
    // Mutate the file UNDER the symlink target. Pre-fix: not detected.
    // Post-fix: surfaces as `mtime advanced`.
    const futureMs = Date.now() + 60_000;
    await utimes(externalFile, futureMs / 1000, futureMs / 1000);
    await assert.rejects(() => assertHostUntouched([baseline]), /mtime advanced/);
  });

  it("records both aliases when two symlinks point at the same real dir (no global inode dedupe)", async () => {
    // Codex iter-3 caught that a global dev:ino dedupe would skip
    // whichever alias readdir returned second, producing readdir-
    // order-dependent false drift. The ancestor-realpath cycle
    // guard fixes this: separate aliases (not ancestors of each
    // other) both get fully walked.
    const target = await seedTarget();
    const shared = path.join(workRoot, "shared-target");
    await mkdir(shared, { recursive: true });
    await writeFile(path.join(shared, "leaf.md"), "shared\n");
    await symlink(shared, path.join(target, "skills", "alias-a"), "dir");
    await symlink(shared, path.join(target, "skills", "alias-b"), "dir");
    const baseline = await snapshotHostFs(target);
    // Both alias paths must have the leaf entry recorded — if dedupe
    // collapsed one, the missing entry would show up as "removed
    // during test" on the no-op assertHostUntouched below.
    assert.ok(baseline.entries.has(path.join(target, "skills", "alias-a", "leaf.md")), "alias-a leaf must be recorded");
    assert.ok(baseline.entries.has(path.join(target, "skills", "alias-b", "leaf.md")), "alias-b leaf must be recorded");
    // No-op assertion: a fresh re-walk should be byte-identical.
    await assertHostUntouched([baseline]);
  });

  it("does not loop on a symlink cycle (ancestor-realpath guard)", async () => {
    // L-30 already plants intentional symlinks in test workspaces; a
    // malicious or buggy cycle (`a -> b -> a`) should NOT spin the
    // walk forever. The ancestor-realpath cycle guard (plus
    // MAX_WALK_DEPTH as a belt-and-braces safety net) caps recursion.
    const target = await seedTarget();
    const cycleDir = path.join(target, "skills", "cycle");
    await mkdir(cycleDir, { recursive: true });
    // Self-referential symlink: <cycle>/self -> <cycle>
    await symlink(cycleDir, path.join(cycleDir, "self"), "dir");
    // If the visited set is missing, this never returns.
    const baseline = await snapshotHostFs(target);
    assert.ok(baseline.entries.size > 0, "snapshot must complete and record entries");
    // Re-snapshot to confirm idempotence — same shape, no drift.
    await assertHostUntouched([baseline]);
  });
});
