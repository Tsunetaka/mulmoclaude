# Add `presentHtml` to MulmoTerminal

Why: HTML-page skills depend on `presentHtml` (render a self-contained HTML page in the canvas), and
MulmoTerminal doesn't have it. Concretely, the **`lessons-biology`** skill's `learn.md` template tells
the agent to deliver each lesson as an HTML page via `presentHtml`. When an action button runs that
skill inside MulmoTerminal, the agent **burns ~7 `ToolSearch` calls hunting for `presentHtml`**, never
finds it, and **falls back to `presentDocument`** — so the lesson renders as plain markdown instead of
its intended styled page (the one already on disk at `artifacts/html/lessons-biology/lesson-001-the-cell.html`).

This was surfaced while testing the collection action → `startChat` flow in MulmoTerminal (PRs #52–54);
the action loop itself worked — the only gap is the missing `presentHtml` tool.

Context:
- MulmoTerminal's GUI tools today: `presentDocument` (`@mulmoclaude/markdown-plugin`), `presentForm`
  (`@mulmoclaude/form-plugin`), `presentChart`, `presentCollection`, `generateImage`,
  `spawnBackgroundChat`, X tools. See `../mulmoterminal/plugins/plugins.json`.
- `presentHtml` is a **MulmoClaude built-in** at `src/plugins/presentHtml/` — it is **NOT** a shareable
  npm package (unlike markdown/form), so MulmoTerminal cannot just add it to `plugins.json`.
- `plans/feat-extract-present-plugins.md` covers extracting `presentMulmoScript` / `presentChart` /
  `presentSpreadsheet` / X — but **not** `presentHtml`. This plan fills that gap.

## What `presentHtml` does (MulmoClaude built-in)

- **Tool** (`src/plugins/presentHtml/definition.ts`): args `{ html?, path?, title? }`. Either save a new
  `html` string, or present an existing workspace `path`. Returns `{ title?, filePath }`.
- **Server** (`apiNamespace: "html"`, `src/plugins/presentHtml/meta.ts`):
  - `POST /api/html` — save `html` under `artifacts/html/…` and return its `filePath`; or echo a
    validated existing `path`.
  - `PUT /api/html/update` — overwrite an existing page in place (workspace-relative path in the body).
- **Frontend** (`View.vue`): render the page in a **sandboxed (`allow-scripts`, opaque-origin) iframe**
  with a **preview CSP** (`buildHtmlPreviewCsp`: `connect-src 'none'`, curated CDN allowlist for
  script/style/font, `img-src` self+CDN+data/blob). No scoped data token (unlike collection custom
  views — those add `connect-src origin` + a view-data endpoint).

## What MulmoTerminal already has to build on

- **Sandboxed-iframe + CSP rendering**: `src/utils/customViewSrcdoc.ts` already builds a CSP'd `srcdoc`
  for collection custom views. `presentHtml`'s policy is the *stricter* sibling (no data endpoint →
  `connect-src 'none'`), so this is largely reusable with a tweaked CSP.
- **Raw-file serving**: `GET /api/files/raw?path=` (`server/backends/files.ts`) already serves workspace
  files with `Content-Security-Policy: sandbox` + `nosniff` — usable to fetch the page's HTML, though
  note its `sandbox` header disables scripts, so the View should fetch the bytes and re-wrap with the
  preview CSP rather than point an iframe straight at it.
- **Artifacts backend**: `server/backends/artifacts.ts` writes under `<workspace>/artifacts` — the save
  target for new pages.
- **Local-plugin registry**: `plugins/plugins.json` supports `local` plugins (`plugins/<name>/` with a
  `definition.js` + `server.js`), wired by `server/plugins-registry.ts` (`loadLocal`) and rendered by
  the frontend `plugins-registry.ts` glob. This is the cheapest place to add a tool.

## Update (2026-06-19) — the extraction machinery already shipped; do Option B

Both this plan and `feat-extract-present-plugins.md` were written assuming Option B
(a shared npm plugin) was a heavy, speculative, "bundle it later" effort. **That is no
longer true** — the extraction pattern is proven and live in-tree:

