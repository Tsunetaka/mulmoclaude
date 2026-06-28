<template>
  <div class="h-full flex flex-col bg-[#0d1220] text-white select-none overflow-hidden">
    <!-- ── WD 未選択: ピッカー ── -->
    <div v-if="!wdId" class="flex-1 flex flex-col items-center justify-center gap-6 px-8">
      <span class="material-icons text-5xl text-gray-500" aria-hidden="true">slideshow</span>
      <h2 class="text-base font-semibold text-gray-300">{{ t("slides.pickWd") }}</h2>
      <div class="flex gap-2 w-full max-w-xs">
        <input
          v-model="wdInput"
          class="flex-1 bg-[#1a2a44] border border-[#2a3a60] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#4a8acc] placeholder-gray-600"
          :placeholder="t('slides.wdPlaceholder')"
          @keydown.enter="openWd"
        />
        <button class="bg-[#1a5fa8] hover:bg-[#2a6fc0] text-white text-sm px-4 py-2 rounded transition-colors" @click="openWd">
          {{ t("slides.open") }}
        </button>
      </div>
      <!-- 利用可能な WD 一覧 -->
      <div v-if="availableWds.length" class="flex flex-col items-center gap-1 mt-2">
        <div class="text-xs text-gray-500 mb-1">{{ t("slides.available") }}</div>
        <button v-for="wd in availableWds" :key="wd" class="text-sm text-[#4a8acc] hover:text-[#6ab0ee] transition-colors" @click="navigateToWd(wd)">
          {{ wd }}
        </button>
      </div>
      <div v-if="wdLoadError" class="text-xs text-red-400">{{ wdLoadError }}</div>
    </div>

    <!-- ── ロード中 ── -->
    <div v-else-if="loading" class="flex-1 flex items-center justify-center gap-3 text-gray-500">
      <span class="material-icons animate-spin text-xl">refresh</span>
      {{ t("common.loading") }}
    </div>

    <!-- ── エラー ── -->
    <div v-else-if="loadError" class="flex-1 flex flex-col items-center justify-center gap-4 text-gray-400 px-8 text-center">
      <span class="material-icons text-4xl text-red-400">error_outline</span>
      <p class="text-sm">{{ loadError }}</p>
      <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- directional arrow is a decorative UI affordance on the back-navigation button -->
      <button class="text-sm text-[#4a8acc] hover:underline" @click="backToPicker">← {{ t("slides.backToPicker") }}</button>
    </div>

    <!-- ── サムネイル生成待ち ── -->
    <div v-else-if="generating" class="flex-1 flex flex-col items-center justify-center gap-4 text-gray-400 px-8 text-center">
      <span class="material-icons animate-spin text-3xl text-[#4a8acc]">refresh</span>
      <p class="text-sm">{{ t("slides.generatingThumbnails") }}</p>
      <p class="text-xs text-gray-600">
        <!-- eslint-disable @intlify/vue-i18n/no-raw-text -->
        チャットで <code class="bg-[#1a2a44] px-1 rounded">edit-slide {{ wdId }}</code> を実行するとキャッシュが生成されます
        <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
      </p>
      <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- directional arrow is a decorative UI affordance on the back-navigation button -->
      <button class="text-sm text-[#4a8acc] hover:underline" @click="backToPicker">← {{ t("slides.backToPicker") }}</button>
    </div>

    <!-- ── エディタ本体 ── -->
    <template v-else-if="manifest">
      <!-- ヘッダー -->
      <div class="h-10 flex-shrink-0 flex items-center gap-2 px-3 bg-[#0a1830] border-b border-[#1a2a44]">
        <span class="badge-wd">{{ wdId }}</span>
        <span class="badge-ver">v{{ paddedVersion }}</span>
        <span v-if="manifest.rule_label" class="badge-rule">{{ manifest.rule_label }}</span>
        <span class="flex-1 text-xs text-[#8aacd0] overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
          {{ pptxBasename }}
        </span>
        <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- abbreviated unit suffixes (p / sec) in compact header -->
        <span class="text-[10px] text-[#4a6a8a] whitespace-nowrap flex-shrink-0"> {{ manifest.total_pages }}p / {{ manifest.sections?.length ?? 0 }}sec </span>
        <!-- Claude チャットペイン トグル -->
        <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- internal tool; aria-label carries accessible name -->
        <button
          class="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors"
          :class="showChatPane ? 'bg-[#1a3a66] text-[#6aaade]' : 'text-[#3a5a7a] hover:text-[#6a9acc] hover:bg-[#0d1828]'"
          :aria-label="showChatPane ? 'Claude チャットを閉じる' : 'Claude チャットを開く'"
          @click="showChatPane = !showChatPane"
        >
          <span class="material-icons text-sm">chat</span>
        </button>
      </div>

      <!-- ボディ -->
      <div class="flex flex-1 overflow-hidden min-h-0">
        <!-- ─ サイドバー ─ -->
        <div
          ref="sidebarEl"
          class="w-44 flex-shrink-0 bg-[#080e18] border-r border-[#141e2e] overflow-y-auto overflow-x-hidden"
          style="scrollbar-width: thin; scrollbar-color: #2a3a5a transparent"
          @wheel.stop
        >
          <template v-for="(sec, si) in safeSections" :key="si">
            <!-- セクション見出し -->
            <button
              class="w-full flex items-center gap-1.5 px-2 py-1.5 bg-[#0d1828] border-b border-[#141e2e] hover:bg-[#162038] transition-colors text-left"
              @click="toggleSection(si)"
            >
              <span
                class="text-[8px] text-[#4a6a8a] flex-shrink-0 transition-transform duration-150"
                :style="{ transform: collapsedSections.has(si) ? 'rotate(-90deg)' : 'rotate(0deg)' }"
                >▼</span
              >
              <span class="text-[10px] font-bold text-[#8aacd0] flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {{ sec.name }}
              </span>
              <span class="text-[9px] text-[#2a3a5a] flex-shrink-0">{{ sec.slides.length }}p</span>
            </button>

            <!-- スライド一覧 -->
            <div v-if="!collapsedSections.has(si)" class="flex flex-col gap-1 p-1.5">
              <button
                v-for="pageNum in sec.slides"
                :key="pageNum"
                class="rounded overflow-hidden border transition-all text-left w-full"
                :class="
                  currentPage === pageNum
                    ? 'border-[#3a78cc] bg-[#0d2040] shadow-[0_0_0_1px_#3a78cc40]'
                    : 'border-[#1e2e48] bg-[#0a1220] hover:border-[#3a5a88]'
                "
                @click="selectPage(pageNum)"
              >
                <div class="relative">
                  <img :src="thumbUrl(pageNum)" :alt="`p.${pageNum}`" class="w-full object-cover bg-[#141e2e]" loading="lazy" />
                  <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- compact status badge; slides tool is an internal workspace feature -->
                  <div v-if="isCheckedOut(pageNum)" class="absolute inset-0 bg-red-900/60 flex items-center justify-center">
                    <span class="text-[9px] font-bold text-red-200">CO中</span>
                  </div>
                  <!-- dirty ドット（編集済み・キャンバス再生成待ち） -->
                  <div v-if="isDirty(pageNum)" class="absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full bg-yellow-400 shadow" />
                  <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
                </div>
                <div class="px-1.5 py-1 flex items-baseline gap-1">
                  <span class="text-[9px] font-bold text-[#4a6a8a] flex-shrink-0">{{ pageNum }}</span>
                  <span class="text-[9px] text-[#3a5a7a] overflow-hidden text-ellipsis whitespace-nowrap flex-1">
                    {{ pageTitle(pageNum) }}
                  </span>
                </div>
              </button>
            </div>
          </template>
        </div>

        <!-- ─ メインビュー ─ -->
        <div class="flex-1 flex flex-col bg-[#0a0e16] items-center justify-center p-4 gap-3 overflow-hidden" :class="showChatPane ? 'min-w-0' : 'min-w-0'">
          <!-- スライド画像 -->
          <!-- メインビューはページキャンバス（.pagecanvas/）優先。未生成時はサムネイルにフォールバック -->
          <div class="flex-1 w-full min-h-0 flex items-center justify-center relative">
            <img
              :src="mainImgUrl(currentPage)"
              :alt="`p.${currentPage}`"
              class="max-w-full max-h-full object-contain rounded shadow-2xl"
              style="box-shadow: 0 10px 50px rgba(0, 0, 0, 0.75)"
              @error="onMainImgError(currentPage)"
            />
            <!-- チェックアウト中バナー -->
            <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- status banner for internal slide editing tool -->
            <div
              v-if="isCheckedOut(currentPage)"
              class="absolute top-0 left-0 right-0 bg-red-800/90 text-white text-xs font-bold text-center py-1.5 rounded-t pointer-events-none"
            >
              🔒 チェックアウト中
            </div>
            <!-- dirty バナー（次回チェックアウト時にページキャンバス再生成予定） -->
            <div
              v-if="isDirty(currentPage)"
              class="absolute bottom-0 left-0 right-0 bg-yellow-700/80 text-yellow-100 text-[10px] font-bold text-center py-1 rounded-b pointer-events-none"
            >
              ✏ 編集済み — 次回 checkout でキャンバス更新
            </div>
            <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
          </div>

          <!-- ページ情報 + ナビ -->
          <div class="w-full flex items-center gap-3 flex-shrink-0">
            <span class="text-sm font-bold text-[#3a78cc] tabular-nums flex-shrink-0"> {{ currentPage }} / {{ manifest.total_pages }} </span>
            <span class="text-xs text-[#6a8aaa] flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
              {{ pageTitle(currentPage) }}
            </span>
            <div class="flex gap-1.5 flex-shrink-0">
              <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- purely decorative arrows, aria-label carries accessible name -->
              <button class="nav-btn" :disabled="currentPage <= 1" :aria-label="t('slides.prevPage')" @click="selectPage(currentPage - 1)">◀</button>
              <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- purely decorative arrows, aria-label carries accessible name -->
              <button class="nav-btn" :disabled="currentPage >= manifest.total_pages" :aria-label="t('slides.nextPage')" @click="selectPage(currentPage + 1)">
                ▶
              </button>
            </div>
          </div>
        </div>

        <!-- ─ Claude チャットペイン ─ -->
        <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- internal slide-editing tool; not subject to i18n -->
        <div v-if="showChatPane" class="chat-pane flex-shrink-0 flex flex-col bg-[#080e18] border-l border-[#141e2e]">
          <!-- ペインヘッダー -->
          <div class="h-9 flex-shrink-0 flex items-center gap-1.5 px-3 bg-[#0a1020] border-b border-[#141e2e]">
            <span class="material-icons text-sm text-[#3a78cc]">chat</span>
            <span class="text-[11px] font-bold text-[#6a9acc] flex-1">Claude に指示</span>
            <button class="text-[#2a3a5a] hover:text-[#6a9acc] transition-colors" aria-label="チャットを閉じる" @click="showChatPane = false">
              <span class="material-icons text-sm">close</span>
            </button>
          </div>

          <!-- コンテキスト表示 -->
          <div class="px-3 py-1.5 bg-[#060b14] border-b border-[#0d1628] text-[9px] text-[#2a4a6a] leading-tight">
            <span class="text-[#3a5a7a]">WD:</span> {{ wdId }}
            <span class="text-[#2a3a5a] mx-1">·</span>
            <span class="text-[#3a5a7a]">p.</span>{{ currentPage }}
            <template v-if="pageTitle(currentPage)">
              <span class="text-[#2a3a5a] mx-1">·</span>
              <span class="text-[#3a607a] overflow-hidden text-ellipsis whitespace-nowrap">{{ pageTitle(currentPage) }}</span>
            </template>
          </div>

          <!-- メッセージリスト -->
          <div
            ref="chatMessagesEl"
            class="flex-1 overflow-y-auto p-2 flex flex-col gap-2 min-h-0"
            style="scrollbar-width: thin; scrollbar-color: #1a2a3a transparent"
          >
            <div v-if="recentChatMessages.length === 0" class="flex flex-col items-center justify-center h-full gap-2 text-center px-3">
              <span class="material-icons text-2xl text-[#1a2a3a]">forum</span>
              <p class="text-[10px] text-[#2a3a5a]">スライドについて Claude に質問・指示できます</p>
            </div>
            <template v-for="msg in recentChatMessages" :key="msg.uuid">
              <div :class="msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'">
                <div
                  :class="[
                    'max-w-[90%] px-2.5 py-1.5 rounded-lg text-[11px] break-words leading-relaxed whitespace-pre-wrap',
                    msg.role === 'user' ? 'bg-[#0f2a50] text-[#a0c4e8] border border-[#1a3a6a]' : 'bg-[#0c1620] text-[#8ab0cc] border border-[#111e2e]',
                  ]"
                >
                  {{ msg.text }}
                </div>
              </div>
            </template>
            <!-- 実行中インジケーター -->
            <div v-if="agentRunning" class="flex justify-start">
              <div class="bg-[#0c1620] border border-[#111e2e] px-2.5 py-1.5 rounded-lg">
                <span class="text-[10px] text-[#3a6a8a] animate-pulse">● 考えています…</span>
              </div>
            </div>
          </div>

          <!-- クイックアクション -->
          <div class="px-2 py-1.5 flex flex-wrap gap-1 border-t border-[#0d1628]">
            <button
              v-for="hint in QUICK_HINTS"
              :key="hint"
              class="text-[9px] bg-[#0a1420] hover:bg-[#0f1e30] text-[#3a5a7a] hover:text-[#6a9acc] px-2 py-0.5 rounded border border-[#0f1e30] hover:border-[#1a2a44] transition-colors"
              :disabled="agentRunning"
              @click="sendQuickHint(hint)"
            >
              {{ hint }}
            </button>
          </div>

          <!-- 入力エリア -->
          <div class="px-2 pb-2 pt-1 flex-shrink-0">
            <div class="flex gap-1 items-end">
              <textarea
                ref="chatInputEl"
                v-model="chatInput"
                class="flex-1 bg-[#0a1420] border border-[#0f1e30] focus:border-[#1a3a66] rounded text-[11px] text-[#a0c0dc] placeholder-[#1a2a3a] px-2 py-1.5 resize-none focus:outline-none transition-colors"
                rows="3"
                placeholder="指示を入力… (Ctrl+Enter で送信)"
                @keydown.ctrl.enter.prevent="sendChatMessage"
                @keydown.meta.enter.prevent="sendChatMessage"
              />
              <button
                class="flex-shrink-0 self-end p-1.5 rounded bg-[#1a4a8a] hover:bg-[#2a5a9a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                :disabled="!chatInput.trim() || agentRunning"
                aria-label="送信"
                @click="sendChatMessage"
              >
                <span class="material-icons text-sm text-white">send</span>
              </button>
            </div>
          </div>
        </div>
        <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { PAGE_ROUTES } from "../router/pageRoutes";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { useAppApi } from "../composables/useAppApi";
