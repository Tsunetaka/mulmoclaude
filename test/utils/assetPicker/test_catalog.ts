import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { placementHint, formatAssetSelection, type AssetItem } from "../../../src/utils/assetPicker/catalog";

function icon(overrides: Partial<AssetItem> = {}): AssetItem {
  return {
    kind: "icon",
    id: "icon_check",
    label: "完了・承認アイコン（チェックマーク）",
    description: "グリーン系の円形チェックマーク。",
    path: "data/work/icons/compressed/icon_check.png",
    colorTone: "green",
    tags: ["完了", "check"],
    iconType: "utility",
    stepNumber: null,
    slidePosition: null,
    ...overrides,
  };
}

function image(overrides: Partial<AssetItem> = {}): AssetItem {
  return {
    kind: "image",
    id: "slide-settings-bg",
    label: "設定・管理スライド背景（HUDパネル）",
    description: "暗いネイビー背景にオレンジのHUD。",
    path: "data/work/images/compressed/slide-settings-bg.jpg",
    colorTone: "dark-orange",
    tags: ["設定", "HUD"],
    iconType: null,
    stepNumber: null,
    slidePosition: "right_panel",
    ...overrides,
  };
}

describe("assetPicker/catalog", () => {
  describe("placementHint", () => {
    it("suggests the SlideIcon frame for step icons", () => {
      assert.match(placementHint(icon({ iconType: "step", stepNumber: 1 })), /SlideIcon/);
    });
    it("suggests the overview Picture 2 frame for overview / flow icons", () => {
      assert.match(placementHint(icon({ iconType: "overview" })), /Picture 2/);
      assert.match(placementHint(icon({ iconType: "flow" })), /Picture 2/);
    });
    it("gives a generic hint for utility icons", () => {
      assert.match(placementHint(icon({ iconType: "utility" })), /SlideIcon|Picture 2/);
    });
    it("suggests the right panel for right_panel images", () => {
      assert.match(placementHint(image({ slidePosition: "right_panel" })), /右パネル/);
    });
    it("suggests the background for background images", () => {
      assert.match(placementHint(image({ slidePosition: "background" })), /背景/);
    });
  });

  describe("formatAssetSelection", () => {
    it("includes id, kind, label, description, path, and placement hint", () => {
      const out = formatAssetSelection(icon());
      assert.match(out, /id: icon_check/);
      assert.match(out, /種類: アイコン/);
      assert.match(out, /ラベル: 完了・承認アイコン/);
      assert.match(out, /説明: グリーン系/);
      assert.match(out, /圧縮版パス: data\/work\/icons\/compressed\/icon_check\.png/);
      assert.match(out, /推奨配置: /);
    });
    it("labels images as 画像", () => {
      assert.match(formatAssetSelection(image()), /種類: 画像/);
    });
  });
});
