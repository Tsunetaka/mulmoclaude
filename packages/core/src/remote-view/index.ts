// The remote custom-view contract (phase 3 — plans/feat-remote-custom-view.md).
//
// Browser-safe single source of truth shared by the host server (which wraps
// the view HTML into a sandboxed srcdoc), the desktop phone-frame preview, and
// the mulmoserver mobile client (post-publish). A remote view runs on a phone
// that can reach the internet but NOT the host's localhost, so — unlike the
// desktop custom view (token + fetch to the view-data route) — its records
// arrive over an async postMessage bridge owned by the parent page, and its
// CSP locks `connect-src` to 'none' entirely.

/** Bump when the bootstrap/message contract changes shape; the bootstrap
 *  exposes it as `__MC_VIEW.protocol` so a parent can refuse a stale view. */
export const REMOTE_VIEW_PROTOCOL = 1;

/** postMessage types between the sandboxed view and its parent page.
 *  `startChat` reuses the desktop custom-view message type on purpose — the
 *  desktop parent already understands it. */
export const REMOTE_VIEW_MESSAGES = {
  /** view → parent: request one page of records ({ requestId, offset, limit, fields }). */
  getItems: "mc-remote-get-items",
  /** parent → view: the reply ({ requestId, ok, page | error }). */
  items: "mc-remote-items",
  /** view → parent: open a new chat with a prefilled, NOT auto-sent draft. */
  startChat: "mc-start-chat",
} as const;

/** Pagination defaults — mirrored by the phase-2 record handlers
 *  (`server/remoteHost/handlers/collectionPage.ts` imports these) so a view
 *  page can never outgrow what the command channel itself serves. */
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/** Hard cap on the wrapped srcdoc: it travels to the phone INSIDE a Firestore
 *  command document (1 MiB total), so leave envelope headroom. */
export const REMOTE_VIEW_MAX_BYTES = 900_000;

/** In-iframe `getItems` timeout — matches the remote client's `callHost`
 *  response timeout so the two layers give up together. */
const GET_ITEMS_TIMEOUT_MS = 30_000;

// CDN allowlist for sandboxed LLM-authored HTML (script/style/font loads).
// Shared with the desktop preview + custom-view CSPs
// (src/utils/html/previewCsp.ts re-exports it as its default) so the two
// policies can't drift. Keep the list audited — every entry is a potential
// supply-chain surface; the hosts here are reputable infrastructure that does
// not expose per-request logs to third parties.
export const SANDBOXED_VIEW_CDN_ALLOWLIST: readonly string[] = [
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://cdnjs.cloudflare.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  // Plotly's first-party CDN — the LLM defaults to it for Plotly charts.
  "https://cdn.plot.ly",
];

const toInt = (value: unknown): number | null => {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(num) ? Math.floor(num) : null;
};

/** Coerce a channel/postMessage offset (arrives as untyped JSON) to a non-negative int. */
export const clampOffset = (value: unknown): number => Math.max(0, toInt(value) ?? 0);

/** Coerce a channel/postMessage limit to [1, MAX_PAGE_LIMIT] (default 50). */
export const clampLimit = (value: unknown): number => {
  const num = toInt(value);
  if (num === null || num <= 0) return DEFAULT_PAGE_LIMIT;
  return Math.min(num, MAX_PAGE_LIMIT);
};

/** Coerce a `fields` projection list from untyped message JSON. */
export const normalizeFields = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
};

export type RemoteViewItem = Record<string, unknown>;

/** One page of records, the resolved value of the view's `getItems()`. Same
 *  shape as the phase-2 `getCollection` page so a parent can pass a channel
 *  page straight through. */
export interface RemoteViewPage {
  items: RemoteViewItem[];
  total: number;
  offset: number;
  limit: number;
}

/** A normalized (clamped, fields-cleaned) page request handed to a parent's
 *  `getPage` — `handleRemoteViewMessage` does the coercion so every parent
 *  answers identical values. */
export interface RemoteViewPageRequest {
  offset: number;
  limit: number;
  fields?: string[];
}

/** Keep only `fields` (+ always the primary key) on each record. Parents apply
 *  this uniformly — the desktop preview via `pageFromItems`, the phone parent
 *  over the page it fetched through the channel — so a view sees the same
 *  projection everywhere. No-op without `fields`. */
