# feat: confirm before Contribute launches the agent (Issue #1831)

## Goal

Gate the collection **Contribute (share)** button behind a confirm dialog. Today a
single click immediately starts a chat where the agent exports the collection and
opens a GitHub PR — too destructive for a one-click, no-undo action. Ask first.

Follow-up to #1828 (the Contribute button itself), now merged.

## Change

1. **`CollectionsIndexView.vue`** — `startContributeChat` becomes async and awaits
   `cui.confirm({ message: t("collectionsView.contributeConfirm", { title }), confirmText: t("collectionsView.contribute"), variant: "primary" })`.
   Returns early if the user cancels; only on confirm does `cui.startChat(...)` fire.
   Uses the host's existing `ConfirmModal` via the `CollectionUi.confirm` capability.

2. **i18n** — new `collectionsView.contributeConfirm` (interpolates `{title}`) in all
   8 locales (en/ja/de/es/fr/ko/ptBR/zh). The confirm CTA reuses the existing
   `collectionsView.contribute` label; cancel uses the host default.

3. **e2e** (`collection-contribute.spec.ts`) — updated for the dialog:
   - click → dialog visible, 0 runs → confirm → exactly 1 run, no detail nav.
   - cancel → 0 runs, no detail nav.
   - keyboard (Enter) → dialog → confirm → exactly 1 run.

4. **Version bump** `@mulmoclaude/collection-plugin` 0.5.12 → 0.5.13.

## Verification

- `yarn workspace @mulmoclaude/collection-plugin build` (vue-tsc), `npx eslint`,
  `yarn typecheck:e2e`, and the 3 Playwright tests all pass.
- Manual: reload the running dev app → Share button shows the confirm dialog;
  cancel does nothing, confirm opens the contribute chat.
