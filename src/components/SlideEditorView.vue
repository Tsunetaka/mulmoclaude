<template>
  <div class="h-full flex flex-col bg-[#0d1220] text-white select-none overflow-hidden">
    <!-- ── WD 未選択: work-files にリダイレクト中 ── -->
    <div v-if="!wdId" class="flex-1 flex items-center justify-center">
      <span class="material-icons animate-spin text-xl text-gray-600">refresh</span>
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

    <!-- ── データ待ち（新構造の再オンボード / 生成待ち） ── -->
    <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- internal slide-editing tool; not subject to i18n -->
    <div v-else-if="waiting" class="flex-1 flex flex-col items-center justify-center gap-4 text-gray-400 px-8 w-full max-w-lg mx-auto text-center">
      <span class="material-icons animate-spin text-3xl text-[#4a8acc]">refresh</span>
      <p class="text-sm font-semibold text-[#8aacd0]">スライドデータを待っています…</p>
      <p class="text-xs text-[#3a5a7a]">
        この WD にはまだ編集用バージョン（v001 など）がありません。<br />チェックアウト / 分割 / 新規作成で生成されると自動で表示されます。
      </p>
      <button class="text-sm text-[#4a8acc] hover:underline mt-2" @click="backToPicker">← {{ t("slides.backToPicker") }}</button>
    </div>
    <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->

    <!-- ── エディタ本体 ── -->
    <template v-else-if="deck">
      <!-- ヘッダー -->
      <div class="h-10 flex-shrink-0 flex items-center gap-2 px-3 bg-[#0a1830] border-b border-[#1a2a44]">
        <span class="badge-wd">{{ wdId }}</span>
        <span class="badge-ver">{{ deck.version }}</span>
        <span
          v-if="sourceLabel"
          class="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-[#0d1828] text-[#5a7aa0] border border-[#1a2a44] whitespace-nowrap"
          :title="sourceLabel"
        >
          {{ sourceLabel }}
        </span>
        <span class="flex-1 min-w-0"></span>
        <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- abbreviated unit suffixes (p / sec) in compact header -->
        <span class="text-[10px] text-[#4a6a8a] whitespace-nowrap flex-shrink-0"> {{ deck.totalPages }}p / {{ deck.sections.length }}sec </span>
        <!-- 操作系コントロール（canvas 更新・チャットトグル・テーマ）は上部リボン
             （SlideEditorRibbon）に集約する。ここには識別バッジと概要のみを置く。 -->
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
          <template v-for="(sec, si) in deck.sections" :key="si">
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
              <span class="text-[9px] text-[#2a3a5a] flex-shrink-0">{{ sec.pages.length }}p</span>
            </button>

            <!-- スライド一覧 -->
            <div v-if="!collapsedSections.has(si)" class="flex flex-col gap-1 p-1.5">
              <button
                v-for="page in sec.pages"
                :key="page.id"
                class="rounded overflow-hidden border transition-all text-left w-full"
                :class="
                  currentId === page.id ? 'border-[#3a78cc] bg-[#0d2040] shadow-[0_0_0_1px_#3a78cc40]' : 'border-[#1e2e48] bg-[#0a1220] hover:border-[#3a5a88]'
                "
                @click="selectId(page.id)"
              >
                <div class="relative">
                  <img :src="thumbUrl(page)" :alt="`p.${page.pageNo}`" class="w-full object-cover bg-[#141e2e]" loading="lazy" />
                  <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- compact status badge; slides tool is an internal workspace feature -->
                  <div v-if="page.checkedOut" class="absolute inset-0 bg-red-900/60 flex items-center justify-center">
                    <span class="text-[9px] font-bold text-red-200">CO中</span>
                  </div>
                  <!-- dirty ドット（編集済み・キャンバス再生成待ち） -->
                  <div v-if="page.dirty" class="absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full bg-yellow-400 shadow" />
                  <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
                </div>
                <div class="px-1.5 py-1 flex items-baseline gap-1">
                  <span class="text-[9px] font-bold text-[#4a6a8a] flex-shrink-0">{{ page.pageNo }}</span>
                  <span class="text-[9px] text-[#3a5a7a] overflow-hidden text-ellipsis whitespace-nowrap flex-1">
                    {{ page.title }}
                  </span>
                </div>
              </button>
            </div>
          </template>
        </div>

        <!-- ─ メインビュー ─ -->
        <div class="flex-1 flex flex-col bg-[#0a0e16] items-center justify-center p-4 gap-3 overflow-hidden min-w-0">
          <!-- スライド画像 -->
          <!-- メインビューはページキャンバス（.pagecanvas/）優先。未生成時はサムネイルにフォールバック -->
          <div v-if="currentPage" class="flex-1 w-full min-h-0 flex items-center justify-center relative">
            <img
              :src="mainImgUrl(currentPage)"
              :alt="`p.${currentPage.pageNo}`"
              class="h-full max-w-full w-auto object-contain rounded shadow-2xl"
              style="box-shadow: 0 10px 50px rgba(0, 0, 0, 0.75)"
              @error="onMainImgError(currentPage.id)"
            />
            <!-- チェックアウト中バナー -->
            <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- status banner for internal slide editing tool -->
            <div
              v-if="currentPage.checkedOut"
              class="absolute top-0 left-0 right-0 bg-red-800/90 text-white text-xs font-bold text-center py-1.5 rounded-t pointer-events-none"
            >
              🔒 チェックアウト中{{ currentPage.checkoutBy ? `（${currentPage.checkoutBy}）` : "" }}
            </div>
            <!-- dirty バナー（サムネで暫定表示中・クリックで canvas 更新を促す） -->
            <button
              v-if="currentPage.dirty"
              class="absolute bottom-0 left-0 right-0 bg-yellow-700/85 text-yellow-50 text-[10px] font-bold text-center py-1 rounded-b hover:bg-yellow-600/90 transition-colors cursor-pointer"
              @click="openRefreshModal"
            >
              ✏ 編集をサムネで表示中 — クリックで canvas 更新（高解像度で反映）
            </button>
            <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
          </div>

          <!-- ページ情報 + ナビ -->
          <div v-if="currentPage" class="w-full flex items-center gap-3 flex-shrink-0">
            <span class="text-sm font-bold text-[#3a78cc] tabular-nums flex-shrink-0"> {{ currentPage.pageNo }} / {{ deck.totalPages }} </span>
            <span class="text-xs text-[#6a8aaa] flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
              {{ currentPage.title }}
            </span>
            <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- purely decorative nav arrows; aria-label carries the accessible name -->
            <div class="flex gap-1.5 flex-shrink-0">
              <button class="nav-btn" :disabled="currentIndex <= 0" :aria-label="t('slides.prevPage')" @click="selectByIndex(currentIndex - 1)">◀</button>
              <button
                class="nav-btn"
                :disabled="currentIndex >= deck.totalPages - 1"
                :aria-label="t('slides.nextPage')"
                @click="selectByIndex(currentIndex + 1)"
              >
                ▶
              </button>
            </div>
            <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
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
          <div v-if="currentPage" class="px-3 py-1.5 bg-[#060b14] border-b border-[#0d1628] text-[9px] text-[#2a4a6a] leading-tight">
            <span class="text-[#3a5a7a]">WD:</span> {{ wdId }}
            <span class="text-[#2a3a5a] mx-1">·</span>
            <span class="text-[#3a5a7a]">p.</span>{{ currentPage.pageNo }}
            <template v-if="currentPage.title">
              <span class="text-[#2a3a5a] mx-1">·</span>
              <span class="text-[#3a607a] overflow-hidden text-ellipsis whitespace-nowrap">{{ currentPage.title }}</span>
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

    <!-- ── canvas 更新モーダル（COM ページキャンバス再生成・SSE） ── -->
    <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- internal slide-editing tool; not subject to i18n -->
    <div v-if="refreshModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="closeRefreshModal">
      <div class="w-[32rem] max-w-[90vw] bg-[#0d1526] border border-[#1a2a44] rounded-lg shadow-2xl overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-2.5 bg-[#0a1830] border-b border-[#1a2a44]">
          <span class="material-icons text-sm text-[#4a8acc]">refresh</span>
          <span class="text-sm font-bold text-[#8aacd0] flex-1">ページキャンバスを更新</span>
          <button
            class="text-[#3a5a7a] hover:text-[#6a9acc] disabled:opacity-30"
            :disabled="refreshPhase === 'running'"
            aria-label="閉じる"
            @click="closeRefreshModal"
          >
            <span class="material-icons text-sm">close</span>
          </button>
        </div>

        <!-- 確認フェーズ -->
        <div v-if="refreshPhase === 'confirm'" class="px-4 py-3 space-y-3 text-[#8aacd0]">
          <p class="text-xs leading-relaxed">
            <span v-if="dirtyCount > 0"
              ><b class="text-yellow-300">{{ dirtyCount }} ページ</b>が再生成待ちです。</span
            >
            <span v-else>再生成待ちのページはありません（全ページ再生成は下のチェックを入れてください）。</span>
          </p>
          <div class="flex items-start gap-2 bg-[#2a1a0a] border border-[#5a3a10] rounded px-3 py-2">
            <span class="material-icons text-sm text-yellow-500 mt-0.5">warning</span>
            <p class="text-[11px] text-yellow-200 leading-relaxed">
              PowerPoint(COM)で描画します。実行前に <b>PowerPoint をすべて終了</b>してください（起動中は中止されます）。
            </p>
          </div>
          <label class="flex items-center gap-2 text-[11px] text-[#6a8aaa] cursor-pointer">
            <input v-model="refreshFull" type="checkbox" class="accent-[#3a78cc]" />
            全ページを強制再生成（dirty でないページも含む）
          </label>
        </div>

        <!-- SSE ログ -->
        <div
          v-else
          class="px-4 py-3 font-mono text-[11px] text-[#7aa0c0] bg-[#060b14] max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed"
          style="scrollbar-width: thin; scrollbar-color: #1a2a3a transparent"
        >
          <div v-for="(line, i) in refreshLog" :key="i">{{ line }}</div>
          <div v-if="refreshPhase === 'running'" class="text-yellow-300 animate-pulse">処理中...</div>
        </div>

        <!-- フッター -->
        <div class="flex justify-end gap-2 px-4 py-2.5 bg-[#0a1220] border-t border-[#1a2a44]">
          <button
            v-if="refreshPhase === 'confirm'"
            class="px-3 py-1.5 rounded text-xs text-[#8aacd0] bg-[#16233c] hover:bg-[#1e2e48]"
            @click="closeRefreshModal"
          >
            キャンセル
          </button>
          <button v-if="refreshPhase === 'confirm'" class="px-3 py-1.5 rounded text-xs text-white bg-[#1a4a8a] hover:bg-[#2a5a9a]" @click="runCanvasRefresh">
            更新を実行
          </button>
          <button v-if="refreshPhase === 'done'" class="px-3 py-1.5 rounded text-xs text-white bg-[#1a4a8a] hover:bg-[#2a5a9a]" @click="closeRefreshModal">
            閉じる
          </button>
        </div>
      </div>
    </div>

    <!-- テーマ適用モーダル（Phase2・全ページ配色再適用の進捗） -->
    <div v-if="themeModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="closeThemeModal">
      <div class="w-[32rem] max-w-[90vw] bg-[#0d1526] border border-[#1a2a44] rounded-lg shadow-2xl overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-2.5 bg-[#0a1830] border-b border-[#1a2a44]">
          <span class="material-icons text-sm text-[#4a8acc]">palette</span>
          <span class="text-sm font-bold text-[#8aacd0] flex-1">テーマ「{{ pendingTheme }}」を適用中</span>
          <button
            class="text-[#3a5a7a] hover:text-[#6a9acc] disabled:opacity-30"
            :disabled="themePhase === 'running'"
            aria-label="閉じる"
            @click="closeThemeModal"
          >
            <span class="material-icons text-sm">close</span>
          </button>
        </div>

        <!-- SSE ログ -->
        <div
          class="px-4 py-3 font-mono text-[11px] text-[#7aa0c0] bg-[#060b14] max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed"
          style="scrollbar-width: thin; scrollbar-color: #1a2a3a transparent"
        >
          <div v-for="(line, i) in themeLog" :key="i">{{ line }}</div>
          <div v-if="themePhase === 'running'" class="text-yellow-300 animate-pulse">配色を適用中...</div>
          <div v-if="themePhase === 'done'" class="text-green-300">完了しました。高解像度の反映は「canvas 更新」で行ってください。</div>
        </div>

        <!-- フッター -->
        <div class="flex justify-end gap-2 px-4 py-2.5 bg-[#0a1220] border-t border-[#1a2a44]">
          <button v-if="themePhase !== 'running'" class="px-3 py-1.5 rounded text-xs text-white bg-[#1a4a8a] hover:bg-[#2a5a9a]" @click="closeThemeModal">
            閉じる
          </button>
        </div>
      </div>
    </div>
    <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { PAGE_ROUTES } from "../router/pageRoutes";
