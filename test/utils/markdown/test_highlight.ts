// Tests for highlight.js-backed code-fence highlighting (#1868).
// Covers the pure `highlightCode` helper and the full `marked`
// pipeline once `markedHighlightExtension` is installed.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { Marked } from "marked";
import { highlightCode, markedHighlightExtension } from "../../../src/utils/markdown/highlight";

describe("highlightCode", () => {
  it("emits hljs token spans for a known language", () => {
    const html = highlightCode("const x = 1;", "ts");
    assert.match(html, /hljs-keyword/);
    assert.match(html, /class="hljs-/);
  });

  it("resolves the `ts` alias to typescript", () => {
    const html = highlightCode("interface A {}", "ts");
    assert.match(html, /hljs-/);
  });

  it("falls back to plaintext for an unknown language without throwing", () => {
    assert.doesNotThrow(() => highlightCode("const x = 1;", "nope-lang"));
    const html = highlightCode("plain text here", "nope-lang");
    assert.doesNotMatch(html, /hljs-keyword/);
  });

  it("does not throw on an empty language tag", () => {
    assert.doesNotThrow(() => highlightCode("just text", ""));
  });

  it("does not throw on illegal syntax for the declared language", () => {
    assert.doesNotThrow(() => highlightCode("<<< not valid json >>>", "json"));
  });

  it("HTML-escapes the rendered code", () => {
    const html = highlightCode("const a = b < c && d > e;", "ts");
    assert.match(html, /&lt;|&gt;|&amp;/);
    assert.doesNotMatch(html, /<c /);
  });
});

describe("markedHighlightExtension in the marked pipeline", () => {
  // Use a scoped `Marked` instance so the extension under test does
  // not leak into other suites sharing the global `marked` singleton.
  let parser: Marked;
  before(() => {
    parser = new Marked();
    parser.use(markedHighlightExtension);
  });

  it("adds `hljs language-ts` to a fenced ts block", () => {
    const html = parser.parse("```ts\nconst x = 1;\n```") as string;
    assert.match(html, /class="hljs language-ts"/);
    assert.match(html, /hljs-keyword/);
  });

  it("tags an empty-language fence with the `hljs` base class", () => {
    const html = parser.parse("```\nplain\n```") as string;
    assert.match(html, /class="hljs"/);
  });

  it("leaves inline code spans untouched", () => {
    const html = parser.parse("use `const` here") as string;
    assert.doesNotMatch(html, /hljs/);
  });
});
