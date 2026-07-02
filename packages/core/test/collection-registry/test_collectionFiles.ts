import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { collectionFileUrl, parseJsonObject } from "../../src/collection/registry/server/collectionFiles.ts";

const OFFICIAL_RAW = "https://raw.githubusercontent.com/receptron/mulmoclaude-collections/main";

describe("collectionFileUrl", () => {
  it("composes the URL under the supplied rawBase", () => {
    assert.equal(
      collectionFileUrl(OFFICIAL_RAW, "collections/isamu/movies", "schema.json"),
      "https://raw.githubusercontent.com/receptron/mulmoclaude-collections/main/collections/isamu/movies/schema.json",
    );
  });

  it("trims leading/trailing slashes in the dir path", () => {
    assert.equal(collectionFileUrl(OFFICIAL_RAW, "/collections/a/b/", "meta.json"), `${OFFICIAL_RAW}/collections/a/b/meta.json`);
  });

  it("accepts a user-configured rawBase (multi-registry support)", () => {
    assert.equal(collectionFileUrl("https://example.test/reg", "collections/a/b", "schema.json"), "https://example.test/reg/collections/a/b/schema.json");
  });

  it("rejects traversal segments inside the dir path", () => {
    // `..` segments would otherwise let the URL escape the rawBase, so they're
    // dropped even though the index parser already rejects such identifiers
    // (defense-in-depth).
    assert.equal(collectionFileUrl(OFFICIAL_RAW, "collections/../escape", "x.json"), `${OFFICIAL_RAW}/collections/escape/x.json`);
  });
});

describe("parseJsonObject", () => {
  it("accepts a JSON object", () => {
    const result = parseJsonObject('{"a":1}', "x");
    assert.ok(result.ok);
    assert.deepEqual(result.value, { a: 1 });
  });

  it("rejects invalid JSON", () => {
    const result = parseJsonObject("{not json", "x");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /not valid JSON/);
  });

  it("rejects non-object JSON (array, number, null)", () => {
    for (const text of ["[]", "42", "null", '"str"']) {
      const result = parseJsonObject(text, "x");
      assert.equal(result.ok, false, text);
    }
  });
});
