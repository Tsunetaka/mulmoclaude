// Fail-over for the transient mulmoclaude MCP-broker startup race (#2057).
//
// Every chat the CLI spawns starts its own mulmoclaude MCP broker (a stdio
// child running `mcp-server.ts`). The CLI is launched with
// `--permission-prompt-tool mcp__mulmoclaude__handlePermission`, so if the
// broker's stdio connection is not ready by the time the model makes its first
// tool call, the CLI can't resolve the permission-prompt tool and the call
// fails with:
//
//   MCP tool mcp__mulmoclaude__handlePermission (passed via
//   --permission-prompt-tool) not found. Available MCP tools: ...
//
// The broker connects a couple of seconds later, so the same turn succeeds on a
// re-run. This is a RACE, distinct from the permanent MODULE_NOT_FOUND load
// failures (#2052 / #2056) that fail on every retry. It shows up most under the
// scheduler's same-minute fan-out (mitigated separately by staggering firings),
// but a cold single-task run can lose the race too, which staggering can't help.
//
// This module is the detector only. The retry orchestration (wait, then replay
// the turn once) lives in the fail-over loop in `server/api/routes/agent.ts`,
// alongside the stale-`--resume` recovery it mirrors (see `resumeFailover.ts`).

// The CLI's fixed phrasing when the permission-prompt tool can't be resolved:
//   MCP tool <name> (passed via --permission-prompt-tool) not found.
// Match the CONTIGUOUS phrase, not two substrings scattered across stderr — a
// replay can re-run work, so an unrelated "not found" (a missing file, an HTTP
// 404, a bad skill) plus a stray flag echo must never trigger it.
const BROKER_NOT_READY_PHRASE = "(passed via --permission-prompt-tool) not found";

export function isMcpBrokerNotReadyError(message: string): boolean {
  return message.includes(BROKER_NOT_READY_PHRASE);
}
