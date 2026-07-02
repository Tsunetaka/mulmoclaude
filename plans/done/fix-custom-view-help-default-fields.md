# fix: teach `custom-view.md` to project `?fields=` by default

Tracks: #1833 (Fix A — docs/scaffold).

## Problem (from #1833)

A user collection grows past the unselective 200-record limit; an existing
custom view that fetches `dataUrl` raw stops loading. The view's
`if (!res.ok) throw new Error("HTTP " + res.status)` surfaces only `HTTP 400`,
which is unhelpful — the server's actual refusal message ("pass `fields` to
project only the columns you need") is in the body but never read.

The `custom-view.md` help (the canonical scaffold doc Claude follows) already
documents the rule, but the canonical `fetch` example on line 73-75 omits
`?fields=`. New views copy the example and get the trap by default; the
warning bullet underneath does not change that.

## Fix (Fix A from #1833)

Three edits in `packages/core/assets/helps/custom-view.md`:

1. **Lead the "Reading records" section with the projection rule** (blockquote
   before the example) so it is impossible to miss.
2. **Canonical fetch example uses `?fields=`** with `encodeURIComponent` for
   safety, and the error handler reads `await res.text()` so a future 400
   surfaces the server's message, not just the status.
3. **Both worked examples (year overview + weekly planner) carry the same
   pattern.** The "Staying live" re-fetch helper too.

Bump `@mulmoclaude/core` to 0.2.3 — `packages/core/assets/` ships with the
package and is consumed by both MulmoClaude and MulmoTerminal.

## Out of scope (Fix B from #1833)

Runtime "ask for help" affordance on the toast / a `window.__MC_VIEW.askHostForHelp(error)`
API — bigger surface change, separate PR.

## Tests

Help text is consumed by humans / LLMs at scaffolding time. No automated test.
Doc shape verified by re-reading the updated file end-to-end.
