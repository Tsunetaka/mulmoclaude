// Prints the SHIPPED MCP-child container spec as JSON, with Windows host paths
// translated to their WSL2 `/mnt/<drive>/...` form.
//
// `.github/workflows/docker_sandbox_windows.yaml` consumes this so the
// end-to-end step drives `docker run` with the same mounts / env / argv that
// `server/agent/config.ts` hands Claude Code — instead of a hand-copied list
// that silently rots. That rot is exactly what #2052 was: the smoke test's
// duplicated argv never received PR #1974's fallback mounts or PR #1995's
// `--import` bootstrap.
//
// Usage (from the repo root, on the Windows runner):
//   node_modules/.bin/tsx test/sandbox-repro/print-mcp-container-spec.ts

import { buildMulmoclaudeServer, workspaceModuleMounts } from "../../server/agent/config.ts";

const ACTIVE_PLUGINS = ["manageSkills", "presentMulmoScript"];

/** `C:\a\repo\packages\core` → `/mnt/c/a/repo/packages/core`. Docker runs inside
 *  WSL2, which sees the Windows FS under `/mnt/<drive>`. */
function toWslPath(hostPath: string): string {
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(hostPath);
  if (!drive) return hostPath.replace(/\\/g, "/");
  return `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, "/")}`;
}

// `workspaceModuleMounts` returns a flat ["-v", "<spec>", "-v", "<spec>", …].
// Pull out the specs; the caller re-adds the flags.
const flatMounts = workspaceModuleMounts(process.cwd(), "win32", toWslPath);
const pkgModuleMounts = flatMounts.filter((_, index) => index % 2 === 1);

const server = buildMulmoclaudeServer({
  chatSessionId: "windows-ci-probe",
  port: 9999,
  activePlugins: ACTIVE_PLUGINS,
  useDocker: true,
});

console.log(
  JSON.stringify(
    {
      pkgModuleMounts,
      env: server.env,
      command: server.command,
      args: server.args,
    },
    null,
    2,
  ),
);
