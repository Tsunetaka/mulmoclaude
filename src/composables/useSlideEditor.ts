import { ref, watch } from "vue";

// 編集ビュー（SlideEditorView）と上部リボン（SlideEditorRibbon）を橋渡しする共有ストア。
// リボンは App.vue の上部 chrome にあり編集ビューと親子関係を持たないため、
// module シングルトンの reactive 状態＋登録式コールバックで疎結合に仲介する。
//
// 方針（基本ルール）：edit-slide の操作系コントロール（canvas 更新・チャットトグル・
// テーマ選択など）は SlideEditorView のヘッダーではなく上部リボンに集約する。
// 右ゾーン＝アクション（canvas 更新・チャット）、左ゾーン＝編集コントロール（テーマ選択）。
// ここに状態（表示用）とトリガー（アクション）を足していく。

/** 編集ビューがマウントされ deck を表示中か（リボンのコントロール表示可否）。 */
const active = ref(false);
/** canvas 再生成待ちページ数（リボンの「canvas 更新」バッジ用）。 */
const dirtyCount = ref(0);
/** チェックアウト中（ロック中）ページ数（リボンの「チェックイン」ボタン活性/バッジ用）。 */
const lockedCount = ref(0);
/** チャットペインが開いているか（リボンのチャットトグル状態用）。 */
const chatOpen = ref(false);
/**
 * 「頁編集」モード（削除・移動・新規追加）。リボンのトグルで切り替え、
 * 編集ビューがサイドバー各サムネの操作ボタン（↑↓移動・🗑削除）と編集可能
 * セクション末尾の「＋頁追加」の表示可否に使う。表紙／Thank You は固定なので
 * ON でも操作ボタンを出さず錠前を表示する。
 */
const pageEditMode = ref(false);
/**
 * 「テキストボックス編集」モード。リボンのトグルで切り替え、編集ビューがメインビュー
 * 画像上に編集可能テキストボックスのハイライト用オーバーレイを重ねる。表紙／Thank You／
 * 未分類／チェックアウト中の頁ではオーバーレイを出さない。頁編集モードとは排他。
 */
const textboxEditMode = ref(false);

// 頁編集モードとテキストボックス編集モードは同時に ON にしない（サイドバー操作行と
// メインビューのオーバーレイが同時に出る混乱を避ける）。一方が ON になったら他方を OFF。
watch(pageEditMode, (enabled) => {
  if (enabled) textboxEditMode.value = false;
});
watch(textboxEditMode, (enabled) => {
  if (enabled) pageEditMode.value = false;
});
/**
 * 「テーマ未適用」を表すセンチネル値。
 * structure.theme が無い（外部から ReleasedVersion にコピーされた pptx 等・
 * どのテーマにも属さない）デッキは、プルダウンで「（未適用）」を選択状態にする。
 * 実テーマ ID（cool/warm/…）とは決して衝突しない空文字を用いる。
 */
export const UNAPPLIED_THEME = "";
/** 現在のテーマ ID（structure.theme 由来・リボンのテーマプルダウン初期選択用）。未適用は UNAPPLIED_THEME。 */
const theme = ref<string>(UNAPPLIED_THEME);

type Handler = () => void;
type ThemeHandler = (themeId: string) => void;
type TemplateHandler = (templateId: string) => void;
let refreshHandler: Handler | null = null;
let toggleChatHandler: Handler | null = null;
let applyThemeHandler: ThemeHandler | null = null;
let applyTemplateHandler: TemplateHandler | null = null;
let releaseHandler: Handler | null = null;
let pageCheckoutHandler: Handler | null = null;
let pageCheckinHandler: Handler | null = null;

interface SlideEditorHandlers {
  onRefresh: Handler;
  onToggleChat: Handler;
  onApplyTheme: ThemeHandler;
  onApplyTemplate: TemplateHandler;
  onRelease: Handler;
  onPageCheckout: Handler;
  onPageCheckin: Handler;
}

/** 編集ビューがアクション（canvas 更新・チャットトグル・テーマ／テンプレ適用・リリース・頁チェックアウト／チェックイン）を登録する。 */
function register(handlers: SlideEditorHandlers): void {
  refreshHandler = handlers.onRefresh;
  toggleChatHandler = handlers.onToggleChat;
  applyThemeHandler = handlers.onApplyTheme;
  applyTemplateHandler = handlers.onApplyTemplate;
  releaseHandler = handlers.onRelease;
  pageCheckoutHandler = handlers.onPageCheckout;
  pageCheckinHandler = handlers.onPageCheckin;
}

/** 編集ビューのアンマウント時にハンドラと状態を解除する。 */
function unregister(): void {
  refreshHandler = null;
  toggleChatHandler = null;
  applyThemeHandler = null;
  applyTemplateHandler = null;
  releaseHandler = null;
  pageCheckoutHandler = null;
  pageCheckinHandler = null;
  active.value = false;
  dirtyCount.value = 0;
  lockedCount.value = 0;
  chatOpen.value = false;
  pageEditMode.value = false;
  textboxEditMode.value = false;
  theme.value = UNAPPLIED_THEME;
}

export function useSlideEditor() {
  return {
    active,
    dirtyCount,
    lockedCount,
    chatOpen,
    pageEditMode,
    textboxEditMode,
    theme,
    register,
    unregister,
    /** リボンからの canvas 更新トリガー。 */
    triggerRefresh: (): void => refreshHandler?.(),
    /** リボンからのチャット表示トグル。 */
    triggerToggleChat: (): void => toggleChatHandler?.(),
    /** リボンのテーマプルダウンからのテーマ適用トリガー。 */
    triggerApplyTheme: (themeId: string): void => applyThemeHandler?.(themeId),
    /** リボンのテンプレート選択からのテンプレート適用トリガー。 */
    triggerApplyTemplate: (templateId: string): void => applyTemplateHandler?.(templateId),
    /** リボンの「リリース」ボタンからのリリース（combine → ReleasedVersion → Windows push）トリガー。 */
    triggerRelease: (): void => releaseHandler?.(),
    /** リボンの「チェックアウト」ボタンから、頁選択モーダルを開くトリガー。 */
    triggerPageCheckout: (): void => pageCheckoutHandler?.(),
    /** リボンの「チェックイン」ボタンから、チェックイン（戻す/破棄）モーダルを開くトリガー。 */
    triggerPageCheckin: (): void => pageCheckinHandler?.(),
  };
}
