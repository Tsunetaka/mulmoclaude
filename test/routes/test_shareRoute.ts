// Route-boundary guard for server/api/routes/share.ts. Validates the
// path policy pure-functionally (mirrors test_chartRoute) so we don't
// need to spin up an Express app; the pack/zip side is covered by the
// share util tests.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isPackablePath, withScriptCsp } from "../../server/api/routes/share.js";

describe("isPackablePath", () => {
  it("accepts a canonical artifacts/html/*.html path", () => {
    assert.equal(isPackablePath("artifacts/html/2026/07/page.html"), true);
  });

  it("rejects non-string input", () => {
    assert.equal(isPackablePath(undefined), false);
    assert.equal(isPackablePath(null), false);
    assert.equal(isPackablePath(42), false);
    assert.equal(isPackablePath({ path: "artifacts/html/x.html" }), false);
  });

  it("rejects a non-.html file", () => {
    assert.equal(isPackablePath("artifacts/html/2026/07/page.txt"), false);
    assert.equal(isPackablePath("artifacts/html/2026/07/page"), false);
  });

  it("rejects paths outside artifacts/html", () => {
    assert.equal(isPackablePath("artifacts/images/2026/07/foo.png"), false);
    assert.equal(isPackablePath("data/wiki/pages/x.html"), false);
    assert.equal(isPackablePath("page.html"), false);
  });

  it("rejects traversal / non-canonical paths", () => {
    assert.equal(isPackablePath("artifacts/html/../secret.html"), false);
    assert.equal(isPackablePath("artifacts/html/./page.html"), false);
    assert.equal(isPackablePath("artifacts/html/a..b.html"), false);
    assert.equal(isPackablePath("artifacts/html/../../../../etc/passwd"), false);
  });
});

describe("withScriptCsp", () => {
  it("injects a script-blocking CSP so a shared markdown script can't run", () => {
    const out = withScriptCsp("<!DOCTYPE html><html><head><style>x</style></head><body><script>alert(1)</script></body></html>");
    assert.match(out, /<meta http-equiv="Content-Security-Policy"/);
    assert.match(out, /script-src 'none'/);
    // Content is preserved (not stripped) — the CSP neutralizes it at open time.
    assert.match(out, /<style>x<\/style>/);
  });
});
