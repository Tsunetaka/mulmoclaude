<template>
  <div class="ap-gallery flex flex-col bg-white rounded-lg overflow-hidden" data-testid="asset-picker-gallery">
    <!-- Header: title + tabs + search -->
    <div class="px-4 pt-3 pb-2 border-b border-gray-200 bg-gray-50">
      <div class="flex items-center gap-2 mb-2">
        <span class="material-icons text-base text-blue-600">collections</span>
        <span class="text-sm font-bold text-gray-700 flex-1">{{ t("assetPicker.title") }}</span>
        <button type="button" class="text-gray-400 hover:text-gray-600" :aria-label="t('assetPicker.cancel')" @click="emit('cancel')">
          <span class="material-icons text-lg">close</span>
        </button>
      </div>
      <div class="flex items-center gap-2">
        <div class="flex rounded overflow-hidden border border-gray-300">
          <button
            type="button"
            class="px-3 py-1 text-xs font-medium"
            :class="tab === 'icons' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'"
            @click="tab = 'icons'"
          >
            {{ t("assetPicker.icons") }} ({{ catalog?.icons.length ?? 0 }})
          </button>
          <button
            type="button"
            class="px-3 py-1 text-xs font-medium border-l border-gray-300"
            :class="tab === 'images' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'"
            @click="tab = 'images'"
          >
            {{ t("assetPicker.images") }} ({{ catalog?.images.length ?? 0 }})
          </button>
        </div>
        <input
          v-model="query"
          type="text"
          :placeholder="t('assetPicker.search')"
          class="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-500"
        />
      </div>
    </div>

    <!-- Body: gallery grid -->
    <div class="flex-1 overflow-y-auto px-4 py-3 min-h-[12rem] max-h-[26rem] bg-white">
      <div v-if="loading" class="h-40 flex items-center justify-center text-sm text-gray-400">
        {{ t("assetPicker.loading") }}
      </div>
      <div v-else-if="loadError" class="h-40 flex items-center justify-center text-sm text-red-600">
        {{ t("assetPicker.loadError") }}
      </div>
      <div v-else-if="filtered.length === 0" class="h-40 flex items-center justify-center text-sm text-gray-400">
        {{ t("assetPicker.empty") }}
      </div>
      <div v-else class="grid grid-cols-4 gap-2 sm:grid-cols-5">
        <button
          v-for="asset in filtered"
          :key="asset.id"
          type="button"
          class="group flex flex-col items-center gap-1 p-1.5 rounded border text-left"
          :class="selectedId === asset.id ? 'border-blue-500 ring-2 ring-blue-300 bg-blue-50' : 'border-gray-200 hover:border-blue-300'"
          :title="`${asset.label}\n${asset.description}`"
          @click="selectedId = asset.id"
          @dblclick="confirm(asset)"
        >
          <span class="w-full aspect-square rounded bg-slate-600 flex items-center justify-center overflow-hidden">
            <img :src="thumbUrl(asset.path)" :alt="asset.label" class="max-w-full max-h-full object-contain" loading="lazy" />
          </span>
          <span class="text-[10px] leading-tight text-gray-600 truncate w-full text-center">{{ asset.id }}</span>
        </button>
      </div>
    </div>

    <!-- Footer: selection detail + actions -->
    <div class="px-4 py-2.5 border-t border-gray-200 bg-gray-50">
      <p v-if="selected" class="text-[11px] text-gray-600 mb-2 line-clamp-2">
        <span class="font-bold text-gray-800 mr-1">{{ selected.label }}</span>
        <span>{{ selected.description }}</span>
      </p>
      <div class="flex justify-end gap-2">
        <button type="button" class="px-3 py-1.5 rounded text-xs text-gray-600 bg-gray-200 hover:bg-gray-300" @click="emit('cancel')">
          {{ t("assetPicker.cancel") }}
        </button>
        <button
          type="button"
          class="px-4 py-1.5 rounded text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40"
          :disabled="!selected"
          @click="selected && confirm(selected)"
        >
          {{ t("assetPicker.select") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import type { AssetCatalog, AssetItem } from "../utils/assetPicker/catalog";

const props = withDefaults(
  defineProps<{
    initialTab?: "icons" | "images";
    initialQuery?: string;
  }>(),
  { initialTab: "icons", initialQuery: "" },
);

const emit = defineEmits<{
  pick: [asset: AssetItem];
  cancel: [];
}>();

const { t } = useI18n();

const catalog = ref<AssetCatalog | null>(null);
const loading = ref(true);
const loadError = ref(false);
const tab = ref<"icons" | "images">(props.initialTab);
const query = ref(props.initialQuery);
const selectedId = ref<string>("");

function thumbUrl(path: string): string {
  return `${API_ROUTES.files.raw}?path=${encodeURIComponent(path)}`;
}

const currentList = computed<AssetItem[]>(() => {
  if (!catalog.value) return [];
  return tab.value === "icons" ? catalog.value.icons : catalog.value.images;
});

const filtered = computed<AssetItem[]>(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return currentList.value;
  return currentList.value.filter((item) => {
    const hay = [item.id, item.label, item.description, item.colorTone, ...(item.tags ?? [])].join(" ").toLowerCase();
    return hay.includes(needle);
  });
});

const selected = computed<AssetItem | null>(() => filtered.value.find((item) => item.id === selectedId.value) ?? null);

function confirm(asset: AssetItem): void {
  emit("pick", asset);
}

onMounted(async () => {
  try {
    const res = await apiGet<AssetCatalog>(API_ROUTES.work.assetCatalog);
    if (res.ok) {
      catalog.value = res.data;
    } else {
      loadError.value = true;
      console.error("[assetPicker] catalog fetch failed:", res.error);
    }
  } catch (err) {
    loadError.value = true;
    console.error("[assetPicker] catalog fetch threw:", err);
  } finally {
    loading.value = false;
  }
});
</script>
