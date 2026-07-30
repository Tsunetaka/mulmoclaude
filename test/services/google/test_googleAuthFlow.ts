// Unit tests for the settings-UI OAuth flow manager: restart-on-start (a new
// start() aborts the pending flow), cancel, completion/failure state.
// authorizeGoogle is stubbed — no network, no browser.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createGoogleAuthFlow, type authorizeGoogle } from "@mulmoclaude/core/google";

const settleMicrotasks = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const makeAuthorizeStub = () => {
  const settlers: { complete: () => void; fail: (err: Error) => void }[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  let calls = 0;
  const authorize: typeof authorizeGoogle = async (opts = {}) => {
    calls += 1;
    const call = calls;
    signals.push(opts.signal);
    return new Promise((resolve, reject) => {
      // Honour the abort signal like the real authorizeGoogle does, so a
      // restart/cancel actually settles the pending flow.
      opts.signal?.addEventListener("abort", () => reject(new Error("authorization cancelled")), { once: true });
      settlers.push({ complete: () => resolve({ refresh_token: "stub" }), fail: reject });
      opts.onAuthUrl?.(`https://accounts.google.com/consent?call=${call}`);
    });
  };
  return {
    authorize,
    callCount: () => calls,
    complete: (index: number) => settlers[index]?.complete(),
    fail: (index: number, err: Error) => settlers[index]?.fail(err),
    signalAborted: (index: number) => signals[index]?.aborted ?? false,
  };
};

describe("createGoogleAuthFlow", () => {
  it("returns the consent URL and reports pending", async () => {
    const stub = makeAuthorizeStub();
    const flow = createGoogleAuthFlow(stub.authorize);
    const { authUrl } = await flow.start();
    assert.match(authUrl, /call=1/);
    assert.deepEqual(flow.status(), { pending: true, lastError: null });
  });

  it("restarts the pending flow, aborting the previous one", async () => {
    const stub = makeAuthorizeStub();
    const flow = createGoogleAuthFlow(stub.authorize);
    const first = await flow.start();
    const second = await flow.start();
    assert.notEqual(second.authUrl, first.authUrl);
    assert.match(second.authUrl, /call=2/);
    assert.equal(stub.callCount(), 2);
    assert.equal(stub.signalAborted(0), true); // the abandoned flow was cancelled
    assert.equal(stub.signalAborted(1), false); // the fresh flow is live
    assert.deepEqual(flow.status(), { pending: true, lastError: null });
  });

  it("cancel() aborts the in-flight flow and clears pending without recording an error", async () => {
    const stub = makeAuthorizeStub();
    const flow = createGoogleAuthFlow(stub.authorize);
    await flow.start();
    assert.equal(flow.status().pending, true);
    flow.cancel();
    await settleMicrotasks();
    assert.equal(stub.signalAborted(0), true);
    assert.deepEqual(flow.status(), { pending: false, lastError: null });
  });

  it("clears pending on completion and allows a fresh flow", async () => {
    const stub = makeAuthorizeStub();
    const flow = createGoogleAuthFlow(stub.authorize);
    await flow.start();
    stub.complete(0);
    await settleMicrotasks();
    assert.deepEqual(flow.status(), { pending: false, lastError: null });
    const next = await flow.start();
    assert.match(next.authUrl, /call=2/);
    assert.equal(stub.callCount(), 2);
  });

  it("records the error when the flow fails after the URL was issued", async () => {
    const stub = makeAuthorizeStub();
    const flow = createGoogleAuthFlow(stub.authorize);
    await flow.start();
    stub.fail(0, new Error("consent denied"));
    await settleMicrotasks();
    assert.deepEqual(flow.status(), { pending: false, lastError: "consent denied" });
  });

  it("clears a previous error when a new flow starts", async () => {
    const stub = makeAuthorizeStub();
    const flow = createGoogleAuthFlow(stub.authorize);
    await flow.start();
    stub.fail(0, new Error("consent denied"));
    await settleMicrotasks();
    await flow.start();
    assert.deepEqual(flow.status(), { pending: true, lastError: null });
  });

  it("rejects start() when authorize fails before issuing a URL", async () => {
    const authorize: typeof authorizeGoogle = async () => {
      throw new Error("no client secret");
    };
    const flow = createGoogleAuthFlow(authorize);
    await assert.rejects(flow.start(), /no client secret/);
    await settleMicrotasks();
    assert.deepEqual(flow.status(), { pending: false, lastError: "no client secret" });
  });
});