import { apiGet, apiFetchRaw } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { useAppApi } from "../composables/useAppApi";
import { useActiveSession } from "../composables/useActiveSession";
import { useSlideEditor } from "../composables/useSlideEditor";
import { parseVersionDirs, isVersionName, buildDeck, type SlideStructure, type SlideManifest, type DeckModel, type DeckPage } from "../utils/slides/slideDeck";
import { SLIDE_ROLE_ID } from "../utils/slides/newDeck";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const appApi = useAppApi();
const activeSessionRef = useActiveSession();
const slideEditor = useSlideEditor();

// Matches the server's TreeNode shape returned by /api/files/dir
interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

// ── State ───────────────────────────────────────────────────────────────────

const loading = ref(false);
const loadError = ref<string | null>(null);
const waiting = ref(false); // 編集用バージョン未生成 → ポーリング待機
const deck = ref<DeckModel | null>(null);
const version = ref<string>(""); // 開いている version フォルダ名（例: v001）
const sourcePptx = ref<string>(""); // structure.source.from（派生元の版名 or 元 pptx 名）
const sourceKind = ref<string>(""); // structure.source.kind（"released" | "editing" | …）
const currentId = ref<string>("");
const collapsedSections = ref(new Set<number>());
const sidebarEl = ref<HTMLDivElement | null>(null);
// ページキャンバス（.pagecanvas/）の読み込みに失敗したページ ID セット。
// 失敗したページはサムネイル（.thumbcache/）にフォールバックする。
const canvasFailed = ref(new Set<string>());
// canvas 更新後に画像 URL を強制再取得させるためのキャッシュバスター。
const reloadNonce = ref(0);

