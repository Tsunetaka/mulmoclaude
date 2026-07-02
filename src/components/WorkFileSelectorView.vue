<!-- eslint-disable @intlify/vue-i18n/no-raw-text -- WorkFileSelectorView は日本語専用機能。文字列を i18n バンドルに含めない設計。 -->
<template>
  <div class="flex flex-col h-full overflow-auto bg-gray-50 text-gray-900 p-4">
    <div class="flex items-center gap-2 mb-4">
      <h1 class="text-xl font-bold">作業ファイル選択</h1>
      <button class="ml-auto px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50" :disabled="loading" @click="scanFiles">
        {{ loading ? "スキャン中..." : "再スキャン" }}
      </button>
    </div>

    <div v-if="errorMsg" class="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">{{ errorMsg }}</div>

    <div v-if="loading && categories.length === 0" class="text-gray-500 text-sm">スキャン中...</div>

    <div v-if="!loading && categories.length === 0 && !errorMsg" class="text-gray-500 text-sm">
      WD フォルダが見つかりませんでした。workRootPath を設定してください。
    </div>

    <!-- カテゴリ一覧 -->
    <div v-for="cat in categories" :key="cat.name" class="mb-4">
      <button
        class="w-full flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg font-semibold text-left hover:bg-gray-50"
        @click="toggleCategory(cat.name)"
      >
        <span class="material-icons text-sm">{{ expandedCategories.has(cat.name) ? "expand_more" : "chevron_right" }}</span>
        <span>{{ cat.name }}</span>
        <span class="ml-auto text-xs text-gray-400">{{ cat.wds.length }} 件</span>
      </button>

      <div v-if="expandedCategories.has(cat.name)" class="mt-1 ml-4 space-y-2">
        <!-- WD 一覧 -->
        <div v-for="wd in cat.wds" :key="wd.id" class="border border-gray-200 rounded bg-white overflow-hidden">
          <button class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50" @click="toggleWd(wd)">
            <span class="material-icons text-sm text-gray-400">{{ expandedWds.has(wd.id) ? "expand_more" : "chevron_right" }}</span>
            <span class="font-mono text-xs text-blue-700 bg-blue-50 px-1 rounded">{{ wd.id }}</span>
            <span class="text-sm font-medium truncate">{{ wd.title }}</span>
            <span v-if="wd.hasCheckedOut" class="ml-auto text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded">CO: {{ wd.checkedOutVersion }}</span>
          </button>

          <div v-if="expandedWds.has(wd.id)" class="px-3 pb-3 border-t border-gray-100 pt-2">
            <!-- バージョンなし → 新規作成ボタン -->
            <div v-if="wd.versions.length === 0">
              <button
                class="px-3 py-1.5 rounded text-sm font-medium border border-dashed border-blue-400 text-blue-600 hover:bg-blue-50 transition-colors"
                @click="onCreateNew(wd)"
              >
                ＋ 新規作成
              </button>
            </div>
            <div class="flex flex-wrap gap-2 items-start">
              <div v-for="v in wd.versions" :key="v.version" class="flex flex-col">
                <button
                  class="rounded text-sm font-medium border transition-colors flex flex-col"
                  :class="[versionButtonClass(v), thumbUrlFor(wd.id, v.version) ? 'p-1.5 w-40 items-stretch' : 'px-3 py-1.5 items-start']"
                  @click="onVersionClick(wd, v)"
                >
                  <img
                    v-if="thumbUrlFor(wd.id, v.version)"
                    :src="thumbUrlFor(wd.id, v.version)"
                    class="w-full h-auto rounded border border-gray-200 bg-white mb-1"
                    alt=""
                    loading="lazy"
                  />
                  <span class="flex flex-wrap items-center gap-x-1">
                    <span>{{ v.version }}</span>
                    <span v-if="v.date" class="text-xs opacity-70">{{ formatDate(v.date) }}</span>
                    <span v-for="s in v.statuses" :key="s" class="text-xs px-1 rounded" :class="statusBadgeClass(s)">{{ statusLabel(s) }}</span>
                  </span>
                </button>
                <!-- 編集中カード：直接オープンに加え、ここから採番モーダル(fork-from)を開く -->
                <button v-if="v.kind === 'editing'" class="mt-0.5 text-[11px] text-blue-600 hover:underline self-start" @click="openVersionModal(wd, v)">
                  ＋新版
                </button>
              </div>
              <span v-if="thumbsLoading.has(wd.id)" class="text-xs text-gray-400 self-center">プレビュー生成中...</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 採番モーダル（新版作成／編集開始） -->
    <div v-if="versionModal" class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div class="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 flex flex-col">
        <div class="flex items-center gap-2 px-4 py-3 border-b">
          <span class="font-semibold">編集を開始 — 新しいバージョンを作成</span>
          <button class="ml-auto text-gray-400 hover:text-gray-600" :disabled="modalPhase === 'running'" @click="closeVersionModal">✕</button>
        </div>

        <!-- ① 採番方法の選択 -->
        <div v-if="modalPhase === 'choose'" class="px-4 py-3 space-y-3">
          <div class="text-sm text-gray-600">
            <span class="font-mono">{{ versionModal.wdId }}</span>
            <span class="ml-2">元: {{ versionModal.sourceVersion }}（{{ versionModal.sourceKind === "released" ? "ReleasedVersion" : "編集中" }}）</span>
          </div>
          <label
            v-for="opt in modalOps"
            :key="opt.value"
            class="flex items-start gap-2 p-2 rounded border cursor-pointer"
            :class="selectedOp === opt.value ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'"
          >
            <input v-model="selectedOp" type="radio" :value="opt.value" class="mt-1" />
            <span class="flex flex-col">
              <span class="text-sm font-medium">{{ opt.label }}</span>
              <span class="text-xs text-gray-500 font-mono">{{ opt.preview }}</span>
            </span>
          </label>
        </div>

        <!-- ② SSE ログ -->
        <div v-else class="flex-1 overflow-y-auto px-4 py-3 max-h-80 font-mono text-xs bg-gray-900">
          <div v-for="(line, i) in modalLog" :key="i" class="text-green-300 whitespace-pre-wrap">{{ line }}</div>
          <div v-if="modalPhase === 'running'" class="text-yellow-300 animate-pulse">処理中...</div>
        </div>

        <div class="px-4 py-3 border-t flex justify-end gap-2">
          <button v-if="modalPhase === 'choose'" class="px-4 py-2 bg-gray-200 rounded text-sm" @click="closeVersionModal">キャンセル</button>
          <button v-if="modalPhase === 'choose'" class="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700" @click="executeVersionOp">
            {{ selectedOp === "continue" ? "この版を開く" : `${targetVersion} を作成` }}
          </button>
          <button v-if="modalPhase === 'done'" class="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700" @click="handleModalDone">
            スライドエディタで開く
          </button>
        </div>
      </div>
    </div>

    <!-- 新規デッキ作成モーダル（N3）：テーマ選択＋タイトル入力 → new-deck API -->
    <div v-if="newDeckModal" class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div class="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">
        <div class="flex items-center gap-2 px-4 py-3 border-b">
          <span class="font-semibold">新規スライド作成 — {{ newDeckModal.wdId }}（{{ NEW_DECK_VERSION }}）</span>
          <button class="ml-auto text-gray-400 hover:text-gray-600" :disabled="modalPhase === 'running'" @click="closeNewDeckModal">✕</button>
        </div>

        <!-- ① テーマ・タイトル入力 -->
        <div v-if="modalPhase === 'choose'" class="px-4 py-3 space-y-3 overflow-y-auto">
          <div>
            <div class="text-sm font-medium mb-1">表紙のテーマ</div>
            <div class="grid grid-cols-5 gap-2">
              <button
                v-for="theme in NEW_DECK_THEMES"
                :key="theme.id"
                type="button"
                class="rounded-lg border-2 p-1 text-left transition-all"
                :class="deckTheme === theme.id ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:border-gray-300'"
                :title="theme.tagline"
                @click="deckTheme = theme.id"
              >
                <div class="h-12 rounded border border-gray-200 flex items-end p-1" :style="{ background: theme.swatch, color: theme.swatchText }">
                  <span class="text-[9px] leading-tight opacity-80">Smallworld with AI</span>
                </div>
                <div class="text-xs mt-1 font-medium truncate">{{ theme.label }}</div>
                <div class="text-[10px] text-gray-400 truncate">{{ theme.tagline }}</div>
              </button>
            </div>
          </div>
          <label class="block">
            <span class="text-sm font-medium">タイトル <span class="text-red-500">*</span></span>
            <input
              v-model="deckTitle"
              type="text"
              class="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              placeholder="スライドのメインタイトル"
            />
          </label>
          <label class="block">
            <span class="text-sm font-medium">サブタイトル（製品名・文脈／省略可）</span>
            <input
              v-model="deckSubtitle"
              type="text"
              class="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              placeholder="例: Google AppSheet / Smallworld with AI"
            />
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="deckConfidential" type="checkbox" />
            [社外秘] ラベルを表示する
          </label>
          <div class="text-xs text-gray-500">表紙には今日の日付・会社名（テンプレにプレースホルダがあれば WD-ID／バージョンも）が自動で入ります。</div>
        </div>

        <!-- ② SSE ログ -->
        <div v-else class="flex-1 overflow-y-auto px-4 py-3 max-h-80 font-mono text-xs bg-gray-900">
          <div v-for="(line, i) in modalLog" :key="i" class="text-green-300 whitespace-pre-wrap">{{ line }}</div>
          <div v-if="modalPhase === 'running'" class="text-yellow-300 animate-pulse">処理中...</div>
        </div>

        <div class="px-4 py-3 border-t flex items-center gap-2">
          <span v-if="modalPhase === 'done'" class="text-xs text-gray-500 mr-auto"
            >高解像度表示はエディタの「canvas を更新」で生成できます（PowerPoint を全て閉じてから）</span
          >
          <button v-if="modalPhase === 'choose'" class="ml-auto px-4 py-2 bg-gray-200 rounded text-sm" @click="closeNewDeckModal">キャンセル</button>
          <button
            v-if="modalPhase === 'choose'"
            class="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            :disabled="!deckTitle.trim()"
            @click="executeNewDeck"
          >
            表紙を作成
          </button>
          <button v-if="modalPhase === 'done'" class="ml-auto px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700" @click="handleNewDeckDone">
            スライドエディタで開く
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { apiGet, apiPost, apiFetchRaw } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { PAGE_ROUTES } from "../router/pageRoutes";
import { nextIncrement, nextBranch, allowedOps, type VersionOp } from "../utils/slides/versioning";
import { NEW_DECK_THEMES } from "../utils/slides/newDeck";

