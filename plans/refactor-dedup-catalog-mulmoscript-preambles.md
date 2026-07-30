# refactor: dedup catalog-source + mulmo-script resolve-or-respond preambles

Issue: #2156

## Context

"1 から順に" #3. Two more genuine same-file resolve-or-respond duplications.

## What this fixes

- `server/workspace/skills/external/catalog.ts` — `readExternalCatalogDetail`
  and `starExternalCatalogEntry` shared "`resolveSource` → classify the
  failure (bad-shape id → `invalid-id`, else missing → `not-found`)".
  Extract `resolveSourceOrError`; the error type is a subset of both
  routes' result types.
- `server/api/routes/mulmo-script.ts` — the movie and PDF SSE routes shared
  "validate filePath → ffmpeg guard → resolveStory → absolutePath".
  Extract `resolveStoryRequest(req, res)` returning
  `{ filePath, absoluteFilePath, chatSessionId }` (filePath is still needed
  for the `publishGeneration` calls downstream).

## Verification

- Pure extraction, behaviour preserved. `test_catalog.ts` 19/19 pass;
  `typecheck:server` + lint clean.
