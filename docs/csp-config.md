# Sandbox CSP extension (`config/csp.json`)

MulmoClaude renders LLM-authored HTML — Files-explorer previews, `presentHtml`
pages, and collection **custom views** — inside a sandboxed iframe under a
strict Content Security Policy. The base policy denies everything
(`default-src 'none'`) and only allows inline scripts/styles plus a small,
audited CDN allowlist (jsdelivr / unpkg / cdnjs / Google Fonts / plotly). In
particular there is **no `frame-src`**, so any `<iframe>` (e.g. a Google Maps
embed) is blocked by default.

`config/csp.json` lets you **add hosts** to that policy per directive. Added
hosts are appended to the base policy — they never replace it.

## Schema

```jsonc
// <workspace>/config/csp.json
{
  "frame-src":   ["https://www.google.com"],   // allow a Google Maps embed <iframe>
  "script-src":  ["https://maps.googleapis.com"],
  "style-src":   [],
  "font-src":    [],
  "img-src":     ["https://maps.gstatic.com"],
  "media-src":   [],
  "connect-src": []                            // ⚠ the sharpest edge — see Security
}
```

Every value is a list of hosts. Only plain **`https://host[:port]`** origins are
accepted; anything else — `http://…`, wildcards (`https://*.example`), paths
(`https://x.com/p`), or keyword tokens (`'unsafe-inline'`, `data:`) — is
silently dropped (`sanitizeCspExtra`). Unknown directive keys are ignored.

### Example: allow a Google Maps embed in a custom view

```json
{ "frame-src": ["https://www.google.com"] }
```

Without this, a `<iframe src="https://www.google.com/maps/embed?...">` in a
custom view is blocked and shows nothing. With it, the map renders.

## Where it applies

- ✅ Files-explorer HTML preview + `presentHtml` (server sets the CSP header on
  `/artifacts/html/*.html`).
- ✅ Collection **custom views** (the client builds the srcdoc CSP; the extra
  hosts arrive via `GET /api/config`).
- ❌ Mobile **remote views** — a different, stricter transport (data over
  `postMessage`, `connect-src 'none'`); config does not widen it.

Changes are read per request / at view render, so editing `config/csp.json`
takes effect on the next preview / view open (no restart needed).

## When a resource is blocked

A blocked resource in a custom view surfaces an **amber banner** at the top of
the app naming the exact host + directive (e.g. "⚠ A view tried to load
`https://www.google.com`, blocked by `frame-src` …"), so you know precisely
what to add to `config/csp.json`. (Mechanism: a `securitypolicyviolation`
listener in the view posts the block up to the host; see `useCspViolations.ts`.)

## Security — read before adding hosts

Every host you add is a **supply-chain / exfiltration surface**. Add only hosts
you trust. By risk:

- **`connect-src` is the most dangerous.** A custom view holds a scoped
  capability token plus the collection's records. Widening `connect-src` lets a
  compromised or careless view `fetch`/`XHR`/`WebSocket` that data to the added
  host — a **two-way exfiltration** channel. The server logs a distinct, louder
  warning at boot when `connect-src` is widened.
- `script-src` — a supply-chain surface (a compromised host serves malicious
  JS into the view).
- `frame-src` / `img-src` / `media-src` — one-way GET; comparatively low risk
  (an attacker host could receive a request but the response isn't readable by
  the view when `connect-src` stays locked).

On boot, if `config/csp.json` extends the policy, the server logs a `[csp]`
warning listing the added hosts.

## Pointers

- Policy builder + validation: `src/utils/html/previewCsp.ts`
  (`buildCsp` / `buildCustomViewCsp` / `sanitizeCspExtra`).
- Config read: `server/utils/files/csp-io.ts` (`readCspExtraSync`,
  `warnIfCspExtended`).
- Base CDN allowlist (hardcoded, shared): `@mulmoclaude/core/remote-view`
  (`SANDBOXED_VIEW_CDN_ALLOWLIST`).
- Violation → banner: `src/composables/useCspViolations.ts`.
- Design: [#1989](https://github.com/receptron/mulmoclaude/issues/1989).
