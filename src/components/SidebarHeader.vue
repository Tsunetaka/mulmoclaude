<template>
  <div class="flex items-center gap-2">
    <button
      type="button"
      class="flex items-center gap-2 -my-1 -ml-1 py-1 pl-1 pr-1 rounded hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      data-testid="app-home-btn"
      :title="resolvedHomeLabel"
      :aria-label="resolvedHomeLabel"
      @click="emit('home')"
    >
      <img :src="resolvedLogoSrc" alt="" class="h-[50px] w-auto -my-3.5 -ml-3 rounded object-contain shrink-0" />
      <!-- span, not h1: `<h1>` inside `<button>` is invalid HTML, and
           the brand label here is a clickable logo, not a page heading. -->
      <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- brand name, overridable via prop -->
      <span data-testid="app-title" class="text-sm font-semibold text-gray-800" :style="titleStyle">{{ appTitle }}</span>
    </button>
    <div class="flex gap-0.5">
      <LockStatusPopup
        ref="lockPopup"
        :sandbox-enabled="sandboxEnabled"
        :open="lockPopupOpen"
        @update:open="lockPopupOpen = $event"
        @test-query="(q) => emit('testQuery', q)"
      />
      <NotificationBell :force-close="lockPopupOpen" @update:open="onNotificationOpen" />
      <RemoteHostControl />
      <button
        v-if="!hideJournalButton"
        class="h-8 w-8 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="today-journal-btn"
        :title="t('sidebarHeader.todayJournal')"
        :aria-label="t('sidebarHeader.todayJournal')"
        :disabled="todayJournalLoading"
        @click="openLatestDaily"
      >
        <span class="material-icons">today</span>
      </button>
      <button
        class="relative h-8 w-8 flex items-center justify-center rounded text-gray-400 hover:text-gray-700"
        data-testid="settings-btn"
        :title="settingsLabel"
        :aria-label="settingsLabel"
        @click="emit('openSettings')"
      >
        <span class="material-icons">settings</span>
        <span
          v-if="!geminiAvailable"
          class="gemini-missing-badge absolute -top-0.5 -right-0.5 flex items-center justify-center w-3.5 h-3.5 rounded-full bg-yellow-400 text-[9px] font-bold leading-none text-white ring-1 ring-white"
          data-testid="settings-gemini-badge"
          aria-hidden="true"
        ></span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type CSSProperties } from "vue";
import { useI18n } from "vue-i18n";
import LockStatusPopup from "./LockStatusPopup.vue";
import NotificationBell from "./NotificationBell.vue";
import RemoteHostControl from "./RemoteHostControl.vue";
import { useClickOutside } from "../composables/useClickOutside";
import { useLatestDaily } from "../composables/useLatestDaily";
import logoUrl from "../assets/mulmo_bw.png";

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    sandboxEnabled: boolean;
    geminiAvailable?: boolean;
    titleStyle?: CSSProperties;
    /** Override the app logo. Defaults to the built-in mulmo_bw mascot. */
    logoSrc?: string;
    /** Override the home button tooltip/aria-label. Defaults to sidebarHeader.home. */
    homeLabel?: string;
    /** When true, hide the today-journal (calendar) button. */
    hideJournalButton?: boolean;
    /** Override the app title text. Defaults to "MulmoClaude". */
    appTitle?: string;
  }>(),
  { geminiAvailable: true, titleStyle: () => ({}), logoSrc: undefined, homeLabel: undefined, hideJournalButton: false, appTitle: "MulmoClaude" },
);

/** Resolved logo: use the override when provided, otherwise fall back to the built-in asset. */
const resolvedLogoSrc = computed(() => props.logoSrc ?? logoUrl);

/** Resolved home button label: use override when provided, otherwise the default i18n string. */
const resolvedHomeLabel = computed(() => props.homeLabel ?? t("sidebarHeader.home"));

const emit = defineEmits<{
  testQuery: [query: string];
  openSettings: [];
  home: [];
}>();

// Settings button accessible name has to convey the `!` badge's
// meaning (missing API key) to screen-reader users — the badge
// itself is decorative (aria-hidden), so without this the a11y
// tree just announces "Settings" and the whole point of the
// attention signal is lost.
const settingsLabel = computed(() => (props.geminiAvailable ? t("sidebarHeader.settings") : t("sidebarHeader.settingsGeminiMissing")));

const { openLatestDaily, loading: todayJournalLoading } = useLatestDaily();

const lockPopupOpen = ref(false);
const lockPopup = ref<{
  button: HTMLButtonElement | null;
  popup: HTMLDivElement | null;
} | null>(null);
const lockButton = computed(() => lockPopup.value?.button ?? null);
const lockPopupEl = computed(() => lockPopup.value?.popup ?? null);

const { handler } = useClickOutside({
  isOpen: lockPopupOpen,
  buttonRef: lockButton,
  popupRef: lockPopupEl,
});
onMounted(() => document.addEventListener("mousedown", handler));
onBeforeUnmount(() => document.removeEventListener("mousedown", handler));

function onNotificationOpen(isOpen: boolean): void {
  if (isOpen) lockPopupOpen.value = false;
}
</script>

<style scoped>
.gemini-missing-badge::before {
  content: "!";
}
</style>