export function projectItems(items: RemoteViewItem[], fields: string[] | undefined, primaryKey: string): RemoteViewItem[] {
  if (!fields || fields.length === 0) return items;
  const keep = new Set([primaryKey, ...fields]);
  return items.map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => keep.has(key))));
}

/** Answer a page request from an already-loaded record array (the desktop
 *  preview's data source): slice + project. Observable behavior matches the
 *  phone paging over the command channel. */
export function pageFromItems(items: RemoteViewItem[], request: RemoteViewPageRequest, primaryKey: string): RemoteViewPage {
  const pageItems = items.slice(request.offset, request.offset + request.limit);
  return { items: projectItems(pageItems, request.fields, primaryKey), total: items.length, offset: request.offset, limit: request.limit };
}

/**
 * CSP for a remote (mobile) custom view. Stricter than the desktop custom-view
 * policy: the view's data arrives over postMessage, so `connect-src` is
 * `'none'` — no fetch / XHR / WebSocket / sendBeacon to ANY origin, which
 * closes the bidirectional-exfiltration channel completely (there is no token
 * to steal either). Script/style/font keep the curated CDN allowlist (the
 * phone can reach the internet; only the host is unreachable), and
 * `img-src`/`media-src` allow any `https:` host so record image/media URLs
 * render — the same knowingly-accepted one-way GET-exfil tradeoff as the
 * desktop policy (see buildCustomViewCsp in src/utils/html/previewCsp.ts).
 */
export function buildRemoteViewCsp(cdns: readonly string[] = SANDBOXED_VIEW_CDN_ALLOWLIST): string {
  const cdnList = cdns.join(" ");
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${cdnList}`,
    `style-src 'unsafe-inline' ${cdnList}`,
    `font-src ${cdnList}`,
    `img-src ${cdnList} data: blob: https:`,
    "media-src https: data: blob:",
    "connect-src 'none'",
  ].join("; ");
}

/** The in-iframe bootstrap installed before any of the view's own scripts.
 *  Owns the fiddly part of the contract — request/response correlation — so an
 *  LLM-authored view only ever awaits `__MC_VIEW.getItems(...)`:
 *
 *  - `getItems({ offset, limit, fields })`: posts an `mc-remote-get-items`
 *    with a fresh `requestId`, resolves on the matching `mc-remote-items`
 *    reply (validated to come from `window.parent`), rejects on `ok: false`
 *    or after 30 s. targetOrigin `'*'` is safe: the request carries no secret
 *    and the parent is by construction the party supplying the data.
 *  - `startChat(prompt, role)`: same message type + semantics as the desktop
 *    bridge — the parent opens a new chat with `prompt` prefilled as an
 *    editable draft, never auto-sent.
 *  - `t(key, named)`: the same vue-i18n-compatible dict helper as the desktop
 *    bootstrap (named interpolation only), over the host-picked `dict`.
 *
 *  Self-contained one-line string (no `<`, no `</script>`, `${}` only for the
 *  interpolated constants). */
function remoteViewBootstrap(): string {
  return `(function(){var v=window.__MC_VIEW,seq=0,pend={};window.addEventListener('message',function(e){if(e.source!==window.parent)return;var d=e.data;if(!d||d.type!=='${REMOTE_VIEW_MESSAGES.items}')return;var p=pend[d.requestId];if(!p)return;delete pend[d.requestId];clearTimeout(p.timer);if(d.ok)p.resolve(d.page);else p.reject(new Error(typeof d.error==='string'?d.error:'load failed'));});v.getItems=function(opts){opts=opts&&typeof opts==='object'?opts:{};return new Promise(function(resolve,reject){var id='q'+(++seq);var timer=setTimeout(function(){delete pend[id];reject(new Error('getItems timed out'));},${GET_ITEMS_TIMEOUT_MS});pend[id]={resolve:resolve,reject:reject,timer:timer};window.parent.postMessage({type:'${REMOTE_VIEW_MESSAGES.getItems}',slug:v.slug,requestId:id,offset:opts.offset,limit:opts.limit,fields:opts.fields},'*');});};v.startChat=function(prompt,role){window.parent.postMessage({type:'${REMOTE_VIEW_MESSAGES.startChat}',slug:v.slug,prompt:String(prompt),role:typeof role==='string'?role:undefined},'*');};v.dict=v.dict||{};v.t=function(key,named){var s=v.dict[key];if(typeof s!=='string')return typeof key==='string'?key:String(key);if(!named||typeof named!=='object')return s;return s.replace(/\\{(\\w+)\\}/g,function(m,n){var x=named[n];return x==null?m:String(x);});};})();`;
}

/** What the host injects into `window.__MC_VIEW` — note what is ABSENT
 *  compared to the desktop boot: no token, no dataUrl, no origin. */
export interface RemoteViewBoot {
  slug: string;
  /** Locale the dict was picked for; empty string when no translations. */
  locale?: string;
  /** Host-picked, locale-filtered flat string map (same contract as the
   *  desktop custom-view dict). */
  dict?: Record<string, string>;
}

/** Wrap a view's HTML into the sandboxed srcdoc: CSP meta + `__MC_VIEW` boot +
 *  bridge bootstrap injected at the start of `<head>` (before any view
 *  script). Runs HOST-side (`getRemoteView`) so the phone and the desktop
 *  preview receive the identical finished artifact. */
export function buildRemoteViewSrcdoc(html: string, boot: RemoteViewBoot): string {
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${buildRemoteViewCsp()}">`;
  // `<`-escape the JSON so a hostile slug/dict string can't break out of the
  // <script> element (same escape as the desktop srcdoc builder).
  const json = JSON.stringify({
    slug: boot.slug,
    locale: boot.locale ?? "",
    dict: boot.dict ?? {},
    target: "mobile",
    protocol: REMOTE_VIEW_PROTOCOL,
  }).replace(/</g, "\\u003c");
  const injection = `${cspMeta}<script>window.__MC_VIEW=${json};${remoteViewBootstrap()}</script>`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/(<head\b[^>]*>)/i, `$1${injection}`);
  }
  return `<!DOCTYPE html><html><head>${injection}</head><body>${html}</body></html>`;
}

