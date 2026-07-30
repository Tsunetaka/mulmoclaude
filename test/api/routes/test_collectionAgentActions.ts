import "../../../server/workspace/collections/configure.js"; // configure @mulmoclaude/core/collection host binding for tests
// `kind: "agent"` collection-action dispatch (collectionAgentActions.ts):
// the stamp-at-dispatch guard (double-click ⇒ one worker), the guard
// clearing on completion AND on launch failure, the deduped failure bell
// (one per action until the next success clears it), and the completion
// ping that lets the client's spinner reconcile. All seams injected — no
// real agent session is ever launched.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  agentActionRunKey,
  dispatchAgentAction,
  resetAgentActionsForTesting,
  runningAgentActions,
  type AgentActionDeps,
} from "../../../server/api/routes/collectionAgentActions.js";
import type { CollectionSeededAction, LoadedCollection } from "../../../server/workspace/collections/index.js";

const action: CollectionSeededAction = { id: "reprice", label: "Refresh price", kind: "agent", role: "finance", template: "templates/reprice.md" };

const collection = {
  slug: "stock-quotes",
  source: "project",
  schema: { title: "Stock Quotes", icon: "trending_up", dataPath: "data/stock-quotes/items", primaryKey: "symbol", fields: {} },
  dataDir: "/tmp/nowhere",
  skillDir: "/tmp/nowhere-skill",
} as unknown as LoadedCollection;

/** Deps whose spawn succeeds and records calls; completion is manual via
 *  the captured onComplete hook (like the real agent-run teardown). */
function makeDeps() {
  const calls = { spawns: 0, changes: [] as string[], bells: [] as string[], cleared: [] as string[] };
  let onComplete: ((outcome: { didError: boolean }) => void | Promise<void>) | undefined;
  const deps: AgentActionDeps = {
    spawn: async (args) => {
      calls.spawns += 1;
      ({ onComplete } = args);
      return { ok: true, chatId: `chat-${calls.spawns}` };
    },
    publishChange: (slug) => calls.changes.push(slug),
    notifyFailure: async (title) => {
      calls.bells.push(title);
      return `bell-${calls.bells.length}`;
    },
    clearNotification: async (bellId) => {
      calls.cleared.push(bellId);
    },
  };
  return { deps, calls, complete: (didError: boolean) => onComplete?.({ didError }) };
}

beforeEach(() => resetAgentActionsForTesting());

describe("collection agent actions — dispatch guard", () => {
  it("stamps before launch: a concurrent second dispatch is refused, one worker spawns", async () => {
    const { deps, calls, complete } = makeDeps();
    const first = await dispatchAgentAction({ collection, action, seed: "go", itemId: "aapl" }, deps);
    assert.deepEqual(first, { ok: true });
    assert.deepEqual(runningAgentActions("stock-quotes"), [agentActionRunKey("reprice", "aapl")]);
    const second = await dispatchAgentAction({ collection, action, seed: "go", itemId: "aapl" }, deps);
    assert.equal(second.ok, false);
    assert.equal(!second.ok && second.alreadyRunning, true);
    assert.equal(calls.spawns, 1);
    // A DIFFERENT record's button is independent; completing it (the last
    // captured hook) clears only its own key.
    assert.deepEqual(await dispatchAgentAction({ collection, action, seed: "go", itemId: "msft" }, deps), { ok: true });
    await complete(false);
    assert.deepEqual(runningAgentActions("stock-quotes"), [agentActionRunKey("reprice", "aapl")]);
  });

  it("collection-level and per-record keys don't alias", () => {
    assert.notEqual(agentActionRunKey("sync"), agentActionRunKey("sync", "aapl"));
    assert.equal(agentActionRunKey("sync"), "collection/sync");
    assert.equal(agentActionRunKey("sync", "aapl"), "item/aapl/sync");
  });

  it("a launch failure clears the guard so the button un-sticks", async () => {
    const { calls } = makeDeps();
    const failing: AgentActionDeps = {
      spawn: async () => ({ ok: false, error: "too many background sessions" }),
      publishChange: (slug) => calls.changes.push(slug),
      notifyFailure: async () => "bell-x",
      clearNotification: async () => {},
    };
    const outcome = await dispatchAgentAction({ collection, action, seed: "go", itemId: "aapl" }, failing);
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.alreadyRunning, undefined);
    assert.deepEqual(runningAgentActions("stock-quotes"), []);
  });
});

describe("collection agent actions — completion", () => {
  it("success clears the key and pings the collection channel", async () => {
    const { deps, calls, complete } = makeDeps();
    await dispatchAgentAction({ collection, action, seed: "go", itemId: "aapl" }, deps);
    await complete(false);
    assert.deepEqual(runningAgentActions("stock-quotes"), []);
    assert.deepEqual(calls.changes, ["stock-quotes"]);
    assert.deepEqual(calls.bells, []);
  });

  it("failure raises ONE bell across repeats; the next success clears it", async () => {
    const { deps, calls, complete } = makeDeps();
    await dispatchAgentAction({ collection, action, seed: "go", itemId: "aapl" }, deps);
    await complete(true);
    await dispatchAgentAction({ collection, action, seed: "go", itemId: "aapl" }, deps);
    await complete(true); // second failure: the standing bell is not piled onto
    assert.deepEqual(calls.bells, ["Collection action failed"]);
    assert.deepEqual(calls.cleared, []);
    await dispatchAgentAction({ collection, action, seed: "go", itemId: "aapl" }, deps);
    await complete(false);
    assert.deepEqual(calls.cleared, ["bell-1"]);
    // Guard cleared and the ping fired on every completion (spinner reconciles
    // even when the failed worker wrote no records).
    assert.deepEqual(runningAgentActions("stock-quotes"), []);
    assert.equal(calls.changes.length, 3);
  });
});
