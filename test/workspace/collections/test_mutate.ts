import "../../../server/workspace/collections/configure.js"; // configure @mulmoclaude/core/collection host binding for tests
// `kind: "mutate"` execution (collection/server/mutate.ts): params
// validated by the shared record-field checks, `$params` references
// resolved, the `set` merged over the stored record (computed keys
// stripped, untouched fields preserved), the standard write gate, and
// the honest failure statuses. Exercised against a real tmpdir
// workspace — same isolation pattern as test_derive.ts.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { applyMutateAction, loadCollection, readItem } from "@mulmoclaude/core/collection/server";
import type { CollectionMutateAction } from "@mulmoclaude/core/collection";

let workdir: string;
let emptyUserDir: string;

const opts = () => ({ workspaceRoot: workdir, userSkillsDir: emptyUserDir });

const ticketsSchema = {
  title: "Tickets",
  icon: "assignment",
  dataPath: "data/tickets/items",
  primaryKey: "id",
  fields: {
    id: { type: "string", label: "ID", primary: true, required: true },
    title: { type: "string", label: "Title", required: true },
    status: { type: "enum", label: "Status", values: ["open", "assigned", "done"], required: true },
    assignee: { type: "string", label: "Assignee" },
    effort: { type: "number", label: "Effort" },
    notes: { type: "text", label: "Notes" },
    doubled: { type: "derived", label: "Doubled", formula: "effort * 2" },
  },
};

const assignAction: CollectionMutateAction = {
  id: "assign",
  label: "Assign",
  kind: "mutate",
  require: { field: "status", in: ["open"] },
  params: {
    assignee: { type: "string", label: "Assignee", required: true },
    effort: { type: "number", label: "Effort" },
  },
  set: { assignee: "$params.assignee", effort: "$params.effort", status: "assigned" },
};

function writeSkill(slug: string, schema: object): void {
  const dir = path.join(workdir, ".claude/skills", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${slug}\ndescription: test fixture\n---\nbody\n`);
  writeFileSync(path.join(dir, "schema.json"), JSON.stringify(schema));
}

function writeRecord(itemId: string, record: object): void {
  const dir = path.join(workdir, "data/tickets/items");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${itemId}.json`), JSON.stringify(record));
}

async function tickets() {
  const collection = await loadCollection("tickets", opts());
  assert.ok(collection, "tickets collection must load");
  return collection;
}

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "collections-mutate-"));
  emptyUserDir = mkdtempSync(path.join(tmpdir(), "collections-mutate-user-"));
  writeSkill("tickets", ticketsSchema);
  writeRecord("tick-1", { id: "tick-1", title: "Fix the door", status: "open", notes: "hinge squeaks", doubled: 999 });
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(emptyUserDir, { recursive: true, force: true });
});

describe("applyMutateAction — the governed pipeline", () => {
  it("merges literals + $params over the stored record, preserving untouched fields and stripping stale computed keys", async () => {
    const outcome = await applyMutateAction(await tickets(), assignAction, "tick-1", { assignee: "kai", effort: 3 }, opts());
    assert.equal(outcome.ok, true);
    const written = await readItem(path.join(workdir, "data/tickets/items"), "tick-1", opts());
    // notes/title preserved (merge), status/assignee/effort written, the
    // stale stored `doubled` (a derived key) healed away.
    assert.deepEqual(written, { id: "tick-1", title: "Fix the door", status: "assigned", assignee: "kai", effort: 3, notes: "hinge squeaks" });
  });

  it("an absent optional $params ref omits the key — the stored value survives", async () => {
    writeRecord("tick-1", { id: "tick-1", title: "Fix the door", status: "open", effort: 8 });
    const outcome = await applyMutateAction(await tickets(), assignAction, "tick-1", { assignee: "kai" }, opts());
    assert.equal(outcome.ok, true);
    const written = await readItem(path.join(workdir, "data/tickets/items"), "tick-1", opts());
    assert.equal(written?.effort, 8);
  });

  it("rejects bad params via the shared record checks: missing required, undeclared key, non-numeric number", async () => {
    const collection = await tickets();
    const missing = await applyMutateAction(collection, assignAction, "tick-1", {}, opts());
    assert.equal(missing.ok, false);
    assert.match(!missing.ok ? missing.problem : "", /missing required field 'assignee'/);
    const unknown = await applyMutateAction(collection, assignAction, "tick-1", { assignee: "kai", extra: 1 }, opts());
    assert.match(!unknown.ok ? unknown.problem : "", /unknown param 'extra'/);
    const notNumeric = await applyMutateAction(collection, assignAction, "tick-1", { assignee: "kai", effort: "lots" }, opts());
    assert.match(!notNumeric.ok ? notNumeric.problem : "", /'effort' = 'lots' is not numeric/);
    // Nothing was written by any of the rejects.
    const stored = await readItem(path.join(workdir, "data/tickets/items"), "tick-1", opts());
    assert.equal(stored?.status, "open");
  });

  it("a set that violates the write gate is rejected with the gate's problem (invalid-record)", async () => {
    const badAction: CollectionMutateAction = { id: "bogus", label: "Bogus", kind: "mutate", set: { status: "archived" } };
    const outcome = await applyMutateAction(await tickets(), badAction, "tick-1", {}, opts());
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.status, "invalid-record");
    assert.match(!outcome.ok ? outcome.problem : "", /'status' = 'archived' is not one of \[open, assigned, done\]/);
  });

  it("a missing record reports not-found", async () => {
    const outcome = await applyMutateAction(await tickets(), assignAction, "ghost", { assignee: "kai" }, opts());
    assert.equal(!outcome.ok && outcome.status, "not-found");
  });

  it("re-checks `require` against ITS OWN read — a gate no longer met at write time is a 409, not a write", async () => {
    // Simulates the TOCTOU window Codex flagged on #2105: the route's
    // pre-check passed on an earlier snapshot, but the record moved out
    // of the gated state before the executor read it. The executor must
    // gate on the snapshot it actually merges.
    writeRecord("tick-1", { id: "tick-1", title: "Fix the door", status: "done" });
    const outcome = await applyMutateAction(await tickets(), assignAction, "tick-1", { assignee: "kai" }, opts());
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.status, "require-unmet");
    const stored = await readItem(path.join(workdir, "data/tickets/items"), "tick-1", opts());
    assert.equal(stored?.status, "done"); // nothing was written
    assert.equal(stored?.assignee, undefined);
  });
});
