// Spawning the Claude Code CLI runs summarization against the user's subscription quota rather than the API-key budget.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { CLI_SUBPROCESS_TIMEOUT_MS } from "../../utils/time.js";
import { claudeBinPath, ClaudeCliNotFoundError } from "../../utils/claudeBin.js";

// User-selectable model for the archivist CLI call. `journalMode`
// widens to `"off"` too; the entry-point (`maybeRunJournal`) filters
// that out before we get here — this union is intentionally narrow so
// a bad string can't reach `--model`.
export type JournalSummaryModel = "haiku" | "sonnet";
export type Summarize = (systemPrompt: string, userPrompt: string, opts?: { model?: JournalSummaryModel }) => Promise<string>;

const CLI_TIMEOUT_MS = CLI_SUBPROCESS_TIMEOUT_MS;

// Re-exported so the dozen-plus consumers across journal/memory/chat-
// index/translation that already import `ClaudeCliNotFoundError` from
// this module keep working without a code mod. The canonical home is
// `server/utils/claudeBin.ts` (where `claudeBinPath()` throws it on a
// failed Windows probe), this re-export preserves the existing
// import path and dependency direction.
export { ClaudeCliNotFoundError };

export class ClaudeCliFailedError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;
  constructor(exitCode: number | null, stderr: string) {
    super(`\`claude\` CLI exited ${exitCode ?? "(killed)"}: ${stderr.slice(0, 500)}`);
    this.name = "ClaudeCliFailedError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

// `opts?.model` is threaded from `Settings → Journal` via maybeRunJournal
// so the user's model choice reaches the CLI. When undefined we omit the
// flag entirely and let the CLI use its own default — preserves the
// pre-#1944 archivist behaviour for direct-CLI callers with no model.
export function buildClaudeCliArgs(model?: JournalSummaryModel): string[] {
  const args = ["-p", "--output-format", "text"];
  if (model) {
    args.push("--model", model);
  }
  return args;
}

export function buildCliPayload(systemPrompt: string, userPrompt: string): string {
  return `${systemPrompt}\n\n---\n\n${userPrompt}`;
}

interface ChildOutput {
  stdout: string;
  stderr: string;
}

function collectChildOutput(child: ChildProcessWithoutNullStreams): ChildOutput {
  const output: ChildOutput = { stdout: "", stderr: "" };
  child.stdout.on("data", (chunk: Buffer) => {
    output.stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output.stderr += chunk.toString();
  });
  return output;
}

// Wait for "drain" on backpressure before end() so the buffer fully flushes — large excerpts can hit this path.
function writeStdinAndClose(child: ChildProcessWithoutNullStreams, payload: string): void {
  const flushed = child.stdin.write(payload);
  if (flushed) {
    child.stdin.end();
  } else {
    child.stdin.once("drain", () => child.stdin.end());
  }
}

// Pipe the combined prompt via stdin to dodge shell-argv limits for large day excerpts.
export const runClaudeCli: Summarize = async (systemPrompt, userPrompt, opts) =>
  new Promise((resolve, reject) => {
    const args = buildClaudeCliArgs(opts?.model);
    const child = spawn(claudeBinPath(), args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const output = collectChildOutput(child);
    let timedOut = false;
    let settled = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, CLI_TIMEOUT_MS);

    child.on("error", (err: Error & { code?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (err.code === "ENOENT") {
        reject(new ClaudeCliNotFoundError());
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (timedOut) {
        reject(new ClaudeCliFailedError(null, `timed out after ${CLI_TIMEOUT_MS}ms\n${output.stderr}`));
        return;
      }
      if (code === 0) {
        resolve(output.stdout);
      } else {
        reject(new ClaudeCliFailedError(code, output.stderr));
      }
    });

    // Surface EPIPE etc. — child may exit before we finish writing.
    child.stdin.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });

    writeStdinAndClose(child, buildCliPayload(systemPrompt, userPrompt));
  });
