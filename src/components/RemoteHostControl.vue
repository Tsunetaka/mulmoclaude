<template>
  <div ref="rootRef" class="relative">
    <button
      type="button"
      class="relative h-8 w-8 flex items-center justify-center rounded hover:text-gray-700"
      :class="status.connected ? 'text-green-600' : 'text-gray-400'"
      data-testid="remote-host-btn"
      :title="t('remoteHost.title')"
      :aria-label="t('remoteHost.title')"
      @click="toggle"
    >
      <span class="material-icons">phonelink</span>
    </button>

    <div
      v-if="open"
      class="absolute left-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-3 text-xs"
      data-testid="remote-host-popover"
    >
      <div class="flex items-center gap-1.5 mb-2">
        <span class="material-icons text-[14px]" :class="status.connected ? 'text-green-600' : 'text-gray-400'">
          {{ status.connected ? "check_circle" : "radio_button_unchecked" }}
        </span>
        <span class="font-medium text-gray-800">{{ status.connected ? t("remoteHost.online") : t("remoteHost.offline") }}</span>
      </div>

      <p v-if="status.uid" class="text-gray-500 break-all mb-2" data-testid="remote-host-uid">{{ t("remoteHost.uid", { uid: status.uid }) }}</p>

      <div class="flex flex-col gap-1">
        <button
          v-if="!status.connected"
          type="button"
          class="h-8 flex items-center justify-center gap-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="remote-host-connect-btn"
          :disabled="busy"
          @click="onConnect"
        >
          <span class="material-icons text-[16px]">login</span>
          {{ busy ? t("remoteHost.connecting") : t("remoteHost.signIn") }}
        </button>
        <button
          v-else
          type="button"
          class="h-8 flex items-center justify-center gap-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="remote-host-disconnect-btn"
          :disabled="busy"
          @click="onDisconnect"
        >
          <span class="material-icons text-[16px]">logout</span>
          {{ busy ? t("remoteHost.disconnecting") : t("remoteHost.disconnect") }}
        </button>
      </div>

      <p v-if="error" class="mt-2 text-red-600 break-words" data-testid="remote-host-error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
// Top-level toolbar control for the remote-host command channel (phase 1).
//
// Google sign-in popup (browser Firebase) → extract the Google OAuth idToken →
// POST it to /api/remote-host/connect, where the server signs in as the user
// and starts the Firestore command loop + presence heartbeat. The popover shows
// online/offline + the connected uid, and offers Connect / Disconnect.
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";

import { auth } from "../config/firebase";
import { API_ROUTES } from "../config/apiRoutes";
import { apiGet, apiPost } from "../utils/api";
import { errorMessage } from "../utils/errors";

interface RemoteHostStatus {
  connected: boolean;
  uid: string | null;
}
interface StatusResponse {
  status: RemoteHostStatus;
}

const { t } = useI18n();

const open = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);
const status = ref<RemoteHostStatus>({ connected: false, uid: null });
const rootRef = ref<HTMLElement | null>(null);

const refreshStatus = async () => {
  const res = await apiGet<StatusResponse>(API_ROUTES.remoteHost.status);
  if (res.ok) {
    status.value = res.data.status;
    error.value = null;
  } else {
    error.value = res.error || t("remoteHost.statusFailed");
  }
};

const toggle = () => {
  open.value = !open.value;
  if (open.value) void refreshStatus();
};

const onConnect = async () => {
  busy.value = true;
  error.value = null;
  try {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    const idToken = GoogleAuthProvider.credentialFromResult(result)?.idToken;
    if (!idToken) {
      error.value = t("remoteHost.noToken");
      return;
    }
    const res = await apiPost<StatusResponse>(API_ROUTES.remoteHost.connect, { idToken });
    if (!res.ok) {
      error.value = res.error || t("remoteHost.connectFailed");
      return;
    }
    status.value = res.data.status;
    open.value = false; // close the popover after a successful login
  } catch (err) {
    error.value = errorMessage(err, t("remoteHost.signInFailed"));
  } finally {
    busy.value = false;
  }
};

const onDisconnect = async () => {
  busy.value = true;
  error.value = null;
  try {
    const res = await apiPost<StatusResponse>(API_ROUTES.remoteHost.disconnect);
    if (!res.ok) {
      error.value = res.error || t("remoteHost.disconnectFailed");
      return;
    }
    status.value = res.data.status;
    open.value = false; // close the popover after a successful logout
  } catch (err) {
    error.value = errorMessage(err, t("remoteHost.disconnectFailed"));
  } finally {
    busy.value = false;
  }
};

const onDocumentClick = (event: MouseEvent) => {
  if (!open.value) return;
  const target = event.target as Node | null;
  if (rootRef.value && target && !rootRef.value.contains(target)) open.value = false;
};

onMounted(() => {
  void refreshStatus();
  document.addEventListener("mousedown", onDocumentClick);
});
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocumentClick));
</script>