import { useActiveSession } from "../composables/useActiveSession";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const appApi = useAppApi();
const activeSessionRef = useActiveSession();

// ── Types ──────────────────────────────────────────────────────────────────

interface SlidePageInfo {
  md: string | null;
  sm: string | null;
  hash: string;
  checked_out: boolean;
  checkout_by: string | null;
  dirty?: boolean;
  title?: string;
}

interface SlideSection {
  name: string;
  slides: number[];
}

interface SlideManifest {
  pptx: string;
  version: number;
  total_pages: number;
  generated_at: string;
  rule?: number;
  rule_label?: string;
  sections?: SlideSection[];
  pages: Record<string, SlidePageInfo>;
}

// Matches the server's TreeNode shape returned by /api/files/dir
interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

// ── State ───────────────────────────────────────────────────────────────────

const wdInput = ref("");
const availableWds = ref<string[]>([]);
const wdLoadError = ref<string | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);
const generating = ref(false);
const manifest = ref<SlideManifest | null>(null);
const currentPage = ref(1);
const collapsedSections = ref(new Set<number>());
const sidebarEl = ref<HTMLDivElement | null>(null);
// ページキャンバス（.pagecanvas/）の読み込みに失敗したページ番号セット
// 失敗したページはサムネイル（.thumbcache/）にフォールバックする
const canvasFailed = ref(new Set<number>());