interface VersionInfo {
  version: string;
  versionNum: number;
  kind: "released" | "editing";
  filename: string;
  date: string;
  source?: { kind: string; from: string };
  locked?: boolean;
  statuses: string[];
}

interface WdInfo {
  id: string;
  title: string;
  windowsWdPath: string;
  hasCheckedOut: boolean;
  checkedOutVersion: string | null;
  versions: VersionInfo[];
}

interface CategoryInfo {
  name: string;
  wds: WdInfo[];
}

interface ScanResult {
  categories: CategoryInfo[];
  rootPath: string;
}

const router = useRouter();
const categories = ref<CategoryInfo[]>([]);
const loading = ref(false);
const errorMsg = ref<string | null>(null);
const expandedCategories = ref<Set<string>>(new Set());
const expandedWds = ref<Set<string>>(new Set());

// リリース選択前プレビュー（N5）。wdId → version → workspace 相対サムネパス。
const releasedThumbs = ref<Record<string, Record<string, string>>>({});
const thumbsLoading = ref<Set<string>>(new Set());

// ── 採番モーダル状態 ─────────────────────────────────────────────────────────
interface VersionModal {
  wdId: string;
  sourceVersion: string;
  sourceKind: "released" | "editing";
  sourceFilename: string;
  siblings: string[];
}
const versionModal = ref<VersionModal | null>(null);
const selectedOp = ref<VersionOp>("increment");
const modalPhase = ref<"choose" | "running" | "done">("choose");
const modalLog = ref<string[]>([]);
const doneVersion = ref<string | null>(null);

