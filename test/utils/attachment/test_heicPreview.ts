// Unit test for the browser-side HEIC preview helper. The
// heic2any WASM path can't run under node:test, so we don't
// exercise the actual conversion here — instead we pin the
// pure `needsBrowserPreviewConversion` predicate that decides
// whether the browser needs to convert at all. That predicate
// is the sole gate between "cheap default" (Chrome renders it)
// and "pay the 1.5 MB WASM bundle" (HEIC / HEIF).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { needsBrowserPreviewConversion } from "../../../src/utils/attachment/heicPreview";

describe("needsBrowserPreviewConversion", () => {
  it("returns true for HEIC / HEIF (still + sequence)", () => {
    assert.equal(needsBrowserPreviewConversion("image/heic"), true);
    assert.equal(needsBrowserPreviewConversion("image/heif"), true);
    // Sequence containers — iOS Live Photos / burst mode. Codex on
    // #2000: without these, a Live Photo silently dropped to the
    // file-icon fallback.
    assert.equal(needsBrowserPreviewConversion("image/heic-sequence"), true);
    assert.equal(needsBrowserPreviewConversion("image/heif-sequence"), true);
  });

  it("returns false for MIMEs Chrome renders natively", () => {
    for (const mime of ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml", "image/avif", "image/bmp"]) {
      assert.equal(needsBrowserPreviewConversion(mime), false, `${mime} is browser-renderable`);
    }
  });

  it("returns false for non-image MIMEs (never reaches the preview img tag)", () => {
    for (const mime of ["application/pdf", "text/plain", "application/json", ""]) {
      assert.equal(needsBrowserPreviewConversion(mime), false, `${mime} — no img rendering path`);
    }
  });

  it("returns false for TIFF (heic2any doesn't decode TIFF; falls back to file-icon chip)", () => {
    // Explicit pin: the helper is HEIC/HEIF-only. TIFF preview
    // support would need a different decoder — out of scope.
    assert.equal(needsBrowserPreviewConversion("image/tiff"), false);
  });
});