// ── Chat pane state ──────────────────────────────────────────────────────────

const showChatPane = ref(false);
const chatInput = ref("");
const chatMessagesEl = ref<HTMLDivElement | null>(null);
const chatInputEl = ref<HTMLTextAreaElement | null>(null);

const QUICK_HINTS = ["このページを説明して", "テキストを修正して", "レイアウトを改善して", "図解にして"] as const;

/** 現在のセッションが実行中かどうか */
const agentRunning = computed(() => activeSessionRef?.value?.isRunning ?? false);

interface ChatMessage {
  uuid: string;
  role: "user" | "assistant";
  text: string;
}

function isTextResponseEntry(result: { toolName: string; data?: unknown }): boolean {
  if (result.toolName !== "text-response") return false;
  const roleData = result.data as { role?: string } | undefined;
  return roleData?.role === "user" || roleData?.role === "assistant";
}

function toTextResponseMessage(result: { uuid: string; message: string; data?: unknown }): ChatMessage {
  const roleData = result.data as { role: string; text?: string };
  return { uuid: result.uuid, role: roleData.role as "user" | "assistant", text: roleData.text ?? result.message ?? "" };
}

/** アクティブセッションから最新20件のテキストメッセージを返す */
const recentChatMessages = computed<ChatMessage[]>(() => {
  const session = activeSessionRef?.value;
  if (!session) return [];
  return session.toolResults.filter(isTextResponseEntry).slice(-20).map(toTextResponseMessage);
});