/** What a parent page provides to answer the sandboxed view. Deliberately
 *  minimal — exactly the phone runtime's capabilities, nothing more, so the
 *  desktop preview can never exceed what works on the phone. */
export interface RemoteViewBridgeHandlers {
  slug: string;
  /** Answer one normalized page request (already clamped + fields-cleaned). */
  getPage: (request: RemoteViewPageRequest) => Promise<RemoteViewPage> | RemoteViewPage;
  /** Relay a `startChat` draft; omit on a parent without a chat surface. */
  onStartChat?: (prompt: string, role?: string) => void;
}

async function answerGetItems(requestId: string, request: RemoteViewPageRequest, handlers: RemoteViewBridgeHandlers, reply: RemoteViewReply): Promise<void> {
  try {
    const page = await handlers.getPage(request);
    reply({ type: REMOTE_VIEW_MESSAGES.items, requestId, ok: true, page });
  } catch (err) {
    reply({ type: REMOTE_VIEW_MESSAGES.items, requestId, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

type RemoteViewReply = (message: Record<string, unknown>) => void;

/**
 * Handle one message-event payload from a sandboxed remote view. DOM- and
 * framework-free: the caller owns the `message` listener (and MUST verify
 * `event.source === iframe.contentWindow` before calling), `reply` posts the
 * response back into the iframe (targetOrigin `"*"` — the sandboxed document's
 * origin is opaque, so nothing else can match). Returns true when the payload
 * was a remote-view request for this slug (callers ignore everything else).
 */
export async function handleRemoteViewMessage(data: unknown, handlers: RemoteViewBridgeHandlers, reply: RemoteViewReply): Promise<boolean> {
  if (typeof data !== "object" || data === null) return false;
  const msg = data as {
    type?: unknown;
    slug?: unknown;
    requestId?: unknown;
    offset?: unknown;
    limit?: unknown;
    fields?: unknown;
    prompt?: unknown;
    role?: unknown;
  };
  if (msg.slug !== handlers.slug) return false;
  if (msg.type === REMOTE_VIEW_MESSAGES.startChat) {
    const prompt = typeof msg.prompt === "string" ? msg.prompt.trim() : "";
    if (prompt) handlers.onStartChat?.(prompt, typeof msg.role === "string" ? msg.role : undefined);
    return true;
  }
  if (msg.type !== REMOTE_VIEW_MESSAGES.getItems || typeof msg.requestId !== "string") return false;
  const request: RemoteViewPageRequest = { offset: clampOffset(msg.offset), limit: clampLimit(msg.limit), fields: normalizeFields(msg.fields) };
  await answerGetItems(msg.requestId, request, handlers, reply);
  return true;
}
