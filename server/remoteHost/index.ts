// Remote-host lifecycle: wire the Firebase session (auth.ts) to the Firestore
// host runner (hostRunner.ts) so that connecting from the toolbar starts the
// command loop + presence heartbeat, and disconnecting stops both.
//
// Single-account, single-host (HOST_ID = "mulmoclaude"), in-memory session:
// a server restart drops the session and needs a re-connect (phase-1 default).
//
// The lifecycle is exposed as a factory (createRemoteHost) so the invariants
// — non-destructive connect, serialized transitions, status/liveness
// reconciliation on fatal listener death — are unit-testable with fake deps.
// A default singleton wired to the real Firebase deps backs the route.
import { log } from "../system/logger/index.js";
import { HOST_ID } from "./commandChannel.js";
import type { CommandHandlers } from "./commandChannel.js";
import { currentUid, signInHost, signOutHost } from "./auth.js";
import { handlers } from "./handlers/index.js";
import { startHostRunner } from "./hostRunner.js";

const PREFIX = "remote-host";

export interface RemoteHostStatus {
  connected: boolean;
  uid: string | null;
}

// Injectable collaborators — the real singleton binds these to Firebase; tests
// pass fakes to exercise the lifecycle without a network.
export interface RemoteHostDeps {
  signIn: (idToken: string) => Promise<string>;
  signOut: () => Promise<void>;
  currentUid: () => string | null;
  startRunner: typeof startHostRunner;
  handlers: CommandHandlers;
}

export interface RemoteHostLifecycle {
  connect: (idToken: string) => Promise<RemoteHostStatus>;
  disconnect: () => Promise<RemoteHostStatus>;
  status: () => RemoteHostStatus;
}

const noop = () => undefined;

export const createRemoteHost = (deps: RemoteHostDeps): RemoteHostLifecycle => {
  // The running host runner's stop() handle, or null when disconnected. Keeps
  // the single-host invariant — one runner at a time.
  let stopRunner: (() => void) | null = null;

  // Serialize connect/disconnect so overlapping requests can't both mutate
  // stopRunner (which would leak a second runner) or race auth against teardown.
  // Each transition runs only after the previous one settles; a failed
  // transition does not block the next (both handlers run the next op).
  let transition: Promise<unknown> = Promise.resolve();

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = transition.then(operation, operation);
    transition = next.then(noop, noop);
    return next;
  };

  const stopIfRunning = () => {
    if (stopRunner) {
      stopRunner();
      stopRunner = null;
    }
  };

  const status = (): RemoteHostStatus => ({ connected: stopRunner !== null, uid: deps.currentUid() });

  const startRunner = (uid: string) => {
    const runner = deps.startRunner({ uid, hostId: HOST_ID }, deps.handlers, {
      onEvent: (event) => log.debug(PREFIX, `host event: ${event.phase} ${event.method}`, { event }),
      // The listener died fatally (heartbeat already stopped + offline written);
      // clear the handle so status() stops reporting connected — but only if it
      // still points at THIS runner (a later reconnect may have replaced it).
      onClosed: () => {
        if (stopRunner === runner) {
          stopRunner = null;
          log.warn(PREFIX, "host runner listener died; marked disconnected");
        }
      },
    });
    return runner;
  };

  const connect = (idToken: string): Promise<RemoteHostStatus> =>
    serialize(async () => {
      // Authenticate BEFORE any teardown, so a failed connect (expired/rejected
      // token) leaves an existing healthy session untouched instead of dropping it.
      const uid = await deps.signIn(idToken);
      stopIfRunning();
      stopRunner = startRunner(uid);
      log.info(PREFIX, `connected as ${uid}, host runner started (hostId=${HOST_ID})`);
      return status();
    });

  const disconnect = (): Promise<RemoteHostStatus> =>
    serialize(async () => {
      stopIfRunning();
      await deps.signOut();
      log.info(PREFIX, "disconnected, host runner stopped");
      return status();
    });

  return { connect, disconnect, status };
};

// Default singleton wired to the real Firebase deps — imported by the route.
const instance = createRemoteHost({
  signIn: signInHost,
  signOut: signOutHost,
  currentUid,
  startRunner: startHostRunner,
  handlers,
});

export const { connect, disconnect, status } = instance;
