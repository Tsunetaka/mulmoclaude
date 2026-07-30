# refactor: dedup skill-writer + wiki-history validate-or-respond preambles

Issue: #2150

## Context

"1 から順に" #2 (server-side small wins) after #2141 / #2145 / #2148. Two
genuine same-file validate-or-respond duplications.

## What this fixes

- `server/workspace/skills/writer.ts` — `saveProjectSkill` and
  `updateProjectSkill` shared the slug + required-field validation
  (returns `invalid-slug` / `missing-field`). Extract
  `validateSkillInput(input): SkillInputProblem | null`; the problem type
  is a subset of both `SaveResult` and `UpdateResult`.
- `server/api/routes/wiki/history.ts` — the read and restore routes
  shared "validate slug/stamp → readSnapshot → 400/404". Extract
  `resolveSnapshotOr4xx(req, res): Promise<SnapshotContent | null>`.

## Deliberately NOT done

- `core/draft.ts` `emptyRow` / `rowFromItem` share four empty-object
  declarations — trivial initialisation, not knowledge duplication.
  Extracting would be over-abstraction.

## Verification

- Pure extraction, behaviour preserved. Existing tests cover both:
  `test_writer.ts`, `test_updateSkill.ts`, `test_wikiHistoryRoute.ts`
  (28/28 pass).
- `typecheck:server` + lint clean.
