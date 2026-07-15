<template>
  <div class="space-y-3" data-testid="settings-chat-index-tab">
    <p class="text-sm text-gray-700">{{ t("settingsModal.chatIndexTab.description") }}</p>

    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-800" for="settings-chat-index-mode">{{ t("settingsModal.chatIndexTab.modeLabel") }}</label>
      <select
        id="settings-chat-index-mode"
        v-model="modeDraft"
        class="w-full px-3 py-2 text-sm rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        data-testid="settings-chat-index-mode-select"
        @change="save"
      >
        <option v-for="mode in CHAT_INDEX_MODES" :key="mode" :value="mode">{{ t(`settingsModal.chatIndexTab.mode.${mode}`) }}</option>
      </select>
      <p class="text-xs text-gray-500">{{ t("settingsModal.chatIndexTab.helperText") }}</p>
    </div>

    <div v-if="loaded && !errorMessage" class="flex items-center gap-3 text-xs">
      <span :class="statusColour" data-testid="settings-chat-index-status">
        {{ statusText }}
      </span>
    </div>

    <p v-if="errorMessage" class="text-sm text-red-700" role="alert" data-testid="settings-chat-index-error">{{ errorMessage }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { apiGet, apiPut, type ApiResult } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

const CHAT_INDEX_MODES = ["off", "haiku", "sonnet"] as const;
type ChatIndexMode = (typeof CHAT_INDEX_MODES)[number];

const { t } = useI18n();

const props = defineProps<{
  reloadToken: number;
}>();

const emit = defineEmits<{
  saved: [];
}>();

interface SettingsResponse {
  settings: { chatIndex?: ChatIndexMode };
}

const modeDraft = ref<ChatIndexMode>("off");
const storedMode = ref<ChatIndexMode>("off");
const loaded = ref(false);
const saving = ref(false);
const errorMessage = ref("");

const statusText = computed(() => {
  if (saving.value) return t("common.saving");
  return t(`settingsModal.chatIndexTab.status.${storedMode.value}`);
});

const statusColour = computed(() => {
  if (saving.value) return "text-gray-500";
  return storedMode.value === "off" ? "text-gray-500" : "text-green-600";
});

async function load(): Promise<void> {
  errorMessage.value = "";
  const response = await apiGet<SettingsResponse>(API_ROUTES.config.base);
  if (!response.ok) {
    errorMessage.value = response.error || t("settingsModal.chatIndexTab.loadError");
    return;
  }
  storedMode.value = response.data.settings.chatIndex ?? "off";
  modeDraft.value = storedMode.value;
  loaded.value = true;
}

async function save(): Promise<void> {
  if (saving.value) return;
  if (modeDraft.value === storedMode.value) return;
  const requested = modeDraft.value;
  saving.value = true;
  errorMessage.value = "";
  // The Settings tab uses the PATCH endpoint (`config.settings`) — the
  // full-shape `config.base` PUT expects `{ settings, mcp }` and would
  // reject a bare `{ chatIndex }` payload. Send null on "off" so the
  // server drops the field and settings.json stays default-clean.
  const payload = { chatIndex: requested === "off" ? null : requested };
  const response = await apiPut<unknown>(API_ROUTES.config.settings, payload);
  saving.value = false;
  applySaveOutcome(response, requested);
}

// On failure with drift, respect the user's newer selection and retry.
// On failure without drift, revert modeDraft so re-selecting the same
// option fires @change again — otherwise the select value hasn't
// changed and the user is stuck with no way to retry.
function applySaveOutcome(response: ApiResult<unknown>, requested: ChatIndexMode): void {
  if (!response.ok) {
    errorMessage.value = response.error || t("settingsModal.chatIndexTab.saveError");
    if (modeDraft.value !== requested) void save();
    else modeDraft.value = storedMode.value;
    return;
  }
  storedMode.value = requested;
  emit("saved");
  if (modeDraft.value !== requested) void save();
}

watch(
  () => props.reloadToken,
  () => {
    void load();
  },
  { immediate: true },
);
</script>
