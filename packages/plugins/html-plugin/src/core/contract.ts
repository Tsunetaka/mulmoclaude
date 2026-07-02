// Host-agnostic dispatch envelope for the presentHtml View. The Vue View is
// decoupled from any one host's REST surface: it calls
// `useRuntime().dispatch({ kind, … })`, the host routes that to the package's
// `executeHtmlDispatch` (see `./dispatch`), and the dispatch reaches host
// storage only through the GENERIC gui-chat-protocol `files.artifacts`
// capability — no presentHtml-specific host method.

/** Read the bytes of an existing HTML artifact (source editor + print). */
export interface LoadHtmlArgs {
  kind: "loadHtml";
  /** Workspace-relative path under `artifacts/html/…`. */
  path: string;
}

/** Overwrite an existing HTML artifact in place (source editor "Apply"). */
export interface SaveHtmlArgs {
  kind: "saveHtml";
  /** Workspace-relative path under `artifacts/html/…`. */
  path: string;
  html: string;
}

/** Discriminated union of every action the View's *package* router
 *  (`executeHtmlDispatch`) serves. `packHtml` is deliberately NOT here:
 *  bundling needs binary asset reads + zip, which live host-side, so the
 *  host intercepts it before delegating (see `PackHtmlArgs`). */
export type HtmlDispatchArgs = LoadHtmlArgs | SaveHtmlArgs;

/** Bundle an HTML artifact + its referenced local assets into a
 *  self-contained zip. Dispatched by the View, handled host-side (not by
 *  the pure package router). */
export interface PackHtmlArgs {
  kind: "packHtml";
  /** Workspace-relative path under `artifacts/html/…`. */
  path: string;
}

/** Result of `packHtml`: base64 keeps the zip bytes JSON-safe over the
 *  dispatch transport; the View decodes it to a Blob download. */
export interface PackHtmlResult {
  filename: string;
  zipBase64: string;
}

/** Maps a dispatch `kind` to its result shape so the View can call
 *  `dispatch<HtmlDispatchResult["loadHtml"]>(…)` without a cast. */
export interface HtmlDispatchResult {
  loadHtml: { html: string };
  saveHtml: { path: string };
}
