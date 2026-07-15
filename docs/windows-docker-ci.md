# Windows-host filesystem bugs in Linux Docker containers: reproducing them on GitHub Actions

The MulmoClaude sandbox runs `claude -p` inside a Linux Docker container and
bind-mounts the host workspace (including `node_modules`) into it. When the
host is Windows and the workspace uses `yarn` workspaces, `node_modules/
@mulmoclaude/*` gets **NTFS junctions with absolute Windows paths**. Inside
the Linux container those junctions dangle — the target `C:\Users\…` doesn't
exist in the container's mount namespace — and every module resolver that
walks `<dir>/node_modules/<pkg>/package.json` misses the package.

Two bugs of this shape have shipped and been fixed:

| Issue                                                         | Symptom                                                                                       | Fix                                                                                                                                                                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#1946](https://github.com/receptron/mulmoclaude/issues/1946) | MCP server dies at load: `MODULE_NOT_FOUND: @mulmoclaude/x-plugin`                            | PR [#1974](https://github.com/receptron/mulmoclaude/pull/1974) mounts each workspace package at `/app/pkg_modules/@mulmoclaude/<name>` and appends that dir to `NODE_PATH` so Node's CJS resolver falls through it |
| [#1982](https://github.com/receptron/mulmoclaude/issues/1982) | Silent preset-plugin load failure — `spotify` / `debug` / `edgar` / `email` MCP tools missing | PR [#1984](https://github.com/receptron/mulmoclaude/pull/1984) replaces the hand-rolled parent-walk in `resolvePresetRoot()` with `require.resolve.paths()`, which inherits the NODE_PATH fallback                 |

Both bugs were reported by Windows users and fixed blind (the maintainers
run on macOS / Linux). CI didn't catch either regression because there's no
runner in the standard `ubuntu-latest` matrix that reproduces the
"Windows FS → Linux container → dangling junction" chain. This doc covers
the CI approach the workflow at
[`.github/workflows/docker_sandbox_windows.yaml`](../.github/workflows/docker_sandbox_windows.yaml)
took to close that gap.

## Why the obvious approaches don't work

### `runs-on: ubuntu-latest` + simulated symlink

`test/agent/test_workspace_module_fallback.ts` and
`test/plugins/test_preset_loader_node_path.ts` do this: `symlinkSync(<absent>,
<primary>)` on POSIX simulates a dangling entry. It catches the resolver
logic, but it doesn't prove that a real NTFS junction bind-mounted into a
Linux container behaves the same way. In practice it does — but "in
practice" only after you've watched the CI run at least once.

### `runs-on: windows-latest` + `docker run <linux-image>`

GitHub-hosted `windows-latest` runners preinstall Docker CLI, but the engine
is Windows-container-only. No Linux backend. `docker run ubuntu:24.04`
errors:

```
docker: Error response from daemon: no matching manifest for windows/amd64
```

### `runs-on: windows-latest` + `choco install docker-desktop`

Chocolatey does install Docker Desktop successfully. But the daemon needs
first-run UI dialogs (license, welcome) that no headless CI can dismiss.
`docker info` errors with:

```
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine;
check if the path is correct and if the daemon is running
```

This is a well-known GHA hurdle and Docker Desktop has no `--accept-license`
CLI flag as of 2026-07.

## What works: WSL2 + native `docker.io`

`windows-latest` runners preinstall WSL2 (Ubuntu isn't installed by default
but `wsl --install` gets it in ~20s). Inside WSL2 we install `docker.io`
via `apt` and run `dockerd` as a background process. No first-run dialog,
no license prompt.

The Windows workspace at `C:\a\<repo>\<repo>` is visible from WSL2 at
`/mnt/c/a/<repo>/<repo>`. NTFS junctions on that FS surface as Linux
symlinks whose targets are Windows-style absolute paths (`C:\Users\…`)
that don't exist inside a Linux container's mount namespace — the exact
dangling-junction failure #1946 / #1982 need.

The workflow's key steps:

```yaml
- name: Set up WSL2 (Ubuntu-22.04)
  shell: pwsh
  run: |
    $distros = @()
    try { $distros = wsl --list --quiet 2>$null } catch { }
    if (-not ($distros | Where-Object { $_ -match "Ubuntu" })) {
      wsl --install -d Ubuntu-22.04 --no-launch
      Start-Sleep -Seconds 15
    }
    wsl -d Ubuntu-22.04 -u root -- uname -a

- name: Install docker.io inside WSL2
  shell: pwsh
  run: |
    wsl -d Ubuntu-22.04 -u root -- bash -c \
      "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io"

- name: Start dockerd in the background inside WSL2
  shell: pwsh
  run: |
    # nohup + disown so dockerd survives the wsl -e exit.
    # --iptables=false because WSL2's kernel lacks iptables_nat.
    wsl -d Ubuntu-22.04 -u root -- bash -c \
      "nohup dockerd --iptables=false --bridge=none > /var/log/dockerd.log 2>&1 &"
    # Poll until the daemon accepts connections (~30s cold, ~5s warm)
    for ($i = 0; $i -lt 30; $i++) {
      $null = wsl -d Ubuntu-22.04 -u root -- docker info 2>&1
      if ($LASTEXITCODE -eq 0) { break }
      Start-Sleep -Seconds 2
    }

- name: Run the container with Windows-FS bind mounts
  shell: pwsh
  run: |
    # Translate C:\a\... → /mnt/c/a/...
    $wsWin = "${{ github.workspace }}"
    $drive = $wsWin.Substring(0, 1).ToLower()
    $rest = $wsWin.Substring(3) -replace '\\', '/'
    $wsLinux = "/mnt/$drive/$rest"

    wsl -d Ubuntu-22.04 -u root -- docker run --rm `
      -v "${wsLinux}/node_modules:/app/node_modules:ro" `
      # ... more mounts ... `
      -e NODE_PATH=/app/node_modules:/app/pkg_modules `
      node:22-slim node /repro/probe.mjs
```

Full timing on the first-ever run (cold caches):

- `actions/checkout` + `setup-node`: ~1 min
- `yarn install`: ~5 min (NTFS + Defender-disabled)
- WSL2 Ubuntu install: ~30 s
- `apt install docker.io`: ~1 min
- `dockerd` startup: ~5 s
- `docker pull node:22-slim`: ~20 s
- probe run: ~5 s
- **Total: ~8 min**

## Anatomy of the probe

The probe (`test/sandbox-repro/probe.ts`) imports the shipped
`resolvePresetRoot()` from `server/plugins/resolvePresetRoot.ts` — the
same file the production `preset-loader.ts` uses. Breaking the fix in
production breaks the probe; that's the point. `resolvePresetRoot.ts`
was pulled out of `preset-loader.ts` specifically to give the probe a
minimal-deps import target (only `node:fs` / `node:module` / `node:path`)
so it can run in a plain `node:22-slim` container without dragging in
the full server graph (logger, plugin registry, …).

The probe also keeps ONE inline copy — the legacy parent-walk-only
resolver from BEFORE the fix — so a check can prove the container
environment is actually reproducing the bug. If a future WSL2 or Docker
update stops dangling the junction, that check fails and tells us the
whole probe stopped exercising the failure mode.

Assertions:

1. **Environment sanity** — `/app/node_modules/@mulmoclaude/x-plugin/package.json`
   MUST dangle (`existsSync` false). If this passes, the workflow's bind mount isn't
   reproducing the bug and everything below is meaningless.
2. **Fallback mount present** — `/app/pkg_modules/@mulmoclaude/x-plugin/package.json`
   MUST exist (PR #1974's mount).
3. **Node's own resolver sees NODE_PATH** — `require.resolve.paths()` MUST include
   `/app/pkg_modules`. Direct check that the env wiring works.
4. **Legacy resolver reproduces the bug** — the inline parent-walk-only
   implementation MUST return `null` for `@mulmoclaude/spotify-plugin`.
5. **Shipped resolver works** — `resolvePresetRoot()` imported from
   `server/plugins/resolvePresetRoot.ts` MUST resolve every preset package to the
   `/app/pkg_modules/` fallback.
6. **Negative case** — the shipped resolver returns `null` for a made-up preset name
   (no false positives).

`require.resolve()` for check #3 was tempting (fully resolve, prove the
whole chain works) but it walks the package's `main`/`exports` entries
which point at `dist/` files that aren't built in this CI job — the check
would fail without proving anything about the resolver.
`require.resolve.paths()` returns the search-path list without touching
main entries.

## The end-to-end step: boot the real MCP child (#2052)

The probe above proves the _preset resolver_ survives dangling junctions. It says nothing about
whether the MCP child actually **starts**. #2052 slipped through exactly there: the fallback mount
list covered `@mulmoclaude/*` but not `@mulmobridge/protocol`, which `mcp-server.ts` reaches through
`src/types/events.ts`. Every unit test passed; the child died at load on Windows and the agent lost
all its tools.

So the workflow also runs the real `server/agent/mcp-server.ts` in the container and speaks the MCP
handshake to it (`test/sandbox-repro/mcp-handshake.jsonl`), asserting `handlePermission` comes back
in `tools/list`.

Crucially, the mounts, env and argv are **not written in the workflow**. They come from
`test/sandbox-repro/print-mcp-container-spec.ts`, which calls the shipped `buildMulmoclaudeServer()`
and `workspaceModuleMounts()`. Hand-copied container args are how #2052 hid for two releases: the
Docker smoke test duplicated them and silently kept reproducing the pre-fix layout, so two shipped
fixes were invisible to it. Derive; never duplicate.

This step needs `yarn build:packages:dev` — the child imports the workspace packages' built `dist/`,
and production ships built output.

## Gotchas

### `dockerd --iptables=false --bridge=none`

WSL2's kernel doesn't have `iptables_nat`. Without the flags `dockerd`
crashes at startup ("Failed to Setup IP tables"). We don't need
Docker networking for a single-container probe run, so it's safe to
disable both.

### `nohup … &` inside `wsl -e bash -c`

`wsl -e` runs the command and exits. Child processes started with plain
`&` get SIGHUP'd when the WSL session ends. `nohup` + redirecting all
descriptors keeps `dockerd` running for the next `wsl -e docker …` call.

### NTFS junction sanity check

`yarn` v1 workspaces create NTFS junctions on Windows. A future yarn
version could switch to hardlinks / copies, which wouldn't dangle in
Linux containers — silently un-reproducing the bug. The workflow
asserts `LinkType == "Junction"` after install so that regression is
noisy.

### `docker: Error response from daemon: no matching manifest for windows/amd64`

If you see this from the WSL2 `docker` invocation, `dockerd` didn't
successfully start with the Linux engine. Check
`/var/log/dockerd.log` inside WSL2 (`wsl -d Ubuntu-22.04 -u root -- cat
/var/log/dockerd.log`).

### `Cannot find package 'tsx' imported from …`

For the sibling POSIX unit test
(`test/plugins/test_preset_loader_node_path.ts`), the child Node process
runs from an isolated tmp cwd with no `node_modules`. Passing `--import
tsx` fails because tsx isn't resolvable from that cwd. Resolve tsx's
absolute path in the parent (`require.resolve("tsx")`) and pass the
absolute path with `pathToFileURL()` instead.

## Why the workflow only runs on schedule + workflow_dispatch

Every PR to `resolvePresetRoot` or the sandbox mount config is already
covered on `ubuntu-latest` and `macos-latest` by
`test/plugins/test_preset_loader_node_path.ts` — it exercises the shipped
resolver against a POSIX-symlink stand-in for the dangling junction.
Windows CI adds value ONLY for detecting **upstream environment drift**
(yarn switching from junctions to hardlinks, WSL2 changing how junctions
surface, Docker changing bind-mount semantics). That drift is slow-moving,
so a daily canary is sufficient — running on every PR would burn Windows
minutes without catching anything the POSIX test doesn't.

## When to reach for this

Not for every Docker-sandbox test. Reach for it when the bug specifically
depends on:

- **Windows filesystem semantics** (NTFS junctions / hardlinks / long
  paths / case-insensitive names)
- Bind-mounted into a **Linux container**, so the container sees the
  Windows FS through WSL2's translation layer
- And Node / Python / any language runtime with its own path resolver has
  a code path that misses the WSL2-mounted FS's quirks

For sandbox bugs that reproduce on POSIX (most of them), a plain
`ubuntu-latest` job with `symlinkSync` (`test/agent/
test_workspace_module_fallback.ts`) is faster, more portable, and equally
diagnostic.
