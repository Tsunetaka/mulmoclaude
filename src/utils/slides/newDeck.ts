// Pure helpers for the "＋ 新規作成" (new-deck, N3) flow.
//
// Clicking the button on a WD with no released pptx and no editing
// version subfolder opens an in-view modal (WorkFileSelectorView):
// theme cards + title/subtitle inputs → POST work.newDeck (SSE) which
// runs `new_deck.py` (WSL python-pptx) then `gen_thumbs.py` (WSL
// LibreOffice). The COM canvas is generated afterwards with the
// editor's explicit "更新" button (PowerPoint must be closed).
//
// This replaced the earlier chat-driven flow (startNewChat into the
// slide role) — leaving the work-file selector for a chat round-trip
// was poor UX (2026-07-02 小町谷さん feedback).

// The custom slide role (config/roles/slide.json — loaded at runtime,
// not a BUILTIN_ROLE_IDS entry). Used by the slide-editor chat pane.
export const SLIDE_ROLE_ID = "slide";

/** Cover theme catalog for the new-deck modal. `gradient` mirrors the
 *  TITLE_THEMES colors in `data/work/tools/new_deck.py` (0% / 60% /
 *  100% stops, top-to-bottom) so the cards preview what the generated
 *  cover background will look like. `plain` is a white cover. */
export interface NewDeckTheme {
  id: string;
  label: string;
  tagline: string;
  /** CSS background for the preview swatch. */
  swatch: string;
  /** Text color that stays readable on the swatch. */
  swatchText: string;
}

const grad = (top: string, mid: string, bottom: string): string => `linear-gradient(180deg, #${top} 0%, #${mid} 60%, #${bottom} 100%)`;

export const NEW_DECK_THEMES: NewDeckTheme[] = [
  { id: "cool", label: "❄ 寒色系", tagline: "知的・信頼感・標準", swatch: grad("0D3B7C", "1A6FC4", "0D9488"), swatchText: "#fff" },
  { id: "warm", label: "🔥 暖色系", tagline: "情熱・活力・親しみやすさ", swatch: grad("6B0F1A", "B91C1C", "D97706"), swatchText: "#fff" },
  { id: "vivid", label: "⚡ ビビット", tagline: "革新・インパクト・個性的", swatch: grad("4C0080", "C20049", "FF6D00"), swatchText: "#fff" },
  { id: "dark", label: "🌑 ダーク", tagline: "重厚・高級・モダン", swatch: grad("050A14", "0F1E35", "0D1F1F"), swatchText: "#fff" },
  { id: "plain", label: "📄 プレーン", tagline: "シンプル・軽量・印刷向き", swatch: "#ffffff", swatchText: "#1f2937" },
  { id: "earth", label: "🌿 アース系", tagline: "安定・自然・土木系", swatch: grad("3D1400", "8B4513", "C49A14"), swatchText: "#fff" },
  { id: "neutral", label: "⬜ ニュートラル", tagline: "超汎用・どんな内容にも馴染む", swatch: grad("1A1A1A", "4A4A4A", "8A8A8A"), swatchText: "#fff" },
  { id: "soft", label: "🌸 ソフト", tagline: "親しみやすい・教育・入門向け", swatch: grad("2A4080", "7050A0", "B06080"), swatchText: "#fff" },
  { id: "forest", label: "🌲 フォレスト", tagline: "環境・自然・誠実", swatch: grad("0C280C", "1A5A1A", "0C7850"), swatchText: "#fff" },
  { id: "premium", label: "🏆 プレミアム", tagline: "高級感・提案書・経営層向け", swatch: grad("050D22", "0E1C44", "8A7820"), swatchText: "#fff" },
];