// メッセージ追加時に自動スクロール
watch(recentChatMessages, () => {
  void nextTick(() => {
    if (chatMessagesEl.value) {
      chatMessagesEl.value.scrollTop = chatMessagesEl.value.scrollHeight;
    }
  });
});

// チャットペインが開いたとき入力欄にフォーカス
watch(showChatPane, (open) => {
  if (open) {
    void nextTick(() => chatInputEl.value?.focus());
  }
});

let pollTimer: ReturnType<typeof setInterval> | null = null;

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling(wdDir: string): void {
  stopPolling();
  pollTimer = setInterval(() => {
    void tryLoadManifestSilent(wdDir);
  }, 3000);
}

// ── Route binding ────────────────────────────────────────────────────────────

const wdId = computed<string | null>(() => {
  const param = route.params.wdId;
  return typeof param === "string" && param.length > 0 ? param : null;
});

// Derived display values
const paddedVersion = computed(() => (manifest.value ? String(manifest.value.version).padStart(3, "0") : ""));
const pptxBasename = computed(() => (manifest.value ? manifest.value.pptx.replace(/\.pptx$/i, "") : ""));

// Sections with fallback when none defined
const safeSections = computed<SlideSection[]>(() => {
  if (!manifest.value) return [];
  if (manifest.value.sections && manifest.value.sections.length > 0) {
    return manifest.value.sections;
  }
  // Fallback: one section containing all pages
  return [
    {
      name: "スライド",
      slides: Array.from({ length: manifest.value.total_pages }, (_, i) => i + 1),
    },
  ];
});

