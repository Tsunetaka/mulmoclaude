import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SLIDE_ROLE_ID, NEW_DECK_THEMES } from "../../../src/utils/slides/newDeck.js";

// ── SLIDE_ROLE_ID ─────────────────────────────────────────────────────────────

describe("SLIDE_ROLE_ID", () => {
  it("names the custom slide role (config/roles/slide.json)", () => {
    assert.equal(SLIDE_ROLE_ID, "slide");
  });
});

// ── NEW_DECK_THEMES ───────────────────────────────────────────────────────────

describe("NEW_DECK_THEMES", () => {
  it("has exactly the 10 theme ids new_deck.py accepts, in catalog order", () => {
    const ids = NEW_DECK_THEMES.map((theme) => theme.id);
    assert.deepEqual(ids, ["cool", "warm", "vivid", "dark", "plain", "earth", "neutral", "soft", "forest", "premium"]);
  });

  it("ids are unique", () => {
    const ids = NEW_DECK_THEMES.map((theme) => theme.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("every theme has a label, tagline and swatch", () => {
    for (const theme of NEW_DECK_THEMES) {
      assert.ok(theme.label.length > 0, `${theme.id}: label`);
      assert.ok(theme.tagline.length > 0, `${theme.id}: tagline`);
      assert.ok(theme.swatch.length > 0, `${theme.id}: swatch`);
      assert.ok(theme.swatchText.length > 0, `${theme.id}: swatchText`);
    }
  });

  it("gradient themes use a 3-stop top-to-bottom gradient; plain is white", () => {
    for (const theme of NEW_DECK_THEMES) {
      if (theme.id === "plain") {
        assert.equal(theme.swatch, "#ffffff");
      } else {
        assert.match(theme.swatch, /^linear-gradient\(180deg, #[0-9A-F]{6} 0%, #[0-9A-F]{6} 60%, #[0-9A-F]{6} 100%\)$/);
      }
    }
  });
});
