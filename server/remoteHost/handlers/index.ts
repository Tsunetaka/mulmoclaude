// Command-handler table for the remote-host runner — the single place the
// runner learns which methods it serves. Add a capability by importing its
// handler and adding it here.
import type { CommandHandlers } from "../commandChannel.js";
import { getCollection } from "./getCollection.js";
import { getFeed } from "./getFeed.js";
import { listCollections } from "./listCollections.js";
import { listFeeds } from "./listFeeds.js";
import { listShortcuts } from "./listShortcuts.js";
import { startChat } from "./startChat.js";

export const handlers: CommandHandlers = {
  listCollections,
  getCollection,
  listShortcuts,
  listFeeds,
  getFeed,
  startChat,
};
