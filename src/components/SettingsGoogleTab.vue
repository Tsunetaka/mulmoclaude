<template>
  <div class="space-y-3" data-testid="settings-google-tab">
    <p class="text-sm text-gray-700">{{ t("settingsModal.googleTab.description") }}</p>

    <!-- `missing` is the normal case now: the broker supplies the OAuth client,
         so only an ambiguous ~/.secrets/ (which the engine refuses to guess at)
         still needs the user's attention. -->
    <p v-if="loaded && clientSecret === 'ambiguous'" class="text-sm text-amber-700" data-testid="settings-google-secret-ambiguous">
      {{ t("settingsModal.googleTab.clientSecretAmbiguous") }}
    </p>

    <div v-if="loaded" class="flex items-center gap-3">
      <span class="text-sm" :class="statusColour" data-testid="settings-google-status">{{ statusText }}</span>
      <!-- Stays clickable while `pending`: a user who abandoned the browser
           consent can restart the link instead of waiting out the server-side
           timeout (the click aborts the stale flow and opens a fresh one). -->
      <button
        v-if="!linked"
        class="px-2 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
        :disabled="busy || clientSecret === 'ambiguous'"
        data-testid="settings-google-connect-btn"
        @click="connect"
      >
        {{ t("settingsModal.googleTab.connect") }}
      </button>
      <button
        v-else
        class="px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        :disabled="busy"
        data-testid="settings-google-unlink-btn"
        @click="unlink"
      >
        {{ t("settingsModal.googleTab.unlink") }}
      </button>
    </div>

    <p v-if="errorText" class="text-sm text-red-700" role="alert" data-testid="settings-google-error">{{ errorText }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { apiGet, apiPost } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

const { t } = useI18n();

const props = defineProps<{
  /** Bumped by the parent each time the modal opens so the status
   *  reflects out-of-band changes (`yarn google:auth`, manual token
   *  file removal, …). */
  reloadToken: number;
}>();

type ClientSecretPresence = "found" | "missing" | "ambiguous";

interface GoogleStatusResponse {
  linked: boolean;
  pending: boolean;
  clientSecret: ClientSecretPresence;
  lastError: string | null;
}

const STATUS_POLL_INTERVAL_MS = 2_000;
const MAX_POLL_BACKOFF_MS = 30_000;

const linked = ref(false);
const pending = ref(false);
const clientSecret = ref<ClientSecretPresence>("found");
const loaded = ref(false);
const busy = ref(false);
const errorText = ref("");
const pollTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const pollFailures = ref(0);
let disposed = false;

const statusText = computed(() => {
  if (pending.value) return t("settingsModal.googleTab.statusPending");
  return linked.value ? t("settingsModal.googleTab.statusLinked") : t("settingsModal.googleTab.statusNotLinked");
});

const statusColour = computed(() => (linked.value ? "text-green-600" : "text-gray-500"));

// The flow finishes out-of-band (browser consent → loopback listener), so
// while the server reports pending the tab polls until pending flips false
// (the loopback flow times out server-side, so this terminates). Transient
// fetch failures back off but never give up — `pending` mirrors the server
// state, not our reachability, so a blip mid-consent must neither strand
// nor clear it.
const backoffDelayMs = (failures: number): number => Math.min(STATUS_POLL_INTERVAL_MS * 2 ** failures, MAX_POLL_BACKOFF_MS);

const schedulePoll = (delayMs: number = STATUS_POLL_INTERVAL_MS): void => {
  if (pollTimer.value) clearTimeout(pollTimer.value);
  pollTimer.value = !disposed && pending.value ? setTimeout(() => void refresh(), delayMs) : null;
};

async function refresh(): Promise<void> {
  const response = await apiGet<GoogleStatusResponse>(API_ROUTES.google.status);
  if (disposed) return;
  if (!response.ok) {
    errorText.value = response.error || t("settingsModal.googleTab.loadError");
    pollFailures.value += 1;
    schedulePoll(backoffDelayMs(pollFailures.value));
    return;
  }
  pollFailures.value = 0;
  linked.value = response.data.linked;
  pending.value = response.data.pending;
  clientSecret.value = response.data.clientSecret;
  errorText.value = response.data.lastError ?? "";
  loaded.value = true;
  schedulePoll();
}

async function connect(): Promise<void> {
  busy.value = true;
  errorText.value = "";
  const response = await apiPost<{ authUrl: string }>(API_ROUTES.google.authorize, {});
  busy.value = false;
  if (!response.ok) {
    errorText.value = response.error || t("settingsModal.googleTab.connectError");
    return;
  }
  window.open(response.data.authUrl, "_blank", "noopener");
  pending.value = true;
  pollFailures.value = 0;
  schedulePoll();
}

async function unlink(): Promise<void> {
  if (!window.confirm(t("settingsModal.googleTab.unlinkConfirm"))) return;
  busy.value = true;
  errorText.value = "";
  const response = await apiPost<{ linked: boolean }>(API_ROUTES.google.unlink, {});
  busy.value = false;
  if (!response.ok) {
    errorText.value = response.error || t("settingsModal.googleTab.unlinkError");
    return;
  }
  linked.value = false;
}

watch(
  () => props.reloadToken,
  () => {
    void refresh();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  disposed = true;
  if (pollTimer.value) clearTimeout(pollTimer.value);
});
</script>