// ── canvas 更新モーダル（COM ページキャンバス再生成・SSE） ─────────────────────
const refreshModalOpen = ref(false);
const refreshPhase = ref<"confirm" | "running" | "done">("confirm");
const refreshFull = ref(false);
const refreshLog = ref<string[]>([]);

// ── テーマ適用モーダル（Phase2・全ページ配色再適用・SSE） ─────────────────────
const themeModalOpen = ref(false);
const themePhase = ref<"running" | "done" | "error">("running");
const themeLog = ref<string[]>([]);
const pendingTheme = ref<string>("");

/** dirty（canvas 再生成待ち）ページ数。ヘッダーバッジと確認文言に使う。 */
const dirtyCount = computed<number>(() => deck.value?.pages.filter((page) => page.dirty).length ?? 0);

// ── Chat pane state ──────────────────────────────────────────────────────────

// The slide-editor chat pane always runs on the "slide" role
// (SLIDE_ROLE_ID, shared via utils/slides/newDeck). sendMessageAs
// forces a session bound to this role without navigating off /slides.

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
    void loadDeckSilent(wdDir);
  }, 3000);
}

// ── Route binding ────────────────────────────────────────────────────────────

const wdId = computed<string | null>(() => {
  const param = route.params.wdId;
  return typeof param === "string" && param.length > 0 ? param : null;
});

