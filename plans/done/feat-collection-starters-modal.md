# Plan: "New collection" starter modal + shared runtime-translation client

## Motivation

The collection-related sample queries attached to roles (in `src/config/roles.ts`)
are some of the best onboarding material in the app — each one says "describe what
you want and get a working data app." But today they're buried as per-role
suggestion chips, only visible if the user happens to be in the Personal / Office /
Tutor / Investor role. New users browsing the **Collections** UI never see them.

Meanwhile the "+ collection" button in the Collections index immediately fires a
single hard-coded chat (the `presentForm`-driven guided flow). There's no chooser,
no discovery of what's possible.

This plan turns the "+ collection" button into a **chooser modal** that offers:

1. **Free-form chat** — a blank new chat, user describes the collection themselves.
2. **Guided form** — the *current* button behavior (auto-sends the `presentForm` prompt).
3. **Ten templates** — the curated collection-creation prompts, lifted out of roles.

The ten template prompts (and their card titles/descriptions) are translated at
runtime via the existing translation service, reusing it through a new
**browser-safe client extracted into `@mulmoclaude/core`** so the collection-plugin
(which may not import host `src/`) can call it — and so MulmoTerminal can reuse the
same client against its own server implementation.

## Current state (verified)

### The "+ collection" button
- `packages/plugins/collection-plugin/src/vue/components/CollectionsIndexView.vue:30-39`
  — button, `data-testid="collections-add-collection"`, `@click="startCreateCollectionChat"`.
- Handler `startCreateCollectionChat()` (~line 168) calls
  `cui.startChat(t("collectionsView.addCollectionPrompt"), cui.generalRoleId)` —
  **auto-sends** the prompt immediately.
- Prompt string `collectionsView.addCollectionPrompt` (en.ts:27-28) already instructs
  the agent to read `config/helps/collection-skills.md` and use `presentForm`. **This
  is exactly the "Guided form" option** — the modal does not replace it, it puts a
  chooser in front of it.

### Chat-injection primitives (already available to collection UI)
- `cui.startChat(prompt, role)` — **auto-sends** (what the button does now).
- `cui.startNewChatDraft(prompt, role)` — **prefills the composer as an editable draft**
  (user reviews/edits/sends). Defined in `src/composables/collections/uiContext.ts`,
  wired in `App.vue` (`startNewChat` / `startNewChatDraft`).
- Templates will use **`startNewChatDraft`** so users can tweak before sending;
  Guided form keeps `startChat` (auto-send); Free-form opens a blank new chat.

### Reusable modal shell
- `packages/plugins/collection-plugin/src/vue/components/CollectionRecordModal.vue`
  — Teleport (configurable target via `collectionUi().modalTeleportTarget`), focus
  trap, Escape handling, `@close` emit. The new modal reuses this shell.

### Runtime translation service (host-side today)
- **Server service**: `server/services/translation/` —
  `createTranslationService` (`index.ts`), `TranslateRequest { namespace, targetLanguage, sentences }`
  → `{ translations }` (`types.ts`), LLM batch via `claude` CLI haiku with
  `--max-budget-usd 0.5` (`llm.ts`), hit/miss split + atomic merge-write (`cache.ts`).
- **Cache**: `data/translation/<namespace>.json` keyed by source sentence + language;
  `server/utils/files/translation-io.ts`, dir constant `WORKSPACE_DIRS.translation`
  (`server/workspace/paths.ts`). Short-circuits when `targetLanguage === "en"`.
- **HTTP route**: `POST /api/translation` (`server/api/routes/translation.ts`,
  path constant in `src/config/apiRoutes.ts`).
- **Client composable**: `src/composables/useTranslatedQueries.ts` —
  role-specific, namespace `"role-queries"`, in-memory cache keyed `roleId:locale`,
  in-flight dedupe, English fallback while loading. Used in `App.vue` → ChatInput →
  SuggestionsPanel.
- **All host-side** (`src/` + `server/`). Nothing in `@mulmoclaude/core` yet.

## Design decisions (locked)

