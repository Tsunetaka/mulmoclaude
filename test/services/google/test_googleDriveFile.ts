// Unit tests for the Drive engine's pure helpers: multipart safety
// (boundary collision + mimeType injection) and field mapping. No network.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { assertSafeMimeType, buildMultipartBody, isTextMimeType, pickBoundary, toDriveFileSummary } from "@mulmoclaude/core/google";

describe("assertSafeMimeType", () => {
  for (const mimeType of ["text/plain", "application/json", "text/markdown", "application/vnd.google-apps.document"]) {
    it(`accepts ${mimeType}`, () => {
      assert.equal(assertSafeMimeType(mimeType), mimeType);
    });
  }

  // A crafted value must not be able to forge part headers or parameters.
  const rejected = [
    "text/plain\r\nX-Injected: 1",
    "text/plain\nX-Injected: 1",
    'text/plain; boundary="evil"',
    "text/plain\r\n\r\nsmuggled body",
    "not-a-mime",
    "",
  ];
  for (const mimeType of rejected) {
    it(`rejects ${JSON.stringify(mimeType)}`, () => {
      assert.throws(() => assertSafeMimeType(mimeType), /invalid mimeType/);
    });
  }
});

describe("pickBoundary", () => {
  it("returns a boundary absent from the parts", () => {
    const boundary = pickBoundary(["hello", '{"name":"a.txt"}']);
    assert.match(boundary, /^mulmo-drive-[0-9a-f]{32}$/);
  });

  it("regenerates when the candidate collides with the content", () => {
    const candidates = ["collide", "collide", "safe"];
    let index = 0;
    const boundary = pickBoundary(["body contains collide here"], () => candidates[index++] ?? "fallback");
    assert.equal(boundary, "safe");
    assert.equal(index, 3);
  });

  it("checks every part, not just the first", () => {
    const candidates = ["in-metadata", "safe"];
    let index = 0;
    const boundary = pickBoundary(["plain body", '{"name":"in-metadata.txt"}'], () => candidates[index++] ?? "fallback");
    assert.equal(boundary, "safe");
  });

  it("produces a distinct boundary per call", () => {
    assert.notEqual(pickBoundary(["x"]), pickBoundary(["x"]));
  });
});

describe("buildMultipartBody", () => {
  it("wraps metadata and content with the given boundary and CRLF line endings", () => {
    const body = buildMultipartBody({ name: "a.txt", mimeType: "text/plain" }, "hello", "text/plain", "BOUND");
    assert.ok(body.startsWith("--BOUND\r\n"));
    assert.ok(body.includes('{"name":"a.txt","mimeType":"text/plain"}'));
    assert.ok(body.includes("\r\nhello\r\n"));
    assert.ok(body.endsWith("--BOUND--\r\n"));
  });

  it("keeps content that merely resembles a boundary intact (caller picks a safe one)", () => {
    const body = buildMultipartBody({ name: "a.txt" }, "--BOUND-ish text", "text/plain", "SAFE");
    assert.ok(body.includes("--BOUND-ish text"));
    assert.equal(body.split("--SAFE").length - 1, 3);
  });
});

describe("isTextMimeType", () => {
  for (const mimeType of ["text/plain", "text/markdown", "application/json", "application/xml"]) {
    it(`treats ${mimeType} as text`, () => {
      assert.equal(isTextMimeType(mimeType), true);
    });
  }

  for (const mimeType of ["image/png", "application/pdf", "application/octet-stream", ""]) {
    it(`treats ${JSON.stringify(mimeType)} as non-text`, () => {
      assert.equal(isTextMimeType(mimeType), false);
    });
  }
});

describe("toDriveFileSummary", () => {
  it("maps the documented fields", () => {
    assert.deepEqual(
      toDriveFileSummary({
        id: "f1",
        name: "notes.txt",
        mimeType: "text/plain",
        webViewLink: "https://drive.google.com/file/d/f1/view",
        modifiedTime: "2026-07-17T02:00:00.000Z",
      }),
      { id: "f1", name: "notes.txt", mimeType: "text/plain", webViewLink: "https://drive.google.com/file/d/f1/view", modifiedTime: "2026-07-17T02:00:00.000Z" },
    );
  });

  it("fills empty strings for missing / non-string fields", () => {
    assert.deepEqual(toDriveFileSummary({ id: 42 }), { id: "", name: "", mimeType: "", webViewLink: "", modifiedTime: "" });
  });

  it("tolerates a non-object payload", () => {
    assert.deepEqual(toDriveFileSummary(null), { id: "", name: "", mimeType: "", webViewLink: "", modifiedTime: "" });
  });
});
