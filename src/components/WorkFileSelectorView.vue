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
          <button class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50" @click="toggleWd(wd.id)">
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
            <div class="flex flex-wrap gap-2">
              <button
                v-for="v in wd.versions"
                :key="v.version"
                class="px-3 py-1.5 rounded text-sm font-medium border transition-colors"
                :class="versionButtonClass(v, wd)"
                :disabled="isVersionDisabled(v, wd)"
                @click="onVersionClick(wd, v)"
              >
                {{ v.version }}
                <span v-if="v.date" class="text-xs opacity-70 ml-1">{{ formatDate(v.date) }}</span>
                <span v-for="s in v.statuses" :key="s" class="ml-1 text-xs px-1 rounded" :class="statusBadgeClass(s)">{{ statusLabel(s) }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- チェックアウトモーダル -->
    <div v-if="checkoutModal" class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div class="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 flex flex-col">
        <div class="flex items-center gap-2 px-4 py-3 border-b">
          <span class="font-semibold">チェックアウト — {{ checkoutModal.wdId }}</span>
          <span class="text-sm text-gray-500 ml-1">{{ checkoutModal.version }}</span>
          <button class="ml-auto text-gray-400 hover:text-gray-600" :disabled="checkoutRunning" @click="closeCheckoutModal">✕</button>
        </div>
        <div class="flex-1 overflow-y-auto px-4 py-3 max-h-80 bg-gray-900 rounded-b-none font-mono text-xs">
          <div v-for="(line, i) in checkoutLog" :key="i" class="text-green-300 whitespace-pre-wrap">{{ line }}</div>
          <div v-if="checkoutRunning" class="text-yellow-300 animate-pulse">処理中...</div>
        </div>
        <div class="px-4 py-3 border-t flex justify-end gap-2">
          <button
            v-if="!checkoutDone"
            class="px-4 py-2 bg-gray-200 rounded text-sm disabled:opacity-50"
            :disabled="checkoutRunning"
            @click="closeCheckoutModal"
          >
            キャンセル
          </button>
          <button v-if="checkoutDone" class="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700" @click="handleCheckoutDone">
            スライドエディタで開く
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { apiGet, apiFetchRaw } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { PAGE_ROUTES } from "../router/pageRoutes";

interface VersionInfo {
  version: string;
  versionNum: number;
  filename: string;
  date: string;
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

const checkoutModal = ref<{ wdId: string; version: string; windowsWdPath: string } | null>(null);
const checkoutLog = ref<string[]>([]);
const checkoutRunning = ref(false);
const checkoutDone = ref(false);
const checkoutDoneWdId = ref<string | null>(null);

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
  // デフォルトで全カテゴリ展開
  for (const cat of result.data.categories) {
    expandedCategories.value.add(cat.name);
  }
}

function toggleCategory(name: string): void {
  if (expandedCategories.value.has(name)) {
    expandedCategories.value.delete(name);
  } else {
    expandedCategories.value.add(name);
  }
}

function toggleWd(wdId: string): void {
  if (expandedWds.value.has(wdId)) {
    expandedWds.value.delete(wdId);
  } else {
    expandedWds.value.add(wdId);
  }
}

function formatDate(date: string): string {
  if (!date || date.length !== 8) return date;
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function statusLabel(statusKey: string): string {
  const labelMap: Record<string, string> = {
    draft: "編集中",
    released: "リリース済",
    "checked-out": "CO済",
    dirty: "未保存",
    stale: "要更新",
  };
  return labelMap[statusKey] ?? statusKey;
}

function statusBadgeClass(statusKey: string): string {
  const classMap: Record<string, string> = {
    draft: "bg-yellow-100 text-yellow-800",
    released: "bg-gray-100 text-gray-600",
    "checked-out": "bg-green-100 text-green-800",
    dirty: "bg-orange-100 text-orange-800",
    stale: "bg-red-100 text-red-800",
  };
  return classMap[statusKey] ?? "bg-gray-100 text-gray-600";
}

function versionButtonClass(verInfo: VersionInfo, wdInfo: WdInfo): string {
  if (verInfo.version === wdInfo.checkedOutVersion) return "border-green-400 bg-green-50 text-green-800";
  if (verInfo.statuses.includes("stale")) return "border-red-300 bg-red-50 text-red-800";
  if (verInfo.statuses.includes("dirty")) return "border-orange-300 bg-orange-50 text-orange-800";
  if (verInfo.statuses.includes("draft")) return "border-yellow-300 bg-yellow-50 text-yellow-800";
  return "border-gray-300 bg-white text-gray-700 hover:bg-gray-50";
}

// 他バージョンがCO中なら、そのバージョン以外を全てdisabledにする
function isVersionDisabled(verInfo: VersionInfo, wdInfo: WdInfo): boolean {
  return wdInfo.hasCheckedOut && verInfo.version !== wdInfo.checkedOutVersion;
}

// YYYYMMDD 形式で今日の日付を返す
function todayYYYYMMDD(): string {
  const now = new Date();
  const yearStr = String(now.getFullYear());
  const monthStr = String(now.getMonth() + 1).padStart(2, "0");
  const dayStr = String(now.getDate()).padStart(2, "0");
  return `${yearStr}${monthStr}${dayStr}`;
}

// Released ファイル名から次バージョンのファイル名を生成
// 例: "TRN-00001 タイトル_20260620_v001.pptx" → "TRN-00001 タイトル_20260628_v002.pptx"
function buildNewVersionFilename(sourceFilename: string): string {
  const today = todayYYYYMMDD();
  const matchWithDate = sourceFilename.match(/^(.+?)_\d{8}_v(\d+)(\.pptx)$/i);
  if (matchWithDate) {
    const newVer = String(parseInt(matchWithDate[2], 10) + 1).padStart(3, "0");
    return `${matchWithDate[1]}_${today}_v${newVer}${matchWithDate[3]}`;
  }
  const matchNoDate = sourceFilename.match(/^(.+?)_v(\d+)(\.pptx)$/i);
  if (matchNoDate) {
    const newVer = String(parseInt(matchNoDate[2], 10) + 1).padStart(3, "0");
    return `${matchNoDate[1]}_${today}_v${newVer}${matchNoDate[3]}`;
  }
  return sourceFilename;
}

// Released バージョン選択 → 新バージョン作成＆チェックアウト
function handleReleasedClick(wdInfo: WdInfo, verInfo: VersionInfo): void {
  const newFilename = buildNewVersionFilename(verInfo.filename);
  const nextVer = newFilename.match(/_v(\d+)\.pptx$/i)?.[1] ?? "?";
  if (!confirm(`${verInfo.version} をコピーして v${nextVer} を新規作成し、チェックアウトします。よろしいですか？`)) return;
  openCheckoutModal(wdInfo, verInfo);
  startCheckout(wdInfo, "checkout-new-version", { sourceFilename: verInfo.filename, newFilename }).catch(() => {});
}

function onVersionClick(wdInfo: WdInfo, verInfo: VersionInfo): void {
  // CO済み（staleでなければ）→ スライドエディタへ直接遷移
  const isActive = verInfo.statuses.includes("checked-out") || verInfo.statuses.includes("dirty");
  if (isActive && !verInfo.statuses.includes("stale")) {
    router.push({ name: PAGE_ROUTES.slides, params: { wdId: wdInfo.id } }).catch(() => {});
    return;
  }
  // Released → 新バージョン作成フロー
  if (verInfo.statuses.includes("released") && !verInfo.statuses.includes("checked-out")) {
    handleReleasedClick(wdInfo, verInfo);
    return;
  }
  // Stale → 再チェックアウトの確認
  if (verInfo.statuses.includes("stale")) {
    if (!confirm(`${verInfo.version} は Windows 側が更新されています。再チェックアウトしますか？`)) return;
  }
  // Draft または stale → checkout
  openCheckoutModal(wdInfo, verInfo);
  startCheckout(wdInfo, "checkout", {}).catch(() => {});
}

function openCheckoutModal(wdInfo: WdInfo, verInfo: VersionInfo): void {
  checkoutModal.value = { wdId: wdInfo.id, version: verInfo.version, windowsWdPath: wdInfo.windowsWdPath };
  checkoutLog.value = [];
  checkoutRunning.value = false;
  checkoutDone.value = false;
  checkoutDoneWdId.value = null;
}

function onCreateNew(wdInfo: WdInfo): void {
  alert(`「${wdInfo.title}」の新規作成機能は準備中です。\nWD: ${wdInfo.id}`);
}

// SSE ストリームを読んでログに追記する
async function drainSseStream(body: ReadableStream<Uint8Array>): Promise<void> {
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
      checkoutLog.value.push(msg);
      if (msg.startsWith("DONE:")) {
        checkoutDoneWdId.value = msg.slice(5);
        checkoutDone.value = true;
      }
    }
  }
}

async function startCheckout(wdInfo: WdInfo, action: string, extra: Record<string, string>): Promise<void> {
  checkoutRunning.value = true;
  try {
    const res = await apiFetchRaw(API_ROUTES.work.checkout, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wdId: wdInfo.id, windowsWdPath: wdInfo.windowsWdPath, action, ...extra }),
    });
    if (!res.ok || !res.body) {
      checkoutLog.value.push(`ERROR: HTTP ${res.status}`);
      return;
    }
    await drainSseStream(res.body);
  } catch (err) {
    checkoutLog.value.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    checkoutRunning.value = false;
  }
}

function closeCheckoutModal(): void {
  if (checkoutRunning.value) return;
  checkoutModal.value = null;
}

function handleCheckoutDone(): void {
  const wdId = checkoutDoneWdId.value;
  checkoutModal.value = null;
  if (wdId) {
    router.push({ name: PAGE_ROUTES.slides, params: { wdId } }).catch(() => {});
  }
  scanFiles().catch(() => {});
}

onMounted(() => {
  scanFiles().catch(() => {});
});
</script>
