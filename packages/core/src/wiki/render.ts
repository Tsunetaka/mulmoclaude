// Pure `[[wiki-link]]` → HTML renderer, shared across hosts via
// `@mulmoclaude/core/wiki`. Extracted from the MulmoClaude host's
// `src/plugins/wiki/helpers.ts` so MulmoTerminal can render the same
// internal-link markup without forking the walker.
//
// String-only, no `marked` / DOM / Node deps — the host pipeline
// (image-ref rewrite, marked.parse, task-interactive) wraps this.

import { parseWikiLink } from "./link.js";

/** HTML-escape attribute / text content. Self-contained on purpose:
 *  this package can't reach the host's escaper, and the rule is a
 *  fixed five-char map. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/**
 * Replace every `[[page name]]` occurrence in `content` with a
 * `<span class="wiki-link" data-page="…">…</span>` element. The
 * page name may not contain `]`; an opening `[[` that is not
 * followed later by `]]` (with no bare `]` in between) is left
 * untouched so malformed text renders as-is — matching the
 * previous regex's non-match behaviour.
 *
 * `[[target|display]]` is split via the shared `parseWikiLink`
 * helper so `data-page` carries only the target slug while the
 * visible text shows the display half (#1297). Both halves are
 * HTML-escaped before interpolation — `parseWikiLink` runs BEFORE
 * the host's `marked.parse`, so escaping has to happen here.
 */
export function renderWikiLinks(content: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < content.length) {
    if (content[i] === "[" && content[i + 1] === "[") {
      const closeStart = findNextCloseBrackets(content, i + 2);
      if (closeStart !== -1) {
        const inner = content.slice(i + 2, closeStart);
        const { target, display } = parseWikiLink(inner);
        out.push(`<span class="wiki-link" data-page="${escapeHtml(target)}">${escapeHtml(display)}</span>`);
        i = closeStart + 2;
        continue;
      }
    }
    out.push(content[i]);
    i++;
  }
  return out.join("");
}

/**
 * Starting at `from`, scan forward for a `]]` sequence. Returns
 * the index of the first `]` of that pair, or -1 if a bare `]`
 * (one not immediately followed by a second `]`) is encountered
 * first — mirroring the old regex's `[^\]]+` constraint that the
 * page name must contain no `]` characters. Also returns -1 if
 * nothing matched before the end of input, or if the pair sits
 * immediately after `from` (zero-length page name, which the old
 * regex rejected via the `+` quantifier).
 */
function findNextCloseBrackets(str: string, from: number): number {
  let j = from;
  while (j < str.length) {
    if (str[j] === "]") {
      if (str[j + 1] === "]" && j > from) return j;
      // Bare `]` inside the page-name span — old regex would not
      // match here, so we bail and let the caller emit the `[[`
      // as literal text.
      return -1;
    }
    j++;
  }
  return -1;
}