- **`@mulmoclaude/chart-plugin` and `@mulmoclaude/x-plugin` are already extracted**
  (`packages/plugins/{chart,x}-plugin/`). `src/plugins/chart/` has shrunk to three thin
  shims (`definition.ts` re-exports `TOOL_DEFINITION` from the package, `index.ts` imports
  `View`/`Preview` from `@mulmoclaude/chart-plugin/vue`, `meta.ts` keeps host routing). The
  host-becomes-consumer migration is not theoretical.
- **The gap-1 unblock is done.** The extraction plan's blocking dependency — "add a generic
  `files.artifacts` primitive to gui-chat-protocol, required before chart's server code can
  live in-package" — now exists: `BrowserPluginRuntime`/`PluginRuntime` expose
  `files.artifacts: FileOps` (the shared, user-browsable artifacts dir), and
  `chart-plugin`'s `executeChart` validates + writes `artifacts/charts/**` entirely
  in-package via `context.files.artifacts.write(...)`. `presentHtml` does the structurally
  identical thing (write `artifacts/html/**`).
- **`presentHtml` maps onto generic primitives almost 1:1** (server route
  `server/api/routes/presentHtml.ts`):

  | `presentHtml` server op | Generic primitive | Status |
  |---|---|---|
  | save new HTML under `artifacts/html/**` | `files.artifacts.write` | ✅ chart uses it |
  | overwrite existing page (PUT /update) | `files.artifacts.write` | ✅ |
  | present existing path (containment + existence) | `files.artifacts.exists` + pure path guard | ✅ FileOps has `exists` |
  | publish file-change for live-refresh | host pubsub (kept host-side in the thin route) | ✅ |

- **The View extraction has a proven precedent too.** Unlike chart (whose View renders
  from `selectedResult.data.document` — data travels in the result), `presentHtml`'s View
  only gets a `filePath` and must fetch bytes, watch for changes, and PUT edits. That exact
  shape is already solved by **`@mulmoclaude/markdown-plugin`**, whose extracted View reaches
  host backends generically via `useRuntime().dispatch({ kind, … })` and watches files via
  `useRuntime().pubsub.subscribe("file:<path>", …)` (`packages/plugins/markdown-plugin/src/
  plugins/markdown/{useFileWatch,contract,core}.ts`). So the View move is a known quantity —
  and `presentHtml` is *cleaner* than markdown because its source load/save map onto generic
  `files.artifacts` read/write, not a bespoke `HostApp`.

**Recommendation (revised): do Option B directly; skip the throwaway Option A local plugin.**
Option A would create exactly the drift the extraction effort exists to eliminate (a second
hand-maintained copy of the CSP/iframe/print logic). `presentHtml` has no dependency on the
two still-blocked extraction targets (spreadsheet/mulmoscript), so it need not wait to be
bundled with them.

### Phasing (so each PR is independently reviewable + validatable)

- **Phase 1 — server core (this PR).** Extract the chart-shaped, fully-in-this-repo-validatable
  slice into a **server-only** `@mulmoclaude/html-plugin` (`.` entry only, template =
  `x-plugin`/`edgar-plugin`): `TOOL_DEFINITION`, arg/data types, pure path/slug builder, and
  `executeHtml` + `executeHtmlUpdate` + `isHtmlArtifactPath` written against the generic
  `{ files: { artifacts } }` context. Reduce the host to thin adapters
  (`server/api/routes/presentHtml.ts` injects `makeArtifactsFileOps()` + publishes the
  file-change event; `src/plugins/presentHtml/definition.ts` re-exports `TOOL_DEFINITION`).
  The host `View.vue`/`Preview.vue` stay in place and keep working. This already unblocks
  MulmoTerminal's original problem — the agent gets a real `presentHtml` tool + shared
  save/validate logic and renders the page via MulmoTerminal's existing `customViewSrcdoc`
  machinery instead of burning ToolSearch calls and falling back to `presentDocument`.
- **Phase 2 — View extraction (follow-up PR).** Add the `./vue` entry (View/Preview + lang/
  + `style.css`), porting the host View onto the generic runtime exactly like markdown:
  `useFileWatch` over `useRuntime().pubsub`, source load/save via `useRuntime().dispatch`
  routed to a package `executeHtmlDispatch(context, …)` against `files.artifacts`, and the
  print-to-PDF logic + `previewCsp` helpers moving into the package. Reduce
  `src/plugins/presentHtml/index.ts` to import `View`/`Preview` from the package (the chart
  shim shape). This is the part that removes the last UI drift; it needs the built-in
  dispatch wiring (markdown's `server/plugins/markdown-builtin.ts` is the host-side
  precedent) and is best validated against a running MulmoTerminal.