// 選択画面から `?version=v002` で開きたい版を指定できる。存在すればその版を、
// 無ければ最新版を開く（discoverVersion 内で解決）。未指定なら最新。
const requestedVersion = computed<string | null>(() => {
  const query = route.query.version;
  const value = Array.isArray(query) ? query[0] : query;
  return typeof value === "string" && isVersionName(value) ? value : null;
});

const pptxBasename = computed(() => sourcePptx.value.replace(/\.pptx$/i, ""));

// 派生元ラベル。現在編集中の版番号（deck.version）と紛らわしくならないよう、
// 3 つ目のバッジは必ず「元: …」と前置きして "派生元" であることを明示する。
// released 由来 = 元リリース版 / editing 由来 = 元編集版。
const sourceLabel = computed(() => {
  const from = pptxBasename.value;
  if (!from) return "";
  const origin = sourceKind.value === "released" ? "元リリース" : sourceKind.value === "editing" ? "元編集" : "元";
  return `${origin}: ${from}`;
});

// ── Current-page derivation (id-native) ───────────────────────────────────────

const currentPage = computed<DeckPage | null>(() => {
  if (!deck.value) return null;
  return deck.value.pages.find((page) => page.id === currentId.value) ?? deck.value.pages[0] ?? null;
});

const currentIndex = computed<number>(() => {
  if (!deck.value) return -1;
  return deck.value.pages.findIndex((page) => page.id === currentId.value);
});

