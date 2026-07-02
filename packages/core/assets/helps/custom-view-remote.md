# Remote custom views (LLM-authored HTML for the phone)

A **remote custom view** is an HTML file you write that renders a collection's
records **on the user's phone**, inside the mobile remote app. Same idea as a
desktop custom view (`config/helps/custom-view.md`) — the user asks in plain
language, you author one HTML file and register it — but the runtime contract
is **different and incompatible**: the phone cannot reach this machine, so
there is **no token, no dataUrl, and no `fetch` of any kind**. Records arrive
through an async bridge instead. Never mix the two contracts in one file.

Read `config/helps/collection-skills.md` first for the collection/schema DSL.
This file is only about the **remote view** layer.

## Where the files go

Same place as desktop views — the HTML lives under `views/` and must end in
`.html`. Register it in the collection's `schema.json` with
**`target: "mobile"`** (that's the whole difference in registration):

```jsonc
{
  "views": [{ "id": "phone", "label": "Phone", "target": "mobile", "file": "views/phone.html" }],
}
```

- **`target: "mobile"`** — required; without it the view is treated as a
  desktop view and is never served to the phone.
- `id` / `label` / `icon` / `i18n` — as for desktop views. The selector icon
  defaults to `smartphone`.
- **No `capabilities`** — remote views are **read-only** in this phase. There
  is no write path; a button that should _do_ something uses `startChat`.

Feed collections register theirs in `feeds/<slug>/schema.json` with the HTML
at `feeds/<slug>/views/<name>.html`, like desktop views.

## Previewing without a phone

After you Write + register the view, its button appears in the collection's
view selector **on the desktop** and renders inside a **phone-sized frame
(390×844)** — the exact same wrapped document the phone receives, with the same
sandbox rules and the same data bridge. A caption under the frame shows the
file's size against its **900 KB budget** (the view travels to the phone inside
a size-capped message — stay well under it; a normal view is tens of KB).
Iterate against this preview; if it works there, it works on the phone.

## The runtime contract — `window.__MC_VIEW`

The host injects a bootstrap into your page **before any of your scripts run**:

```js
window.__MC_VIEW = {
  slug: "annual-plan", // this collection
  locale: "en", // active app locale ("" when no translations)
  target: "mobile",
  protocol: 1,
  getItems: (opts) => Promise, // the ONLY way to read records — see below
  startChat: (prompt, role) => void, // draft a new chat for the user
  t: (key, named) => string, // vue-i18n-style dict lookup (same as desktop)
};
```

What is deliberately **absent** compared to the desktop contract: `token`,
`dataUrl` (nothing to fetch), `onChange` (no live refresh yet — render on
load), and `openItem` (no host record panel on the phone yet).

### Reading records — `getItems` (paginated, always)

```js
const page = await window.__MC_VIEW.getItems({
  offset: 0,
  limit: 50, // clamped to [1, 200]
  fields: ["title", "start", "status"], // project — list ONLY what you render
});
// page = { items: [...], total: 123, offset: 0, limit: 50 }
```

- **Pagination is mandatory.** Each page travels to the phone through a
  size-capped channel; you can never assume one call returns everything.
  Render the first page, then offer a **"Load more"** affordance while
  `items.length < total` (see the example).
- **Always pass `fields`.** The projection keeps pages small (the primary key
  is always included). List the columns your view actually renders.
- The promise **rejects** on failure or after a 30 s timeout — catch it and
  show the message; don't fail silently.
- **`derived` formulas that read only the record's own fields come back
  resolved** (e.g. `won * 3 + drawn`). Formulas that dereference a `ref`
  field, and `embed` fields, are NOT resolved on the phone — don't rely on
  them; compute from base fields or omit.

### Starting a chat — `startChat`

Identical to the desktop helper: opens a **new chat with your prompt prefilled
as an editable draft** — it does NOT auto-send; the user reviews and sends.
This is the only way a remote view "does" anything beyond display:

```js
window.__MC_VIEW.startChat("Mark task " + item.id + " as done.");
```

### Translations — `t`

Same contract as desktop: declare `"i18n": "views/<name>.i18n.json"` in the
`views[]` entry (vue-i18n locale-message shape); the host picks the active
locale's flat dict server-side and `t(key, named)` interpolates `{name}`
placeholders, falling back to the key.

## Design for the phone — not a shrunken desktop

The frame is a real phone viewport. **Do not miniaturize a desktop layout**
(a 12-month grid becomes an unreadable postage stamp); pick a vertically
composable idiom instead — a scrolling agenda, a card list, stacked sections.

