import hljs from "highlight.js/lib/common";
import { markedHighlight } from "marked-highlight";

const FALLBACK_LANGUAGE = "plaintext";

// highlight.js token classes (`hljs-keyword`, `hljs-string`, …) are
// language-agnostic, so the single theme CSS imported in `setup.ts`
// colours every registered language. An unknown or empty fence tag
// falls back to plaintext so an author's typo renders as escaped text
// instead of throwing mid-parse.
export function highlightCode(code: string, lang: string): string {
  const language = lang && hljs.getLanguage(lang) ? lang : FALLBACK_LANGUAGE;
  return hljs.highlight(code, { language, ignoreIllegals: true }).value;
}

// `langPrefix: "hljs language-"` keeps the conventional `language-ts`
// class while also adding the `hljs` base class the theme CSS targets.
export const markedHighlightExtension = markedHighlight({
  emptyLangClass: "hljs",
  langPrefix: "hljs language-",
  highlight: (code, lang) => highlightCode(code, lang),
});
