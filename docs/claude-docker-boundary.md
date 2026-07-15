# Claude ↔ Docker sandbox: what runs where

When MulmoClaude spawns `claude -p` for an agent turn, the CLI runs
inside the Docker sandbox but **most of its power lives on the host**.
This doc walks through the split so you can predict where a given tool
call actually executes — useful when debugging permission errors,
missing binaries in `Bash`, or an MCP tool that "works locally but not
in Docker".

If `DISABLE_SANDBOX=1` is set (or Docker isn't running), every row in
the table below collapses to "host" — the sandbox layer is skipped and
`claude` runs directly on the host with full access.

## Claude built-in tools (Bash / Read / Write / Edit / Grep / Glob …)

**Container.** Claude Code implements these itself; the process is
whatever `docker run` started, so the tool executes inside the
sandbox. Implications:

- `Bash` sees only the binaries in the `node:22-slim` sandbox image
  — no `git`, `python`, `jq`, or arbitrary system tools by default
  ([#162](https://github.com/receptron/mulmoclaude/issues/162),
  [`docs/mcp-sandbox.md`](mcp-sandbox.md)).
- File I/O uses the workspace bind mount: `~/mulmoclaude/` on the host
  shows up as `/home/node/mulmoclaude/` in the container, so writes
  land on real host files but `Read`/`Write` cannot see anything
  outside the mounted paths.
- Host credentials (SSH keys, `.aws`, npm auth …) are **not** visible
  from `Bash` unless you've explicitly opted them in via
  `SANDBOX_SSH_AGENT_FORWARD` or `SANDBOX_MOUNT_CONFIGS`
  ([`docs/sandbox-credentials.md`](sandbox-credentials.md)).

## MCP — the two-tier arrangement

Claude thinks it's calling a local MCP tool. In practice the tool's
**stdio subprocess** lives in the container but its **actual
implementation** lives on the host. The container-side piece is a
thin proxy.

### mulmoclaude built-in MCP (`server/agent/mcp-server.ts`)

1. Claude reads `--mcp-config` and starts `tsx /app/server/agent/mcp-server.ts`
   as a subprocess **in the container**
   (`buildMulmoclaudeServer` in `server/agent/config.ts:276`).
2. The bridge subprocess talks JSON-RPC over stdio with Claude.
3. For every tool call, the bridge issues an **HTTP request to
   `MCP_HOST=host.docker.internal:PORT/api/…`** — i.e. back to the
   host's Express server (`config.ts:284`).
4. The **real tool logic runs on the host** — file writes to the
   workspace, plugin dispatch, DB queries, external API calls, other
   MCP tools' side effects. The container-side bridge just forwards.

Net effect: Claude gets the full power of the host through a
stdio-shaped hole. This is the "bypass" people describe.

### User-defined MCP (added in the Settings UI)

| Kind | Docker-mode routing |
|---|---|
| **HTTP** | URL rewritten so `localhost` → `host.docker.internal` (`rewriteLocalhostForDocker` in `config.ts:116`). Claude in the container connects over HTTP; the server itself runs on the **host** where the user configured it. |
| **stdio** (default) | **Dropped.** The `node:22-slim` sandbox image can't host arbitrary stdio runtimes ([#162](https://github.com/receptron/mulmoclaude/issues/162), [#1334](https://github.com/receptron/mulmoclaude/issues/1334)). The Settings UI surfaces this before you save. |
| **stdio + `hostExecInDocker: true`** ([#1421 Phase B](https://github.com/receptron/mulmoclaude/issues/1421)) | Explicit opt-in. MulmoClaude starts the stdio server on the **host** behind a `stdio ↔ HTTP` gateway and rewrites the config to `http` so the sandboxed Claude can reach it (`config.ts:186`). |

## Where-what summary

| What | Where it runs |
|---|---|
| `claude -p` CLI itself | **container** |
| Claude built-in `Bash` / `Read` / `Write` / `Edit` / `Grep` / `Glob` | **container** |
| mulmoclaude MCP stdio subprocess (bridge proxy) | container |
| mulmoclaude MCP tool **implementation** | **host** (Express) |
| User HTTP MCP | **host** (URL rewritten to reach it) |
| User stdio MCP (default) | *not called* |
| User stdio MCP (`hostExecInDocker: true`) | **host** (via stdio↔HTTP gateway) |
| Anthropic API traffic | container (outbound directly) |

## Consequences

- Host secrets (`git` config, `npm` token, `~/.aws`, SSH keys, …) are
  **safe from `Bash`** by default. Escape hatches are explicit env
  vars documented in [`sandbox-credentials.md`](sandbox-credentials.md).
- The workspace is writable, because the bind mount is `rw`. Files
  Claude writes appear on the host under `~/mulmoclaude/`.
- MCP is the **intended** channel for exposing host capabilities to
  the agent. If you want Claude to reach a host service, expose it as
  an HTTP MCP (auto-rewritten) or add a tool to the mulmoclaude
  broker.
- `DISABLE_SANDBOX=1` collapses everything to the host — useful for
  debugging without a container rebuild, but Claude then has host-wide
  authority through `Bash`.

## Related

- [`docs/developer.md#docker-sandbox`](developer.md#docker-sandbox-dockerfilesandbox)
  — bind mounts, image build, path translation
- [`docs/developer.md#container-only-env-auto-set`](developer.md#container-only-env-auto-set)
  — env vars auto-set inside the container
- [`docs/mcp-sandbox.md`](mcp-sandbox.md) — TL;DR of the stdio-vs-HTTP
  MCP situation
- [`docs/sandbox-credentials.md`](sandbox-credentials.md) — SSH agent
  forward + `SANDBOX_MOUNT_CONFIGS` allowlist
