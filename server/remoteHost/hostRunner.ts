// Host side of the command channel: claim queued commands, run handlers, write
// results back, and announce presence via heartbeat.
//
// Ported from ../mulmoserver/src/firestore/hostRunner.ts. Adaptations for this
// repo: `db` import rewired to the Node-side `firestore` instance;
// `errorMessage` reused from server/utils/errors.ts (the canonical helper)
// instead of a copied commandFormat.ts; `heartbeatMs` sourced from the time
// constants; the runTransaction callback param renamed tx -> txn (id-length).
import { DocumentReference, onSnapshot, query, runTransaction, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";

import { errorMessage } from "../utils/errors.js";
import { ONE_MINUTE_MS } from "../utils/time.js";
import { Channel, Command, CommandHandler, CommandHandlers, JsonObject, commandsCollection, hostDoc } from "./commandChannel.js";
import { firestore } from "./firebase.js";

const heartbeatMs = ONE_MINUTE_MS;

export interface HostEvent {
  phase: "received" | "done" | "error";
  method: string;
  message?: string;
}

export interface HostRunnerOptions {
  onEvent?: (event: HostEvent) => void;
  // Called once when the listener dies fatally (after presence has been set
  // offline), so the lifecycle owner can reconcile its own state — e.g. clear
  // the runner handle so status() no longer reports connected. NOT called on a
  // normal stop().
  onClosed?: () => void;
}

interface Claim {
  method: string;
  params: JsonObject;
}

const noop = () => undefined;

// The remote may have deleted the doc on timeout, so ignore write-after-delete.
const writeError = (ref: DocumentReference, code: string, message: string) =>
  updateDoc(ref, { status: "error", error: { code, message }, updatedAt: serverTimestamp() }).catch(noop);

// Atomically move a command queued -> processing so it is handled exactly once.
// Returns the method/params to run, or null if another handler already took it.
const claimCommand = (ref: DocumentReference): Promise<Claim | null> =>
  runTransaction(firestore, async (txn) => {
    const data = (await txn.get(ref)).data() as Command | undefined;
    if (!data || data.status !== "queued") {
      return null;
    }
    txn.update(ref, { status: "processing", updatedAt: serverTimestamp() });
    return { method: data.method, params: data.params ?? {} };
  });

const runHandler = async (ref: DocumentReference, claim: Claim, handler: CommandHandler): Promise<HostEvent> => {
  try {
    const result = await handler(claim.params);
    await updateDoc(ref, { status: "done", result: result ?? null, updatedAt: serverTimestamp() });
    return { phase: "done", method: claim.method };
  } catch (error) {
    const message = errorMessage(error);
    await writeError(ref, "handler_error", message);
    return { phase: "error", method: claim.method, message };
  }
};

const processCommand = async (ref: DocumentReference, handlers: CommandHandlers, onEvent?: HostRunnerOptions["onEvent"]) => {
  const claim = await claimCommand(ref);
  if (!claim) {
    return;
  }
  onEvent?.({ phase: "received", method: claim.method });
  const handler: CommandHandler | undefined = handlers[claim.method];
  if (!handler) {
    await writeError(ref, "unknown_method", `No handler for method: ${claim.method}`);
    onEvent?.({ phase: "error", method: claim.method, message: "unknown method" });
    return;
  }
  onEvent?.(await runHandler(ref, claim, handler));
};

// startHostRunner subscribes to queued commands for the given channel and runs
// each one through the supplied handler table. It also announces presence (a
// heartbeat on users/{uid}/hosts/{hostId}) so the remote can tell it is online.
// Returns a stop function that goes offline and detaches the listener.
export const startHostRunner = (channel: Channel, handlers: CommandHandlers, options: HostRunnerOptions = {}): (() => void) => {
  const presence = hostDoc(channel);
  const announce = () => {
    setDoc(presence, { online: true, updatedAt: serverTimestamp() }).catch(noop);
  };
  announce();
  const beat = setInterval(announce, heartbeatMs);

  const queuedCommands = query(commandsCollection(channel), where("status", "==", "queued"));
  const unsubscribe = onSnapshot(
    queuedCommands,
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          processCommand(change.doc.ref, handlers, options.onEvent).catch(noop);
        }
      });
    },
    (error) => {
      options.onEvent?.({ phase: "error", method: "listen", message: error.message });
      // A Firestore onSnapshot error terminates the listener and it does not
      // recover on its own. Stop advertising presence (clear the heartbeat +
      // write online:false) so remotes see the host as offline instead of a
      // live host that silently consumes no commands.
      clearInterval(beat);
      setDoc(presence, { online: false, updatedAt: serverTimestamp() }).catch(noop);
      options.onClosed?.();
    },
  );

  return () => {
    clearInterval(beat);
    setDoc(presence, { online: false, updatedAt: serverTimestamp() }).catch(noop);
    unsubscribe();
  };
};
