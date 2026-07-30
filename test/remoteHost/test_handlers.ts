// Unit tests for the remote-host command handlers.
//   - the registry exposes listCollections
//   - createListCollections maps discover() -> toSummary() into { collections }
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { handlers } from "../../server/remoteHost/handlers/index.js";
import { createListCollections, type ListCollectionsDeps } from "../../server/remoteHost/handlers/listCollections.js";
import { createListAccountingBooks, type ListAccountingBooksDeps } from "../../server/remoteHost/handlers/listAccountingBooks.js";

describe("remote-host handler registry", () => {
  it("exposes every registered handler", () => {
    for (const name of [
      "listCollections",
      "getCollection",
      "listShortcuts",
      "listSkills",
      "listFeeds",
      "getFeed",
      "listAccountingBooks",
      "startChat",
      "google.calendar.createEvent",
      "google.calendar.listEvents",
    ]) {
      assert.equal(typeof handlers[name], "function", `missing handler: ${name}`);
    }
  });
});

describe("createListAccountingBooks", () => {
  it("maps books down to { id, name }, dropping the other BookSummary fields", async () => {
    const listBooks = (async () => ({
      books: [
        { id: "b1", name: "Personal", currency: "USD", createdAt: "2026-01-01T00:00:00Z" },
        { id: "b2", name: "Studio LLC", currency: "JPY", country: "JP" },
      ],
    })) as unknown as ListAccountingBooksDeps["listBooks"];
    const handler = createListAccountingBooks({ listBooks });
    assert.deepEqual(await handler({}), {
      books: [
        { id: "b1", name: "Personal" },
        { id: "b2", name: "Studio LLC" },
      ],
    });
  });

  it("returns an empty list when there are no books", async () => {
    const listBooks = (async () => ({ books: [] })) as unknown as ListAccountingBooksDeps["listBooks"];
    const handler = createListAccountingBooks({ listBooks });
    assert.deepEqual(await handler({}), { books: [] });
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

  it("excludes feeds — feeds are served by listFeeds, not listCollections", async () => {
    const discover = (async () => [
      { slug: "alpha", source: "project" },
      { slug: "news", source: "feed" },
    ]) as unknown as ListCollectionsDeps["discover"];
    const toSummary = ((col: { slug: string; source: string }) => ({ slug: col.slug, source: col.source })) as unknown as ListCollectionsDeps["toSummary"];
    const handler = createListCollections({ discover, toSummary });
    assert.deepEqual(await handler({}), { collections: [{ slug: "alpha", source: "project" }] });
  });

  it("returns an empty list when discovery finds nothing", async () => {
    const discover = (async () => []) as unknown as ListCollectionsDeps["discover"];
    const toSummary = ((col: { slug: string }) => ({ slug: col.slug })) as unknown as ListCollectionsDeps["toSummary"];
    const handler = createListCollections({ discover, toSummary });
    assert.deepEqual(await handler({}), { collections: [] });
  });
});