async function scanFiles(): Promise<void> {
  loading.value = true;
  errorMsg.value = null;
  const result = await apiGet<ScanResult>(API_ROUTES.work.scan);
  loading.value = false;
  if (!result.ok) {
    errorMsg.value = result.error;
    return;
  }
  categories.value = result.data.categories;
  for (const cat of result.data.categories) {
    expandedCategories.value.add(cat.name);
  }
}

function toggleCategory(name: string): void {
  if (expandedCategories.value.has(name)) expandedCategories.value.delete(name);
  else expandedCategories.value.add(name);
}

function toggleWd(wdInfo: WdInfo): void {
  if (expandedWds.value.has(wdInfo.id)) {
    expandedWds.value.delete(wdInfo.id);
  } else {
    expandedWds.value.add(wdInfo.id);
    loadReleasedThumbs(wdInfo).catch(() => {});
  }
}

interface ReleasedThumb {
  version: string;
  path: string;
  generated: boolean;
  error?: string;
}

// 展開時に対象 WD の released サムネ（欠落/古いものだけ）をサーバー生成して取り込む。
// released 版が無い新規 WD でも windowsWdPath があれば呼ぶ（released-thumbs エンドポイントが
// D: 側の素材フォルダ構成を WSL へミラーするため）。released 版が無ければサムネは空で返る。
async function loadReleasedThumbs(wdInfo: WdInfo): Promise<void> {
  if (!wdInfo.windowsWdPath || thumbsLoading.value.has(wdInfo.id)) return;
  thumbsLoading.value = new Set(thumbsLoading.value).add(wdInfo.id);
  try {
    const result = await apiPost<{ thumbs: ReleasedThumb[] }>(API_ROUTES.work.releasedThumbs, {
      wdId: wdInfo.id,
      windowsWdPath: wdInfo.windowsWdPath,
    });
    if (!result.ok) return;
    const map: Record<string, string> = {};
    for (const thumb of result.data.thumbs) {
      if (!thumb.error) map[thumb.version] = thumb.path;
    }
    releasedThumbs.value = { ...releasedThumbs.value, [wdInfo.id]: map };
  } finally {
    const next = new Set(thumbsLoading.value);
    next.delete(wdInfo.id);
    thumbsLoading.value = next;
  }
}

