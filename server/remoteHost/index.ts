// Remote-host lifecycle for this host: bind MulmoClaude's Firebase deps + hostId
// to the shared `createRemoteHost` factory so connecting from the toolbar starts
// the Firestore command loop + presence heartbeat, and disconnecting stops both.
//
// The transport engine (command loop, connect/disconnect invariants, Firebase
// init/auth) lives in `@mulmoclaude/core/remote-host/server`; this module only
// supplies host specifics — hostId, the handler table, the firestore-bound
// runner, and a logger adapter — and exposes the default singleton the route uses.
//
// Single-account, single-host (HOST_ID = "mulmoclaude"). The Firebase session is
// parked in the browser (case A', mulmoserver#50), so a server restart doesn't
// force a re-login: the client reconnects from its stored blob.
import { createRemoteHost, startHostRunner } from "@mulmoclaude/core/remote-host/server";

import { log } from "../system/logger/index.js";
import { HOST_ID } from "./commandChannel.js";
import { currentFirestore, currentUid, restore, signIn, signOut } from "./session.js";
import { handlers } from "./handlers/index.js";
import { onExpire } from "./onExpire.js";

export type { RemoteHostStatus } from "@mulmoclaude/core/remote-host/server";
export { exportSession, RemoteHostSessionExpiredError } from "./session.js";

const PREFIX = "remote-host";

// Default singleton wired to the session-backed Firebase deps — imported by the
// route. The runner reads the CURRENT session's firestore (it changes each
// (re)connect); the logger adapts the factory's plain-string calls to the host
// logger's (prefix, msg) shape.
const instance = createRemoteHost({
  hostId: HOST_ID,
  signIn,
  restore,
  signOut,
  currentUid,
  startRunner: (channel, hostHandlers, options) => startHostRunner(currentFirestore(), channel, hostHandlers, options),
  handlers,
  onExpire,
  log: {
    info: (msg) => log.info(PREFIX, msg),
    warn: (msg) => log.warn(PREFIX, msg),
    debug: (msg) => log.debug(PREFIX, msg),
  },
});

export const { connect, reconnect, disconnect, status } = instance;
