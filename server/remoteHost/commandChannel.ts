// Command-channel protocol for this host.
//
// The wire types + Firestore path helpers now live in the shared, browser-safe
// `@mulmoclaude/core/remote-host` (so the host runner and the mobile client
// can't drift). This module re-exports them and pins this host's channel id.
export * from "@mulmoclaude/core/remote-host";

// This MulmoClaude server host's hardcoded channel id. The remote and host just
// agree on the id — there is no discovery / host registry. (MulmoTerminal uses
// its own id so the two never compete for the same command queue.)
export const HOST_ID = "mulmoclaude";
