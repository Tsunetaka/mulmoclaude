<template>
  <!-- MulmoPoint credits popup — shown when the user clicks the logo
       while the slide editor is active. Rendered via Teleport so it
       floats above all other content without z-index wrestling. -->
  <Teleport to="body">
    <Transition name="mp-fade">
      <div v-if="open" class="fixed inset-0 z-[9999] flex items-start justify-start" role="dialog" aria-modal="true" :aria-label="t('mulmoPoint.title')">
        <!-- Backdrop: click-away to close -->
        <div class="absolute inset-0" @click="emit('close')" />

        <!-- Card -->
        <div class="relative mt-[68px] ml-3 w-72 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl">
          <!-- Header band -->
          <div class="flex items-center gap-3 bg-gradient-to-r from-[#7ECFFF] to-[#A08AFF] px-4 py-3">
            <img :src="takoLogoUrl" alt="" class="h-10 w-10 rounded-full bg-white/20 object-contain" />
            <div>
              <div class="text-sm font-bold text-white drop-shadow">{{ t("mulmoPoint.title") }}</div>
              <div class="text-[10px] text-white/80">{{ t("mulmoPoint.description") }}</div>
            </div>
          </div>

          <!-- Body -->
          <div class="space-y-3 px-4 py-3 text-[12px] text-gray-700">
            <!-- AI Engines -->
            <section>
              <div class="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                {{ t("mulmoPoint.aiEngines") }}
              </div>
              <ul class="space-y-1">
                <li class="flex items-baseline gap-2">
                  <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- brand name -->
                  <span class="min-w-[110px] font-semibold text-[#5B4CF5]">Anthropic Claude</span>
                  <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- internal tool description, slide-editor only -->
                  <span class="text-gray-500">テキスト生成・推論・コード</span>
                </li>
                <li class="flex items-baseline gap-2">
                  <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- brand name -->
                  <span class="min-w-[110px] font-semibold text-[#1A73E8]">Google Gemini</span>
                  <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- internal tool description, slide-editor only -->
                  <span class="text-gray-500">画像・音声・動画生成</span>
                </li>
              </ul>
            </section>

            <hr class="border-gray-100" />

            <!-- Slide Editing -->
            <section>
              <div class="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                {{ t("mulmoPoint.slideEditing") }}
              </div>
              <ul class="space-y-1">
                <li class="flex items-baseline gap-2">
                  <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- library name -->
                  <span class="min-w-[110px] font-semibold text-gray-600">python-pptx</span>
                  <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- internal tool description, slide-editor only -->
                  <span class="text-gray-500">PPTX 解析・生成</span>
                </li>
                <li class="flex items-baseline gap-2">
                  <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- library name -->
                  <span class="min-w-[110px] font-semibold text-gray-600">LibreOffice</span>
                  <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- internal tool description, slide-editor only -->
                  <span class="text-gray-500">サムネイル変換</span>
                </li>
                <li class="flex items-baseline gap-2">
                  <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- product name -->
                  <span class="min-w-[110px] font-semibold text-gray-600">PowerPoint COM</span>
                  <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- internal tool description, slide-editor only -->
                  <span class="text-gray-500">ページキャンバス生成</span>
                </li>
              </ul>
            </section>

            <hr class="border-gray-100" />

            <!-- Core Engine -->
            <section>
              <div class="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                {{ t("mulmoPoint.coreEngine") }}
              </div>
              <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- product name -->
              <p class="font-semibold text-gray-600">receptron / MulmoClaude</p>
            </section>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-2">
            <span class="text-[10px] text-gray-400">{{ t("mulmoPoint.copyright") }}</span>
            <button class="text-[11px] font-medium text-[#7B8FFF] transition-colors hover:text-[#5B4CF5]" @click="emit('close')">
              {{ t("mulmoPoint.close") }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import takoLogoUrl from "../assets/mulmo_tako.png";

const { t } = useI18n();

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
</script>

<style scoped>
.mp-fade-enter-active,
.mp-fade-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.mp-fade-enter-from,
.mp-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
