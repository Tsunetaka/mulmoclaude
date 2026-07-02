<template>
  <!-- Slide editor ribbon — replaces the global PluginLauncher across the
       slide-editor chrome (document picker `workFiles` + editor `slides`).
       Left zone is reserved for future editing controls. Right zone renders
       a data-driven list of icon buttons (see `RIBBON_BUTTONS` below): to add
       a button, append one entry — no template edits, and it appears on every
       page it lists in `pages`. -->
  <div class="flex items-center gap-2 w-full min-w-0" data-testid="slide-editor-ribbon">
    <!-- ── Future edit controls (left zone) ── -->
    <div class="flex items-center gap-2 flex-1 min-w-0">
      <!-- Placeholder for future controls such as theme selector -->
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
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { PAGE_ROUTES, type PageRouteName } from "../router/pageRoutes";
import { useSlideEditor } from "../composables/useSlideEditor";
import iconSelectDoc from "../assets/icons/icon_overview_white.png";
import iconDone from "../assets/icons/icon_check.png";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

// 編集ビュー（SlideEditorView）と共有するコントロール状態・アクション。
const slideEditor = useSlideEditor();
const { active, dirtyCount, chatOpen } = slideEditor;

// slides ページで編集ビューがマウント済みのときだけ canvas 更新・チャットを出す。
const showSlideControls = computed<boolean>(() => route.name === PAGE_ROUTES.slides && active.value);

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
    id: "select-doc",
    labelKey: "slides.selectDoc",
    icon: iconSelectDoc,
    pages: [PAGE_ROUTES.workFiles, PAGE_ROUTES.slides],
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
         transition-colors;
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
