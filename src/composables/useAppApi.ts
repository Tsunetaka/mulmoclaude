// #227: replaced window CustomEvent dispatch (`roles-updated`, `skill-run`) with provide/inject so plugin → App
// communication is type-checked instead of routed through string event names.

import { inject, provide } from "vue";

export interface AppApi {
  refreshRoles: () => void | Promise<void>;
  sendMessage: (message: string) => void;
  // Send a message pinned to `roleId`, activating a session bound to
  // that role WITHOUT navigating away from the current (non-chat)
  // page. If the active session already uses that role it is
  // continued; otherwise a fresh session is activated in place. Used
  // by the slide-editor chat pane to force the `slide` role while the
  // user stays on /slides (unlike startNewChat, which pushes /chat).
  sendMessageAs: (message: string, roleId: string) => void;
  // roleId overrides for one-off sessions (e.g. wiki lint must run as General even if the user is on a different role).
  startNewChat: (message: string, roleId?: string) => void;
  navigateToWorkspacePath: (href: string) => void;
  // Live SSE stream stamps real arrival times; jsonl-loaded results fall back to the session's startedAt baseline
  // because per-entry timestamps aren't persisted yet (see pushResult in utils/session/sessionHelpers.ts).
  getResultTimestamp: (uuid: string) => number | undefined;
}

const APP_API_KEY = Symbol("appApi");

export function provideAppApi(api: AppApi): void {
  provide(APP_API_KEY, api);
}

// Throws when called outside an App.vue subtree; tests that render a plugin in isolation should call inject directly.
export function useAppApi(): AppApi {
  const api = inject<AppApi>(APP_API_KEY);
  if (!api) {
    throw new Error("useAppApi() called outside an App.vue subtree — provideAppApi must run first.");
  }
  return api;
}
