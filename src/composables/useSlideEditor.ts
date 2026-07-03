import { ref } from "vue";

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
/** チャットペインが開いているか（リボンのチャットトグル状態用）。 */
const chatOpen = ref(false);
/** 現在のテーマ ID（structure.theme 由来・リボンのテーマプルダウン初期選択用）。 */
const theme = ref<string>("cool");

type Handler = () => void;
type ThemeHandler = (themeId: string) => void;
let refreshHandler: Handler | null = null;
let toggleChatHandler: Handler | null = null;
let applyThemeHandler: ThemeHandler | null = null;

export function useSlideEditor() {
  return {
    active,
    dirtyCount,
    chatOpen,
    theme,
    /** 編集ビューがアクション（canvas 更新・チャットトグル・テーマ適用）を登録する。 */
    register(handlers: { onRefresh: Handler; onToggleChat: Handler; onApplyTheme: ThemeHandler }): void {
      refreshHandler = handlers.onRefresh;
      toggleChatHandler = handlers.onToggleChat;
      applyThemeHandler = handlers.onApplyTheme;
    },
    /** 編集ビューのアンマウント時にハンドラと状態を解除する。 */
    unregister(): void {
      refreshHandler = null;
      toggleChatHandler = null;
      applyThemeHandler = null;
      active.value = false;
      dirtyCount.value = 0;
      chatOpen.value = false;
      theme.value = "cool";
    },
    /** リボンからの canvas 更新トリガー。 */
    triggerRefresh(): void {
      refreshHandler?.();
    },
    /** リボンからのチャット表示トグル。 */
    triggerToggleChat(): void {
      toggleChatHandler?.();
    },
    /** リボンのテーマプルダウンからのテーマ適用トリガー。 */
    triggerApplyTheme(themeId: string): void {
      applyThemeHandler?.(themeId);
    },
  };
}
