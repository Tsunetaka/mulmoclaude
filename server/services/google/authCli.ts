// One-shot CLI (`yarn google:auth`): run the loopback + PKCE consent flow and
// store the refresh token locally. Same trigger model as `gcloud auth login`.
// Interactive terminal entry point — writes straight to stdout/stderr because
// the server logger's structured output would mangle the URL the user must
// open when the browser doesn't launch.
import { spawn } from "node:child_process";
import { authorizeGoogle, googleTokenPath } from "@mulmoclaude/core/google";
import { errorMessage } from "../../utils/errors.js";

const printLine = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

// Same platform triple as the folder-reveal in server/api/routes/files.ts.
const openInBrowser = (url: string): void => {
  const [cmd, args] =
    process.platform === "darwin"
      ? (["open", [url]] as const)
      : process.platform === "win32"
        ? (["explorer.exe", [url]] as const)
        : (["xdg-open", [url]] as const);
  spawn(cmd, [...args], { stdio: "ignore", detached: true }).unref();
};

const main = async (): Promise<void> => {
  printLine("Opening the Google consent page in your browser…");
  await authorizeGoogle({
    onAuthUrl: (url) => {
      printLine(`If the browser does not open, visit:\n${url}\n`);
      openInBrowser(url);
    },
  });
  printLine(`✅ Google account linked. Tokens stored at ${googleTokenPath()} (mode 600).`);
};

main().catch((err: unknown) => {
  process.stderr.write(`❌ ${errorMessage(err)}\n`);
  process.exitCode = 1;
});
