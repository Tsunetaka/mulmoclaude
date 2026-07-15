import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { readFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { maybeIndexSession, backfillAllSessions, __resetForTests } from "../../server/workspace/chat-index/index.js";
import { indexEntryPathFor } from "../../server/workspace/chat-index/paths.js";
import { ClaudeCliNotFoundError } from "../../server/workspace/journal/archivist-cli.js";
import type { SummaryResult } from "../../server/workspace/chat-index/types.js";

let workspace: string;
// Mirrors WORKSPACE_DIRS.chat (`conversations/chat`) — the value
// the indexer resolves through `chatDirFor` at runtime.
const CHAT_REL = join("conversations", "chat");

beforeEach(() => {
  __resetForTests();
  workspace = mkdtempSync(join(tmpdir(), "chat-index-maybe-"));
  mkdirSync(join(workspace, CHAT_REL), { recursive: true });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function seedSession(sessionId: string): void {
  const chatDir = join(workspace, CHAT_REL);
  writeFileSync(
    join(chatDir, `${sessionId}.json`),
    JSON.stringify({
      roleId: "general",
      startedAt: "2026-04-12T10:00:00.000Z",
    }),
  );
  writeFileSync(join(chatDir, `${sessionId}.jsonl`), `${JSON.stringify({ source: "user", type: "text", message: "hello" })}\n`);
}

function stubSummarize(
  result: SummaryResult = {
    title: "t",
    summary: "s",
    keywords: ["k"],
  },
): { fn: (input: string) => Promise<SummaryResult>; calls: number } {
  const state = { calls: 0 };
  return {
    fn: async () => {
      state.calls++;
      return result;
    },
    get calls() {
      return state.calls;
    },
  };
}

describe("maybeIndexSession — active session guard", () => {
  it("skips when the session is still being written (activeSessionIds)", async () => {
    seedSession("live-sess");
    const stub = stubSummarize();

    await maybeIndexSession({
      sessionId: "live-sess",
      activeSessionIds: new Set(["live-sess", "other"]),
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: stub.fn, now: () => 0 },
    });

    assert.equal(stub.calls, 0);
    await assert.rejects(() => readFile(indexEntryPathFor(workspace, "live-sess"), "utf-8"));
  });

  it("runs when the session is NOT in activeSessionIds", async () => {
    seedSession("done-sess");
    const stub = stubSummarize();

    await maybeIndexSession({
      sessionId: "done-sess",
      activeSessionIds: new Set(["other"]),
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: stub.fn, now: () => 0 },
    });

    assert.equal(stub.calls, 1);
    const raw = await readFile(indexEntryPathFor(workspace, "done-sess"), "utf-8");
    assert.match(raw, /"title": "t"/);
  });
});

describe("maybeIndexSession — per-session lock", () => {
  it("double-fire for the same session is a no-op while the first is in flight", async () => {
    seedSession("slow-sess");
    // Use the executor's synchronous assignment pattern — TS would
    // otherwise narrow `release` to `null` after the callback, since
    // it can't prove the executor runs inline.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowSummarize = async (): Promise<SummaryResult> => {
      await gate;
      return { title: "t", summary: "s", keywords: [] };
    };

    const first = maybeIndexSession({
      sessionId: "slow-sess",
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: slowSummarize, now: () => 0 },
    });
    // Call again while `first` is still blocked on the gate. This
    // second call should short-circuit via the in-process lock.
    const second = await maybeIndexSession({
      sessionId: "slow-sess",
      workspaceRoot: workspace,
      deps: {
        mode: "haiku",
        summarize: async () => {
          throw new Error("second call should not run summarize");
        },
        now: () => 0,
      },
    });
    assert.equal(second, undefined);

    // Let the first finish and await it to avoid leaking the
    // promise into the next test.
    release();
    await first;
  });

  it("different sessions can run concurrently", async () => {
    seedSession("sess-1");
    seedSession("sess-2");
    const stub = stubSummarize();

    await Promise.all([
      maybeIndexSession({
        sessionId: "sess-1",
        workspaceRoot: workspace,
        deps: { mode: "haiku", summarize: stub.fn, now: () => 0 },
      }),
      maybeIndexSession({
        sessionId: "sess-2",
        workspaceRoot: workspace,
        deps: { mode: "haiku", summarize: stub.fn, now: () => 0 },
      }),
    ]);

    assert.equal(stub.calls, 2);
  });
});

