// Bootstrap module for the Docker sandbox MCP child (#1982).
//
// `tsx --import file:///app/server/agent/mcp-esm-bootstrap.mjs`
// runs this file at process startup. Its ONLY job is to call
// `node:module.register()` pointing at the actual resolver hook —
// without that call, `--import` merely evaluates the target
// module's top level and the exported `resolve()` never runs
// (Codex review on PR #1995).
//
// Separated from `mcp-esm-loader.mjs` so the loader stays pure and
// unit-testable (importing the loader from a test doesn't trigger
// a register() side effect).

import { register } from "node:module";

register("./mcp-esm-loader.mjs", import.meta.url);
