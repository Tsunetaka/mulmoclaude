# feat: Remote collection view — phase 2: view one collection on mobile

## Goal

Let the **mobile remote** (the `mulmoserver` app) open a single collection and
browse its records, **optimized for a phone**. Builds directly on phase 1
(`listCollections`, shipped): the remote already lists the host's collections
with icon/title/slug and auto-fetches on connect. Phase 2 makes each list row
tappable → a mobile-first detail page that renders the collection's records.

**Phase 2 scope:** **read-only**, **paginated**, **field-schema-driven** card
list → tap a record → record detail. **No** calendar/kanban/dashboard/custom-HTML
views, **no** images, **no** editing. Those are later phases (the host API
already supports them, so they're clean extensions).

Phase 2 also exposes the user's **pinned shortcuts (favorites)** — the same
`config/shortcuts.json` list the desktop launcher shows — so the remote can offer
quick access to starred collections/feeds. Read-only: a new `listShortcuts`
handler mirrors `GET /api/shortcuts`; editing the pin list stays desktop-only.

And it exposes **feeds** the same way as collections. A feed *is* a
`LoadedCollection` with an `ingest` block, so its records read through the exact
same `listItems(dataDir)` path: `listFeeds` mirrors `GET /api/feeds` (the feed
registry with kind/schedule/last-fetch), and `getFeed` returns one feed's detail
+ a page of records — identical result shape to `getCollection`, so the remote
reuses the same card renderer. Read-only; refresh/retrieval stays desktop-only.

## Background / what already exists

- **Channel**: proven command channel over Firestore — `callHost(channel,
  method, params)` on the remote, `startHostRunner(channel, handlers)` on the
  host, one document per call under `users/{uid}/hosts/mulmoclaude/commands`.
  Phase 1 added the `mulmoclaude` host + `listCollections` handler.
- **Host already has the desktop API** this phase mirrors:
  `GET /api/collections/:slug → { collection: CollectionDetail, items:
  CollectionItem[] }` (see `server/api/routes/collections.ts`). We reuse the same
  in-process helpers it calls, bypassing the HTTP/view-token layer:
  - `loadCollection(slug): Promise<LoadedCollection | null>` — `null` ⇒ not found.
    Carries `.dataDir`, `.schema` (`primaryKey`, `displayField?`, `fields:
    Record<string, CollectionFieldSpec>`), and `toSummary(collection)` →
    `CollectionSummary`.
  - `listItems(dataDir): Promise<CollectionItem[]>` — `CollectionItem =
    Record<string, unknown>`.
  Both exported from `server/workspace/collections/index.ts`.
- **Host already has the shortcuts API** this phase mirrors: `GET /api/shortcuts
  → { shortcuts: Shortcut[] }` (`server/api/routes/shortcuts.ts`), backed by
  `readShortcuts(): Promise<Shortcut[]>` (`server/utils/files/shortcuts-io.ts`).
  `Shortcut = { kind: "collection" | "feed", slug, title, icon }` is browser-safe
  plain JSON (`src/types/shortcuts.ts`).
- **Host already has the feeds API** this phase mirrors: `GET /api/feeds →
  { feeds: FeedSummary[] }` (`server/api/routes/feeds.ts`), backed by
  `listFeeds(workspaceRoot): Promise<LoadedCollection[]>` + `readFeedState(...)`
  (`@mulmoclaude/core/feeds/server`). A feed is a `LoadedCollection` with an
  `ingest` block, so its records read via the same `listItems(feed.dataDir)`.
- **Remote already has** `useCollections` + the Collections page
  (`../mulmoserver/src/composables/useCollections.ts`,
  `src/views/Collections.vue`). This phase adds a sibling `useCollection(slug)`
  and a `/collections/:slug` route.

### Trust model — why reading an arbitrary slug is safe

The infra sections below detail *how* records are paged under the 1 MiB limit;
this paragraph records *why* an unauthenticated-at-the-handler `getCollection(slug)`
/ `getFeed(slug)` is not a data-leak. The entire security boundary is the
**Firestore rules layer, scoped by uid** — there is deliberately **no per-method
authz in the handlers**:

- Everything lives under `users/{uid}/hosts/{hostId}/**` (the `commands`
  subcollection and the presence doc), which the deployed rule restricts to
  `request.auth != null && request.auth.uid == uid`. In mulmoserver this is the
  broader `match /users/{uid}/{document=**}` rule, whose recursive wildcard
  already covers the hosts subtree. So a remote can only ever enqueue commands in
  **its own** uid's queue; a different signed-in user cannot reach this host.
- That rule was established in **phase-1 (#1909)** and is live in production —
  it is a prerequisite of this phase, not something phase-2 adds.
- The handlers being read-only is what makes uid-scope-only sufficient: a
  request already proves ownership of the workspace by virtue of writing to
  `users/{uid}/…`, and read-only handlers can't cross that boundary.
- **Phase-3+ caveat:** when write/delete or cross-collection `ref`/`embed`
  handlers are added, re-evaluate — they may need handler-side authz (per-slug
  scope, rate limits) on top of the rules layer, since "can write to my own
  queue" no longer implies "may mutate this specific record/collection."

The one boundary *outside* Firestore is the auth entry point: `signInHost`'s
Google OAuth ID token must be accepted only from the localhost owner
(`/api/remote-host/connect`), so a hostile page can't turn the server into a host
for someone else's workspace.

## The three decisions that shape this

### 1. The 1 MB Firestore document limit (the important one)
The command channel writes the **result inside the command document**, and
Firestore caps a document at 1 MiB. A collection with many/large records will
exceed that. So the host handler **must paginate**:

- Params: `{ slug: string, offset?: number, limit?: number }` (default limit
  e.g. 50).
- Result: `{ collection: CollectionDetail, items: CollectionItem[], total:
  number, offset: number, limit: number }`.
- The remote fetches a page at a time; the detail page appends on scroll
  ("Load more") and shows `items.length / total`.

Optional refinement if single records are still large: a **projected** list
payload (only the fields the card shows) + a separate `getRecord(slug, id)` for
the full record on tap. Start without projection; add it only if a real
collection blows the budget.

### 2. Images / media — out of scope in phase 2
`image` fields point at bytes on the host's `localhost`; a phone can't fetch
those URLs. Options for later: inline small thumbnails as data-URLs (eats the
1 MB budget) or stand up an image relay. **Phase 2 renders image fields as a
placeholder chip, not the image.**

### 3. Renderer scope — mobile-first, field-schema-driven, read-only
Do **not** reproduce the desktop's calendar/kanban/dashboard or sandboxed
custom-HTML views. Walk `schema.fields` and render a **card per record**:

- **Card title** = `record[schema.displayField]` when set and non-empty, else
  `record[schema.primaryKey]`.
- **Card body** = a few scalar fields as label/value rows.
- Render these field types natively; **skip or summarize** the rest in phase 2:
  - `text`, `number`, `date`, `money` → formatted value.
  - `enum` → a colored badge.
  - `ref` → the stored slug as plain text (no navigation yet).
  - `table` → "N rows" summary chip.
  - `embed`, `image`, `derived` → skip in the card (show on the record detail as
    a placeholder / best-effort).
- **Tap a card** → a record detail panel listing every scalar field label/value.
- Respect each field's `when` visibility predicate if cheap; otherwise defer.

## Reusable collection-view component (the template for LLM custom views)

**Design constraint (decided):** the collection view must be built as a
**reusable component that accesses item collections through a stable contract**,
*not* as a page that reaches into the channel inline. The default card renderer
shipped in phase 2 becomes the **reference template** for a later phase where an
**LLM generates a bespoke "custom mobile view" per collection** from the user's
request (the mobile-native analogue of the desktop's sandboxed custom-HTML
`views`). So the seam has to exist from day one — build the default view *as if*
it were one of many interchangeable views.

Two layers, split cleanly:

1. **Data access — `useCollection(uid, hostId, slug)` (channel-aware, reusable).**
   The *only* thing that knows about `callHost`/Firestore. Exposes a plain,
   view-agnostic surface: `{ collection, schema, items, total, pending, error,
   load(), loadMore() }`. Every view — the default one and any future
   LLM-generated one — consumes exactly this; none of them import the channel.

2. **Presentation — a `CollectionView`-shaped component over a documented prop
   contract.** The default `CollectionCardList.vue` is the reference
   implementation. Its inputs are the whole contract:

   ```ts
   // The view contract every mobile collection view implements.
   interface CollectionViewProps {
     schema: CollectionSchema;      // field specs, primaryKey, displayField
     items: CollectionItem[];       // the current page of records (read-only)
     total: number;                 // full count, for "Load more" / progress
     pending: boolean;
   }
   // emits: (e: "load-more") — the page owns pagination; the view just asks.
   ```

   A custom view is a drop-in component satisfying the same props/emit — the page
   swaps which component it renders, nothing else changes.

3. **Shared, view-usable helpers.** Keep the pure `collectionSchema.ts` helpers
   (`recordTitle`, `visibleScalarFields`, `formatFieldValue`, `enumBadgeClass`)
   dependency-free so *any* view — including generated ones — can reuse title and
   per-type formatting logic instead of re-deriving it. These plus the prop
   contract are the surface an LLM targets.

The page (`Collection.vue`) wires it together: `useCollection(slug)` → chooses a
view (phase 2: always `CollectionCardList`; later: the collection's custom view
when present, else the default) → renders it and handles `load-more`. Keep the
default view free of collection-specific assumptions so it stays a faithful
template.

## Host side (MulmoClaude — the other terminal)

`server/remoteHost/handlers/getCollection.ts` — reuse `toDetail(collection)` (the
exact helper `GET /api/collections/:slug` uses; it *is* `{ ...toSummary, schema }`)
rather than rebuilding the shape, and follow the `createListCollections(deps)`
factory pattern so the mapping is unit-testable with the engine stubbed:

```ts
import { loadCollection, listItems, toDetail } from "../../workspace/collections/index.js";
// params arrive as JSON over the channel — coerce defensively:
//   slug -> String; offset -> non-negative int (default 0);
//   limit -> int clamped to [1, MAX_LIMIT] (default 50) so a runaway page
//   can't blow the 1 MB Firestore result-document budget.
export const getCollection = async ({ slug, offset, limit }) => {
  const collection = await loadCollection(String(slug));
  if (!collection) throw new Error(`collection '${slug}' not found`);
  const all = await listItems(collection.dataDir);
  const off = clampOffset(offset), lim = clampLimit(limit);
  return { collection: toDetail(collection), items: all.slice(off, off + lim), total: all.length, offset: off, limit: lim };
};
```

`server/remoteHost/handlers/listShortcuts.ts` — the favorites list, mirroring
`GET /api/shortcuts`:

```ts
import { readShortcuts } from "../../utils/files/shortcuts-io.js";
export const listShortcuts = async () => ({ shortcuts: await readShortcuts() });
```

`server/remoteHost/handlers/listFeeds.ts` + `getFeed.ts` — the feed registry and
one feed's records, mirroring `GET /api/feeds` and reusing the collection page
builder (a feed is a `LoadedCollection`):

```ts
import { listFeeds, readFeedState } from "@mulmoclaude/core/feeds/server";
import { workspacePath } from "../../workspace/workspace.js";
// listFeeds -> { feeds: FeedSummary[] } (slug/title/icon/kind/schedule/lastFetchedAt)
// getFeed({ slug, offset, limit }) -> find the feed by slug, then the SAME
//   { collection: toDetail(feed), items, total, offset, limit } shape as getCollection.
```

Shared pagination lives in `server/remoteHost/handlers/collectionPage.ts`
(`clampOffset` / `clampLimit` / `pageResult`) so `getCollection` and `getFeed`
don't duplicate the 1 MB-budget clamping and slicing.

Register all of them in `server/remoteHost/handlers/index.ts` alongside
`listCollections` (the single place the runner learns its methods). `getCollection`
/ `getFeed` mirror the not-found behavior (throw → the runner writes an error
result). All return values are plain JSON but their interfaces lack an index
signature, so cast to the channel's `JsonObject` like `listCollections`.

## Remote side (mulmoserver)

- **Data hook (shared by collections *and* feeds)** —
  `src/composables/useCollection.ts` — `useCollection(uid, hostId, slug,
  method = "getCollection")`: the only channel-aware piece. Calls
  `callHost(channel, method, { slug, offset, limit })`; exposes the view-agnostic
  surface `{ collection, schema, items, total, pending, error, load(),
  loadMore() }`. Because `getFeed` returns the **identical** `{ collection,
  items, total, offset, limit }` shape, a feed detail page reuses this hook by
  passing `method: "getFeed"` — **no duplicate hook, no second renderer**. (A
  one-line `useFeed = (uid, hostId, slug) => useCollection(uid, hostId, slug,
  "getFeed")` alias is fine if it reads better at call sites.) Mirrors
  `useCollections`.
- **Shared helpers** — `src/firestore/collectionSchema.ts` — **firebase-free**
  pure helpers (so they unit-test under `tsx --test`, like `commandFormat.ts`,
  and so any view — default or generated — can reuse them): `recordTitle(schema,
  record)`, `visibleScalarFields(schema)`, `formatFieldValue(spec, value)`,
  `enumBadgeClass(value)`. `import type` only.
- **Reusable view (the template)** — `src/components/collection/CollectionCardList.vue`
  — presentational only, over the `CollectionViewProps` contract
  (`schema`/`items`/`total`/`pending`, emits `load-more`). Renders the card list,
  record detail on tap, and the "Load more" affordance. Imports **no** channel
  code — this is what a future LLM-generated custom view is modeled on. **Feeds
  render through this same component** (a feed is a `LoadedCollection`).
- **Collection page** — `src/views/Collection.vue` — wires it together: header
  (title + the same connection status icon) + `useCollection(slug)` → renders the
  chosen view component (phase 2: always `CollectionCardList`) and handles
  `load-more`, loading / empty / error states.
- **Feed page** — `src/views/Feed.vue` — the same shape as `Collection.vue` but
  calls `useCollection(slug, "getFeed")` and renders the same
  `CollectionCardList`. Thin wrapper; exists mainly to give feeds their own route
  and (later) surface feed-registry metadata (kind/schedule/last-fetch) in the
  header.
- **Feeds list** — `src/composables/useFeeds.ts` (calls `listFeeds`) + a
  `src/views/Feeds.vue` list page, mirroring `useCollections` + `Collections.vue`
  (rows → `/feeds/:slug`). Add a `feeds` toolbar entry (e.g. `rss_feed` icon) next
  to `collections`.
- **Shortcuts launcher** — `src/composables/useShortcuts.ts` (calls
  `listShortcuts`) + a launcher surface (a section on the home/Collections page,
  or its own small `Shortcuts.vue`) rendering each pinned `Shortcut`
  (`{ kind, slug, title, icon }`) as a tappable row. The `kind` discriminant
  routes: `collection` → `/collections/:slug`, `feed` → `/feeds/:slug`. This is a
  navigation list, **not** a card renderer — no `CollectionCardList` here.
- Routes: add `collections/:slug`, `feeds/:slug`, and `feeds` to `routeChildren`
  in `src/router/index.ts` (all work under `/en` and `/ja`). Make each row in
  `Collections.vue` / `Feeds.vue` a `router-link` to the localized detail path.

## Steps

0. Host: add `getCollection`, `listShortcuts`, `listFeeds`, `getFeed` handlers +
   register them; unit-test the mapping (engine/IO stubbed) and smoke-test from
   the remote client (`callHost(channel, "getCollection", { slug })`,
   `listShortcuts`, `listFeeds`, `getFeed`).
1. Remote: `collectionSchema.ts` pure helpers + unit tests (`recordTitle`,
   `formatFieldValue`, `visibleScalarFields`).
2. Remote: `useCollection` data hook (paginated `load` / `loadMore`,
   `method`-parameterized so feeds reuse it).
3. Remote: `CollectionCardList.vue` reusable view over the `CollectionViewProps`
   contract (no channel imports); then `Collection.vue` page wires
   `useCollection` → the view + `load-more`; wire the `collections/:slug` route;
   make `Collections.vue` rows navigate.
4. Remote (feeds + shortcuts, reusing step 2/3): `useFeeds` + `Feeds.vue` list
   and `Feed.vue` detail (via `useCollection(slug, "getFeed")` →
   `CollectionCardList`) with `feeds` / `feeds/:slug` routes and a toolbar entry;
   `useShortcuts` + the launcher list routing by `kind`.
5. Manual end-to-end: connect the host → open a collection **and** a feed on a
   phone → records render through the same card view, "Load more" pages through a
   large one; the shortcuts launcher routes to both.

## Out of scope (later phases)

- **LLM-generated custom mobile views.** Phase 2 establishes the seam — the data
  hook, the `CollectionViewProps` contract, and the default view as its reference
  implementation — but does **not** build the generation/selection mechanism
  (host stores a per-collection custom view; the page picks it when present).
  That is the next phase, and it should require *no* change to the data hook.
- Editing (create/update/delete items — the host API already supports it).
- Images/media, `embed` resolution, `ref` navigation between collections.
- Calendar / kanban / dashboard / desktop custom-HTML views.
- Live updates (re-fetch on open / manual refresh is enough for now).

## Test plan (`tsx --test`, both repos)

- **Remote pure-logic**: `recordTitle` (displayField → primaryKey fallback),
  `formatFieldValue` per type (date/number/money/enum), `visibleScalarFields`
  (skips table/embed/image/derived). No Firebase at import time.
- **Remote contract/source-text**: `useCollection` calls `callHost` with a
  `method` param (default `"getCollection"`) plus `slug`/`offset`/`limit`, so
  `Feed.vue` reuses it with `"getFeed"`; `CollectionCardList.vue` imports **no**
  channel/Firestore code (it's a pure view over props) and emits `load-more`
  gated on `items.length < total`; `Collection.vue` and `Feed.vue` both render
  that same view and own pagination; the `collections/:slug`, `feeds`, and
  `feeds/:slug` routes are registered; `Collections.vue` / `Feeds.vue` rows link
  to their detail paths; the shortcuts launcher routes by `kind` (`collection` →
  `/collections/:slug`, `feed` → `/feeds/:slug`).
- **Host**: `getCollection`, `listShortcuts`, `listFeeds`, `getFeed` registered;
  `getCollection`/`getFeed` return `{ collection, items, total, offset, limit }`,
  not-found throws, pagination slices by `offset`/`limit` and clamps a runaway
  `limit` (`loadCollection`/`listFeeds`/`listItems`/`toDetail` stubbed);
  `listShortcuts` returns `{ shortcuts }` (`readShortcuts` stubbed); `listFeeds`
  returns `{ feeds }` (`listFeeds`/`readFeedState` stubbed).
```
