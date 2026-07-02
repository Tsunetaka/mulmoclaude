// Command-channel protocol types + Firestore path helpers.
//
// Ported from ../mulmoserver/src/firestore/commandChannel.ts (modular
// firebase/firestore, runs unchanged in Node). Only the `db` import is rewired
// to this package's Node-side `firestore` instance. The server is host-only, so
// the remote-side callHost.ts / useHostPresence.ts are intentionally not ported.
import { CollectionReference, DocumentData, DocumentReference, collection, doc } from "firebase/firestore";

import { firestore } from "./firebase.js";

// This MulmoClaude server host's hardcoded channel id. The remote and host just
// agree on the id — there is no discovery / host registry.
export const HOST_ID = "mulmoclaude";

// JSON payloads carried by the command channel. Using explicit JSON types
// keeps the channel typed without resorting to any/unknown.
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, JsonValue>;

// A channel routes commands to one specific host. Both sides agree on a
// hardcoded hostId per use case (e.g. "test", "mulmoclaude"); there is no
// discovery — the remote and host just share the id.
export interface Channel {
  uid: string;
  hostId: string;
}

export type CommandStatus = "queued" | "processing" | "done" | "error";

export interface CommandError {
  code: string;
  message: string;
}

// One document in a channel's commands subcollection is one API-call-like
// request. The remote (mobile) writes method/params; the host writes
// result/error/status.
export interface Command {
  method: string;
  params: JsonObject;
  status: CommandStatus;
  result: JsonValue;
  error: CommandError | null;
  createdBy: "remote" | "host";
}

export type CommandHandler = (params: JsonObject) => JsonValue | Promise<JsonValue>;
export type CommandHandlers = Record<string, CommandHandler>;

// Per-host command queue: users/{uid}/hosts/{hostId}/commands.
export const commandsCollection = (channel: Channel): CollectionReference<DocumentData> =>
  collection(firestore, "users", channel.uid, "hosts", channel.hostId, "commands");

// Presence doc for a host: users/{uid}/hosts/{hostId}. The host heartbeats
// { online, updatedAt } here; the remote reads it to know if the host is up.
export const hostDoc = (channel: Channel): DocumentReference<DocumentData> => doc(firestore, "users", channel.uid, "hosts", channel.hostId);
