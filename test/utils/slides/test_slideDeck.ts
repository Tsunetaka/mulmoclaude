import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseVersionDirs,
  buildDeck,
  type SlideStructure,
  type SlideManifest,
  type DirEntry,
  type DeckModel,
  type DeckPage,
} from "../../../src/utils/slides/slideDeck.js";

/** Find a page by id, asserting it exists (narrows away undefined). */
function pageById(model: DeckModel, pageId: string): DeckPage {
  const found = model.pages.find((page) => page.id === pageId);
  assert.ok(found, `page ${pageId} should exist`);
  return found;
}

// ── parseVersionDirs ──────────────────────────────────────────────────────────

describe("parseVersionDirs", () => {
  const entries: DirEntry[] = [
    { name: "v001", type: "dir" },
    { name: "v003", type: "dir" },
    { name: "v002", type: "dir" },
    { name: "ReleasedVersion", type: "dir" },
    { name: ".checkout-source", type: "file" },
    { name: "notes.txt", type: "file" },
  ];

  it("keeps only version dirs, newest first", () => {
    assert.deepEqual(parseVersionDirs(entries), ["v003", "v002", "v001"]);
  });

  it("excludes ReleasedVersion and files", () => {
    assert.ok(!parseVersionDirs(entries).includes("ReleasedVersion"));
  });

  it("orders branch versions after their base (more specific = newer)", () => {
    const branchy: DirEntry[] = [
      { name: "v002", type: "dir" },
      { name: "v002-001", type: "dir" },
      { name: "v001", type: "dir" },
    ];
    assert.deepEqual(parseVersionDirs(branchy), ["v002-001", "v002", "v001"]);
  });

  it("returns empty when no version dirs", () => {
    assert.deepEqual(parseVersionDirs([{ name: "ReleasedVersion", type: "dir" }]), []);
  });
});

// ── buildDeck ─────────────────────────────────────────────────────────────────

function makeStructure(): SlideStructure {
  return {
    schema_version: 1,
    wd: "GIT-00003",
    version: "v001",
    sections: [
      { name: "タイトル", page_ids: ["p-aaa"] },
      { name: "本文", page_ids: ["p-bbb", "p-ccc"] },
    ],
    pages: {
      "p-aaa": { file: "p-aaa.pptx", checked_out: false, checkout_by: null, checkout_at: null },
      "p-bbb": { file: "p-bbb.pptx", checked_out: true, checkout_by: "tsune", checkout_at: "2026-07-01T00:00:00+09:00" },
      "p-ccc": { file: "p-ccc.pptx", checked_out: false, checkout_by: null, checkout_at: null },
    },
  };
}

function makeManifest(): SlideManifest {
  return {
    schema_version: 1,
    version: "v001",
    generated_at: "2026-07-01T19:44:22+09:00",
    pages: {
      "p-aaa": {
        page_no: 1,
        section: "タイトル",
        title: "表紙",
        thumb: "p-aaa_md.png",
        thumb_sm: null,
        canvas: "p-aaa.png",
        content_hash: "h1",
        dirty: false,
        frozen: false,
      },
      "p-bbb": {
        page_no: 2,
        section: "本文",
        title: "手順1",
        thumb: "p-bbb_md.png",
        thumb_sm: null,
        canvas: "p-bbb.png",
        content_hash: "h2",
        dirty: true,
        frozen: true,
      },
      "p-ccc": {
        page_no: 3,
        section: "本文",
        title: "手順2",
        thumb: "p-ccc_md.png",
        thumb_sm: null,
        canvas: "p-ccc.png",
        content_hash: "h3",
        dirty: false,
        frozen: false,
      },
    },
  };
}

describe("buildDeck — merge", () => {
  it("orders pages by structure sections and numbers them 1..N", () => {
    const deck = buildDeck(makeStructure(), makeManifest());
    assert.equal(deck.totalPages, 3);
    assert.deepEqual(
      deck.pages.map((page) => [page.id, page.pageNo]),
      [
        ["p-aaa", 1],
        ["p-bbb", 2],
        ["p-ccc", 3],
      ],
    );
    assert.deepEqual(
      deck.sections.map((sec) => [sec.name, sec.pages.length]),
      [
        ["タイトル", 1],
        ["本文", 2],
      ],
    );
  });

  it("pulls title / thumb / canvas / dirty / frozen from manifest", () => {
    const deck = buildDeck(makeStructure(), makeManifest());
    const page = pageById(deck, "p-bbb");
    assert.equal(page.title, "手順1");
    assert.equal(page.thumb, "p-bbb_md.png");
    assert.equal(page.canvas, "p-bbb.png");
    assert.equal(page.dirty, true);
    assert.equal(page.frozen, true);
  });

  it("pulls lock state from structure (not manifest)", () => {
    const deck = buildDeck(makeStructure(), makeManifest());
    const locked = pageById(deck, "p-bbb");
    assert.equal(locked.checkedOut, true);
    assert.equal(locked.checkoutBy, "tsune");
    assert.equal(pageById(deck, "p-aaa").checkedOut, false);
  });

  it("survives a missing manifest (null → empty fields, no throw)", () => {
    const deck = buildDeck(makeStructure(), null);
    assert.equal(deck.totalPages, 3);
    assert.equal(deck.pages[0].title, "");
    assert.equal(deck.pages[0].thumb, null);
    assert.equal(deck.pages[0].canvas, null);
    // lock still comes from structure
    assert.equal(deck.pages[1].checkedOut, true);
  });

  it("appends orphan pages (not in any section) into a trailing 未分類 section", () => {
    const struct = makeStructure();
    struct.pages["p-zzz"] = { file: "p-zzz.pptx", checked_out: false, checkout_by: null, checkout_at: null };
    const deck = buildDeck(struct, makeManifest());
    assert.equal(deck.totalPages, 4);
    const last = deck.sections.at(-1);
    assert.ok(last, "trailing section should exist");
    assert.equal(last.name, "未分類");
    assert.deepEqual(
      last.pages.map((page) => page.id),
      ["p-zzz"],
    );
  });
});