| # | Decision |
|---|---|
| Layout | **Grouped (B)**: top row `[Free-form chat] [Guided form]`, then a "Start from a template" gallery of ten cards. Free-form and Guided form are co-equal generic actions; templates are the content. |
| Guided form | = the **current** button behavior (`startChat` + `addCollectionPrompt`). Modal adds a chooser in front; does not change this path. |
| Free-form | Brand-new **blank** chat, general role, empty composer. |
| Templates → injection | `startNewChatDraft` (editable draft), so users can tweak before sending. |
| Source of truth | The ten prompts **move out of `roles.ts`** into a new `collectionStarters` array owned by the collection-plugin. One curated list, decoupled from role membership. |
| General L70 | The General role's "What are collections in this app…" query **stays** — it's a discovery/info question, not a creation template, and belongs with General's other app-intro chips. |
| i18n | No static i18n keys. Card **titles + descriptions + prompts** are English source strings, translated at **runtime** via the translation service (new namespace `"collection-starters"`). |
| Core scope | **Client only** moves to core. The server service + `/api/translation` route stay host-side (already generic). MulmoTerminal implements its own server side (different LLM path) — see separate-repo section. |
| Transport | The core client is **host-agnostic**: it receives its POST function via injection (mulmoclaude passes `apiPost` w/ bearer token; MulmoTerminal passes its own). |

## Card metadata (locked)

Icons are Material Symbols, matching collection-card convention. Title + description
are English source strings (runtime-translated); `prompt` is the injected draft text.

| id | icon | title | description |
|---|---|---|---|
| `todos` | `checklist` | Todo list | Track tasks with due dates and status |
| `contacts` | `contacts` | Contacts | People with details, read from a business card photo |
| `reading-list` | `menu_book` | Reading list | Save links to read, with unread reminders |
| `restaurants` | `restaurant` | Restaurants | Places to try, rate after you've visited |
| `bills` | `receipt_long` | Bills | Recurring payments with due-date reminders |
| `clients-worklog` | `work` | Clients & time | Consulting clients plus a worklog |
| `invoice` | `request_quote` | Invoicing | Invoices and your business profile |
| `vocabulary` | `translate` | Vocabulary | Words and sample sentences for a language |
| `lessons` | `school` | Lessons | A tracked course with a planned curriculum |
| `portfolio` | `trending_up` | Stock portfolio | A watchlist plus valued holdings |

The `prompt` for each is the exact query currently in `roles.ts` (see "Move map").

## Move map — queries leaving `roles.ts`

| Role | Remove queries | Keeps |
|---|---|---|
| Personal | todos, contacts, reading-list, restaurants | the feed-register query |
| Office | bills, clients/worklog, invoice | DCF, report, deck, X-search |
| Tutor | vocabulary, lessons | whales, solar, sorting, fractions, water cycle |
| Investor | portfolio tracker | the other 7 |
| General | — (line 70 **stays**) | all |

After the move, Personal is left with a single query — acceptable; its role chips
shrink because that content now lives in the modal.

## Work items (this repo)

1. **`collectionStarters` data** (collection-plugin). New module exporting the ten
   entries `{ id, icon, title, description, prompt }` — English source strings.
   Owned by the plugin (its only consumer), so no uphill host import.

2. **Remove moved queries from `src/config/roles.ts`** per the move map. Leave
   General L70. Update `test/config/test_roles.ts` if it asserts query contents.

3. **Extract translation client into core** — new browser-safe subpath
   `@mulmoclaude/core/translation/client` exporting a generic
   `useTranslatedStrings(sentences, locale, namespace, { post })`. Host-agnostic:
   transport injected via `post`. Add the export to core's `package.json`
   (`import`/`require`/`default` conditions per CLAUDE.md cross-platform rule).

4. **Refactor `src/composables/useTranslatedQueries.ts`** to a thin wrapper over the
   core client (namespace `"role-queries"`, `post = apiPost`). One translation client,
   no parallel copies.