Original Option A / Option B write-ups retained below for context.

## Option A — build a local `presentHtml` plugin in MulmoTerminal (no longer recommended)

Keeps the **zero-MulmoClaude-changes** property and reuses the custom-view CSP/iframe code.

1. **Tool definition** — `plugins/presentHtml/definition.ts`: `TOOL_DEFINITION` for `presentHtml`
   (args `{ html?, path?, title? }`), copied/trimmed from MulmoClaude's `definition.ts`.
2. **Server execute** — `plugins/presentHtml/server.ts`:
   - `html` given → write `artifacts/html/<prefix>-<id>.html` via the artifacts FileOps; return
     `{ data: { title, filePath } }`.
   - `path` given → validate it is under `artifacts/html/**` (path containment, like the raw route),
     return `{ data: { title, filePath: path } }`.
3. **Frontend View** — a Vue component that:
   - reads `selectedResult.data.filePath`, fetches the HTML (via `/api/files/raw?path=` or a dedicated
     `/api/html/file` route),
   - wraps it with a **preview CSP** (extend `customViewSrcdoc.ts` with a `connect-src 'none'` variant /
     factor out a shared `buildPreviewSrcdoc`),
   - renders it via `srcdoc` in a `sandbox="allow-scripts"` iframe, sized like the collection card
     (`height` through `PluginFrame`, or its own full-bleed frame).
4. **Register** — add `"presentHtml"` to `plugins.json` `local`, plus the server-side `loadLocal` entry
   (and the GUI MCP allow-list so the agent may call it without a prompt).
5. *(Optional)* `PUT /api/html/update` for in-place overwrite (the lesson skill writes the file directly
   today, so this may be deferrable).

## Option B — extract a shared `@mulmoclaude/html-plugin`

Follow `plans/feat-extract-present-plugins.md`'s form/markdown pattern: lift `src/plugins/presentHtml/`
into `packages/plugins/html-plugin` (`.` server core + `./vue` View/Preview + `./style.css`), publish,
and have **both** apps consume it. No drift; but it's a cross-repo change + npm publish, and MulmoClaude
becomes a consumer of its own extracted plugin. Prefer this only if/when the other present* plugins are
extracted too (bundle the work).

**Recommendation (superseded — see the 2026-06-19 update above).** This originally read
"Option A first, then fold into B later." The extraction machinery has since shipped
(`chart`/`x` extracted, `files.artifacts` primitive live, markdown View precedent), so the
revised call is **Option B directly, phased** — server core first, View second.

## Open questions

- **CSP policy**: reuse MulmoClaude's `buildHtmlPreviewCsp` CDN allowlist verbatim (jsdelivr/unpkg/
  cdnjs/Google Fonts/plotly)? Lesson pages are self-contained but may pull a font/chart lib from a CDN.
- **Existing-path present**: lesson records store `lesson: "artifacts/html/…​.html"` and the skill
  presents by `path`. Confirm the View handles `path`-only results (no inline `html`).
- **Live-refresh**: a background worker may regenerate the page after it's shown; do we forward file
  changes to the View (the markdown plugin already has a pubsub file-change channel) or accept a manual
  re-present? (Same open gap as collection views.)
- **`presentSVG`**: MulmoClaude also has a sibling `presentSVG` built-in — likely the same treatment;
  decide whether to cover it here or separately.

## Pointers

- MulmoClaude built-in: `src/plugins/presentHtml/{definition,meta,index,View,Preview}.ts(.vue)`,
  `src/utils/html/previewCsp.ts` (`buildHtmlPreviewCsp`).
- MulmoTerminal reuse: `../mulmoterminal/src/utils/customViewSrcdoc.ts`,
  `../mulmoterminal/server/backends/{files,artifacts}.ts`, `../mulmoterminal/server/plugins-registry.ts`
  (`loadLocal`), `../mulmoterminal/docs/collection-plugin-integration.md`.
