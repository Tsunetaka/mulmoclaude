// Diagnostic probe for #2052 — does the MCP child run as CJS or ESM inside
// the sandbox container, and does NODE_PATH rescue the dangling junction?
//
// This file is bind-mounted to `/app/server/agent/diagnose-2052.ts` so it sits
// in the SAME package scope as the real `mcp-server.ts`. That is the whole
// point: `tsx` picks a module format from the nearest `package.json`, and the
// production mount layout never puts one under `/app`. The sibling probe
// (`probe.ts`) is mounted at `/repro/` next to a `{"type":"module"}` manifest,
// which is exactly why it has never reproduced this bug.
//
// It REPORTS rather than asserts. Reading the output is the deliverable; the
// fix is chosen from it. Every lookup is wrapped so a failure prints its error
// instead of killing the process before the later facts are gathered.
//
// Must stay valid under BOTH transpile targets: no `import.meta`, no
// top-level `await`, no static import of a `@mulmoclaude/*` package.

import { existsSync, lstatSync, readlinkSync } from "node:fs";
import Module, { createRequire } from "node:module";

const SPECIFIER = "@mulmoclaude/x-plugin";
const PRIMARY_LINK = "/app/node_modules/@mulmoclaude/x-plugin";
const REQUIRE_CONTEXT = "/app/server/agent/mcp-tools/index.ts";

function line(label: string, value: unknown): void {
  console.log(`${label.padEnd(34)} ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

function attempt(label: string, probe: () => unknown): void {
  try {
    line(label, probe());
  } catch (err) {
    line(label, `ERROR: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }
}

console.log("=== #2052 sandbox module-resolution diagnostic ===");

// 1. The decisive fact. `typeof require === "function"` in a transpiled CJS
//    module; in ESM output esbuild leaves `require` undefined.
const isCjs = typeof require === "function";
line("module format of this .ts", isCjs ? "CommonJS  <-- module.register() ESM hook is INERT" : "ESM");
line("/app/package.json present", existsSync("/app/package.json"));
line("node version", process.version);

// 2. Is the NODE_PATH fallback wired, and does Node's own resolver see it?
line("process.env.NODE_PATH", process.env.NODE_PATH ?? "(unset)");
line("Module.globalPaths", Module.globalPaths);

// 3. Prove the container really reproduces the Windows failure mode: the
//    primary yarn-workspace link must dangle.
attempt("lstat(primary link)", () => (lstatSync(PRIMARY_LINK).isSymbolicLink() ? "symlink" : "not a symlink"));
attempt("readlink(primary link)", () => readlinkSync(PRIMARY_LINK));
line("primary target resolves", existsSync(`${PRIMARY_LINK}/package.json`));
line("fallback mount present", existsSync(`/app/pkg_modules/${SPECIFIER}/package.json`));

// 4. The question PR #1974 answers only if tsx's CJS hook honours globalPaths.
const req = createRequire(REQUIRE_CONTEXT);
attempt("require.resolve.paths()", () => req.resolve.paths(SPECIFIER));
attempt("require.resolve(x-plugin)", () => req.resolve(SPECIFIER));
attempt("require(x-plugin) keys", () => Object.keys(req(SPECIFIER) as object));

// 5. The question PR #1995 answers — but only ever reachable from ESM.
//    `.then()` rather than top-level await so the file transpiles under CJS.
import(SPECIFIER).then(
  (mod: object) => {
    line("await import(x-plugin) keys", Object.keys(mod));
    console.log("=== end (import resolved) ===");
  },
  (err: unknown) => {
    line("await import(x-plugin)", `ERROR: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    console.log("=== end (import rejected) ===");
  },
);