// ── Navigation ───────────────────────────────────────────────────────────────

function backToPicker(): void {
  router.back();
}

function selectId(pageId: string): void {
  currentId.value = pageId;
}

function selectByIndex(index: number): void {
  if (!deck.value) return;
  const page = deck.value.pages[index];
  if (page) currentId.value = page.id;
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

// ── URL helpers ────────────────────────────────────────────────────────────────

function versionBase(): string {
  return `data/work/${wdId.value}/${version.value}`;
}

function rawUrl(path: string): string {
  return `${API_ROUTES.files.raw}?path=${encodeURIComponent(path)}`;
}

/** 画像 URL にキャッシュバスターを付与（canvas 更新後の再取得用）。 */
function imgUrl(path: string): string {
  const base = rawUrl(path);
  return reloadNonce.value > 0 ? `${base}&_=${reloadNonce.value}` : base;
}

function thumbUrl(page: DeckPage): string {
  if (!wdId.value || !version.value) return "";
  const file = page.thumb ?? `${page.id}_md.png`;
  return imgUrl(`${versionBase()}/.thumbcache/${file}`);
}

/** ページキャンバス（PowerPoint 生成・高解像度）の URL */
function canvasUrl(page: DeckPage): string {
  if (!wdId.value || !version.value) return "";
  const file = page.canvas ?? `${page.id}.png`;
  return imgUrl(`${versionBase()}/.pagecanvas/${file}`);
}

/**
 * メインビュー用 URL。通常はページキャンバス（高解像度）を優先し、
 * 未生成 or 読み込み失敗時はサムネイルにフォールバックする。
 * dirty ページは canvas が古い（COM 未更新）ため、更新済みサムネを優先表示して
 * 編集内容を即座に見せる（canvas 更新で高解像度に置き換わる）。
 */
function mainImgUrl(page: DeckPage): string {
  if (page.dirty) return thumbUrl(page);
  return canvasFailed.value.has(page.id) ? thumbUrl(page) : canvasUrl(page);
}

function onMainImgError(pageId: string): void {
  canvasFailed.value.add(pageId);
  // Set の変更は Vue がトラックしないため新しい Set を代入してリアクティビティを発火
  canvasFailed.value = new Set(canvasFailed.value);
}

// ── canvas 更新（COM ページキャンバス再生成・SSE） ────────────────────────────

function fillRoute(routePattern: string, wdVal: string, ver: string): string {
  return routePattern.replace(":wd", wdVal).replace(":version", ver);
}

function openRefreshModal(): void {
  refreshLog.value = [];
  refreshFull.value = false;
  refreshPhase.value = "confirm";
  refreshModalOpen.value = true;
}

function closeRefreshModal(): void {
  if (refreshPhase.value === "running") return; // 実行中は閉じさせない
  refreshModalOpen.value = false;
}

/** SSE ストリームを読んで指定ログに追記し、DONE を検出する（canvas 更新・テーマ適用で共用）。 */
async function drainSse(body: ReadableStream<Uint8Array>, log: { value: string[] }): Promise<boolean> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let done = false;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const msg = line.slice(6);
      log.value.push(msg);
      if (msg.startsWith("DONE:")) done = true;
    }
  }
  return done;
}

