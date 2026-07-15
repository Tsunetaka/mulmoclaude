import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { readCspExtraSync } from "../../../server/utils/files/csp-io.js";
import { WORKSPACE_DIRS } from "../../../server/workspace/paths.js";

let root: string;

before(() => {
  root = mkdtempSync(path.join(tmpdir(), "csp-io-test-"));
  mkdirSync(path.join(root, WORKSPACE_DIRS.configs), { recursive: true });
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

const writeCsp = (content: string) => writeFileSync(path.join(root, "config", "csp.json"), content);

describe("readCspExtraSync", () => {
  it("returns {} when the file is absent", () => {
    const fresh = mkdtempSync(path.join(tmpdir(), "csp-io-none-"));
    assert.deepEqual(readCspExtraSync(fresh), {});
    rmSync(fresh, { recursive: true, force: true });
  });

  it("reads and sanitizes valid per-directive hosts", () => {
    writeCsp(JSON.stringify({ "frame-src": ["https://www.google.com"], "script-src": ["https://maps.googleapis.com", "http://evil"] }));
    assert.deepEqual(readCspExtraSync(root), {
      "frame-src": ["https://www.google.com"],
      "script-src": ["https://maps.googleapis.com"],
    });
  });

  it("returns {} for malformed JSON (never throws)", () => {
    writeCsp("{ not json");
    assert.deepEqual(readCspExtraSync(root), {});
  });

  it("drops unknown directives and non-array values", () => {
    writeCsp(JSON.stringify({ "default-src": ["https://x.com"], "img-src": "https://x.com" }));
    assert.deepEqual(readCspExtraSync(root), {});
  });
});
