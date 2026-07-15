// Unit test for createRemoteHostSession's non-destructive `open` (mulmoserver#50).
//
// The invalid-seed-blob path throws BEFORE any Firebase app is built, so it runs
// without a network: it proves `open` rolls back cleanly and doesn't corrupt the
// session store when a bad blob is handed in (the reconnect contract). The
// Firebase-touching success/restore paths are covered by Phase 2/3 integration.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getApps } from "firebase/app";

import { createRemoteHostSession } from "../../src/remote-host/server/firebase.js";

const CONFIG = { apiKey: "test", projectId: "test", appId: "test" };

describe("createRemoteHostSession.open (non-destructive)", () => {
  it("rejects an invalid seed blob and leaves the session store untouched", async () => {
    const session = createRemoteHostSession(CONFIG);

    // Valid JSON but not an object → seed throws before any app is initialized.
    await assert.rejects(session.open("[1,2,3]"), /must be a JSON object/);
    assert.equal(session.exportSession(), null, "a failed open must not leave a partial session");

    // Syntactically invalid JSON → JSON.parse throws, same rollback.
    await assert.rejects(session.open("not json"));
    assert.equal(session.exportSession(), null);
  });
});

// The `validate` hook runs on the fresh handles BEFORE the previous app is torn
// down, so a failed sign-in / expired blob is non-destructive. initializeAuth
// runs offline, so both paths are exercised without a network.
describe("createRemoteHostSession.open (validate before teardown)", () => {
  const appNames = (): string[] => getApps().map((app) => app.name);

  it("commits on a passing validate: swaps in the fresh app, tears down the previous", async () => {
    const session = createRemoteHostSession(CONFIG);
    try {
      const first = await session.open();
      const firstName = first.auth.app.name;
      const second = await session.open(undefined, () => Promise.resolve());
      assert.ok(!appNames().includes(firstName), "the previous app is torn down after a committed open");
      assert.ok(appNames().includes(second.auth.app.name), "the fresh app is live");
    } finally {
      await session.close();
    }
  });

  it("rolls back on a rejecting validate: keeps the previous session, drops the fresh app", async () => {
    const session = createRemoteHostSession(CONFIG);
    try {
      const first = await session.open();
      const firstName = first.auth.app.name;
      const countWithLiveSession = appNames().length;

      await assert.rejects(
        session.open(undefined, () => Promise.reject(new Error("sign-in failed"))),
        /sign-in failed/,
      );

      assert.ok(appNames().includes(firstName), "the previous session must survive a failed validate");
      assert.equal(appNames().length, countWithLiveSession, "the fresh app must be rolled back — no leak");
    } finally {
      await session.close();
    }
  });
});
