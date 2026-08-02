// Shared types + selection formatter for the slide asset picker.
// Used by both the generic chat card (src/plugins/presentAssetPicker/View.vue)
// and the MulmoPoint modal (SlideEditorView.vue) so the string sent back to the
// agent is identical wherever the picker is invoked.

/** One asset row as returned by GET /api/work/asset-catalog. */
export interface AssetItem {
  /** kind of asset — drives placement hints and section grouping. */
  kind: "icon" | "image";
  /** stable id (e.g. "icon_check"), matches index.json. */
  id: string;
  /** human label (JP). */
  label: string;
  /** long description (JP). */
  description: string;
  /** workspace-relative path to the compressed file to insert. */
  path: string;
  /** color tone tag (e.g. "green", "blue", "white"). */
  colorTone: string;
  /** free-text tags for filtering. */
  tags: string[];
  /** icons only: "utility" | "step" | "overview" | "flow" | "mascot" | null. */
  iconType?: string | null;
  /** icons only: 1..8 for step icons, else null. */
  stepNumber?: number | null;
  /** images only: "right_panel" | "background" | null. */
  slidePosition?: string | null;
}

/** Full catalog payload from the server. */
export interface AssetCatalog {
  icons: AssetItem[];
  images: AssetItem[];
}

/** Placement hint appended to the selection so the agent knows where such an
 *  asset usually goes. The user still specifies exact coordinates / size. */
export function placementHint(asset: AssetItem): string {
  if (asset.kind === "icon") {
    if (asset.iconType === "step") return "Step 頁の右肩 SlideIcon 枠（本文ページのアイコン定位置）";
    if (asset.iconType === "overview" || asset.iconType === "flow") return "概要頁の右アイコン枠 Picture 2（L5.63 T1.07 W5.12 H6.30）";
    return "右肩 SlideIcon 枠 / 概要頁の Picture 2 枠 など（用途に合わせて）";
  }
  if (asset.slidePosition === "right_panel") return "右パネル画像枠（例 14.3cm, 2.75cm, 13cm×16cm）";
  if (asset.slidePosition === "background") return "スライド背景（全面）";
  return "右パネル or 背景（用途に合わせて）";
}

/** Build the markdown bullet block sent back to the agent when the user picks
 *  an asset. Includes id, kind, label, description, compressed path, and a
 *  placement hint (matches the agreed return-info set). */
export function formatAssetSelection(asset: AssetItem): string {
  const kindLabel = asset.kind === "icon" ? "アイコン" : "画像";
  const lines = [
    "【アセットピッカーで選択】",
    `- id: ${asset.id}`,
    `- 種類: ${kindLabel}`,
    `- ラベル: ${asset.label}`,
    `- 説明: ${asset.description}`,
    `- 圧縮版パス: ${asset.path}`,
    `- 推奨配置: ${placementHint(asset)}`,
    "このアセットを現在のページに配置してください（座標・サイズは指示します）。",
  ];
  return lines.join("\n");
}