async function runCanvasRefresh(): Promise<void> {
  if (!wdId.value || !version.value) return;
  refreshPhase.value = "running";
  refreshLog.value = [];
  const url = fillRoute(API_ROUTES.work.canvasRefresh, wdId.value, version.value);
  try {
    const res = await apiFetchRaw(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full: refreshFull.value }),
    });
    if (!res.ok || !res.body) {
      refreshLog.value.push(`ERROR: HTTP ${res.status}`);
      refreshPhase.value = "confirm";
      return;
    }
    const done = await drainSse(res.body, refreshLog);
    refreshPhase.value = done ? "done" : "confirm";
    if (done) await reloadAfterRefresh();
  } catch (err) {
    refreshLog.value.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    refreshPhase.value = "confirm";
  }
}

/** canvas 更新完了後にデッキを再読込し、新しい画像を確実に取得する。 */
async function reloadAfterRefresh(): Promise<void> {
  await reloadDeck();
}

// ── テーマ再適用（Phase2・リボンのテーマプルダウン発） ────────────────────────
// デッキ全ページに配色を適用（表紙グラデ／概要帯／本文 Step 色）→ サムネ再生成。
// canvas は dirty になるので後で「更新」ボタンで高解像度化する。

async function runApplyTheme(themeId: string): Promise<void> {
  if (!wdId.value || !version.value) return;
  if (themeId === slideEditor.theme.value) return; // 同一テーマは no-op
  pendingTheme.value = themeId;
  themePhase.value = "running";
  themeLog.value = [];
  themeModalOpen.value = true;
  const url = fillRoute(API_ROUTES.work.theme, wdId.value, version.value);
  try {
    const res = await apiFetchRaw(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: themeId }),
    });
    if (!res.ok || !res.body) {
      themeLog.value.push(`ERROR: HTTP ${res.status}`);
      themePhase.value = "error";
      return;
    }
    const done = await drainSse(res.body, themeLog);
    themePhase.value = done ? "done" : "error";
    if (done) {
      slideEditor.theme.value = themeId; // プルダウンの選択を確定
      await reloadDeck();
    }
  } catch (err) {
    themeLog.value.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    themePhase.value = "error";
  }
}

function closeThemeModal(): void {
  if (themePhase.value === "running") return; // 実行中は閉じさせない
  themeModalOpen.value = false;
}

// ── Chat helpers ─────────────────────────────────────────────────────────────

/** 現在のスライドコンテキストをメッセージの先頭に付与する文字列を返す */
function buildSlideContext(): string {
  const page = currentPage.value;
  if (!page || !deck.value || !wdId.value) return "";
  const titlePart = page.title ? ` / タイトル: 「${page.title}」` : "";
  return `[スライド編集] WD: ${wdId.value} ${version.value} / p.${page.pageNo}/${deck.value.totalPages} (id: ${page.id})${titlePart}\n\n`;
}

function sendChatMessage(): void {
  const text = chatInput.value.trim();
  if (!text || agentRunning.value) return;
  appApi.sendMessageAs(buildSlideContext() + text, SLIDE_ROLE_ID);
  chatInput.value = "";
}

function sendQuickHint(hint: string): void {
  if (agentRunning.value) return;
  appApi.sendMessageAs(buildSlideContext() + hint, SLIDE_ROLE_ID);
}

// ── Data loading ──────────────────────────────────────────────────────────────

/** `<WD>/` 直下の version サブフォルダを列挙し、最新（先頭）を返す。 */
async function discoverVersion(wdDir: string): Promise<string | null> {
  const dirPath = `data/work/${wdDir}`;
  const dirRes = await apiGet<TreeNode>(`${API_ROUTES.files.dir}?path=${encodeURIComponent(dirPath)}`);
  if (!dirRes.ok) return null;
  const versions = parseVersionDirs(dirRes.data.children ?? []);
  const requested = requestedVersion.value;
  if (requested && versions.includes(requested)) return requested;
  return versions[0] ?? null;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  const res = await apiGet<{ kind: string; content: string }>(`${API_ROUTES.files.content}?path=${encodeURIComponent(path)}`);
  if (!res.ok) return null;
  try {
    return JSON.parse(res.data.content) as T;
  } catch {
    return null;
  }
}

/**
 * structure.json（必須）＋ manifest.json（任意）を読み deck に反映。成功で true。
 * opts.preserve=true のときは現在の選択ページ・セクション開閉状態を維持する
 * （外部編集後の再読込で先頭ページに飛ばされないようにするため）。
 */