// released バージョンの表紙サムネ URL（無ければ空文字）。
function thumbUrlFor(wdId: string, version: string): string {
  const relPath = releasedThumbs.value[wdId]?.[version];
  if (!relPath) return "";
  return `${API_ROUTES.files.raw}?path=${encodeURIComponent(relPath)}`;
}

function formatDate(date: string): string {
  if (!date || date.length !== 8) return date;
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function statusLabel(statusKey: string): string {
  const labelMap: Record<string, string> = {
    editing: "編集中",
    released: "リリース済",
    "checked-out": "CO済",
    dirty: "未保存",
  };
  return labelMap[statusKey] ?? statusKey;
}

function statusBadgeClass(statusKey: string): string {
  const classMap: Record<string, string> = {
    editing: "bg-yellow-100 text-yellow-800",
    released: "bg-gray-100 text-gray-600",
    "checked-out": "bg-green-100 text-green-800",
    dirty: "bg-orange-100 text-orange-800",
  };
  return classMap[statusKey] ?? "bg-gray-100 text-gray-600";
}

function versionButtonClass(verInfo: VersionInfo): string {
  if (verInfo.statuses.includes("checked-out")) return "border-green-400 bg-green-50 text-green-800";
  if (verInfo.statuses.includes("dirty")) return "border-orange-300 bg-orange-50 text-orange-800";
  if (verInfo.kind === "editing") return "border-yellow-300 bg-yellow-50 text-yellow-800";
  return "border-gray-300 bg-white text-gray-700 hover:bg-gray-50";
}

// エディタへ遷移（version クエリで開く版を指定）。
function openEditor(wdId: string, version: string): void {
  router.push({ name: PAGE_ROUTES.slides, params: { wdId }, query: { version } }).catch(() => {});
}

// バージョンカードのクリック：編集中→直接オープン／released→採番モーダル。
function onVersionClick(wdInfo: WdInfo, verInfo: VersionInfo): void {
  if (verInfo.kind === "editing") {
    openEditor(wdInfo.id, verInfo.version);
    return;
  }
  openVersionModal(wdInfo, verInfo);
}

// 採番モーダルを開く（released カードのクリック or 編集中カードの「＋新版」）。
function openVersionModal(wdInfo: WdInfo, verInfo: VersionInfo): void {
  versionModal.value = {
    wdId: wdInfo.id,
    sourceVersion: verInfo.version,
    sourceKind: verInfo.kind,
    sourceFilename: verInfo.filename,
    siblings: wdInfo.versions.map((ver) => ver.version),
  };
  const ops = allowedOps(verInfo.kind);
  selectedOp.value = ops.includes("increment") ? "increment" : ops[0];
  modalPhase.value = "choose";
  modalLog.value = [];
  doneVersion.value = null;
}

function closeVersionModal(): void {
  if (modalPhase.value === "running") return;
  versionModal.value = null;
}

// 選択した操作から新版番号を計算する。
const targetVersion = computed<string>(() => {
  const modal = versionModal.value;
  if (!modal) return "";
  if (selectedOp.value === "increment") return nextIncrement(modal.sourceVersion, modal.siblings);
  if (selectedOp.value === "branch") return nextBranch(modal.sourceVersion, modal.siblings);
  return modal.sourceVersion; // continue
});

interface ModalOp {
  value: VersionOp;
  label: string;
  preview: string;
}

// モーダルに表示する採番オプション（kind により継続の可否が変わる）。
const modalOps = computed<ModalOp[]>(() => {
  const modal = versionModal.value;
  if (!modal) return [];
  return allowedOps(modal.sourceKind).map((value) => {
    if (value === "increment")
      return { value, label: "インクリメント（推奨）", preview: `${modal.sourceVersion} → ${nextIncrement(modal.sourceVersion, modal.siblings)}` };
    if (value === "branch") return { value, label: "枝番を追加", preview: `${modal.sourceVersion} → ${nextBranch(modal.sourceVersion, modal.siblings)}` };
    return { value, label: "この版のまま継続", preview: `${modal.sourceVersion}（そのまま開く）` };
  });
});

// SSE ストリームを読んでログに追記し、DONE を検出する。
async function drainModalSse(body: ReadableStream<Uint8Array>): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const msg = line.slice(6);
      modalLog.value.push(msg);
      if (msg.startsWith("DONE:")) modalPhase.value = "done";
    }
  }
}

