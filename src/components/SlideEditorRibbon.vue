<template>
  <!-- Slide editor ribbon — replaces the global PluginLauncher while the
       slide editor is active.  Left zone is reserved for future editing
       controls.  Right zone has two icon buttons:
         • 文書選択 — go back to the WD picker (slides root)
         • 編集完了 — leave the slide editor and return to home (chat) -->
  <div class="flex items-center gap-2 w-full min-w-0">
    <!-- ── Future edit controls (left zone) ── -->
    <div class="flex items-center gap-2 flex-1 min-w-0">
      <!-- Placeholder for future controls such as theme selector -->
    </div>

    <!-- ── 文書選択 button ── -->
    <div class="relative group">
      <button class="ribbon-icon-btn" :aria-label="t('slides.selectDoc')" @click="handleSelectDoc">
        <img src="../assets/icons/icon_overview_white.png" class="w-5 h-5 object-contain" alt="" />
      </button>
      <div class="ribbon-tooltip">{{ t("slides.selectDoc") }}</div>
    </div>

    <!-- ── 編集完了 button ── -->
    <div class="relative group">
      <button class="ribbon-icon-btn ribbon-icon-btn--done" :aria-label="t('slides.editDone')" @click="handleDone">
        <img src="../assets/icons/icon_check.png" class="w-5 h-5 object-contain" alt="" />
      </button>
      <div class="ribbon-tooltip">{{ t("slides.editDone") }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { PAGE_ROUTES } from "../router/pageRoutes";

const { t } = useI18n();
const router = useRouter();

/** 文書選択 — WD ピッカーへ戻る */
function handleSelectDoc(): void {
  router.push({ name: PAGE_ROUTES.slides }).catch(() => {});
}

/** 編集完了 — ホーム（チャット）へ戻る */
function handleDone(): void {
  router.push({ name: PAGE_ROUTES.chat }).catch(() => {});
}
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