async function applyDeck(wdDir: string, ver: string, opts?: { preserve?: boolean }): Promise<boolean> {
  const base = `data/work/${wdDir}/${ver}`;
  const structure = await fetchJson<SlideStructure>(`${base}/.pages/structure.json`);
  if (!structure) return false;
  const manifest = await fetchJson<SlideManifest>(`${base}/.thumbcache/manifest.json`);
  version.value = ver;
  sourcePptx.value = structure.source?.from ?? "";
  sourceKind.value = structure.source?.kind ?? "";
  slideEditor.theme.value = structure.theme ?? "cool"; // リボンのテーマプルダウン初期選択
  const prevId = currentId.value;
  deck.value = buildDeck(structure, manifest);
  const keep = opts?.preserve === true && deck.value.pages.some((page) => page.id === prevId);
  currentId.value = keep ? prevId : (deck.value.pages[0]?.id ?? "");
  if (!keep) collapsedSections.value = new Set();
  canvasFailed.value = new Set();
  return true;
}

/** デッキを再読込して最新のサムネ・dirty 状態を反映する（選択ページは維持）。 */
async function reloadDeck(): Promise<void> {
  reloadNonce.value += 1; // 画像 URL を変えてブラウザキャッシュを回避
  if (wdId.value && version.value) await applyDeck(wdId.value, version.value, { preserve: true });
}

/** ポーリング用の静かなロード（成功したら待機を解除）。 */
async function loadDeckSilent(wdDir: string): Promise<void> {
  if (wdId.value !== wdDir) return;
  const ver = await discoverVersion(wdDir);
  if (!ver || wdId.value !== wdDir) return;
  if (await applyDeck(wdDir, ver)) {
    waiting.value = false;
    stopPolling();
  }
}

async function loadDeck(wdDir: string): Promise<void> {
  loading.value = true;
  loadError.value = null;
  waiting.value = false;
  deck.value = null;
  stopPolling();

  const isStale = (): boolean => wdId.value !== wdDir;

  try {
    const ver = await discoverVersion(wdDir);
    if (isStale()) return;
    if (!ver) {
      waiting.value = true;
      startPolling(wdDir);
      return;
    }
    const ok = await applyDeck(wdDir, ver);
    if (isStale()) return;
    if (!ok) {
      waiting.value = true;
      startPolling(wdDir);
    }
  } catch (err) {
    if (!isStale()) loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (!isStale()) loading.value = false;
  }
}

// ── Watchers ──────────────────────────────────────────────────────────────────

watch(
  [wdId, requestedVersion],
  ([wdVal]) => {
    stopPolling();
    waiting.value = false;
    if (wdVal) {
      void loadDeck(wdVal);
    } else {
      deck.value = null;
      loadError.value = null;
      // WD 未指定で /slides に来た場合は WorkFileSelectorView にリダイレクト
      router.replace({ name: PAGE_ROUTES.workFiles }).catch(() => {});
    }
  },
  { immediate: true },
);

// チャット（slide ロール）エージェントの実行が完了したら、デッキを再読込して
// python-pptx 編集の結果（dirty フラグ・更新済みサムネ）を画面へ反映する。
watch(agentRunning, (running, wasRunning) => {
  if (wasRunning && !running && deck.value) void reloadDeck();
});

// ── 上部リボンへコントロールを集約する連携 ──────────────────────────────────
// canvas 更新・チャットトグルの実体はこのビューが持ち、リボンからは共有ストア
// 経由でトリガー／状態参照する（App.vue chrome のリボンとは親子関係が無いため）。
slideEditor.register({
  onApplyTheme: (themeId: string) => void runApplyTheme(themeId),
  onRefresh: () => openRefreshModal(),
  onToggleChat: () => {
    showChatPane.value = !showChatPane.value;
  },
});
watch(deck, (value) => (slideEditor.active.value = Boolean(value)), { immediate: true });
watch(dirtyCount, (value) => (slideEditor.dirtyCount.value = value), { immediate: true });
watch(showChatPane, (value) => (slideEditor.chatOpen.value = value), { immediate: true });

onUnmounted(() => {
  stopPolling();
  slideEditor.unregister();
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