// split / fork-from を SSE で叩き、完了まで待つ。preflight エラー（非 SSE の JSON）も処理。
async function runModalSse(url: string, body: Record<string, unknown>): Promise<void> {
  modalPhase.value = "running";
  try {
    const res = await apiFetchRaw(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      let msg = `HTTP ${res.status}`;
      try {
        const errBody = (await res.json()) as { error?: string };
        if (errBody?.error) msg = errBody.error;
      } catch {
        // レスポンスが JSON でない場合はステータスコードのみ
      }
      modalLog.value.push(`ERROR: ${msg}`);
      modalPhase.value = "choose";
      return;
    }
    await drainModalSse(res.body);
  } catch (err) {
    modalLog.value.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    modalPhase.value = "choose";
  }
}

function fillRoute(routePattern: string, wdId: string, version: string): string {
  return routePattern.replace(":wd", wdId).replace(":version", version);
}

// 採番モーダルの「実行」：continue は直接オープン、それ以外は split/fork-from。
async function executeVersionOp(): Promise<void> {
  const modal = versionModal.value;
  if (!modal) return;
  const target = targetVersion.value;

  // 編集中由来の「継続」は新版を作らずそのまま開く。
  if (modal.sourceKind === "editing" && selectedOp.value === "continue") {
    versionModal.value = null;
    openEditor(modal.wdId, modal.sourceVersion);
    return;
  }

  doneVersion.value = target;
  if (modal.sourceKind === "released") {
    const url = fillRoute(API_ROUTES.work.split, modal.wdId, target);
    await runModalSse(url, { sourceFilename: modal.sourceFilename, sourceKind: "released", sourceFrom: modal.sourceVersion });
  } else {
    const url = fillRoute(API_ROUTES.work.forkFrom, modal.wdId, target);
    await runModalSse(url, { sourceVersion: modal.sourceVersion });
  }
}