// ── Navigation ───────────────────────────────────────────────────────────────

function navigateToWd(wdItem: string): void {
  router.push({ name: PAGE_ROUTES.slides, params: { wdId: wdItem } }).catch(() => {});
}

function openWd(): void {
  const wdValue = wdInput.value.trim();
  if (wdValue) navigateToWd(wdValue);
}

function backToPicker(): void {
  router.push({ name: PAGE_ROUTES.slides }).catch(() => {});
}

function selectPage(page: number): void {
  if (!manifest.value) return;
  if (page < 1 || page > manifest.value.total_pages) return;
  currentPage.value = page;
}

function toggleSection(idx: number): void {
  if (collapsedSections.value.has(idx)) {
    collapsedSections.value.delete(idx);
  } else {
    collapsedSections.value.add(idx);
  }
  // Trigger reactivity (Set mutations aren't tracked automatically)
  collapsedSections.value = new Set(collapsedSections.value);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function thumbUrl(page: number): string {
  if (!manifest.value || !wdId.value) return "";
  const verPad = String(manifest.value.version).padStart(3, "0");
  const pagePad = String(page).padStart(3, "0");
  const path = `data/work/${wdId.value}/.thumbcache/v${verPad}/p${pagePad}_md.png`;
  return `${API_ROUTES.files.raw}?path=${encodeURIComponent(path)}`;
}

/** ページキャンバス（PowerPoint 生成・高解像度）の URL */
function canvasUrl(page: number): string {
  if (!manifest.value || !wdId.value) return "";
  const verPad = String(manifest.value.version).padStart(3, "0");
  const pagePad = String(page).padStart(3, "0");
  const path = `data/work/${wdId.value}/.pagecanvas/v${verPad}/p${pagePad}.png`;
  return `${API_ROUTES.files.raw}?path=${encodeURIComponent(path)}`;
}

/**
 * メインビュー用 URL。ページキャンバスを優先し、
 * 未生成 or 読み込み失敗時はサムネイルにフォールバックする。
 */
function mainImgUrl(page: number): string {
  return canvasFailed.value.has(page) ? thumbUrl(page) : canvasUrl(page);
}

function onMainImgError(page: number): void {
  canvasFailed.value.add(page);
  // Set の変更は Vue がトラックしないため新しい Set を代入してリアクティビティを発火
  canvasFailed.value = new Set(canvasFailed.value);
}

function pageTitle(page: number): string {
  return manifest.value?.pages[String(page)]?.title ?? "";
}

function isCheckedOut(page: number): boolean {
  return manifest.value?.pages[String(page)]?.checked_out ?? false;
}

function isDirty(page: number): boolean {
  return manifest.value?.pages[String(page)]?.dirty ?? false;
}

// ── Chat helpers ─────────────────────────────────────────────────────────────

/** 現在のスライドコンテキストをメッセージの先頭に付与する文字列を返す */
function buildSlideContext(): string {
  if (!manifest.value || !wdId.value) return "";
  const title = pageTitle(currentPage.value);
  const titlePart = title ? ` / タイトル: 「${title}」` : "";
  return `[スライド編集] WD: ${wdId.value} v${paddedVersion.value} / p.${currentPage.value}/${manifest.value.total_pages}${titlePart}\n\n`;
}

function sendChatMessage(): void {
  const text = chatInput.value.trim();
  if (!text || agentRunning.value) return;
  appApi.sendMessage(buildSlideContext() + text);
  chatInput.value = "";
}

function sendQuickHint(hint: string): void {
  if (agentRunning.value) return;
  appApi.sendMessage(buildSlideContext() + hint);
}

// ── Data loading ──────────────────────────────────────────────────────────────

/** Silently attempt to read manifest (used during polling). Returns true on success. */
async function tryLoadManifestSilent(wdDir: string): Promise<boolean> {
  try {
    const cacheDir = `data/work/${wdDir}/.thumbcache`;
    const dirRes = await apiGet<TreeNode>(`${API_ROUTES.files.dir}?path=${encodeURIComponent(cacheDir)}`);
    if (!dirRes.ok) return false;

    const versions = (dirRes.data.children ?? [])
      .filter((entry) => entry.type === "dir" && /^v\d{3}$/.test(entry.name))
      .map((entry) => parseInt(entry.name.slice(1), 10))
      .sort((left, right) => right - left);
    if (versions.length === 0) return false;

    const latestV = String(versions[0]).padStart(3, "0");
    const manifestPath = `${cacheDir}/v${latestV}/manifest.json`;
    const manifestRes = await apiGet<{ kind: string; content: string }>(`${API_ROUTES.files.content}?path=${encodeURIComponent(manifestPath)}`);
    if (!manifestRes.ok) return false;

    manifest.value = JSON.parse(manifestRes.data.content) as SlideManifest;
    currentPage.value = 1;
    collapsedSections.value = new Set();
    generating.value = false;
    stopPolling();
    return true;
  } catch {
    return false;
  }
}

async function loadManifest(wdDir: string): Promise<void> {
  loading.value = true;
  loadError.value = null;
  generating.value = false;
  manifest.value = null;
  stopPolling();

  try {
    // Find highest version directory in .thumbcache/
    // /api/files/dir returns a TreeNode with children[] (type:"dir"|"file")
    const cacheDir = `data/work/${wdDir}/.thumbcache`;
    const dirRes = await apiGet<TreeNode>(`${API_ROUTES.files.dir}?path=${encodeURIComponent(cacheDir)}`);
    if (!dirRes.ok) {
      generating.value = true;
      startPolling(wdDir);
      return;
    }

    const versions = (dirRes.data.children ?? [])
      .filter((entry) => entry.type === "dir" && /^v\d{3}$/.test(entry.name))
      .map((entry) => parseInt(entry.name.slice(1), 10))
      .sort((left, right) => right - left);

    if (versions.length === 0) {
      generating.value = true;
      startPolling(wdDir);
      return;
    }

    const latestV = String(versions[0]).padStart(3, "0");
    const manifestPath = `${cacheDir}/v${latestV}/manifest.json`;

    // /api/files/content returns { kind:"text", content: string, ... }
    const manifestRes = await apiGet<{ kind: string; content: string }>(`${API_ROUTES.files.content}?path=${encodeURIComponent(manifestPath)}`);
    if (!manifestRes.ok) {
      generating.value = true;
      startPolling(wdDir);
      return;
    }

    manifest.value = JSON.parse(manifestRes.data.content) as SlideManifest;
    currentPage.value = 1;
    collapsedSections.value = new Set();
  } finally {
    loading.value = false;
  }
}

async function loadAvailableWds(): Promise<void> {
  wdLoadError.value = null;
  const res = await apiGet<TreeNode>(`${API_ROUTES.files.dir}?path=${encodeURIComponent("data/work")}`);
  if (!res.ok) return;
  const WD_ID_PATTERN = /^[A-Z]+-\d{5}$/;
  availableWds.value = (res.data.children ?? [])
    .filter((entry) => entry.type === "dir" && WD_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

// ── Watchers ──────────────────────────────────────────────────────────────────

watch(
  wdId,
  (wdVal) => {
    stopPolling();
    generating.value = false;
    canvasFailed.value = new Set(); // WD 切り替え時はフォールバック状態をリセット
    if (wdVal) {
      void loadManifest(wdVal);
    } else {
      manifest.value = null;
      loadError.value = null;
    }
  },
  { immediate: true },
);

onMounted(() => {
  void loadAvailableWds();
});

onUnmounted(() => {
  stopPolling();
});
</script>

<style scoped>
@reference "../index.css";

/* ── バッジ ── */
.badge-wd {
  @apply flex-shrink-0 text-[10px] font-bold bg-[#1a3a66] text-[#6aaade] px-1.5 py-0.5 rounded;
}
.badge-ver {
  @apply flex-shrink-0 text-[10px] bg-[#0e2638] text-[#4a8acc] px-1.5 py-0.5 rounded;
}
.badge-rule {
  @apply flex-shrink-0 text-[10px] bg-[#1a2a44] text-[#6a8aaa] px-1.5 py-0.5 rounded;
}

/* ── ナビボタン ── */
.nav-btn {
  @apply text-[11px] bg-[#1a2a44] hover:bg-[#2a3a66] text-[#6a9acc] px-2.5 py-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed;
}

/* ── Claude チャットペイン ── */
.chat-pane {
  width: 280px;
  min-width: 240px;
  max-width: 360px;
  scrollbar-width: thin;
  scrollbar-color: #1a2a3a transparent;
}
</style>
