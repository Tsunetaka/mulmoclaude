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
      </template>
    </div>

    <!-- ── slides 編集コントロール（canvas 更新・チャット） ──
         操作系は編集ビューのヘッダーではなくリボンに集約する（基本ルール）。
         状態・アクションは useSlideEditor 共有ストア経由。テーマ選択は Phase2 で左ゾーンへ。 -->
    <template v-if="showSlideControls">
      <div class="relative group">
        <button
          class="ribbon-text-btn"
          :class="{ 'ribbon-text-btn--dirty': dirtyCount > 0 }"
          data-testid="ribbon-btn-canvas-refresh"
          :aria-label="t('slides.canvasRefresh')"
          @click="slideEditor.triggerRefresh()"
        >
          <span class="material-icons text-base">refresh</span>
          <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- count suffix appended to the i18n label -->
          <span
            >{{ t("slides.canvasRefresh") }}<template v-if="dirtyCount > 0"> ({{ dirtyCount }})</template></span
          >
        </button>
        <div class="ribbon-tooltip">{{ t("slides.canvasRefresh") }}</div>
      </div>
      <!-- リリース — 編集中バージョンを combine（COM 結合）して ReleasedVersion を生成し、
           サーバーが自動で Windows(D:) へ push する。SlideEditorView が確認モーダルで実行。 -->
      <div class="relative group">
        <button
          class="ribbon-text-btn ribbon-text-btn--release"
          data-testid="ribbon-btn-release"
          :aria-label="t('slides.release')"
          @click="slideEditor.triggerRelease()"
        >
          <span class="material-icons text-base">publish</span>
          <span>{{ t("slides.release") }}</span>
        </button>
        <div class="ribbon-tooltip">{{ t("slides.release") }}</div>
      </div>
      <!-- チェックアウト — 選んだページだけを Windows へ出して手編集する（往復）。
           SlideEditorView が頁選択モーダル → SSE で実行。 -->
      <div class="relative group">
        <button
          class="ribbon-text-btn"
          data-testid="ribbon-btn-page-checkout"
          :aria-label="t('slides.pageCheckout')"
          @click="slideEditor.triggerPageCheckout()"
        >
          <span class="material-icons text-base">file_download</span>
          <span>{{ t("slides.pageCheckout") }}</span>
        </button>
        <div class="ribbon-tooltip">{{ t("slides.pageCheckoutHint") }}</div>
      </div>
      <!-- チェックイン — チェックアウト中ページを戻す(apply)/破棄(discard)。
           ロック中ページが 0 のときは無効。件数をバッジ表示。 -->
      <div class="relative group">
        <button
          class="ribbon-text-btn"
          :class="{ 'ribbon-text-btn--checkin': lockedCount > 0 }"
          data-testid="ribbon-btn-page-checkin"
          :disabled="lockedCount === 0"
          :aria-label="t('slides.pageCheckin')"
          @click="slideEditor.triggerPageCheckin()"
        >
          <span class="material-icons text-base">file_upload</span>
          <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- count suffix appended to the i18n label -->
          <span
            >{{ t("slides.pageCheckin") }}<template v-if="lockedCount > 0"> ({{ lockedCount }})</template></span
          >
        </button>
        <div class="ribbon-tooltip">{{ t("slides.pageCheckinHint") }}</div>
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

    <!-- ── Action buttons (right zone, data-driven) ── -->
    <div v-for="btn in visibleButtons" :key="btn.id" class="relative group">
      <button
        class="ribbon-icon-btn"
        :class="{ 'ribbon-icon-btn--done': btn.variant === 'done' }"
        :data-testid="`ribbon-btn-${btn.id}`"
        :aria-label="t(btn.labelKey)"
        @click="btn.action()"
      >
        <img :src="btn.icon" class="w-5 h-5 object-contain" alt="" />
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
import iconSelectDoc from "../assets/icons/icon_overview_white.png";
import iconDone from "../assets/icons/icon_check.png";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

// 編集ビュー（SlideEditorView）と共有するコントロール状態・アクション。
const slideEditor = useSlideEditor();
const { active, dirtyCount, lockedCount, chatOpen, theme } = slideEditor;

