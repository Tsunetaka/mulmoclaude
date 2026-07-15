# Error recovery — when a tool call fails

This is the lookup the agent reads BEFORE asking the user a clarifying
question or giving up on a failing tool call. Each section is keyed by
the error message you'd see in tool output, with the cause and the
documented fix.

Cite the section you used in your reply so the user can follow up
(e.g. "Per `config/helps/error-recovery.md` § gh-auth / SSH …").

If no section here matches, list the workspace's other help files
(`ls config/helps/`) and Read whichever name best matches the failing
area (`sandbox.md`, `github.md`, `collection-skills.md`, etc.) before
falling back to asking the user.

## gh / git / SSH errors inside the sandbox

### Symptoms

- `gh: To authenticate, please run gh auth login`
- `git@github.com: Permission denied (publickey)`
- `Could not resolve host: github.com`
- `Permission denied (publickey)` on `git push` / `git clone <ssh-url>`
- `fatal: Could not read from remote repository`

### Cause

The Claude Code agent runs inside a credential-free Docker sandbox by
default. The host's SSH agent and `gh` config aren't exposed unless the
user opts them in.

### Fix

Tell the user to enable the two opt-in mounts on the next agent spawn
(see also `config/helps/sandbox.md` for the full contract):

```bash
# Forward the host's SSH agent into the container.
# Private keys stay on the host; only the signing oracle is exposed.
SANDBOX_FORWARD_SSH_AGENT=1 \
# Mount allowlisted config files/dirs read-only — including ~/.config/gh.
SANDBOX_MOUNT_CONFIGS=gh \
  yarn dev   # or: npx mulmoclaude
```

Equivalent CLI flags: `--sandbox-forward-ssh-agent --sandbox-mount-configs=gh`.

After restart, inside the agent's first tool turn verify:

```bash
ssh-add -l                      # should list at least one key
gh auth status                  # should report logged in
```

If `ssh-add -l` fails, the host's SSH agent isn't running — tell the
user to start it (`ssh-add ~/.ssh/id_*` on macOS / Linux). If
`gh auth status` fails, the user needs to run `gh auth login` on the
host first (host config is mounted read-only into the sandbox).

### When neither helps

The sandbox itself can be turned off for the session with
`DISABLE_SANDBOX=1 yarn dev` / `--disable-sandbox`. The agent then
inherits the user's full environment. Recommend this only when the
credential mount approach didn't resolve the issue — the sandbox is
the safer default.

## Collection registry — Contribute / Discover failures

### Symptoms

- Contribute flow: `gh pr create` fails, `git push` rejected, or the
  registry clone fails inside `github/`.
- Discover tab loads no entries, or one registry's cards are missing.

### Cause + fix

For the Contribute side, the underlying issue is almost always
sandbox credentials — see the gh/git/SSH section above before anything
else.

For Discover, multi-registry config lives at
`config/collections-registries.json`. A malformed entry there is
silently dropped; check the server log for
`[collections-registry] registry config entry rejected`. The file
format and validation rules are documented in
`config/helps/collection-skills.md` (Contribute bundle layout) and the
shipped registry repo's README. Common rejections:

- URL not HTTPS, or includes embedded credentials.
- `rawBaseUrl` contains a `?` query or `#` fragment.
- `name` reuses the reserved value `official`.
- `name` doesn't match `[A-Za-z0-9][A-Za-z0-9_-]{0,31}`.

## Marp slide PDF — empty / image / font issues

### Symptoms

- PDF export of a Marp deck produces tofu (□□□) for Japanese / CJK text.
- Inline images in a slide are missing from the PDF.
- A custom Marp `theme: <name>` is ignored.

### Fix

CJK fonts (Hiragino on macOS, Yu Gothic / Meiryo on Windows, Noto Sans
CJK on Linux) need to exist on the **host running the server**, not
in the sandbox (PDF render happens server-side via puppeteer). On
Linux: `sudo apt-get install fonts-noto-cjk`. Docker host:
`apt-get install -y fonts-noto-cjk` in the production Dockerfile.

Inline images missing from the PDF: paths must be relative to the
`.md` file, NOT absolute or workspace-rooted. See the "Image
references in markdown / HTML" section of the system prompt for the
rule.

Custom theme ignored: themes live in `~/mulmoclaude/config/marp-themes/<name>.css`.
The filename (sans `.css`) is the theme slug; only `[A-Za-z0-9_-]` is
allowed. Reload the browser tab after adding a theme — preview caches
per session.

## Build / yarn workspace ordering

### Symptoms

- `yarn dev` fails on a fresh clone with
  `Cannot find module '@mulmoclaude/<x>-plugin/server'` or similar.
- A workspace package's `dist/` is missing on first run.

### Fix

```bash
yarn build:packages   # builds every shared workspace package in tier order
yarn dev              # then the dev server picks them up
```

If a specific package keeps failing, build just it:
`yarn workspace @mulmoclaude/<name> run build`. The build pipeline
runs plugins before services so cross-package imports resolve cold.

## Plugin runtime — install / drift

### Symptoms

- A runtime plugin shown in `/skills` doesn't load, or its routes 404.
- After upgrading the plugin host, a previously-installed plugin
  reports a peer-dependency mismatch (e.g. `gui-chat-protocol`
  version skew).

### Fix

