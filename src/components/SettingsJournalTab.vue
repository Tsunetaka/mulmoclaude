<template>
  <div class="space-y-3" data-testid="settings-journal-tab">
    <p class="text-sm text-gray-700">{{ t("settingsModal.journalTab.description") }}</p>

    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-800" for="settings-journal-mode">{{ t("settingsModal.journalTab.modeLabel") }}</label>
      <select
        id="settings-journal-mode"
        v-model="modeDraft"
        class="w-full px-3 py-2 text-sm rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        data-testid="settings-journal-mode-select"
        @change="save"
      >
        <option v-for="mode in JOURNAL_MODES" :key="mode" :value="mode">{{ t(`settingsModal.journalTab.mode.${mode}`) }}</option>
      </select>
      <p class="text-xs text-gray-500">{{ t("settingsModal.journalTab.helperText") }}</p>
    </div>

    <div v-if="loaded && !errorMessage" class="flex items-center gap-3 text-xs">
      <span :class="statusColour" data-testid="settings-journal-status">
        {{ statusText }}
      </span>
    </div>

    <p v-if="errorMessage" class="text-sm text-red-700" role="alert" data-testid="settings-journal-error">{{ errorMessage }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { apiGet, apiPut, type ApiResult } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

const JOURNAL_MODES = ["off", "haiku", "sonnet"] as const;
type JournalMode = (typeof JOURNAL_MODES)[number];

const { t } = useI18n();

const props = defineProps<{
  reloadToken: number;
}>();

const emit = defineEmits<{
  saved: [];
}>();

interface SettingsResponse {
  settings: { journal?: JournalMode };
}

const modeDraft = ref<JournalMode>("off");
const storedMode = ref<JournalMode>("off");
const loaded = ref(false);
const saving = ref(false);
const errorMessage = ref("");

const statusText = computed(() => {
  if (saving.value) return t("common.saving");
  return t(`settingsModal.journalTab.status.${storedMode.value}`);
});

const statusColour = computed(() => {
  if (saving.value) return "text-gray-500";
  return storedMode.value === "off" ? "text-gray-500" : "text-green-600";
});

async function load(): Promise<void> {
  errorMessage.value = "";
  const response = await apiGet<SettingsResponse>(API_ROUTES.config.base);
  if (!response.ok) {
    errorMessage.value = response.error || t("settingsModal.journalTab.loadError");
    return;
  }
  storedMode.value = response.data.settings.journal ?? "off";
  modeDraft.value = storedMode.value;
  loaded.value = true;
}

async function save(): Promise<void> {
  if (saving.value) return;
  if (modeDraft.value === storedMode.value) return;
  const requested = modeDraft.value;
  saving.value = true;
  errorMessage.value = "";
  // PATCH endpoint (not the atomic base) so a bare `{ journal }` body
  // is accepted. Send null on "off" so settings.json stays default-clean.
  const payload = { journal: requested === "off" ? null : requested };
  const response = await apiPut<unknown>(API_ROUTES.config.settings, payload);
  saving.value = false;
  applySaveOutcome(response, requested);
}

// On failure with drift, respect the user's newer selection and retry.
// On failure without drift, revert modeDraft so re-selecting the same
// option fires @change again — otherwise the select value hasn't
// changed and the user is stuck with no way to retry.
function applySaveOutcome(response: ApiResult<unknown>, requested: JournalMode): void {
  if (!response.ok) {
    errorMessage.value = response.error || t("settingsModal.journalTab.saveError");
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