- **Required `<head>`**: build a full document with
  `<meta charset="utf-8">` and
  `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- **Single column, vertical scroll.** No fixed pixel widths, no horizontal
  scroll, percentages / flex / grid over absolute positioning.
- **Touch, not pointer**: tap targets ≥ 44px tall, generous spacing, **no
  hover-dependent affordances** (there is no hover).
- **Respect the notch**: pad fixed headers/footers with
  `env(safe-area-inset-top)` / `env(safe-area-inset-bottom)`.
- **System fonts** (`system-ui, sans-serif`) render instantly; heavy chart
  libraries that feel fine on desktop are sluggish on a phone — prefer plain
  DOM/SVG unless a chart is the point.

## Sandbox rules (what the view may and may not do)

The view runs in a `sandbox="allow-scripts"` iframe with a CSP **stricter**
than desktop views:

- **`fetch` / XHR / WebSocket are blocked to EVERY origin** (`connect-src
'none'`). There is nothing to fetch — records come only through
  `getItems`. Never write `fetch(...)` in a remote view.
- **Inline `<script>` / `<style>` work**, and external scripts/styles/fonts
  may load from the same curated CDNs as desktop views (`cdn.jsdelivr.net`,
  `unpkg.com`, `cdnjs.cloudflare.com`, Google Fonts, `cdn.plot.ly`) — the
  phone has internet; only this machine is unreachable. Prefer self-contained
  HTML anyway (see the size budget).
- **`<img>` / `<audio>` / `<video>` may load any `https:` URL** (plus `data:`
  / `blob:`) — a record's public image/media URL renders. A **workspace file
  path does not** (it lives on this machine, which the phone can't reach):
  treat `image`-type fields as desktop-only and skip or placeholder them.
- **Outbound links**: `<a href="…" target="_blank" rel="noopener">` opens
  normally; a same-tab `<a href>` is blocked by the sandbox.
- No cookies, no `localStorage`, no parent access — and no token exists in
  this contract at all.

## Editing / iterating

Read + Edit the `views/<name>.html` file under the collection's skill dir,
exactly like a desktop view; the desktop preview re-renders on reload. To
remove one, delete the file and its `views[]` entry.

---

## Example — mobile card list with "Load more"

A phone-first record list: single column, 44px+ tap targets, paginated through
`getItems`, a `startChat` action per card. Schema has `title` (string),
`status` (enum), `start` (date). Registration:
`{ "id": "phone", "label": "Phone", "target": "mobile", "file": "views/phone.html" }`.

`data/skills/annual-plan/views/phone.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        font-family: system-ui, sans-serif;
        margin: 0;
        padding: 12px;
        padding-bottom: calc(12px + env(safe-area-inset-bottom));
        background: #f8fafc;
        color: #1e293b;
      }
      h1 {
        font-size: 17px;
        margin: 4px 4px 12px;
      }
      .card {
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 12px 14px;
        margin-bottom: 10px;
        min-height: 44px;
      }
      .card b {
        font-size: 15px;
      }
      .meta {
        display: flex;
        gap: 8px;
        margin-top: 6px;
        font-size: 13px;
        color: #64748b;
        align-items: center;
      }
      .badge {
        background: #eef2ff;
        color: #3730a3;
        border-radius: 999px;
        padding: 2px 10px;
        font-size: 12px;
      }
      button {
        min-height: 44px;
        border: 0;
        border-radius: 10px;
        font-size: 15px;
        font-weight: 600;
      }
      .chat {
        margin-left: auto;
        background: #f1f5f9;
        color: #334155;
        padding: 0 14px;
      }
      .more {
        width: 100%;
        background: #4f46e5;
        color: white;
        margin-top: 4px;
      }
      .err {
        color: #b91c1c;
        padding: 12px;
      }
    </style>
  </head>
  <body>
    <h1>Annual plan</h1>
    <div id="list"></div>
    <button id="more" class="more" hidden>Load more</button>
    <script>
      var FIELDS = ["title", "status", "start"]; // project ONLY what we render
      var PAGE = 50;
      var loaded = [];
      var total = 0;

      function card(item) {
        var el = document.createElement("div");
        el.className = "card";
        var meta =
          '<div class="meta"><span class="badge">' +
          (item.status || "-") +
          "</span><span>" +
          (item.start || "") +
          "</span>" +
          '<button class="chat" data-id="' +
          item.id +
          '">Chat</button></div>';
        el.innerHTML = "<b></b>" + meta;
        el.querySelector("b").textContent = item.title || item.id;
        return el;
      }

      function render(items) {
        var list = document.getElementById("list");
        items.forEach(function (item) {
          list.appendChild(card(item));
        });
        document.getElementById("more").hidden = loaded.length >= total;
      }

      async function loadMore() {
        var page = await window.__MC_VIEW.getItems({ offset: loaded.length, limit: PAGE, fields: FIELDS });
        total = page.total;
        loaded = loaded.concat(page.items);
        render(page.items);
      }

      document.getElementById("more").onclick = function () {
        loadMore().catch(showError);
      };
      document.getElementById("list").onclick = function (e) {
        var btn = e.target.closest(".chat");
        if (!btn) return;
        var item = loaded.find(function (r) {
          return String(r.id) === btn.dataset.id;
        });
        if (item) window.__MC_VIEW.startChat("Give me an update plan for: " + (item.title || item.id));
      };

      function showError(err) {
        document.getElementById("list").innerHTML = '<div class="err">Could not load: ' + err.message + "</div>";
      }
      loadMore().catch(showError);
    </script>
  </body>
</html>
```
