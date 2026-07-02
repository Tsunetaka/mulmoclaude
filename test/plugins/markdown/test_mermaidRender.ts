// Plugin-side regression coverage for the `adoptSvg` HTML5-mode fix
// (issue #1916 CodeRabbit follow-up). The plugin package's
// `mermaidRender.ts` is a hand-synced copy of the host module — this
// test guards the plugin copy independently so a future edit that
// only lands on one side is caught.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { adoptSvg } from "../../../packages/plugins/markdown-plugin/src/utils/markdown/mermaidRender";

let dom: JSDOM;

const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">
  <g class="subgraph">
    <foreignObject width="80" height="20">
      <div xmlns="http://www.w3.org/1999/xhtml">line 1<br>line 2</div>
    </foreignObject>
  </g>
</svg>`;

before(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>");
  const win = dom.window as unknown as { document: Document; DOMParser: typeof DOMParser };
  (globalThis as unknown as { document: Document }).document = win.document;
  (globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = win.DOMParser;
});

describe("markdown-plugin adoptSvg (HTML5 mode)", () => {
  it("returns the svg root for a mermaid-shaped output", () => {
    const svgEl = adoptSvg(SAMPLE_SVG);
    assert.ok(svgEl);
    assert.equal(svgEl.tagName.toLowerCase(), "svg");
  });

  it("preserves the foreignObject subtree with its br tag", () => {
    const svgEl = adoptSvg(SAMPLE_SVG);
    assert.ok(svgEl);
    const foreign = svgEl.querySelector("foreignObject");
    assert.ok(foreign);
    assert.ok(foreign.querySelector("br"));
  });

  it("returns null for input without an svg root", () => {
    const svgEl = adoptSvg("<p>not an svg</p>");
    assert.equal(svgEl, null);
  });
});
