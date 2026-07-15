import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isMcpBrokerNotReadyError } from "../../server/agent/mcpBrokerFailover.ts";

// #2057: the retry that recovers a lost broker startup race hinges entirely on
// this detector. It must fire on the CLI's real message and stay silent on every
// other "not found" so a replay never masks a genuine failure (a bad skill, a
// missing file, a stale --resume id).

describe("isMcpBrokerNotReadyError", () => {
  it("matches the CLI's real permission-prompt-tool error verbatim", () => {
    const line =
      "Error: MCP tool mcp__mulmoclaude__handlePermission (passed via --permission-prompt-tool) not found. " +
      "Available MCP tools: mcp__claude_ai_Gmail__search_threads, mcp__claude_ai_Google_Drive__search_files";
    assert.equal(isMcpBrokerNotReadyError(line), true);
  });

  it("matches when wrapped by surrounding stderr (phrase intact)", () => {
    const msg = "2026-07-11 WARN prior log line\nError: MCP tool x (passed via --permission-prompt-tool) not found.\ntrailing";
    assert.equal(isMcpBrokerNotReadyError(msg), true);
  });

  it("requires the CONTIGUOUS phrase — the flag echo alone does not match", () => {
    assert.equal(isMcpBrokerNotReadyError("usage: claude --permission-prompt-tool <name>"), false);
  });

  it("requires the CONTIGUOUS phrase — a scattered flag + 'not found' does not match", () => {
    // The two markers present but not adjacent must NOT trigger a replay.
    const scattered = "started with --permission-prompt-tool mcp__x__h\n... later: some unrelated resource not found";
    assert.equal(isMcpBrokerNotReadyError(scattered), false);
  });

  it("does not fire on unrelated 'not found' errors (no false replay)", () => {
    assert.equal(isMcpBrokerNotReadyError("role 'writer' not found"), false);
    assert.equal(isMcpBrokerNotReadyError("collection 'inbox' not found"), false);
    assert.equal(isMcpBrokerNotReadyError("Cannot find module '@mulmobridge/protocol'"), false);
    assert.equal(isMcpBrokerNotReadyError("ENOENT: no such file or directory"), false);
    assert.equal(isMcpBrokerNotReadyError("HTTP 404 not found"), false);
  });

  it("does not collide with the stale-session failover phrase", () => {
    // Both recoveries inspect the same error events; each must own its trigger.
    assert.equal(isMcpBrokerNotReadyError("No conversation found with session ID: abc-123"), false);
  });

  it("returns false for empty input", () => {
    assert.equal(isMcpBrokerNotReadyError(""), false);
  });
});