// 作業ファイル選択（ピッカー）と共有する再スキャン状態・アクション。
const workFileSelector = useWorkFileSelector();
const { scanning } = workFileSelector;

// テーマプルダウンの選択肢（new-deck モーダルと同じ 10 テーマカタログを流用）。
const themes = NEW_DECK_THEMES;

function onThemeChange(event: Event): void {
  const next = (event.target as HTMLSelectElement).value;
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
  const sel = event.target as HTMLSelectElement;
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
// while still allowing a future button to target just one of them. `variant`
// only tweaks the colour accent (e.g. the green "done" button).
interface RibbonButton {
  id: string;
  labelKey: string;
  icon: string;
  variant?: "default" | "done";
  pages: PageRouteName[];
  action: () => void;
}

/** 文書選択 — 作業ファイル選択画面へ戻る */
function goToPicker(): void {
  router.push({ name: PAGE_ROUTES.workFiles }).catch(() => {});
}

/** 編集完了 — ホーム（チャット）へ戻る */
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
    icon: iconSelectDoc,
    pages: [PAGE_ROUTES.slides],
    action: goToPicker,
  },
  {
    id: "edit-done",
    labelKey: "slides.editDone",
    icon: iconDone,
    variant: "done",
    pages: [PAGE_ROUTES.workFiles, PAGE_ROUTES.slides],
    action: goHome,
  },
];

const visibleButtons = computed<RibbonButton[]>(() => {
  const current = route.name;
  if (typeof current !== "string") return [];
  return RIBBON_BUTTONS.filter((btn) => btn.pages.includes(current as PageRouteName));
});
</script>

<style scoped>
@reference "../index.css";

/* ── アイコンボタン共通 ── */
.ribbon-icon-btn {
  @apply w-8 h-8 flex items-center justify-center rounded
         bg-[#1a2a44] hover:bg-[#2a3a66]
         border border-[#2a3a60] hover:border-[#3a5a8a]
         transition-colors
         disabled:opacity-50 disabled:cursor-not-allowed;
}

/* 編集完了 — グリーン系 */
.ribbon-icon-btn--done {
  @apply bg-[#1a3a1a] hover:bg-[#2a5a2a]
         border-[#2a4a2a] hover:border-[#3a6a3a];
}

/* チャットトグル ON 時のアクセント */
.ribbon-icon-btn--active {
  @apply bg-[#1a3a66] border-[#3a5a8a];
}

/* テーマ選択プルダウン（左ゾーン・編集コントロール） */
.ribbon-theme-select {
  @apply h-8 max-w-[11rem] px-2 rounded text-[11px] font-medium
         bg-[#1a2a44] hover:bg-[#2a3a66] text-[#8aacd0]
         border border-[#2a3a60] hover:border-[#3a5a8a]
         cursor-pointer transition-colors;
}

/* テキスト付きアクションボタン（canvas 更新など） */
.ribbon-text-btn {
  @apply h-8 flex items-center gap-1 px-2 rounded text-[11px] font-medium
         bg-[#1a2a44] hover:bg-[#2a3a66] text-[#8aacd0]
         border border-[#2a3a60] hover:border-[#3a5a8a]
         transition-colors whitespace-nowrap;
}

/* canvas 更新待ち（dirty>0）— 明るい琥珀で下部バナーと同系色 */
.ribbon-text-btn--dirty {
  @apply bg-yellow-700 hover:bg-yellow-600 text-yellow-50
         border-yellow-600 hover:border-yellow-500;
}

/* リリース — グリーン系（作業ファイル選択画面の「⬆ リリース」と同系色） */
.ribbon-text-btn--release {
  @apply bg-[#1a3a1a] hover:bg-[#2a5a2a] text-green-100
         border-[#2a4a2a] hover:border-[#3a6a3a];
}

/* チェックイン待ち（lockedCount>0）— ロック中サムネの赤帯と同系色で「戻し待ち」を示す */
.ribbon-text-btn--checkin {
  @apply bg-red-900 hover:bg-red-800 text-red-50
         border-red-700 hover:border-red-600;
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
