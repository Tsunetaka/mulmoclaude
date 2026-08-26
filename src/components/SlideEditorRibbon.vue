<template>
  <!-- Slide editor ribbon — replaces the global PluginLauncher across the
       slide-editor chrome (document picker `workFiles` + editor `slides`).
       Left zone is reserved for future editing controls. Right zone renders
       a data-driven list of icon buttons (see `RIBBON_BUTTONS` below): to add
       a button, append one entry — no template edits, and it appears on every
       page it lists in `pages`. -->
  <div class="flex items-center gap-2 w-full min-w-0" data-testid="slide-editor-ribbon">
    <!-- ── 編集コントロール（左ゾーン）── テーマ選択（Phase2）
         配色（表紙グラデ＋概要/本文の帯色）を全ページに再適用する。チャット非経由で
         直接変更（要望）。選択即実行＝SlideEditorView がモーダルで進捗表示する。 -->
    <div class="flex items-center gap-2 flex-1 min-w-0">
      <template v-if="showSlideControls">
        <span class="material-icons text-base text-[#6a8aaa]">palette</span>
        <select
          class="ribbon-theme-select"
          data-testid="ribbon-theme-select"
          :value="theme"
          :aria-label="t('slides.theme')"
          :title="t('slides.theme')"
          @change="onThemeChange"
        >
          <!-- 「（未適用）」— theme 欄の無いデッキの初期状態。テーマ適用済み
               （theme が実 ID）のときは選べないよう disabled にする。 -->
          <option :value="UNAPPLIED_THEME" :disabled="theme !== UNAPPLIED_THEME">{{ t("slides.themeUnapplied") }}</option>
          <option v-for="opt in themes" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
        </select>

        <!-- テンプレート適用（アクション型プルダウン）。テンプレを選ぶと全ページを
             その土台に作り替える（SlideEditorView が確認モーダル → SSE で実行）。
             選択は保持せず、実行後プレースホルダに戻る。 -->
        <template v-if="templates.length > 0">
          <span class="material-icons text-base text-[#6a8aaa]">dashboard_customize</span>
          <select
            class="ribbon-theme-select"
            data-testid="ribbon-template-select"
            :value="TEMPLATE_ACTION_NONE"
            :aria-label="t('slides.applyTemplate')"
            :title="t('slides.applyTemplate')"
            @change="onTemplateChange"
          >
            <option :value="TEMPLATE_ACTION_NONE">{{ t("slides.applyTemplate") }}</option>
            <option v-for="tpl in templates" :key="tpl.id" :value="tpl.id">{{ tpl.label }}</option>
          </select>
        </template>

        <!-- 頁編集トグル — ON で各サムネに操作ボタン（↑↓移動・🗑削除）と編集可能
             セクション末尾の「＋頁追加」を表示する（誤操作防止のトグル）。表紙／
             Thank You は固定で ON でも錠前を出すのみ。状態は useSlideEditor 共有。 -->
        <div class="relative group">
          <button
            class="ribbon-icon-btn"
            :class="{ 'ribbon-icon-btn--active': pageEditMode }"
            data-testid="ribbon-btn-page-edit"
            :aria-label="t('slides.pageEdit')"
            @click="pageEditMode = !pageEditMode"
          >
            <span class="material-icons text-lg" :class="pageEditMode ? 'text-[#cfe2ff]' : 'text-[#8ab4e8]'">low_priority</span>
          </button>
          <div class="ribbon-tooltip">{{ t("slides.pageEditHint") }}</div>
        </div>

        <!-- テキストボックス編集トグル — ON でメインビュー画像上に編集可能テキスト
             ボックスのハイライトを重ね、クリックで編集モーダルを開く。表紙／Thank You／
             チェックアウト頁ではオーバーレイを出さない。頁編集モードとは排他（useSlideEditor）。 -->
        <div class="relative group">
          <button
            class="ribbon-icon-btn"
            :class="{ 'ribbon-icon-btn--active': textboxEditMode }"
            data-testid="ribbon-btn-textbox-edit"
            :aria-label="t('slides.textboxEdit')"
            @click="textboxEditMode = !textboxEditMode"
          >
            <span class="material-icons text-lg" :class="textboxEditMode ? 'text-[#cfe2ff]' : 'text-[#8ab4e8]'">text_fields</span>
          </button>
          <div class="ribbon-tooltip">{{ t("slides.textboxEditHint") }}</div>
        </div>
      </template>
    </div>

    <!-- ── slides 編集コントロール（canvas 更新・チャット） ──
         操作系は編集ビューのヘッダーではなくリボンに集約する（基本ルール）。
         状態・アクションは useSlideEditor 共有ストア経由。テーマ選択は Phase2 で左ゾーンへ。 -->
    <template v-if="showSlideControls">
      <div class="relative group">
        <button
          class="ribbon-icon-btn"
          :class="{ 'ribbon-icon-btn--dirty': dirtyCount > 0 }"
          data-testid="ribbon-btn-canvas-refresh"
          :aria-label="t('slides.canvasRefresh')"
          @click="slideEditor.triggerRefresh()"
        >
          <span class="material-icons text-lg" :class="dirtyCount > 0 ? 'text-yellow-50' : 'text-[#8ab4e8]'">refresh</span>
          <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- numeric count badge -->
          <span v-if="dirtyCount > 0" class="ribbon-badge">{{ dirtyCount }}</span>
        </button>
        <div class="ribbon-tooltip">{{ t("slides.canvasRefresh") }}</div>
      </div>
      <!-- リリース — 編集中バージョンを combine（COM 結合）して ReleasedVersion を生成し、
           サーバーが自動で Windows(D:) へ push する。SlideEditorView が確認モーダルで実行。 -->
      <div class="relative group">
        <button
          class="ribbon-icon-btn ribbon-icon-btn--release"
          data-testid="ribbon-btn-release"
          :aria-label="t('slides.release')"
          @click="slideEditor.triggerRelease()"
        >
          <span class="material-icons text-lg text-green-100">publish</span>
        </button>
        <div class="ribbon-tooltip">{{ t("slides.release") }}</div>
      </div>
      <!-- チェックアウト — 選んだページだけを Windows へ出して手編集する（往復）。
           SlideEditorView が頁選択モーダル → SSE で実行。 -->
      <div class="relative group">
        <button
          class="ribbon-icon-btn"
          data-testid="ribbon-btn-page-checkout"
          :aria-label="t('slides.pageCheckout')"
          @click="slideEditor.triggerPageCheckout()"
        >
          <span class="material-icons text-lg text-[#8ab4e8]">file_download</span>
        </button>
        <div class="ribbon-tooltip">{{ t("slides.pageCheckoutHint") }}</div>
      </div>
      <!-- チェックイン — チェックアウト中ページを戻す(apply)/破棄(discard)。
           ロック中ページが 0 のときは無効。件数をバッジ表示。 -->
      <div class="relative group">
        <button
          class="ribbon-icon-btn"
          :class="{ 'ribbon-icon-btn--checkin': lockedCount > 0 }"
          data-testid="ribbon-btn-page-checkin"
          :disabled="lockedCount === 0"
          :aria-label="t('slides.pageCheckin')"
          @click="slideEditor.triggerPageCheckin()"
        >
          <span class="material-icons text-lg" :class="lockedCount > 0 ? 'text-red-50' : 'text-[#8ab4e8]'">file_upload</span>
          <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- numeric count badge -->
          <span v-if="lockedCount > 0" class="ribbon-badge ribbon-badge--alert">{{ lockedCount }}</span>
        </button>
        <div class="ribbon-tooltip">{{ t("slides.pageCheckinHint") }}</div>
      </div>
      <!-- アセット挿入 — アイコン/画像ライブラリのギャラリーを開き、1点選んで
           チャットに投入する（Claude が python-pptx で配置）。Claude の
           presentAssetPicker でも同じモーダルが開く。 -->
      <div class="relative group">
        <button class="ribbon-icon-btn" data-testid="ribbon-btn-asset-picker" :aria-label="t('slides.pickAsset')" @click="slideEditor.triggerOpenAssetPicker()">
          <span class="material-icons text-lg text-[#8ab4e8]">add_photo_alternate</span>
        </button>
        <div class="ribbon-tooltip">{{ t("slides.pickAssetHint") }}</div>
      </div>
      <div class="relative group">
        <button
          class="ribbon-icon-btn"
          :class="{ 'ribbon-icon-btn--active': chatOpen }"
          data-testid="ribbon-btn-chat"
          :aria-label="t('slides.toggleChat')"
          @click="slideEditor.triggerToggleChat()"
        >
          <span class="material-icons text-lg text-[#8ab4e8]">chat</span>
        </button>
        <div class="ribbon-tooltip">{{ t("slides.toggleChat") }}</div>
      </div>
    </template>

    <!-- ── 作業ファイル選択（ピッカー）コントロール ──
         「再スキャン」を右ゾーン先頭（＝文書選択ボタンのあった位置）に置く。
         このページには既に居るので文書選択ボタンは出さない（select-doc は slides 限定）。 -->
    <div v-if="showPickerControls" class="relative group">
      <button
        class="ribbon-icon-btn"
        data-testid="ribbon-btn-rescan"
        :disabled="scanning"
        :aria-label="t('slides.rescan')"
        @click="workFileSelector.triggerRescan()"
      >
        <span class="material-icons text-lg text-[#8ab4e8]" :class="{ 'animate-spin': scanning }">refresh</span>
      </button>
      <div class="ribbon-tooltip">{{ t("slides.rescan") }}</div>
    </div>

    <!-- ── Action buttons (right zone, data-driven) ──
         各ボタンは material アイコンのみ（ラベルは下側の吹き出しヘルプで補う）。
         `variant === 'exit'` は「機能終了」で赤系＝終了を強調する。 -->
    <div v-for="btn in visibleButtons" :key="btn.id" class="relative group">
      <button
        class="ribbon-icon-btn"
        :class="{ 'ribbon-icon-btn--exit': btn.variant === 'exit' }"
        :data-testid="`ribbon-btn-${btn.id}`"
        :aria-label="t(btn.labelKey)"
        @click="btn.action()"
      >
        <span class="material-icons text-lg" :class="btn.variant === 'exit' ? 'text-red-100' : 'text-[#8ab4e8]'">{{ btn.icon }}</span>
      </button>
      <div class="ribbon-tooltip">{{ t(btn.labelKey) }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { PAGE_ROUTES, type PageRouteName } from "../router/pageRoutes";
import { useSlideEditor, UNAPPLIED_THEME } from "../composables/useSlideEditor";
import { useWorkFileSelector } from "../composables/useWorkFileSelector";
import { NEW_DECK_THEMES } from "../utils/slides/newDeck";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

// 編集ビュー（SlideEditorView）と共有するコントロール状態・アクション。
const slideEditor = useSlideEditor();
const { active, dirtyCount, lockedCount, chatOpen, pageEditMode, textboxEditMode, theme } = slideEditor;

// 作業ファイル選択（ピッカー）と共有する再スキャン状態・アクション。
const workFileSelector = useWorkFileSelector();
const { scanning } = workFileSelector;

// テーマプルダウンの選択肢（new-deck モーダルと同じ 10 テーマカタログを流用）。
const themes = NEW_DECK_THEMES;

function onThemeChange(event: Event): void {
  const { target } = event;
  if (!(target instanceof HTMLSelectElement)) return;
  const next = target.value;
  if (next === UNAPPLIED_THEME) return; // 「（未適用）」は選択不可（適用済みは戻せない）
  slideEditor.triggerApplyTheme(next);
}

// テンプレート適用（アクション型プルダウン）。プレースホルダ値は空文字。
const TEMPLATE_ACTION_NONE = "";
const templates = ref<{ id: string; label: string }[]>([]);

async function loadTemplates(): Promise<void> {
  try {
    const res = await apiGet<{ templates: { id: string; label: string }[] }>(API_ROUTES.work.templates);
    if (res.ok) templates.value = res.data.templates;
  } catch {
    /* テンプレ取得失敗はプルダウン非表示で許容（機能は無くても編集は継続可能） */
  }
}
onMounted(() => void loadTemplates());

function onTemplateChange(event: Event): void {
  const sel = event.target;
  if (!(sel instanceof HTMLSelectElement)) return;
  const tid = sel.value;
  sel.value = TEMPLATE_ACTION_NONE; // アクション型：選択は保持しない
  if (tid === TEMPLATE_ACTION_NONE) return;
  slideEditor.triggerApplyTemplate(tid);
}

// slides ページで編集ビューがマウント済みのときだけ canvas 更新・チャットを出す。
const showSlideControls = computed<boolean>(() => route.name === PAGE_ROUTES.slides && active.value);

// 作業ファイル選択（picker）ページのときだけ「再スキャン」を出す。
const showPickerControls = computed<boolean>(() => route.name === PAGE_ROUTES.workFiles);

// A single ribbon action. `pages` lists every route the button shows on, so
// the same button set can stay identical across the picker → editor flow now
// while still allowing a future button to target just one of them. `icon` is a
// Material Icons ligature name (icon-only — the label shows in the hover
// tooltip). `variant` only tweaks the colour accent (e.g. the red "exit"
// 機能終了 button).
interface RibbonButton {
  id: string;
  labelKey: string;
  icon: string;
  variant?: "default" | "exit";
  pages: PageRouteName[];
  action: () => void;
}

/** 文書選択 — 作業ファイル選択画面へ戻る */
function goToPicker(): void {
  router.push({ name: PAGE_ROUTES.workFiles }).catch(() => {});
}

/** 機能終了 — ホーム（チャット）へ戻る */
function goHome(): void {
  router.push({ name: PAGE_ROUTES.chat }).catch(() => {});
}

// The ribbon's button list. Append entries here to add buttons — keep them in
// left-to-right display order. Both current buttons appear on both pages so
// the top bar is identical whether picking or editing a document.
const RIBBON_BUTTONS: RibbonButton[] = [
  {
    // 文書選択（＝作業ファイル選択へ戻る）は編集画面(slides)でのみ意味を持つ。
    // ピッカー(workFiles)には既に居るので出さない — 代わりに再スキャンを同位置へ。
    id: "select-doc",
    labelKey: "slides.selectDoc",
    icon: "folder_open",
    pages: [PAGE_ROUTES.slides],
    action: goToPicker,
  },
  {
    // 機能終了（＝MulmoPoint を抜けてチャットホームへ戻る）。電源アイコン＋赤系。
    id: "edit-done",
    labelKey: "slides.editDone",
    icon: "power_settings_new",
    variant: "exit",
    pages: [PAGE_ROUTES.workFiles, PAGE_ROUTES.slides],
    action: goHome,
  },
];

const visibleButtons = computed<RibbonButton[]>(() => {
  const current = route.name;
  if (typeof current !== "string") return [];
  return RIBBON_BUTTONS.filter((btn) => btn.pages.some((page) => page === current));
});
</script>

<style scoped>
@reference "../index.css";

/* ── アイコンボタン共通 ──
   ラベルは廃し、アイコン＋ホバー吹き出しに統一。`relative` は件数バッジ
   （右上・absolute）の位置基準。 */
.ribbon-icon-btn {
  @apply relative w-8 h-8 flex items-center justify-center rounded
         bg-[#1a2a44] hover:bg-[#2a3a66]
         border border-[#2a3a60] hover:border-[#3a5a8a]
         transition-colors
         disabled:opacity-50 disabled:cursor-not-allowed;
}

/* 頁編集トグル ON・チャットトグル ON — 青系アクセント（アクティブを示す） */
.ribbon-icon-btn--active {
  @apply bg-[#1a3a66] border-[#3a5a8a];
}

/* canvas 更新待ち（dirty>0）— 明るい琥珀で下部バナーと同系色 */
.ribbon-icon-btn--dirty {
  @apply bg-yellow-700 hover:bg-yellow-600
         border-yellow-600 hover:border-yellow-500;
}

/* リリース — グリーン系（作業ファイル選択画面の「⬆ リリース」と同系色） */
.ribbon-icon-btn--release {
  @apply bg-[#1a3a1a] hover:bg-[#2a5a2a]
         border-[#2a4a2a] hover:border-[#3a6a3a];
}

/* チェックイン待ち（lockedCount>0）— ロック中サムネの赤帯と同系色で「戻し待ち」を示す */
.ribbon-icon-btn--checkin {
  @apply bg-red-900 hover:bg-red-800
         border-red-700 hover:border-red-600;
}

/* 機能終了 — 赤系（電源オフ＝終了を強調） */
.ribbon-icon-btn--exit {
  @apply bg-[#3a1a1a] hover:bg-[#5a2a2a]
         border-[#4a2a2a] hover:border-[#6a3a3a];
}

/* テーマ選択プルダウン（左ゾーン・編集コントロール） */
.ribbon-theme-select {
  @apply h-8 max-w-[11rem] px-2 rounded text-[11px] font-medium
         bg-[#1a2a44] hover:bg-[#2a3a66] text-[#8aacd0]
         border border-[#2a3a60] hover:border-[#3a5a8a]
         cursor-pointer transition-colors;
}

/* ── 件数バッジ（アイコン右上）── canvas 未反映数・チェックインのロック件数を示す */
.ribbon-badge {
  @apply absolute -top-1 -right-1 min-w-[16px] h-4 px-1
         flex items-center justify-center
         text-[10px] font-bold leading-none text-white
         bg-yellow-600 rounded-full ring-1 ring-[#0e1a30];
}

/* ロック件数（チェックイン待ち）は赤系 */
.ribbon-badge--alert {
  @apply bg-red-600;
}

/* ── バルーンヘルプ（ボタン下側に表示） ── */
.ribbon-tooltip {
  @apply absolute top-full left-1/2 -translate-x-1/2 mt-2
         px-2.5 py-1 text-[11px] font-medium text-white
         bg-[#1a2a44] border border-[#2a3a60] rounded shadow-lg
         whitespace-nowrap pointer-events-none
         opacity-0 group-hover:opacity-100 transition-opacity duration-150
         z-50;
}

/* 吹き出しの三角（上向き） */
.ribbon-tooltip::before {
  content: "";
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  border-width: 4px;
  border-style: solid;
  border-color: transparent transparent #2a3a60 transparent;
}
</style>
