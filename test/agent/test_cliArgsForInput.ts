import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cliArgsForInput } from "../../server/agent/backend/claude-code.js";
import type { AgentInput } from "../../server/agent/backend/types.js";
import { ROLES, type Role } from "../../src/config/roles.js";

function requireRole(roleId: string): Role {
  const role = ROLES.find((candidate) => candidate.id === roleId);
  if (!role) throw new Error(`test setup: role '${roleId}' not found`);
  return role;
}

function makeInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    systemPrompt: "sys",
    message: "hi",
    role: requireRole("general"),
    workspacePath: "/tmp/does-not-matter",
    sessionId: `test-${randomUUID()}`,
    port: 0,
    activePlugins: [],
    extraAllowedTools: [],
    useDocker: false,
    ...overrides,
  };
}

describe("cliArgsForInput", () => {
  it("maps sessionToken onto claudeSessionId (the --resume id)", () => {
    const params = cliArgsForInput(makeInput({ sessionToken: "resume-123" }));
    assert.equal(params.claudeSessionId, "resume-123");
  });

  it("forwards the pass-through fields verbatim", () => {
    const params = cliArgsForInput(
      makeInput({
        systemPrompt: "SP",
        activePlugins: ["a", "b"],
        mcpConfigPath: "/cfg.json",
        extraAllowedTools: ["Bash"],
        effortLevel: "high",
      }),
    );
    assert.equal(params.systemPrompt, "SP");
    assert.deepEqual(params.activePlugins, ["a", "b"]);
    assert.equal(params.mcpConfigPath, "/cfg.json");
    assert.deepEqual(params.extraAllowedTools, ["Bash"]);
    assert.equal(params.effortLevel, "high");
  });

  it("leaves optional fields undefined when the input omits them", () => {
    const params = cliArgsForInput(makeInput());
    assert.equal(params.claudeSessionId, undefined);
    assert.equal(params.mcpConfigPath, undefined);
    assert.equal(params.effortLevel, undefined);
  });

  it("does not carry over non-CLI fields (message, workspacePath, port)", () => {
    const params = cliArgsForInput(makeInput({ message: "secret", port: 9999 }));
    assert.ok(!("message" in params));
    assert.ok(!("workspacePath" in params));
    assert.ok(!("port" in params));
  });
});
