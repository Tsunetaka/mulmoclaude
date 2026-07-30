<template>
  <div class="p-2 text-sm" data-testid="mulmo-script-preview">
    <div class="font-medium text-gray-700 truncate mb-1" data-testid="mulmo-script-preview-title">
      {{ title }}
    </div>
    <div v-if="description" class="text-xs text-gray-500 leading-relaxed" data-testid="mulmo-script-preview-description">
      {{ description }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { MulmoScriptData } from "../core/types";

const props = defineProps<{ result: ToolResultComplete<MulmoScriptData> }>();

const data = computed(() => props.result.data);
const script = computed(() => data.value?.script);
const title = computed(() => script.value?.title || data.value?.filePath?.split("/").pop() || "MulmoScript");
const description = computed(() => script.value?.description);
</script>