function handleModalDone(): void {
  const modal = versionModal.value;
  const target = doneVersion.value;
  versionModal.value = null;
  if (modal && target) openEditor(modal.wdId, target);
  scanFiles().catch(() => {});
}

// ── 新規デッキ作成モーダル（N3）─────────────────────────────────────────────
// 画面内モーダルでテーマ・タイトルを選び、new-deck API（new_deck.py→gen_thumbs）を
// SSE で実行する。チャット遷移はしない（2026-07-02 UX 改善）。canvas はエディタの
// 「更新」ボタンで後追い生成（PowerPoint 全終了の確認付き）。
const NEW_DECK_VERSION = "v001";
const newDeckModal = ref<{ wdId: string; windowsWdPath: string } | null>(null);
const deckTheme = ref("cool");
const deckTitle = ref("");
const deckSubtitle = ref("");
const deckConfidential = ref(true);

// 「＋ 新規作成」：モーダルを開く（タイトル既定値は WD タイトル）。
function onCreateNew(wdInfo: WdInfo): void {
  newDeckModal.value = { wdId: wdInfo.id, windowsWdPath: wdInfo.windowsWdPath };
  deckTheme.value = "cool";
  deckTitle.value = wdInfo.title;
  deckSubtitle.value = "";
  deckConfidential.value = true;
  modalPhase.value = "choose";
  modalLog.value = [];
}

function closeNewDeckModal(): void {
  if (modalPhase.value === "running") return;
  newDeckModal.value = null;
}

// 新規デッキ作成を実行（サーバーが new_deck.py → gen_thumbs を SSE で流す）。
async function executeNewDeck(): Promise<void> {
  const modal = newDeckModal.value;
  if (!modal || !deckTitle.value.trim()) return;
  const url = fillRoute(API_ROUTES.work.newDeck, modal.wdId, NEW_DECK_VERSION);
  await runModalSse(url, {
    title: deckTitle.value.trim(),
    subtitle: deckSubtitle.value.trim() || undefined,
    theme: deckTheme.value,
    confidential: deckConfidential.value,
    // 新規作成時に D: 側の素材フォルダ構成も WSL へミラーさせる。
    windowsWdPath: modal.windowsWdPath,
  });
}

function handleNewDeckDone(): void {
  const modal = newDeckModal.value;
  newDeckModal.value = null;
  if (modal) openEditor(modal.wdId, NEW_DECK_VERSION);
  scanFiles().catch(() => {});
}

onMounted(() => {
  scanFiles().catch(() => {});
});
</script>