Runtime plugins are installed via tgz under `~/mulmoclaude/plugins/`
with a ledger at `plugins/plugins.json`. Reinstall the failing
plugin via the `/skills` UI to refresh both the tgz and the ledger.
A version skew on a peer dep means the plugin was built against an
older host — bump the plugin via the Discover tab's update flow.

## Fallback

If none of the above matches the failing tool output:

1. `ls config/helps/` to see every shipped help file.
2. Pick the file whose name most closely matches the failing area
   (`sandbox.md`, `github.md`, `feeds.md`, `presentation-deck.md`,
   `mulmoscript.md`, `spreadsheet.md`, etc.) and Read it.
3. If you find a fix there, apply it and cite the help by path in
   your reply.
4. If nothing fits, surface the raw error to the user and say
   "no documented fix found in `config/helps/` — could you share more
   context so we can resolve this together?" rather than silently
   guessing or retrying the same command.

## When you discover a new common error

If you resolve a new class of error that other users are likely to
hit, suggest to the user that we extend this file. Don't edit it
yourself — additions to `config/helps/error-recovery.md` are managed
by the project maintainers so the canonical copy in
`packages/core/assets/helps/error-recovery.md` and the installed copy
stay in sync.

## Sandbox MCP server dies at load — `Cannot find module '@…/…'`

### Symptoms

- Chatting fails before any tool runs, with:
  `Error: MCP tool mcp__mulmoclaude__handlePermission (passed via --permission-prompt-tool) not found.`
- Or, in the server log: `[agent-stderr] Error: Cannot find module '@mulmobridge/protocol'`
  (or `@mulmoclaude/chart-plugin`, `@gui-chat-plugin/camera`, …) followed by a `Require stack:`
  listing `/app/server/agent/mcp-server.ts`.
- Sandbox (Docker) mode only. The broker dies **permanently** — it fails on every manual retry
  too (contrast the transient scheduler race below, which succeeds on a manual re-run).

### Cause

The MCP child resolves its imports against `/app/node_modules` plus the `/app/pkg_modules`
fallback on `NODE_PATH`. It dies at load when a package it imports is reachable from neither. Two
layouts cause that:

1. **Windows source checkout.** `yarn` links workspace packages into `node_modules/` as **NTFS
   junctions**; their absolute Windows target (`C:\Users\…`) does not exist in the Linux container,
   so every junction dangles. `server/agent/config.ts` bind-mounts a junction-free copy of each
   workspace package at `/app/pkg_modules/<name>`; a package missing from that list is invisible.
2. **npx install with nested `node_modules`.** npm sometimes places a dep in the nested
   `<packageRoot>/node_modules` (a version conflict, or a half-deduped npx cache from repeated
   overwrite-updates) instead of hoisting it to `<projectRoot>/node_modules`. Only the latter is
   mounted to `/app/node_modules`, so the nested dep is invisible.

Either way the child dies before the MCP handshake, so the agent loses **every** MCP tool at once —
`handlePermission` included, which is why the CLI complains about the permission-prompt tool rather
than about the missing module.

### Fix

Both layouts are handled automatically: the Windows case mounts every workspace scope, and the npx
case mounts the nested `<packageRoot>/node_modules` onto `/app/pkg_modules`. If you see this anyway:

```bash
# Check the SHIPPED mount list, not a hand-mounted copy: does the package the
# child failed on appear in what workspaceModuleMounts() actually produces?
node_modules/.bin/tsx test/sandbox-repro/print-mcp-container-spec.ts \
  | grep pkg_modules/<name>       # <name> e.g. @mulmobridge/protocol

# The workspace dists must exist — production ships built output.
yarn build:packages:dev
```

A stale `dist/` looks identical from the outside: the mount is there, but its `exports` target is
absent. Rebuild before suspecting the mounts.

For an **npx** install specifically, the quickest user-side unblock is to clear the npx cache so
the next launch installs a clean, fully-hoisted tree:

```bash
rm -rf ~/.npm/_npx        # then re-run:
npx mulmoclaude@latest
```

## Scheduled run fails once with `handlePermission not found`, but works on a manual retry

### Symptoms

- A scheduled skill / user task fails with the SAME
  `MCP tool mcp__mulmoclaude__handlePermission ... not found` message — but running the identical
  skill by hand immediately afterwards succeeds.
- More frequent when several tasks are scheduled for the same minute (e.g. multiple 20:00 UTC
  jobs). The failed run's transcript is tiny (a few hundred bytes to a few KB) and its recorded
  duration is only milliseconds.

### Cause

This is a transient STARTUP RACE, not the permanent load failure above. Each scheduled chat spawns
its own `mulmoclaude` MCP broker; when many chats launch in the same instant the broker boots under
contention and can connect a moment after the agent's first tool call, so the permission-prompt
tool is briefly absent. The broker connects seconds later — which is why a manual re-run works.

The scheduler now staggers same-minute firings by a second each to reduce this contention (#2057),
so it should be rare. It is NOT a module-resolution problem — the mounts / `dist` are fine.

### Fix

Just re-run the task. If it recurs often on a busy schedule, spread the tasks across different
minutes rather than stacking them on the same one.

### Regression coverage

`.github/workflows/docker_sandbox_windows.yaml` boots the real `mcp-server.ts` inside a Linux
container from a Windows host (WSL2 + native `dockerd`), with the same mounts / env / argv the
shipped builders produce, and asserts `handlePermission` comes back over the MCP handshake. See
`docs/windows-docker-ci.md`.
