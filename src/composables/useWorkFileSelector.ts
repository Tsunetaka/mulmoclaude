import { ref } from "vue";

// 作業ファイル選択ビュー（WorkFileSelectorView）と上部リボン（SlideEditorRibbon）を
// 橋渡しする共有ストア。ピッカーはリボンと親子関係を持たないため、useSlideEditor と
// 同じく module シングルトンの reactive 状態＋登録式コールバックで疎結合に仲介する。
//
// 方針：作業ファイル選択の操作系（再スキャン）は画面ヘッダーではなく上部リボンに集約する
// （edit-slide chrome の基本ルール）。「再スキャン」ボタンはリボンから scanFiles を叩き、
// 実行中かどうか（scanning）を共有してボタンの disabled／スピナー表示に使う。

/** 再スキャン実行中か（リボンの「再スキャン」ボタンの disabled／スピナー用）。 */
const scanning = ref(false);

type Handler = () => void;
let rescanHandler: Handler | null = null;

export function useWorkFileSelector() {
  return {
    scanning,
    /** ピッカービューが再スキャンアクションを登録する。 */
    register(handlers: { onRescan: Handler }): void {
      rescanHandler = handlers.onRescan;
    },
    /** ピッカービューのアンマウント時にハンドラと状態を解除する。 */
    unregister(): void {
      rescanHandler = null;
      scanning.value = false;
    },
    /** リボンからの再スキャントリガー。 */
    triggerRescan(): void {
      rescanHandler?.();
    },
  };
}
