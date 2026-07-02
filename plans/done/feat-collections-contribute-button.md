# feat: Contribute button → agent-driven registry export (Issue #1827)

## Goal

Give collection authors a one-click way to publish a collection to the curated
registry (`receptron/mulmoclaude-collections`). Producer-side counterpart to the
Discover/Import consumer flow.

## Why "button → agent" (Option ②)

A button that calls a backend endpoint can only produce the **local** bundle —
the app server cannot open the user's GitHub PR for them. The full
export→curate loop needs git + `gh`, which the agent has. So the button does not
do the export itself; it launches a chat seeded with an instruction prompt, and
the agent performs the whole flow (build bundle → clone registry → build-index →
validate → `gh pr create`). This mirrors the existing custom-view / add-collection
pattern (`cui.startChat(prompt, role)`).

The export backend endpoint (PR #1825) stays as an independent, reusable building
block; Option ② does not depend on it.

## Changes

1. **`CollectionsIndexView.vue`**
   - Add a Contribute icon-button (`ios_share`) to each Installed-tab card,
     between the pin toggle and the chevron.
   - `@click.stop` (+ keyboard equivalents) so it never triggers the card's
     `openCollection`.
   - `startContributeChat(collection)` → `cui.startChat(t("collectionsView.contributePrompt", { title, slug }), cui.generalRoleId)`.

2. **i18n** (all 8 locales: en, ja, de, es, fr, ko, ptBR, zh)
   - `collectionsView.contribute` — button label/title.
   - `collectionsView.contributePrompt` — the agent instruction (interpolates
     `{title}` / `{slug}`). EN + JA fully translated; the other 6 carry the EN
     prompt value (agent-facing text — the agent works in any language), with the
     button label localized.

3. **Version bump** `@mulmoclaude/collection-plugin` 0.5.11 → 0.5.12.

## Prompt contract

The seeded prompt tells the agent to:
1. Read `config/helps/collection-skills.md` for the bundle layout.
2. Ask for the user's GitHub username (`meta.author` must equal it — registry R9)
   and whether to include records as sample seed (skip anything with secrets).
3. Build `collections/<author>/<slug>/` (SKILL.md, schema.json, meta.json,
   optional seed/items), copy into a clone of the registry under `github/`, run
   `node scripts/build-index.mjs` + `node scripts/validate.mjs`, open a PR after
   confirmation.

## Verification

- `yarn format`, `npx eslint` (changed files), `yarn workspace @mulmoclaude/collection-plugin build` (vue-tsc), `yarn typecheck` — all clean.
- Manual: Contribute button on a card launches a chat with the prompt prefilled.

## Out of scope

- Update detection (R5) — next workstream (Installed tab "update available").
