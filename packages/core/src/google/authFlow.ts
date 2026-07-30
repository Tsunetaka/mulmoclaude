// In-flight manager for the settings-UI OAuth flow. authorizeGoogle() resolves
// only after the user finishes the browser consent, so the HTTP layer starts it
// in the background, returns the consent URL immediately, and reports progress
// via status polling. start() always reflects the latest intent: a new call
// aborts any pending flow (which closes its loopback listener) before launching
// a fresh one, so a user who abandoned the browser consent can just link again
// instead of waiting out the server-side timeout.
import { log } from "./host.js";
import { errorMessage } from "./util.js";
import { authorizeGoogle } from "./auth.js";

export interface GoogleAuthFlowStatus {
  pending: boolean;
  lastError: string | null;
}

export interface GoogleAuthFlow {
  start: () => Promise<{ authUrl: string }>;
  cancel: () => void;
  status: () => GoogleAuthFlowStatus;
}

export const createGoogleAuthFlow = (authorize: typeof authorizeGoogle): GoogleAuthFlow => {
  let flowRunning = false;
  let lastError: string | null = null;
  let active: AbortController | null = null;

  const launch = (): Promise<{ authUrl: string }> => {
    const controller = new AbortController();
    active = controller;
    flowRunning = true;
    return new Promise((resolve, reject) => {
      authorize({ onAuthUrl: (url) => resolve({ authUrl: url }), signal: controller.signal })
        .then(() => log.info("google", "authorize flow completed"))
        .catch((err: unknown) => {
          // An aborted flow is a user-initiated restart, not a failure to
          // surface — only real errors reach lastError.
          if (!controller.signal.aborted) {
            lastError = errorMessage(err);
            log.warn("google", "authorize flow failed", { error: lastError });
          }
          reject(err instanceof Error ? err : new Error(String(err)));
        })
        .finally(() => {
          // A restart may have already installed a newer controller; only the
          // current flow clears the shared state so it can't strand the new one.
          if (active === controller) {
            flowRunning = false;
            active = null;
          }
        });
    });
  };

  const cancel = (): void => {
    active?.abort();
  };

  const start = (): Promise<{ authUrl: string }> => {
    cancel();
    lastError = null;
    return launch();
  };

  const status = (): GoogleAuthFlowStatus => ({ pending: flowRunning, lastError });

  return { start, cancel, status };
};

export const googleAuthFlow = createGoogleAuthFlow(authorizeGoogle);
