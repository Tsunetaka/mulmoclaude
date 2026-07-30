// Optional host-supplied capabilities that are genuinely host TRANSPORT,
// not plugin logic — the browser-side sibling of html-plugin's host-injected
// `previewUrl`. The generic runtime covers JSON dispatch + pubsub; what it
// can't cover is (a) which chat session a generation should be tagged to
// (MulmoClaude's sidebar indicator) and (b) how to fetch movie/PDF bytes,
// which every host serves behind its own auth (MulmoClaude keeps them on
// bearer-guarded /api routes by explicit review decision — see the
// downloadMovie comment trail in the pre-extraction View).
//
// Hosts provide the adapter with Vue's provide() around the View; absent
// capabilities degrade gracefully (no session tagging; download / clip-play
// UI hidden).

import { inject, type InjectionKey, type Ref } from "vue";

export interface MulmoScriptHostAdapter {
  /** Active chat session id, forwarded on generation dispatches so the
   *  host can light its per-session progress indicators. */
  chatSessionId?: Ref<string | undefined>;
  /** Authenticated media download. Exactly one of `moviePath` / `pdfPath`
   *  is set — both are the wire `stories/…` paths the status/probe
   *  dispatches return. Rejects on transport/HTTP failure. */
  fetchMediaBlob?: (query: { moviePath?: string; pdfPath?: string }) => Promise<Blob>;
}

export const MULMOSCRIPT_HOST_ADAPTER_KEY: InjectionKey<MulmoScriptHostAdapter> = Symbol("mulmoscript-host-adapter");

const EMPTY_ADAPTER: MulmoScriptHostAdapter = {};

export function useHostAdapter(): MulmoScriptHostAdapter {
  return inject(MULMOSCRIPT_HOST_ADAPTER_KEY, EMPTY_ADAPTER);
}
