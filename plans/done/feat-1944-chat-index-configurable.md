# feat(#1944): chat-index configurable + always-on origin filter

## Summary

Two behaviour changes to the background chat-index summarizer:

- **Origin filter (always on)** — `indexSession` now skips sessions whose `meta.origin` is `system` (hidden worker; title never surfaces in any UI) or `scheduler` (automation; the `firstUserMessage` fallback already identifies them). Applied under every trigger — turn-finish hook, backfill, manual rebuild, forced startup — and unaffected by the `force` flag. Zero Claude CLI spend on ~30 % of the sessions on a busy workspace.
- **Configurable model + kill switch** — new `AppSettings.chatIndex` field with three values: `"off"` (default), `"haiku"`, `"sonnet"`. Ships **off** — a fresh workspace pays nothing for indexing until the user opts in from Settings → Chat index. `haiku` and `sonnet` pick the model the summarizer spawns; `off` short-circuits `maybeIndexSession` and `backfillAllSessions` before they take the per-session lock / walk the chat dir.

Related: #1929 (unchanged-session skip — the mtime gate stays), #1930 (same).

## Items to Confirm / Review

- **Default is `off`.** Existing users who currently have AI titles + summaries running lose that behaviour until they flip the switch. This is the user's explicit ask ("defaultで、このindex作成をoffに"), but let me know if a one-shot migration prompt is wanted.
- **Origin filter re-runs every backfill tick** (no persistent skip marker). Cost analysis: ~1–2 ms meta read × 166 automation sessions × 4 backfills/day = ~1.3 s/day of I/O with zero Claude CLI spend. A skip marker in the manifest was considered but rejected as over-engineering — the check is cheap and the manifest stays clean of empty entries.
- **Manual rebuild + `CHAT_INDEX_FORCE_RUN_ON_STARTUP=1`** also honour `chatIndex: "off"` — they resolve mode via the same `chatIndexMode(loadSettings())` path. If the intent is "override the switch when the user explicitly asked to rebuild", say so and we can add a `bypassOff` opt-in.
- **Setting shape uses the same null-sentinel wire pattern** as `effortLevel` (`chatIndex?: ChatIndexMode | null` in the patch, dropped to `undefined` on the storage side). The `SettingsChatIndexTab` sends `null` when the user picks `"off"` so `settings.json` stays free of default values.
- **i18n across 8 locales in lockstep** (en / ja / de / es / fr / ko / pt-BR / zh) — please review the non-EN copies for tone.

## User Prompt

> chat-index scheduler re-summarises every session every hour ... system / scheduler origins are summarized even though the title never displays. → 一旦 sonet に戻す？→ 設定化する。default で、この index 作成を off にしつつ、設定で on/off と、haiku/sonnet 切り替えできるようにしよう。off/haiku/sonnet がよいかな。origin filter もいれよう。これは常に有効。

## Implementation

### Server

- `server/system/config.ts`:
  - New `CHAT_INDEX_MODES = ["off", "haiku", "sonnet"] as const` + `ChatIndexMode` type.
  - `AppSettings.chatIndex?: ChatIndexMode` field with docs pointing at Settings → Chat index.
  - `chatIndexMode(settings)` helper — resolves undefined → `"off"` in one place so every reader agrees.
  - `AppSettingsPatch` extended with `chatIndex?: ChatIndexMode | null` (null sentinel matches `effortLevel`).
  - `normaliseAppSettingsPatch` drops the null sentinel.
  - `isAppSettings` / `isAppSettingsPatch` validators updated. Complexity-relief: extracted `isOptionalString` / `isOptionalNullableEffortLevel` / `isOptionalNullableChatIndexMode` mini-validators so `isAppSettingsPatch` stays under the cognitive-complexity ceiling.
  - `cloneAppSettings` copies the new field.

- `server/workspace/chat-index/summarizer.ts`:
  - `SummarizeFn` signature widened to accept an optional `{ model?: SummaryModel }` second arg.
  - `defaultSummarize` reads `opts.model`, falls back to `DEFAULT_SUMMARY_MODEL` (`"sonnet"`).
  - `spawnClaudeSummarize` takes the model as a parameter; the hard-coded `SUMMARY_MODEL` constant is gone.

- `server/workspace/chat-index/indexer.ts`:
  - `IndexerDeps.mode?: "off" | "haiku" | "sonnet"`.
  - `NON_INDEXED_ORIGINS = new Set(["system", "scheduler"])`.
  - `readSessionMeta` now also returns `origin`.
  - `indexSession`: bails at the top when `mode === "off"`. Reads `meta` before the freshness / jsonl-changed / origin gates so the origin filter can short-circuit the (much heavier) jsonl load + summarizer spawn. Passes `model: mode` to `summarize`. Complexity-relief: gates extracted into `shouldSkipBeforeSummarize` helper.

- `server/workspace/chat-index/index.ts`:
  - `maybeIndexSession` and `backfillAllSessions` resolve mode from `AppSettings.chatIndex` (via `chatIndexMode(loadSettings())`) unless the caller injected one. `"off"` short-circuits BOTH before taking the per-session lock / walking the chat dir.

### Client

- `src/components/SettingsChatIndexTab.vue` — new tab mirroring the `SettingsModelTab` shape (select → auto-save via PUT to `API_ROUTES.config.base`). Sends `null` on `"off"` so `settings.json` stays default-clean.
- `src/components/SettingsModal.vue` — new `chatIndex` `TabId`, added to the `llm` group (between `voice` and `tools`), reload token bumped on modal open, tab rendered via `<SettingsChatIndexTab>`.
- 8 locales (en / ja / de / es / fr / ko / pt-BR / zh) — tab label + full `chatIndexTab` block (description, mode label, helper, per-mode name, per-mode status, load/save errors).

### Tests

- `test/chat-index/test_indexer.ts` — existing 30 tests updated to pass `mode: "haiku"` (or `"sonnet"`) so the new default-off gate doesn't skip them. New 6-test suite `indexSession — chat-index mode + origin filter (#1944)`:
  - `mode: "off"` returns null and NEVER calls the summarizer.
  - `origin: "system"` skips even under `mode: "sonnet"` + `force: true`.
  - `origin: "scheduler"` — same.
  - `mode: "haiku"` passes `{ model: "haiku" }` down to the summarizer.
  - `mode: "sonnet"` passes `{ model: "sonnet" }` down.
  - `origin: "human"` indexes normally.

## Test plan

- [x] `yarn tsx --test test/chat-index/test_indexer.ts` — 36 pass (30 existing + 6 new).
- [x] `yarn tsx --test test/server/test_config.ts test/routes/test_configRoute.ts` — 60 pass.
- [x] `yarn format` / `yarn lint` (0 errors, 26 pre-existing warnings) / `yarn typecheck` / `yarn build`.
- Manual: open Settings → Chat index, flip through off / haiku / sonnet, confirm the auto-save banner turns green and `settings.json` updates. Trigger a chat turn under each mode; confirm the summarizer either skips or spawns with the chosen model (via `[chat-index] indexed` log entries).

## Out of scope

- **Persistent skip marker** for automation-origin sessions. Analysed and rejected — the meta read is cheap and the marker would pollute the manifest with empty entries.
- **Force-rebuild bypassing `off`** — separate opt-in if we later need "override the switch when the user explicitly rebuilt". Current behaviour treats `off` as authoritative for every trigger, which matches the user's ask.
