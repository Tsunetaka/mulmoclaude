// Wire @mulmoclaude/core/feeds/server to this host's workspace, logger, atomic
// writer, and agent-ingest worker launcher. Called once from server/index.ts
// BEFORE scheduler init (catch-up can fire `system:feed-refresh` immediately, so
// wiring after would make those first refreshes fail "host not configured").
//
// The worker launcher (`spawnSystemWorker`) is INJECTED by the caller rather
// than imported here: it lives in the routes layer, and workspace code must not
// import routes (a workspace→routes cycle is exactly what the old
// `setAgentWorkerRunner` seam — now folded into `spawnWorker` — existed to
// avoid). `server/index.ts` (the host entry) is allowed to bridge the two.
import { configureFeedsHost, type AgentWorkerRunner } from "@mulmoclaude/core/feeds/server";
import { workspacePath } from "../workspace.js";
import { log } from "../../system/logger/index.js";
import { writeFileAtomic } from "../../utils/files/atomic.js";

export function configureFeeds(spawnWorker: AgentWorkerRunner): void {
  configureFeedsHost({
    workspaceRoot: workspacePath,
    log,
    // Feed state files use the plain (non-uniqueTmp) atomic write, as before.
    writeFileAtomic: (filePath, content) => writeFileAtomic(filePath, content),
    spawnWorker,
  });
}