describe("maybeIndexSession — claude CLI missing sentinel", () => {
  it("disables the module after ClaudeCliNotFoundError is thrown", async () => {
    seedSession("sess-miss-1");
    seedSession("sess-miss-2");
    const throwing = async (): Promise<SummaryResult> => {
      throw new ClaudeCliNotFoundError();
    };

    // First call hits the sentinel and flips `disabled`.
    await maybeIndexSession({
      sessionId: "sess-miss-1",
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: throwing, now: () => 0 },
    });

    // Second call should be a no-op: even though we hand it a
    // working summarizer, the disabled flag short-circuits the
    // whole module.
    const workingStub = stubSummarize();
    await maybeIndexSession({
      sessionId: "sess-miss-2",
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: workingStub.fn, now: () => 0 },
    });
    assert.equal(workingStub.calls, 0);
  });
});

describe("maybeIndexSession — unexpected error swallowing", () => {
  it("does not throw when summarize throws an unrelated error", async () => {
    seedSession("sess-err");
    const failing = async (): Promise<SummaryResult> => {
      throw new Error("boom");
    };

    // This must resolve, not reject — the agent finally block
    // relies on it.
    await assert.doesNotReject(
      maybeIndexSession({
        sessionId: "sess-err",
        workspaceRoot: workspace,
        deps: { mode: "haiku", summarize: failing, now: () => 0 },
      }),
    );
  });

  it("does not disable the module on unrelated errors", async () => {
    seedSession("sess-err-1");
    seedSession("sess-err-2");
    const failing = async (): Promise<SummaryResult> => {
      throw new Error("transient network blip");
    };
    await maybeIndexSession({
      sessionId: "sess-err-1",
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: failing, now: () => 0 },
    });

    // Subsequent call with a working summarizer should still run.
    const stub = stubSummarize();
    await maybeIndexSession({
      sessionId: "sess-err-2",
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: stub.fn, now: () => 0 },
    });
    assert.equal(stub.calls, 1);
  });
});

describe("maybeIndexSession — force option", () => {
  it("bypasses the activeSessionIds guard when force is true", async () => {
    seedSession("live-force");
    const stub = stubSummarize();

    await maybeIndexSession({
      sessionId: "live-force",
      activeSessionIds: new Set(["live-force"]),
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: stub.fn, now: () => 0 },
      force: true,
    });

    assert.equal(stub.calls, 1);
  });

  it("bypasses the freshness throttle when force is true", async () => {
    seedSession("fresh-force");
    const stub = stubSummarize();

    // Seed a fresh entry.
    await maybeIndexSession({
      sessionId: "fresh-force",
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: stub.fn, now: () => 0 },
    });
    assert.equal(stub.calls, 1);

    // Normal second call: skipped by freshness.
    await maybeIndexSession({
      sessionId: "fresh-force",
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: stub.fn, now: () => 500 },
    });
    assert.equal(stub.calls, 1);

    // Forced second call: re-indexes.
    await maybeIndexSession({
      sessionId: "fresh-force",
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: stub.fn, now: () => 500 },
      force: true,
    });
    assert.equal(stub.calls, 2);
  });
});

