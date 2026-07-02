<template>
  <div class="remote-preview-container" data-testid="collection-remote-view-preview">
    <div v-if="error" class="remote-preview-message" role="alert" data-testid="collection-remote-view-error">
      {{ t("collectionsView.customViewError", { error }) }}
    </div>
    <div v-else-if="loading" class="remote-preview-message" data-testid="collection-remote-view-loading">
      {{ t("collectionsView.customViewLoading") }}
    </div>
    <template v-else-if="srcdoc">
      <!-- Same sandbox as CollectionCustomView: NO `allow-same-origin` (opaque
           origin — the view can't read the parent's storage; here there is no
           token to protect, but the phone renders under the same rules and the
           preview must match it exactly). `allow-popups*` lets outbound
           `target="_blank"` links open as normal tabs. -->
      <div class="phone-frame">
        <iframe
          ref="iframeEl"
          :key="view.id"
          data-testid="collection-remote-view-iframe"
          :title="view.label"
          :srcdoc="srcdoc"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          class="phone-screen"
        />
      </div>
      <!-- Numeric on purpose (no locale keys): the srcdoc's size against the
           1 MiB command-document budget it must travel through. -->
      <div class="remote-preview-caption" data-testid="collection-remote-view-size">{{ sizeCaption }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useCollectionI18n } from "../lang";
import { deriveAll, errorMessage } from "@mulmoclaude/core/collection";
import type { CollectionCustomView, CollectionItem, CollectionSchema } from "@mulmoclaude/core/collection";
import { handleRemoteViewMessage, pageFromItems, REMOTE_VIEW_MAX_BYTES, type RemoteViewItem, type RemoteViewPage } from "@mulmoclaude/core/remote-view";
import { collectionUi } from "../uiContext";

const { t } = useCollectionI18n();

const props = defineProps<{
  slug: string;
  view: CollectionCustomView;
  /** The collection schema — the bridge derives computed fields from it and
   *  `projectItems` always keeps its `primaryKey`. */
  schema: CollectionSchema;
  /** The already-loaded records the bridge pages over. Deliberately the
   *  UNFILTERED list: the phone pages over the whole collection through the
   *  command channel, and the preview must behave identically. */
  items: CollectionItem[];
}>();

const emit = defineEmits<{
  /** The view called `__MC_VIEW.startChat(prompt, role)` — open a new chat
   *  with `prompt` prefilled as an editable draft (host validates `role`). */
  startChat: [payload: { prompt: string; role?: string }];
}>();

const loading = ref(true);
const error = ref<string | null>(null);
const srcdoc = ref<string | null>(null);
const bytes = ref(0);
const iframeEl = ref<HTMLIFrameElement | null>(null);

const sizeCaption = computed(() => `${Math.max(1, Math.round(bytes.value / 1024))} KB / ${Math.round(REMOTE_VIEW_MAX_BYTES / 1024)} KB`);

// Monotonic load id — same stale-load guard as CollectionCustomView.
let loadSeq = 0;

async function load(): Promise<void> {
  const seq = ++loadSeq;
  const stale = (): boolean => seq !== loadSeq;
  loading.value = true;
  error.value = null;
  srcdoc.value = null;
  const binding = collectionUi();
  try {
    // The host wraps the srcdoc server-side (CSP + bootstrap) — the preview
    // receives the exact artifact the phone gets over the command channel.
    const resp = await binding.fetchRemoteView?.(props.slug, props.view.id, binding.localeTag());
    if (stale()) return;
    if (!resp) {
      error.value = "fetchRemoteView is not wired on this host";
      return;
    }
    if (!resp.ok) {
      error.value = resp.error;
      return;
    }
    bytes.value = resp.data.bytes;
    srcdoc.value = resp.data.srcdoc;
  } catch (err) {
    if (!stale()) error.value = errorMessage(err);
  } finally {
    if (!stale()) loading.value = false;
  }
}

// Reload when the view / collection / app locale changes (the dict is picked
// server-side per locale, like the desktop custom view).
watch([() => props.slug, () => props.view.id, () => collectionUi().localeTag()], () => void load(), { immediate: true });

// ── The parent side of the remote-view bridge ──
// Answers ONLY what the phone parent answers — `getItems` pages (clamped +
// fields-projected by the shared handler) and `startChat` relays. No
// `onChange`, no `openItem`, no data plane: preview capability must equal
// phone capability exactly (plans/feat-remote-custom-view.md, decision 5).
//
// `props.items` are the RAW detail records: derived formulas resolve at
// render time on the desktop, so the bridge must derive them here — with an
// empty ref cache, exactly like the channel's `deriveItems` — before paging.
// The JSON round-trip then strips Vue's reactive proxies (postMessage
// structured-clone throws DataCloneError on them) and matches what the
// command channel does to a page anyway.
function getPage(request: Parameters<typeof pageFromItems>[1]): RemoteViewPage {
  const derived = props.items.map((item) => deriveAll(props.schema, item, {}) as RemoteViewItem);
  return JSON.parse(JSON.stringify(pageFromItems(derived, request, props.schema.primaryKey))) as RemoteViewPage;
}

function onWindowMessage(event: MessageEvent): void {
  const target = event.source;
  if (!target || target !== iframeEl.value?.contentWindow) return;
  void handleRemoteViewMessage(
    event.data,
    {
      slug: props.slug,
      getPage,
      onStartChat: (prompt, role) => emit("startChat", { prompt, role }),
    },
    // targetOrigin "*": the sandboxed document's origin is opaque, nothing
    // else can match; the page carries the user's own records to the user's
    // own view.
    (message) => target.postMessage(message, "*"),
  );
}

onMounted(() => window.addEventListener("message", onWindowMessage));
onBeforeUnmount(() => window.removeEventListener("message", onWindowMessage));
</script>

<style scoped>
.remote-preview-container {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  background: #f1f5f9;
  overflow: hidden;
}

/* A phone-sized (390×844 CSS px) frame; shrinks with the panel but never
   grows past phone dimensions, so layouts are judged at the real size. */
.phone-frame {
  width: 390px;
  height: 844px;
  max-width: 100%;
  max-height: calc(100% - 28px);
  min-height: 0;
  flex-shrink: 1;
  border: 8px solid #0f172a;
  border-radius: 28px;
  overflow: hidden;
  background: white;
}

.phone-screen {
  width: 100%;
  height: 100%;
  border: 0;
}

.remote-preview-caption {
  font-size: 12px;
  color: #64748b;
}

.remote-preview-message {
  padding: 1rem;
  font-size: 0.875rem;
  color: #64748b;
}

[role="alert"].remote-preview-message {
  color: #b71c1c;
}
</style>
