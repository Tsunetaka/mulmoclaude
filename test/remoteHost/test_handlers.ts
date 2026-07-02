// Unit tests for the remote-host command handlers.
//   - the registry exposes listCollections
//   - createListCollections maps discover() -> toSummary() into { collections }
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { handlers } from "../../server/remoteHost/handlers/index.js";
import { createListCollections, type ListCollectionsDeps } from "../../server/remoteHost/handlers/listCollections.js";

describe("remote-host handler registry", () => {
  it("exposes every registered handler", () => {
    for (const name of ["listCollections", "getCollection", "listShortcuts", "listFeeds", "getFeed", "startChat"]) {
      assert.equal(typeof handlers[name], "function", `missing handler: ${name}`);
    }
  });
});

describe("createListCollections", () => {
  it("maps discovered collections through toSummary into { collections }", async () => {
    // Stub discovery + summary so the test asserts the wiring, not the engine.
    const discover = (async () => [{ slug: "alpha" }, { slug: "beta" }]) as unknown as ListCollectionsDeps["discover"];
    const toSummary = ((col: { slug: string }) => ({
      slug: col.slug,
      title: col.slug.toUpperCase(),
      icon: "folder",
      source: "preset",
    })) as unknown as ListCollectionsDeps["toSummary"];

    const handler = createListCollections({ discover, toSummary });
    const result = await handler({});

    assert.deepEqual(result, {
      collections: [
        { slug: "alpha", title: "ALPHA", icon: "folder", source: "preset" },
        { slug: "beta", title: "BETA", icon: "folder", source: "preset" },
      ],
    });
  });

  it("returns an empty list when discovery finds nothing", async () => {
    const discover = (async () => []) as unknown as ListCollectionsDeps["discover"];
    const toSummary = ((col: { slug: string }) => ({ slug: col.slug })) as unknown as ListCollectionsDeps["toSummary"];
    const handler = createListCollections({ discover, toSummary });
    assert.deepEqual(await handler({}), { collections: [] });
  });
});
