# MCP servers and the Docker sandbox

> 日本語: [mcp-sandbox.ja.md](mcp-sandbox.ja.md)

MulmoClaude can run Claude inside a Docker sandbox to isolate it from your host system (`yarn dev` without `DISABLE_SANDBOX=1`, or `Settings → Docker sandbox`). When the sandbox is on, **stdio MCP servers are dropped by default**; HTTP MCP servers continue to work. There is one explicit opt-in — `hostExecInDocker` — that runs a stdio server on the host behind a gateway so it still works under Docker. This page explains why stdio is dropped by default, how to pass environment variables, and how the opt-in works. **If you just want the answer, read [Short version](#short-version-can-i-run-a-stdio-mcp) — the rest of the page is the "why".**

## Short version: can I run a stdio MCP?

**Yes — including with the Docker sandbox on. No coding required.** What you do depends on one thing: is the Docker sandbox on or off? (Not sure? Open **Settings → Docker sandbox** and see whether it's enabled.)

**Sandbox OFF** — nothing special. Add the MCP server (Settings → MCP Servers, or a catalog entry) and it just works, like on any normal computer.

**Sandbox ON** — by itself the server **won't start**; you'll see *"⚠ Won't run while the Docker sandbox is enabled."* next to it. To make it work, do this once:

1. Open **Settings → MCP Servers** and find your server.
2. Tick the checkbox **"Run on the host anyway (advanced)."**
3. Save. Done — the server runs and Claude can use it.

(Prefer editing files? Add `"hostExecInDocker": true` to that server's entry in `~/mulmoclaude/config/mcp.json` instead — [example below](#running-a-stdio-mcp-under-docker-anyway-hostexecindocker).)

**The one thing to understand before you tick it:** that checkbox runs **that server directly on your computer**, outside the Docker "safety box." The box still protects everything else — only the server you ticked steps outside it (it's per-server, so you decide for each one). So tick it **only for servers you added on purpose and trust** (e.g. your own email/IMAP server). Not comfortable with that? Turn the Docker sandbox off entirely instead — then every stdio server runs normally, but Claude loses the extra isolation.

In one line: **stdio works everywhere; if the Docker sandbox is on, tick "Run on the host anyway" for that server.**

## TL;DR

- **stdio MCP servers** run as **child processes of Claude**. When Claude is sandboxed, the child process lands inside the sandbox too. The sandbox image is intentionally minimal (`node:22-slim` + `claude` + `tsx`) — most stdio MCPs need a richer environment to start.
- **HTTP MCP servers** run on the host (or remote) and Claude inside the sandbox talks to them over the network. The MCP server keeps its proper environment; the sandbox just opens a network path.
- When the sandbox is on, MulmoClaude **drops stdio entries from the per-session MCP config**. Disabling sandbox (`DISABLE_SANDBOX=1`) loads them all.
- **Opt-in escape hatch** (`"hostExecInDocker": true`): keep the sandbox on but run a stdio server on the **host** behind a `stdio ↔ HTTP` gateway, so the sandboxed agent reaches it over HTTP. It's a **per-server** flag — set it on as many servers as you need; each opted-in server gets its own gateway. Gated behind an explicit risk acknowledgment in the UI. See [Running a stdio MCP under Docker anyway](#running-a-stdio-mcp-under-docker-anyway-hostexecindocker).

## The full story

### How stdio MCP servers work

stdio is the original MCP transport. Claude CLI spawns the MCP server as a child process and the two communicate over stdin/stdout using JSON-RPC:

```
[Claude CLI] ──spawn──> [MCP server process]
              │
              └── stdin / stdout pipes
                  carrying MCP JSON-RPC
```

The MCP server inherits Claude's environment — current directory, environment variables, the file system as Claude sees it. That inheritance is the source of every problem listed below.

### Why the sandbox is "minimal"

The sandbox image bakes in only what Claude itself needs to run:

- Node.js 22 (slim variant — no build-essential, no Python, no compilers)
- The `claude` binary
- `tsx` (used by hook subprocesses)

That's intentional. A bigger image means a bigger attack surface, longer pull times, and slower cold starts. The sandbox exists to **isolate** Claude — adding every possible runtime to it would defeat that goal.

### Why stdio MCP servers don't fit

When Claude lives inside the sandbox, every stdio MCP server it spawns also lives inside the sandbox. The following all break at once:

#### 1. Runtimes aren't there

A typical stdio MCP server invocation:

```
npx -y @modelcontextprotocol/server-memory
```

needs Node + npm cache + outbound network to npm registry. The sandbox image has Node but **no warmed npm cache** and (by policy) **no outbound network beyond an allowlist**. The first `npx -y` either fails immediately (no network) or downloads hundreds of megabytes per cold start (with network).

Python / Ruby / Go / .NET MCPs need their respective runtimes, none of which are in the image.

To "fix" this by bundling every runtime, we'd ship a multi-gigabyte image and still couldn't keep up with new entries. That's a non-starter for the isolation use case.

#### 2. Filesystem boundary

Many stdio MCPs assume host-level filesystem access:

| MCP | Reads / writes |
|---|---|
| `server-memory` | Memory state file |
| `server-filesystem` | An arbitrary tree the user passes |
| GitHub MCP | `~/.config/github` token |
| Spotify-style MCPs | OAuth tokens at fixed host paths |

The sandbox mounts only the workspace (`~/mulmoclaude/`). Everything else doesn't exist from inside. Even paths that DO exist are read-only or volume-mounted with different ownership. Most MCPs that work fine on the host immediately fail when their expected directory is missing.

#### 3. Authentication

OAuth tokens, API keys stored in `~/.config/...`, system keyrings — all out of reach inside the sandbox. The MCP starts, fails its first authenticated request, and exits.

#### 4. Network policy

Even when the MCP server runs locally, it often needs to reach a service over the public internet (npm, OAuth callbacks, the MCP's underlying API). The sandbox's network is intentionally narrowed to the MulmoClaude server's loopback so a compromised Claude can't exfiltrate data. Any outbound the MCP needs is blocked.

#### 5. Process lifecycle

Sandbox containers are ephemeral. `~/.npm` cache, MCP server side-effects on disk, anything the MCP relies on between runs — all wiped between container restarts. A stdio MCP that worked on first cold start will fail on the second because its state is gone.

#### 6. Silent-failure mode

Claude CLI 2.1.x tries to spawn each stdio MCP at startup and **silently exits with code 1 if any spawn fails** (no stderr line). When a sandbox image lacks a runtime the MCP needs, the user sees `[Error] claude exited with code 1` and nothing else. That's the symptom #1334 caught: the MCP-config writer was passing stdio entries into the sandbox even though we'd already decided not to support them, and the failure modes above tripped silently.

### Why HTTP MCP servers work

HTTP MCPs don't share Claude's process tree:

```
[Claude CLI (in sandbox)] ──HTTP via mapped port──> [MCP server (host or remote)]
```

The MCP server stays in its proper environment — full filesystem, full network, host's OAuth tokens, whatever. The sandbox just opens a single network path. None of the problems above apply: the runtime is on the host, the filesystem is the host's, the auth lives where it always lives, and the MCP's outbound network is its own concern.

This is why HTTP-style entries (`type: "http"`) and SSE-style entries are fine under Docker. Only `type: "stdio"` is problematic.

### Design decision

The two theoretical alternatives were:

| Option | Trade-off |
|---|---|
| **A — Fat sandbox image** | Bake every runtime in. Image inflates to gigabytes, attack surface widens, build times balloon, and the user's `~/.config` still isn't accessible — most MCPs still wouldn't work. Defeats the sandbox's purpose. |
| **B — Sidecar containers per MCP** | Spawn each stdio MCP in its own host-side container, then have Claude reach it over network. This is essentially the HTTP path with extra orchestration. Once you're talking over network, the MCP server might as well be an HTTP MCP. |

Neither pays off. MulmoClaude takes the simpler path: **stdio is dropped by default when the sandbox is on**. Users who need stdio MCPs run with `DISABLE_SANDBOX=1`, use HTTP MCPs (which can be a local server — just point them at a `http://localhost:…` URL), or opt a single server into the host-exec escape hatch below.

## Running a stdio MCP under Docker anyway (`hostExecInDocker`)

Option B above (a per-MCP host-side gateway) is available as an explicit, per-server opt-in — this is the way to run an `npx`-based stdio MCP while keeping the sandbox on. It's evaluated **per entry**, so you can opt in as many stdio servers as you like — each gets its own gateway. Set `"hostExecInDocker": true` on each stdio entry (via the MCP Settings tab's risk-acknowledgment checkbox, or by hand in `mcp.json`):

```json
{
  "mcpServers": {
    "imap": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-imap-mcp"],
      "env": { "IMAP_HOST": "imap.example.com", "IMAP_USER": "me", "IMAP_PASS": "secret" },
      "hostExecInDocker": true,
      "enabled": true
    }
  }
}
```

What happens then (`server/agent/config.ts` `prepareUserServers` → `server/agent/stdioHttpShim.ts`):

1. MulmoClaude spawns the stdio server **on the host** — wrapped in a `stdio ↔ HTTP` gateway (`supergateway`). Because it runs on the host, `npx` has Node + network + your real home directory, so the runtime / filesystem / auth problems above don't apply.
2. The per-session MCP config handed to Claude is rewritten to `type: "http"` pointing at that gateway (`localhost` → `host.docker.internal` for the container). The sandboxed agent reaches the server over HTTP, exactly like any HTTP MCP.
3. The gateway is torn down when the agent turn ends.

**This deliberately escapes the sandbox for each server you opt in.** The whole point of the sandbox is isolation; a host-exec MCP runs with your host's authority. The Settings UI marks it with a red badge and requires an explicit acknowledgment. Only opt in for servers you trust. If the gateway fails to start, the entry falls back to the safe default (dropped + logged).

## Passing environment variables

stdio entries take an `env` map — this is how you hand credentials (API keys, IMAP host/user/password, …) to the server:

```json
"env": { "IMAP_HOST": "imap.example.com", "IMAP_USER": "me", "IMAP_PASS": "secret" }
```

- **Sandbox off / stdio on the host**: the values are passed straight to the spawned MCP process (Claude CLI's standard `--mcp-config` `env`).
- **`hostExecInDocker: true`**: the gateway spawns the host process with `{ ...process.env, ...spec.env }`, so the server sees both your host environment and the `env` you set.
- Values are **literal** in `mcp.json`. `${VAR}` placeholders are resolved only when installing a catalog entry through the Settings form — a hand-written `mcp.json` needs real values, not placeholders.
- `mcp.json` is written mode `0600`, but the credentials still live there **in plaintext** — it is file-permission protection, not a secrets vault. Keep the workspace off shared/synced locations if that matters to you.

## What MulmoClaude does in practice

When the Docker sandbox is on, two things happen to each MCP entry from `~/mulmoclaude/config/mcp.json`:

1. `prepareUserServers` (`server/agent/config.ts`) drops any `type: "stdio"` entry from the per-session MCP config it writes. Claude CLI never sees them — no spawn attempt, no silent exit.
2. `userServerAllowedToolNames` (same file) drops the same entries from the `--allowedTools` allowlist. So even if a previously-cached `mcp__<server>` tool name somehow leaked through, the CLI wouldn't be permitted to call it.

The exception is `"hostExecInDocker": true`: `prepareUserServers` starts those servers on the host and rewrites them to `type: "http"` *before* the drop, so they survive as HTTP entries the sandboxed agent can reach.

A `log.info("mcp", "skipping stdio server in Docker mode", { serverId, transport: "stdio" })` line is emitted per drop so an operator scanning the server log knows why an entry isn't loading.

The settings UI surfaces this directly: any stdio entry shown while the Docker sandbox is on carries a warning badge plus a "Learn more" link to this page.

## Workarounds

- **You don't need the sandbox**: launch with `DISABLE_SANDBOX=1 yarn dev` (or toggle the setting). All stdio MCPs load normally.
- **You want the sandbox, you have an HTTP variant**: switch the MCP entry's `type` to `http` and point at a local server. Many MCP servers expose both transports.
- **You want the sandbox, you only have a stdio implementation**: set `"hostExecInDocker": true` on the entry ([above](#running-a-stdio-mcp-under-docker-anyway-hostexecindocker)). MulmoClaude runs the stdio server on the host behind a gateway and rewrites the config to HTTP for you — no manual shim. (You can still wrap it by hand — run the stdio MCP on the host with your own HTTP shim in front and add it as a `type: "http"` entry — if you'd rather manage the process yourself.)

## Related code

- `server/agent/config.ts` — `prepareUserServers`, `userServerAllowedToolNames` (the drop sites)
- `server/agent/index.ts` — picks `useDocker` and passes it down
- `src/components/SettingsMcpTab.vue` — the settings UI warning that links here
- `docs/sandbox-credentials.md` — orthogonal: how secrets get into the sandbox at all

## History

- **#162** introduced the Docker sandbox, established the stdio carve-out at the allowlist layer with the comment "the sandbox image is too minimal to run most of them".
- **#1334** caught the asymmetry: stdio entries were still being written to the per-session MCP config, so Claude CLI tried to spawn them, fell into the silent-exit-1 mode, and the user saw an unhelpful `[Error] claude exited with code 1`. The fix made `prepareUserServers` symmetric with the allowlist drop, and this document was added so the underlying constraint is discoverable without re-reading the issue.
