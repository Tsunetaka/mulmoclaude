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

      <div class="mt-3 pt-2 border-t border-gray-100 text-[11px] leading-snug text-gray-600 space-y-2" data-testid="remote-host-help">
        <p>{{ t("remoteHost.description") }}</p>
        <i18n-t keypath="remoteHost.customViewHint" tag="p" scope="global">
          <template #keyword>
            <code class="px-1 py-0.5 rounded bg-gray-100 text-gray-800">custom remote view</code>
          </template>
        </i18n-t>
        <i18n-t keypath="remoteHost.howTo" tag="p" scope="global">
          <template #url>
            <a :href="MOBILE_URL" target="_blank" rel="noopener noreferrer" class="font-mono text-blue-600 hover:underline break-all">{{ MOBILE_URL }}</a>
          </template>
        </i18n-t>
        <div class="flex flex-col items-center gap-1 pt-1">
          <img :src="qrDataUrl" alt="" aria-hidden="true" class="h-32 w-32" data-testid="remote-host-qr" />
          <p>{{ t("remoteHost.qrHint") }}</p>
        </div>
      </div>
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
import { renderSVG } from "uqr";

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
  // The server's Firebase session blob (refresh token included). We park it in
  // localStorage so a server restart can reconnect without a Google popup
  // (case A', mulmoserver#50). Null when disconnected.
  session: string | null;
}

const { t } = useI18n();

// Same-machine (localhost) trust model — see mulmoserver#50. Wrapped so a
// storage-disabled context (private mode) degrades to "no persistence" rather
// than throwing.
const SESSION_KEY = "remoteHost.session";
// Reconnect status that means "this blob is expired/invalid" (vs a transient
// failure), so only then do we drop the parked session.
const UNAUTHORIZED = 401;
const loadStoredSession = (): string | null => {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
};
const persistSession = (blob: string | null): void => {
  try {
    if (blob) localStorage.setItem(SESSION_KEY, blob);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable — reconnect just won't survive a restart */
  }
};

// Mobile companion PWA. Shown in the popover as help text; not fetched from
// this desktop app, so no runtime env override is needed.
const MOBILE_URL = "https://mulmoserver.web.app";
// Rendered to a data URL (uqr output is ASCII-only SVG) so no v-html is needed.
const qrDataUrl = `data:image/svg+xml;base64,${btoa(renderSVG(MOBILE_URL))}`;

const open = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);
const status = ref<RemoteHostStatus>({ connected: false, uid: null });
const rootRef = ref<HTMLElement | null>(null);

const refreshStatus = async () => {
  const res = await apiGet<StatusResponse>(API_ROUTES.remoteHost.status);
  if (res.ok) {
    status.value = res.data.status;
    // Keep the parked blob fresh (the refresh token can rotate) — but never
    // clear it on a disconnected status, so an auto-reconnect still has it.
    if (res.data.session) persistSession(res.data.session);
    error.value = null;
  } else {
    error.value = res.error || t("remoteHost.statusFailed");
  }
};

// On load, if the server is disconnected but we have a parked session, restore
// it without a popup.
const tryAutoReconnect = async () => {
  if (status.value.connected) return;
  const blob = loadStoredSession();
  if (!blob) return;
  const res = await apiPost<StatusResponse>(API_ROUTES.remoteHost.reconnect, { session: blob });
  if (res.ok) {
    status.value = res.data.status;
    persistSession(res.data.session);
  } else if (res.status === UNAUTHORIZED) {
    // 401 = the blob is genuinely expired/invalid: drop it so the user just sees
    // the normal Connect button. Transient failures (network status 0, backend
    // 5xx) KEEP the blob so a later retry / restart can still reconnect popup-free.
    persistSession(null);
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
    persistSession(res.data.session); // park the session for popup-free reconnect after a restart
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
    persistSession(null); // forget the parked session on an explicit disconnect
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
  refreshStatus()
    .then(tryAutoReconnect)
    .catch(() => undefined);
  document.addEventListener("mousedown", onDocumentClick);
});
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocumentClick));
</script>
