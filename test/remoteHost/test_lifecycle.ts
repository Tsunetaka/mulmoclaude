// Unit tests for the remote-host lifecycle invariants (createRemoteHost):
//   - connect starts a runner and reports connected + uid
//   - connect is NON-DESTRUCTIVE: a failed reconnect leaves the healthy session
//   - connect/disconnect are SERIALIZED: overlapping calls never leak a 2nd runner
//   - disconnect stops the runner + signs out
//   - a FATAL listener death reconciles status() back to disconnected, and the
//     reconciliation is identity-guarded (a superseded runner can't clear a newer one)
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createRemoteHost, type RemoteHostDeps } from "../../server/remoteHost/index.js";
import type { Channel } from "../../server/remoteHost/commandChannel.js";

interface FakeRunner {
  channel: Channel;
  stopped: boolean;
  onClosed?: () => void;
  stop: () => void;
}

// Build a lifecycle backed by fakes. signIn maps a token to a uid (and updates
// the "current user"), except the token "bad" which rejects — mirroring
// signInWithCredential leaving currentUser unchanged on failure.
const makeHarness = () => {
  const runners: FakeRunner[] = [];
  let uid: string | null = null;
  let signOutCount = 0;

  const startRunner: RemoteHostDeps["startRunner"] = (channel, _handlers, options) => {
    const runner: FakeRunner = { channel, stopped: false, onClosed: options?.onClosed, stop: () => (runner.stopped = true) };
    runners.push(runner);
    return runner.stop;
  };

  const deps: RemoteHostDeps = {
    signIn: async (idToken: string) => {
      if (idToken === "bad") throw new Error("rejected credential");
      uid = `uid-${idToken}`;
      return uid;
    },
    signOut: async () => {
      signOutCount += 1;
      uid = null;
    },
    currentUid: () => uid,
    startRunner,
    handlers: {},
  };

  return { rh: createRemoteHost(deps), runners, signOutCount: () => signOutCount };
};

describe("createRemoteHost lifecycle", () => {
  it("connect starts a runner and reports connected + uid", async () => {
    const { rh, runners } = makeHarness();
    const status = await rh.connect("t1");
    assert.deepEqual(status, { connected: true, uid: "uid-t1" });
    assert.equal(runners.length, 1);
    assert.equal(runners[0].stopped, false);
    assert.deepEqual(runners[0].channel, { uid: "uid-t1", hostId: "mulmoclaude" });
  });

  it("failed reconnect is non-destructive: keeps the existing healthy session", async () => {
    const { rh, runners } = makeHarness();
    await rh.connect("t1");
    await assert.rejects(rh.connect("bad"), /rejected credential/);
    // Old runner still running, no new runner, status unchanged.
    assert.equal(runners.length, 1);
    assert.equal(runners[0].stopped, false);
    assert.deepEqual(rh.status(), { connected: true, uid: "uid-t1" });
  });

  it("serializes overlapping connects: stops the old runner before starting the new", async () => {
    const { rh, runners } = makeHarness();
    const [status1, status2] = await Promise.all([rh.connect("t1"), rh.connect("t2")]);
    assert.equal(runners.length, 2);
    assert.equal(runners[0].stopped, true); // first runner torn down
    assert.equal(runners[1].stopped, false); // second is the live one
    assert.equal(status1.uid, "uid-t1");
    assert.deepEqual(status2, { connected: true, uid: "uid-t2" });
    assert.deepEqual(rh.status(), { connected: true, uid: "uid-t2" });
  });

  it("disconnect stops the runner and signs out", async () => {
    const { rh, runners, signOutCount } = makeHarness();
    await rh.connect("t1");
    const status = await rh.disconnect();
    assert.equal(runners[0].stopped, true);
    assert.equal(signOutCount(), 1);
    assert.deepEqual(status, { connected: false, uid: null });
  });

  it("reconciles status to disconnected when the listener dies fatally", async () => {
    const { rh, runners } = makeHarness();
    await rh.connect("t1");
    assert.equal(rh.status().connected, true);
    // Simulate hostRunner's fatal-listener path invoking onClosed.
    runners[0].onClosed?.();
    assert.equal(rh.status().connected, false);
    // A fresh connect still works after a fatal death.
    await rh.connect("t2");
    assert.deepEqual(rh.status(), { connected: true, uid: "uid-t2" });
  });

  it("onClosed from a superseded runner does not clear the current one", async () => {
    const { rh, runners } = makeHarness();
    await rh.connect("t1"); // runner 0
    await rh.connect("t2"); // runner 1 (runner 0 stopped)
    runners[0].onClosed?.(); // stale callback from the superseded runner
    assert.deepEqual(rh.status(), { connected: true, uid: "uid-t2" });
    runners[1].onClosed?.(); // the live runner dies
    assert.equal(rh.status().connected, false);
  });
});
