# Changelog

Newest first. Each entry corresponds to a tagged release. Written in English.

## @mulmoclaude/core@0.8.2 — 2026-07-04

Restores the `computeCollectionIcon` export that was published to the workspace source in PR #1957 (dynamic collection icons) but never reached the npm tarball. The mulmoclaude launcher's tarball smoke was failing with `SyntaxError: does not provide an export named 'computeCollectionIcon'` on every push against `@mulmoclaude/core@0.8.1`.

### From PR #1957 — feat(collections): dynamic collection icons based on data state

- Collection schemas can declare an optional `dynamicIcon` block; launcher shortcut icons then reflect the current state of a source collection's data (weather forecast, todo completion state, etc.).
- Reuses the existing `CollectionWhen` `{field, in}` predicate for `rules`; absent `dynamicIcon` = static `schema.icon` (unchanged).
- New public exports on `@mulmoclaude/core/collection/server`: `computeCollectionIcon`.
- New public exports on `@mulmoclaude/core/collection`: `dynamicIcon.ts` pure resolver + `where.ts` predicate helper.
- `CollectionSummary.iconSources` tells the client which collection channels to watch for reactive icon refresh.

📦 **npm**: [`@mulmoclaude/core@0.8.2`](https://www.npmjs.com/package/@mulmoclaude/core/v/0.8.2)
