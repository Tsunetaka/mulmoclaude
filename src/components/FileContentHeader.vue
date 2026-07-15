<template>
  <div v-if="selectedPath" class="flex items-center gap-2 px-3 py-2 border-b border-gray-200 text-xs text-gray-500 font-mono shrink-0">
    <span class="truncate min-w-0">{{ selectedPath }}</span>
    <span v-if="size !== null" class="text-gray-400 shrink-0">· {{ formatBytes(size) }}</span>
    <span v-if="modifiedMs !== null" class="text-gray-400 shrink-0">· {{ formatDateTime(modifiedMs) }}</span>
    <button
      type="button"
      class="ml-auto shrink-0 h-8 w-8 flex items-center justify-center rounded hover:bg-gray-100 font-sans disabled:opacity-50"
      :class="revealInOsError ? 'text-red-500' : 'text-gray-400 hover:text-gray-700'"
      :disabled="revealInOsBusy"
      :title="revealInOsError || t('fileContentHeader.revealInOs')"
      :aria-label="revealAriaLabel"
      data-testid="file-reveal-in-os"
      @click="revealInOs"
    >
      <span class="material-icons text-base" aria-hidden="true">folder_open</span>
    </button>
    <button
      v-if="isMarkdown"
      class="shrink-0 h-8 px-2.5 flex items-center gap-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-100 font-sans"
      :title="mdRawMode ? t('fileContentHeader.showRendered') : t('fileContentHeader.showRaw')"
      @click="emit('toggleMdRaw')"
    >
      {{ mdRawMode ? t("fileContentHeader.rendered") : t("fileContentHeader.raw") }}
    </button>
    <button
      type="button"
      class="shrink-0 h-8 w-8 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
      :title="t('fileContentHeader.closeFile')"
      :aria-label="t('fileContentHeader.closeFile')"
      data-testid="close-file-btn"
      @click="emit('deselect')"
    >
      <span class="material-icons text-base" aria-hidden="true">close</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef } from "vue";
import { useI18n } from "vue-i18n";
import { formatDateTime } from "../utils/format/date";
import { formatBytes } from "../utils/format/bytes";
import { useRevealInOs } from "../composables/useOpenInOs";

const { t } = useI18n();

const props = defineProps<{
  selectedPath: string | null;
  size: number | null;
  modifiedMs: number | null;
  isMarkdown: boolean;
  mdRawMode: boolean;
}>();

const emit = defineEmits<{
  toggleMdRaw: [];
  deselect: [];
}>();

// "Show in folder" — open the selected file's location in the host
// file manager. Lives here (not in FileContentRenderer) so it's
// available for every file type, not just the binary fallback (#1985).
const {
  busy: revealInOsBusy,
  error: revealInOsError,
  reveal: revealInOs,
} = useRevealInOs(toRef(props, "selectedPath"), () => t("fileContentHeader.revealInOsFailed"));

// Screen readers only get the accessible name, not the visual red/title
// error state — fold the error into the aria-label so a failed reveal is
// conveyed non-visually.
const revealAriaLabel = computed(() => {
  const label = t("fileContentHeader.revealInOs");
  return revealInOsError.value ? `${label} – ${revealInOsError.value}` : label;
});
</script>
