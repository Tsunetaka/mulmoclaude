// Duplicate of the host's `src/utils/markdown/mermaidExtension.ts` —
// the plugin ships its own bundled `marked` (see package.json), so it
// cannot reach across to the host module without pulling the whole
// host into the plugin bundle. Kept in sync manually; if the shape
// changes on one side, update the other.

import type { MarkedExtension, Tokens } from "marked";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export const mermaidExtension: MarkedExtension = {
  renderer: {
    code(token: Tokens.Code): string | false {
      const lang = (token.lang ?? "").trim();
      if (lang !== "mermaid") return false;
      // Honour `token.escaped` so this extension composes cleanly
      // with `markedHighlight`-style walkTokens hooks — see the host
      // copy for the full rationale.
      const html = token.escaped === true ? token.text : escapeHtml(token.text);
      return `<pre class="mermaid" data-mermaid-pending="1">${html}</pre>\n`;
    },
  },
};
