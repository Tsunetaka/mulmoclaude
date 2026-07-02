// Assemble one mobile (`target: "mobile"`) custom view for the remote client:
// find the view entry, read its HTML (source-aware staging read), pick its
// i18n dict for the requested locale, wrap it into the sandboxed srcdoc
// (CSP + postMessage bootstrap — @mulmoclaude/core/remote-view), and enforce
// the 1 MiB command-document budget. Shared by the `getRemoteView` channel
// handler and the desktop preview's HTTP route so both serve the IDENTICAL
// artifact (plans/feat-remote-custom-view.md, decision 2).
//
// Discriminated result (not throw) so the HTTP route can map each failure to
// its status; the channel handler converts non-ok to a thrown error via
// `remoteViewFailureMessage`. Factory keeps the mapping unit-testable with the
// engine stubbed.
import { buildRemoteViewSrcdoc, REMOTE_VIEW_MAX_BYTES } from "@mulmoclaude/core/remote-view";
import { readCustomViewHtml, readCustomViewI18n, type LoadedCollection } from "./index.js";

export interface RemoteViewInfo {
  id: string;
  label: string;
  icon?: string;
  target: "mobile";
}

export type RemoteViewBuildResult =
  | { kind: "ok"; view: RemoteViewInfo; srcdoc: string; bytes: number }
  | { kind: "view-not-found"; viewId: string }
  | { kind: "not-mobile"; viewId: string }
  | { kind: "file-missing"; file: string }
  | { kind: "too-large"; bytes: number };

export interface BuildRemoteViewDeps {
  readCustomViewHtml: typeof readCustomViewHtml;
  readCustomViewI18n: typeof readCustomViewI18n;
}

export const createBuildRemoteView =
  (deps: BuildRemoteViewDeps) =>
  async (collection: LoadedCollection, viewId: string, locale: string): Promise<RemoteViewBuildResult> => {
    const view = (collection.schema.views ?? []).find((entry) => entry.id === viewId);
    if (!view) return { kind: "view-not-found", viewId };
    // A desktop view's HTML assumes the token/dataUrl contract and would just
    // break on the phone — refuse it instead of serving a broken page.
    if (view.target !== "mobile") return { kind: "not-mobile", viewId };
    const html = await deps.readCustomViewHtml(collection, view.file);
    if (html === null) return { kind: "file-missing", file: view.file };
    const i18n = view.i18n ? await deps.readCustomViewI18n(collection, view.i18n, locale) : { locale: "", dict: {} };
    const srcdoc = buildRemoteViewSrcdoc(html, { slug: collection.slug, locale: i18n.locale, dict: i18n.dict });
    const bytes = Buffer.byteLength(srcdoc, "utf8");
    if (bytes > REMOTE_VIEW_MAX_BYTES) return { kind: "too-large", bytes };
    return { kind: "ok", view: { id: view.id, label: view.label, ...(view.icon ? { icon: view.icon } : {}), target: "mobile" }, srcdoc, bytes };
  };

export const buildRemoteView = createBuildRemoteView({ readCustomViewHtml, readCustomViewI18n });

/** One message per failure kind, shared by the channel handler (throws it) and
 *  the HTTP route (sends it with the matching status). */
export function remoteViewFailureMessage(result: Exclude<RemoteViewBuildResult, { kind: "ok" }>, slug: string): string {
  if (result.kind === "view-not-found") return `custom view '${result.viewId}' not found on collection '${slug}'`;
  if (result.kind === "not-mobile") return `custom view '${result.viewId}' is not a mobile view — declare target: "mobile" in its views[] entry`;
  if (result.kind === "file-missing") return `view file '${result.file}' not found — author it at data/skills/${slug}/${result.file}`;
  return `mobile view srcdoc is ${result.bytes} bytes — over the ${REMOTE_VIEW_MAX_BYTES}-byte command-channel budget; slim the HTML`;
}
