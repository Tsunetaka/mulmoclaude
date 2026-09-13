// Regression guard for the background-task ceiling reaching the sandbox.
//
// The CLI's own default is 600s, and it is enforced in a way the server cannot
// see as a failure: the CLI writes ONE line to stderr and exits 0, so the turn
// is recorded as `request completed` and nothing reaches the UI. On 2026-09-12
// that silently truncated four long knowledge-base runs (11-27 min turns) in a
// single night, and the only trace was `prefix: agent-stderr` in
// `server/system/logs/server-2026-09-12.log`.
//
// Two things have to hold, and neither is visible at runtime until a long
// background run is already lost:
//   1. the var is in the DOCKER ARGV — a host-side export never reaches the
//      container (same constraint documented on MCP_CONNECT_TIMEOUT_MS), so
//      moving it to the environment would be a silent no-op
//   2. the value stays FINITE — the `0` the CLI suggests means "wait forever",
//      which trades a truncated turn for one that never ends, and the UI has no
//      watchdog for a stuck spinner
import { strict as assert } from "node:assert";
import test, { describe } from "node:test";

import { BG_TASK_WAIT_CEILING_MS, buildDockerSpawnArgs } from "../../server/agent/config.js";

const spawnArgs = (): string[] =>
  buildDockerSpawnArgs({
    workspacePath: "/tmp/workspace",
    cliArgs: ["--print"],
    chatSessionId: "session-under-test",
    uid: 1000,
    gid: 1000,
    platform: "linux",
  });

describe("background-task wait ceiling", () => {
  test("is passed into the container as a -e pair", () => {
    const args = spawnArgs();
    const index = args.indexOf(`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=${BG_TASK_WAIT_CEILING_MS}`);
    assert.ok(index > 0, "CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS is missing from the docker argv");
    assert.equal(args[index - 1], "-e", "the ceiling must be introduced by -e or docker ignores it");
  });

  test("is finite and longer than the CLI's 600s default", () => {
    assert.ok(Number.isFinite(BG_TASK_WAIT_CEILING_MS), "must be a finite number of ms");
    assert.ok(BG_TASK_WAIT_CEILING_MS > 0, "0 means wait indefinitely — a turn that never ends");
    assert.ok(BG_TASK_WAIT_CEILING_MS > 600_000, "must exceed the 600s default this exists to raise");
  });

  test("covers the longest run observed when this was diagnosed (27 min)", () => {
    assert.ok(BG_TASK_WAIT_CEILING_MS >= 27 * 60_000, "shorter than the run that exposed the bug");
  });
});
