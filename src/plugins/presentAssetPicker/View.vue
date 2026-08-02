<template>
  <div class="p-2">
    <div v-if="picked" class="flex items-center gap-2 p-3 text-sm text-gray-600 bg-green-50 border border-green-200 rounded">
      <span class="material-icons text-base text-green-600">check_circle</span>
      <span>{{ t("assetPicker.picked", { label: picked.label }) }}</span>
    </div>
    <AssetPickerGallery v-else :initial-tab="data?.tab ?? 'icons'" :initial-query="data?.query ?? ''" @pick="onPick" @cancel="onCancel" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import AssetPickerGallery from "../../components/AssetPickerGallery.vue";
import { formatAssetSelection, type AssetItem } from "../../utils/assetPicker/catalog";
import type { AssetPickerData } from "./definition";

const props = defineProps<{
  selectedResult: ToolResultComplete<AssetPickerData>;
  sendTextMessage: (text?: string) => void;
}>();

const { t } = useI18n();

const data = computed(() => props.selectedResult.data);
const picked = ref<AssetItem | null>(null);

function onPick(asset: AssetItem): void {
  if (picked.value) return;
  picked.value = asset;
  props.sendTextMessage(formatAssetSelection(asset));
}

function onCancel(): void {
  props.sendTextMessage(t("assetPicker.cancelledMessage"));
}
</script>
