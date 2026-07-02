// listFeeds command handler (remote-host phase 2).
//
// Returns the feed registry with retrieval kind / schedule / last-fetch time,
// mirroring GET /api/feeds → { feeds: FeedSummary[] }. Read-only: feeds are
// created/removed/refreshed desktop-side only.
import { listFeeds as listFeedsRegistry, readFeedState } from "@mulmoclaude/core/feeds/server";
import { workspacePath } from "../../workspace/workspace.js";
import type { CommandHandler, JsonObject } from "../commandChannel.js";

export interface ListFeedsDeps {
  listFeeds: typeof listFeedsRegistry;
  readFeedState: typeof readFeedState;
  workspaceRoot: string;
}

export const createListFeeds =
  (deps: ListFeedsDeps): CommandHandler =>
  // Handler receives the command's params; listFeeds takes none.
  async (__params: JsonObject) => {
    const feeds = await deps.listFeeds(deps.workspaceRoot);
    const summaries = [];
    for (const feed of feeds) {
      const state = await deps.readFeedState(deps.workspaceRoot, feed);
      const { ingest } = feed.schema;
      summaries.push({
        slug: feed.slug,
        title: feed.schema.title,
        icon: feed.schema.icon,
        kind: ingest?.kind ?? "rss",
        schedule: ingest?.schedule ?? "on-demand",
        lastFetchedAt: state.lastFetchedAt,
      });
    }
    return { feeds: summaries } as unknown as JsonObject;
  };

export const listFeeds = createListFeeds({ listFeeds: listFeedsRegistry, readFeedState, workspaceRoot: workspacePath });
