// Reproduces the #2052 crash verbatim, in the production package scope.
//
// Bind-mounted to `/app/server/agent/static-import-2052.ts`, i.e. next to the
// real `mcp-server.ts`, with the same mounts and NODE_PATH the sandbox uses.
// The static import is the one `server/agent/mcp-tools/index.ts` line 2 makes.
//
// Expected BEFORE the fix: a CJS `Cannot find module '@mulmoclaude/x-plugin'`
// with a `Require stack:` — byte-identical to the trace in issue #2052,
// proving that PR #1995's ESM hook never gets consulted.
// Expected AFTER the fix: prints the resolved export.

import { readXPost } from "@mulmoclaude/x-plugin";

console.log(`static import resolved: readXPost is ${typeof readXPost}`);