5. **Build the chooser modal** (collection-plugin). New component reusing
   `CollectionRecordModal`'s shell. Layout B. Wire:
   - Free-form → blank `startNewChatDraft("")` (or a dedicated blank-chat path), general role.
   - Guided form → `startChat(addCollectionPrompt, generalRoleId)`.
   - Templates → `startNewChatDraft(starter.prompt, role?)`.
   - Translate titles/descriptions/prompts via the core client, namespace
     `"collection-starters"`, English fallback while loading.
   Change `startCreateCollectionChat` to **open the modal** instead of starting a chat.

6. **Version bump** `@mulmoclaude/core` (new subpath export) and re-add to host —
   per the cross-host version-skew rule (MulmoTerminal consumes core too).

7. **Checks**: `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, plus
   `eslint --no-cache` on new/moved files. Update `docs/shared-utils.md` if a new
   shared helper is added.

## Translation service in MulmoTerminal (separate repo — `../mulmoterminal`)

> This work lands in the **MulmoTerminal repository**, not here. It is required for
> the shared client to function there, but is tracked separately and is **not part of
> this repo's PR**. Documented here so the contract is unambiguous.

**Confirmed feasible** (inspection of the MulmoTerminal checkout at `../mulmoterminal`):

- MulmoTerminal already depends on `@mulmoclaude/core` and imports server subpaths
  from it (e.g. `@mulmoclaude/core/feeds/server`). Consuming the new
  `@mulmoclaude/core/translation/client` subpath requires bumping its `@mulmoclaude/core`
  to `^0.2.15` (the version that first ships the subpath) **in lockstep with** the
  `@mulmoclaude/collection-plugin` bump — the plugin imports the subpath at module
  load, so an older core there throws on resolution before the optional `translate`
  fallback can run. The collection-plugin's peer range now pins `@mulmoclaude/core`
  to `^0.2.15` to make that requirement explicit.
- Same stack: Express server, Vue 3 frontend, same `data/<...>.json` workspace
  convention, same default workspace root (`CLAUDE_CWD`, default `~/mulmoclaude`).
- It already spawns the `claude` CLI and also has a Gemini SDK path — so it can
  implement the LLM step however it likes.
- It has **no host i18n** today (plugins self-localize; locale = `navigator.language`
  base). `useTranslatedStrings` is therefore a new, additive client capability there.

**MulmoTerminal must provide its own server side implementing the identical contract:**

- Route: `POST /api/translation`, body `{ namespace, targetLanguage, sentences }`,
  response `{ translations }` (same order as input). Mount via a
  `mountTranslationRoutes(app, { workspace: CLAUDE_CWD })` in
  `server/backends/translation.ts`, called from `server/index.ts` alongside the other
  `mount*Routes` calls (mirrors `mountShortcutsRoutes`).
- LLM step: **MulmoTerminal's own implementation** — the invocation mechanism differs
  from mulmoclaude's and that's expected. Only the HTTP contract is shared.
- Cache: write per-namespace dictionaries to `data/translation/<namespace>.json` to
  match the convention. Because both apps default to the `~/mulmoclaude` workspace and
  the cache is keyed by source sentence + language, **the cache is shared** —
  whichever app translates a given sentence first, both benefit. (Same English source
  strings → same keys; no schema divergence.)
- Client wiring: pass MulmoTerminal's own transport as `post` into
  `useTranslatedStrings` — keeping the interface identical while transport + server
  LLM path differ per host. This is the same injection pattern MulmoTerminal already
  uses for host capabilities (`collectionUi().localeTag`, etc.).

**No blockers identified.** The only shared artifact is the core client + the HTTP
contract; everything host-specific (transport, auth, LLM, route mounting) stays in
each repo.

## Out of scope

- Localizing the role `queries` that *remain* in `roles.ts` (unchanged behavior — they
  already flow through `useTranslatedQueries`).
- Any change to the translation server service or `/api/translation` route in this
  repo (the client extraction is non-breaking; the service stays put).
- Dashboard / pinned-shortcut surfacing of starters (the modal is the only new entry
  point this plan adds).