describe("backfillAllSessions", () => {
  it("indexes every session jsonl in the workspace", async () => {
    seedSession("bf-1");
    seedSession("bf-2");
    seedSession("bf-3");
    const stub = stubSummarize();

    const result = await backfillAllSessions({
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: stub.fn, now: () => 0 },
    });

    assert.equal(result.total, 3);
    assert.equal(result.indexed, 3);
    assert.equal(result.skipped, 0);
    assert.equal(stub.calls, 3);
  });

  it("returns an empty result when there are no session jsonls", async () => {
    const stub = stubSummarize();
    const result = await backfillAllSessions({
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: stub.fn, now: () => 0 },
    });
    assert.equal(result.total, 0);
    assert.equal(result.indexed, 0);
    assert.equal(result.skipped, 0);
    assert.equal(stub.calls, 0);
  });

  it("skips sessions that throw and keeps processing the rest", async () => {
    seedSession("ok-1");
    seedSession("boom");
    seedSession("ok-2");
    let callCount = 0;
    const mixedSummarize = async (): Promise<SummaryResult> => {
      callCount++;
      if (callCount === 2) throw new Error("boom on second call");
      return { title: "t", summary: "s", keywords: [] };
    };

    const result = await backfillAllSessions({
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: mixedSummarize, now: () => 0 },
    });

    assert.equal(result.total, 3);
    assert.equal(result.indexed, 2);
    assert.equal(result.skipped, 1);
  });

  it("re-indexes sessions even when they are already fresh (force)", async () => {
    seedSession("warm-1");
    const stub = stubSummarize();

    // First pass seeds the entry.
    await maybeIndexSession({
      sessionId: "warm-1",
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: stub.fn, now: () => 0 },
    });
    assert.equal(stub.calls, 1);

    // Second pass via backfill with the same now() — a normal
    // maybeIndexSession call would be skipped by freshness. After
    // #1929, backfill no longer forces by default (the hourly
    // scheduler tick would otherwise re-summarise every session on
    // every tick); opt in explicitly here so the test still
    // exercises the force path.
    const result = await backfillAllSessions({
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: stub.fn, now: () => 0 },
      force: true,
    });
    assert.equal(result.indexed, 1);
    assert.equal(stub.calls, 2);
  });

  it("without force, skips sessions whose jsonl hasn't been touched since the last index (#1929)", async () => {
    seedSession("cold-1");
    // Pin the jsonl mtime BEFORE the first index runs. If the mtime
    // ended up newer than `indexedAt` (real wall clock), the
    // content-changed gate would fire on the second backfill.
    await utimes(join(workspace, CHAT_REL, "cold-1.jsonl"), 0.1, 0.1);

    const stub = stubSummarize();

    // Prime the index once via a forced backfill.
    await backfillAllSessions({
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: stub.fn, now: () => 1000 },
      force: true,
    });
    assert.equal(stub.calls, 1);

    // Simulate the next scheduler tick an hour later — jsonl mtime
    // hasn't moved, so nothing should be re-summarised. Without the
    // #1929 fix this would fire another CLI call.
    const result = await backfillAllSessions({
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: stub.fn, now: () => 1000 + 60 * 60 * 1000 },
    });
    assert.equal(result.indexed, 0);
    assert.equal(result.skipped, 1);
    assert.equal(stub.calls, 1);
  });

  it("without force, re-indexes sessions whose jsonl mtime moved forward (#1929)", async () => {
    seedSession("warm-2");
    await utimes(join(workspace, CHAT_REL, "warm-2.jsonl"), 0.1, 0.1);

    const stub = stubSummarize();

    await backfillAllSessions({
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: stub.fn, now: () => 1000 },
      force: true,
    });
    assert.equal(stub.calls, 1);

    // Simulate a new turn landing: bump jsonl mtime past the entry's
    // `indexedAt`. A non-force backfill should now pick it up.
    await utimes(join(workspace, CHAT_REL, "warm-2.jsonl"), 5000, 5000);

    const result = await backfillAllSessions({
      workspaceRoot: workspace,
      deps: { mode: "haiku", summarize: stub.fn, now: () => 1000 + 60 * 60 * 1000 },
    });
    assert.equal(result.indexed, 1);
    assert.equal(stub.calls, 2);
  });
});

// #1944 — public-entry-point coverage for the mode kill switch. When
// `mode: "off"` is injected via deps (or resolved from settings as
// undefined → off), both public entry points must short-circuit
// before spawning the summarizer.
describe("public entry points honour chat-index mode = off (#1944)", () => {
  it("maybeIndexSession returns without summarizing when mode is off", async () => {
    seedSession("off-sess");
    const stub = stubSummarize();

    await maybeIndexSession({
      sessionId: "off-sess",
      workspaceRoot: workspace,
      deps: { mode: "off", summarize: stub.fn, now: () => 0 },
    });

    assert.equal(stub.calls, 0);
    await assert.rejects(() => readFile(indexEntryPathFor(workspace, "off-sess"), "utf-8"));
  });

  it("backfillAllSessions short-circuits and reports zero counts when mode is off", async () => {
    seedSession("off-a");
    seedSession("off-b");
    const stub = stubSummarize();

    const result = await backfillAllSessions({
      workspaceRoot: workspace,
      deps: { mode: "off", summarize: stub.fn, now: () => 0 },
    });

    // Total is 0 because the walk itself is skipped — nothing to count.
    assert.deepEqual(result, { total: 0, indexed: 0, skipped: 0 });
    assert.equal(stub.calls, 0);
  });
});
