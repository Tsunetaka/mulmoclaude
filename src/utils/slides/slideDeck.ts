// Pure helpers for the new 3-tier edit-slide data model (post-N6).
//
// A working directory (WD) holds one or more *version* subfolders
// (`v001`, `v002-001`, …). Each version folder carries:
//   - `.pages/structure.json`   — source of truth: section order,
//     page-id order, per-page lock (`checked_out`).
//   - `.thumbcache/manifest.json` — display cache: per-page title,
//     thumbnail / canvas filenames, dirty + frozen flags. Keyed by the
//     same stable page id (`p-<8hex>`) as structure.
//
// SlideEditorView merges the two into a `DeckModel` and renders by id.
// The merge + version discovery are pure so they can be unit-tested
// without a browser.

// ── structure.json (`.pages/`) — source of truth ─────────────────────────────

export interface StructurePage {
  file: string;
  checked_out: boolean;
  checkout_by: string | null;
  checkout_at: string | null;
}

export interface StructureSection {
  name: string;
  page_ids: string[];
}

export interface SlideStructure {
  schema_version: number;
  wd: string;
  version: string;
  source?: { kind: string; from: string };
  /** geoplan-step-guide のテーマ ID（表紙グラデ＋内部帯色）。リボンのテーマ
   *  プルダウンの初期選択に使う。旧 structure（theme 欄なし）は cool 扱い。 */
  theme?: string;
  sections: StructureSection[];
  pages: Record<string, StructurePage>;
}

// ── manifest.json (`.thumbcache/`) — display cache (derived) ──────────────────

export interface ManifestPage {
  page_no: number;
  section: string;
  title: string;
  thumb: string | null;
  thumb_sm: string | null;
  canvas: string | null;
  content_hash: string;
  dirty: boolean;
  frozen: boolean;
}

export interface SlideManifest {
  schema_version: number;
  version: string;
  generated_at: string;
  structure_rev?: string;
  pages: Record<string, ManifestPage>;
}

// ── merged view model ─────────────────────────────────────────────────────────

export interface DeckPage {
  id: string;
  pageNo: number; // 1-based position in the flat structure order
  title: string;
  section: string;
  thumb: string | null; // filename within `.thumbcache/`
  canvas: string | null; // filename within `.pagecanvas/`
  dirty: boolean;
  frozen: boolean;
  checkedOut: boolean;
  checkoutBy: string | null;
}

export interface DeckSection {
  name: string;
  pages: DeckPage[];
}

export interface DeckModel {
  version: string;
  totalPages: number;
  sections: DeckSection[];
  pages: DeckPage[]; // flat, in structure (section) order
}

/** A minimal `/api/files/dir` child entry shape. */
export interface DirEntry {
  name: string;
  type: "file" | "dir";
}

// ── 頁編集（削除・移動・追加）の固定セクション判定・移動先計算 ────────────────────
// 表紙（先頭セクション）／Thank You 系セクションは固定＝頁の削除/移動/追加/並べ替え
// 不可（サーバー page_ops.py と同一ルール）。orphan（未分類）も構造編集の対象外。

/** buildDeck が孤児ページをまとめる末尾セクション名。構造編集の対象外。 */
export const ORPHAN_SECTION_NAME = "未分類";

// Thank You（締め）系セクション名（サーバー page_ops.py / apply_theme と一致）。
const THANKYOU_SECTION_NAMES = new Set(["thank you", "thankyou", "おわりに", "まとめ", "結び"]);

/** 先頭（表紙）／Thank You／未分類セクションは固定＝頁編集不可。 */
export function isFixedSection(sectionIndex: number, sectionName: string): boolean {
  if (sectionIndex === 0) return true;
  if (sectionName === ORPHAN_SECTION_NAME) return true;
  return THANKYOU_SECTION_NAMES.has(sectionName.trim().toLowerCase());
}

/** 頁の削除・移動・追加を許すセクションか（固定でない）。 */
export function isEditableSection(sectionIndex: number, sectionName: string): boolean {
  return !isFixedSection(sectionIndex, sectionName);
}

/**
 * 現在頁のタイトルを編集できるか（＝固定でないセクションに属する頁か）。
 * 表紙（先頭）／Thank You／未分類 の頁は編集不可（サーバー page_ops.py と同一ルール）。
 * 存在しない pageId は false。
 */
export function canEditTitle(deck: DeckModel, pageId: string): boolean {
  const sectionIndex = deck.sections.findIndex((sec) => sec.pages.some((page) => page.id === pageId));
  if (sectionIndex < 0) return false;
  return isEditableSection(sectionIndex, deck.sections[sectionIndex].name);
}

/**
 * 現在頁のテキストボックスを編集できるか（＝固定でないセクションに属し、かつチェックアウト
 * 中でない頁か）。表紙（先頭）／Thank You／未分類／チェックアウト中の頁は不可（サーバー
 * page_ops.py と同一ルール）。存在しない pageId は false。
 */
export function canEditTextboxes(deck: DeckModel, pageId: string): boolean {
  const sectionIndex = deck.sections.findIndex((sec) => sec.pages.some((page) => page.id === pageId));
  if (sectionIndex < 0) return false;
  if (!isEditableSection(sectionIndex, deck.sections[sectionIndex].name)) return false;
  const page = deck.sections[sectionIndex].pages.find((entry) => entry.id === pageId);
  return page ? !page.checkedOut : false;
}

/** 移動 API に渡す移動先（セクション名＋そのセクション内 0 始まり位置）。 */
export interface MoveTarget {
  toSection: string;
  toIndex: number;
}

/**
 * 「↑（-1）／↓（+1）」1 ステップ移動の移動先を求める純関数。
 *
 * 編集可能セクションを跨いだフラット順序の中で pageId を direction 分だけ
 * ずらした最終位置を求め、それを (toSection, toIndex) に写像する。toIndex は
 * サーバー契約に合わせ「移動対象を取り除いた後の」移動先セクション内位置。
 * 端（編集可能範囲の先頭/末尾）を越える移動、固定/未分類ページ、存在しない
 * ページは null（＝移動不可）。
 */
export function computeMoveTarget(deck: DeckModel, pageId: string, direction: -1 | 1): MoveTarget | null {
  // 編集可能セクションの頁を順に並べ、各頁に「自セクション名＋セクション内位置」を持たせる。
  const editable: { sec: string; localIndex: number; id: string }[] = [];
  deck.sections.forEach((sec, sectionIndex) => {
    if (isEditableSection(sectionIndex, sec.name)) {
      sec.pages.forEach((page, localIndex) => editable.push({ sec: sec.name, localIndex, id: page.id }));
    }
  });
  const from = editable.findIndex((entry) => entry.id === pageId);
  if (from < 0) return null;
  const dest = from + direction;
  if (dest < 0 || dest >= editable.length) return null; // 編集可能範囲の端を越える
  // 隣接頁と入れ替える＝移動対象は隣接頁のスロット（セクション＋セクション内位置）へ。
  // toIndex は隣接頁の元のセクション内位置（移動対象を取り除いた後の挿入位置と一致する）。
  const neighbor = editable[dest];
  return { toSection: neighbor.sec, toIndex: neighbor.localIndex };
}

// ── セクション編集（追加・移動・削除・リネーム）の純関数 ─────────────────────────
// サーバー page_ops.py の section-* サブコマンドと同一ルール。判定は python が真実源
// で、ここはボタンの活性/非活性・入力の事前検証・挿入位置の候補算出に使う。

/** Thank You 系（大小無視）または 未分類（完全一致）は予約名＝新規/リネーム不可。 */
export function isReservedSectionName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === ORPHAN_SECTION_NAME) return true;
  return THANKYOU_SECTION_NAMES.has(trimmed.toLowerCase());
}

export type SectionNameProblem = "empty" | "reserved" | "duplicate";
export interface SectionNameCheck {
  ok: boolean;
  problem?: SectionNameProblem;
}

/**
 * 新規追加／リネームのセクション名を検証する（page_ops._validate_section_name と同一）。
 * 空・予約名・重複（前後空白を無視した完全一致・大小文字は区別）を弾く。リネーム時は
 * `excludeName` に現在名を渡すと、自分自身との重複衝突を除外する（＝名前据置は OK）。
 */
export function validateNewSectionName(name: string, existingNames: readonly string[], excludeName?: string): SectionNameCheck {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, problem: "empty" };
  if (isReservedSectionName(trimmed)) return { ok: false, problem: "reserved" };
  const exclude = excludeName?.trim();
  const duplicate = existingNames.some((existing) => existing.trim() === trimmed && existing.trim() !== exclude);
  return duplicate ? { ok: false, problem: "duplicate" } : { ok: true };
}

/**
 * セクションを↑（-1）／↓（+1）へ 1 つ動かせるか（＝隣接する編集可能セクションと入れ替え
 * 可能か）。固定セクション・編集可能帯の端・存在しない名前は false。
 */
export function canMoveSection(deck: DeckModel, sectionName: string, direction: -1 | 1): boolean {
  const editableIndexes = deck.sections.map((sec, index) => ({ index, name: sec.name })).filter((entry) => isEditableSection(entry.index, entry.name));
  const sectionIndex = deck.sections.findIndex((sec) => sec.name === sectionName);
  if (sectionIndex < 0) return false;
  const pos = editableIndexes.findIndex((entry) => entry.index === sectionIndex);
  if (pos < 0) return false; // 固定セクション
  const dest = pos + direction;
  return dest >= 0 && dest < editableIndexes.length;
}

/** 新規セクションを挿入できる位置（sections 配列の 0 始まり index）とその前後の名前。 */
export interface SectionInsertSlot {
  index: number;
  afterName: string;
  beforeName: string | null;
}

/**
 * 新規セクションの有効な挿入位置一覧。先頭（表紙・index 0）の後から、最初に現れる固定
 * セクション（Thank You／未分類）の直前まで。固定セクションが無ければ末尾まで。
 * page_ops._insert_upper_bound と同じ上限を使う。
 */
export function sectionInsertSlots(deck: DeckModel): SectionInsertSlot[] {
  const { sections } = deck;
  const count = sections.length;
  let upper = count;
  for (let i = 1; i < count; i++) {
    if (isFixedSection(i, sections[i].name)) {
      upper = i;
      break;
    }
  }
  const slots: SectionInsertSlot[] = [];
  for (let index = 1; index <= upper; index++) {
    slots.push({ index, afterName: sections[index - 1].name, beforeName: sections[index]?.name ?? null });
  }
  return slots;
}

// Version folder names: `v001`, `v012`, `v002-001`, `v003-001-002`, …
// Validated segment-wise (not one regex) to avoid a nested-quantifier
// ReDoS pattern — each sub-regex is anchored and linear.
const BASE_SEGMENT = /^v\d{3}$/;
const BRANCH_SEGMENT = /^\d+$/;

/** True when `name` is a version folder name (`v001`, `v002-001`, …). */
export function isVersionName(name: string): boolean {
  const segments = name.split("-");
  if (!BASE_SEGMENT.test(segments[0])) return false;
  return segments.slice(1).every((seg) => BRANCH_SEGMENT.test(seg));
}

/** Numeric segment array for a version name (`v002-001` → [2, 1]). */
export function versionSegments(name: string): number[] {
  return name
    .slice(1)
    .split("-")
    .map((seg) => parseInt(seg, 10));
}

/** Descending comparator: newer (higher, then more-specific branch) first. */
function compareVersionDesc(versionA: string, versionB: string): number {
  const segsA = versionSegments(versionA);
  const segsB = versionSegments(versionB);
  const len = Math.max(segsA.length, segsB.length);
  for (let i = 0; i < len; i++) {
    const diff = (segsB[i] ?? -1) - (segsA[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Version subfolders under a WD, newest first. */
export function parseVersionDirs(entries: readonly DirEntry[]): string[] {
  return entries
    .filter((entry) => entry.type === "dir" && isVersionName(entry.name))
    .map((entry) => entry.name)
    .sort(compareVersionDesc);
}

// Full-shape defaults so the merge coalesces once (keeps `makeDeckPage`
// under the cognitive-complexity ceiling instead of `?? ` per field).
const EMPTY_MANIFEST_PAGE: ManifestPage = {
  page_no: 0,
  section: "",
  title: "",
  thumb: null,
  thumb_sm: null,
  canvas: null,
  content_hash: "",
  dirty: false,
  frozen: false,
};
const EMPTY_STRUCT_PAGE: StructurePage = { file: "", checked_out: false, checkout_by: null, checkout_at: null };

function makeDeckPage(pageId: string, pageNo: number, structure: SlideStructure, manifest: SlideManifest | null): DeckPage {
  const structPage = structure.pages[pageId] ?? EMPTY_STRUCT_PAGE;
  const manifestPage = manifest?.pages[pageId] ?? EMPTY_MANIFEST_PAGE;
  return {
    id: pageId,
    pageNo,
    title: manifestPage.title,
    section: manifestPage.section,
    thumb: manifestPage.thumb,
    canvas: manifestPage.canvas,
    dirty: manifestPage.dirty,
    frozen: manifestPage.frozen,
    checkedOut: structPage.checked_out,
    checkoutBy: structPage.checkout_by,
  };
}

/** Page ids present in `structure.pages` but not referenced by any section. */
function collectOrphanIds(structure: SlideStructure): string[] {
  const covered = new Set<string>();
  for (const sec of structure.sections) {
    for (const pageId of sec.page_ids) covered.add(pageId);
  }
  return Object.keys(structure.pages).filter((pageId) => !covered.has(pageId));
}

/**
 * Merge structure (order + lock, authoritative) with manifest (title /
 * thumb / canvas / flags, cache) into an id-keyed `DeckModel`. Page
 * numbers follow the flat structure order — manifest `page_no` is not
 * trusted so a re-order needs no manifest rewrite. Orphaned pages are
 * appended in a trailing "未分類" section so nothing vanishes.
 */
export function buildDeck(structure: SlideStructure, manifest: SlideManifest | null): DeckModel {
  let pageNo = 0;
  const sections: DeckSection[] = structure.sections.map((sec) => ({
    name: sec.name,
    pages: sec.page_ids.map((pageId) => makeDeckPage(pageId, ++pageNo, structure, manifest)),
  }));

  const orphans = collectOrphanIds(structure);
  if (orphans.length > 0) {
    sections.push({ name: ORPHAN_SECTION_NAME, pages: orphans.map((pageId) => makeDeckPage(pageId, ++pageNo, structure, manifest)) });
  }

  const pages = sections.flatMap((sec) => sec.pages);
  return { version: structure.version, totalPages: pages.length, sections, pages };
}

/**
 * サイドバー（サムネイルペイン）のキーボード頁送りで、押されたキーから遷移先の
 * フラット index を返す。対象外キーは null（呼び出し側は preventDefault しない）。
 * - ArrowUp / PageUp   … 前の頁（先頭で頭打ち）
 * - ArrowDown / PageDown … 次の頁（末尾で頭打ち）
 * - Home … 先頭 / End … 末尾
 * current<0（未選択）は 0 起点とする。total<=0 は常に null。
 */
export function sidebarNavTarget(key: string, current: number, total: number): number | null {
  if (total <= 0) return null;
  const base = current < 0 ? 0 : current;
  switch (key) {
    case "ArrowUp":
    case "PageUp":
      return Math.max(0, base - 1);
    case "ArrowDown":
    case "PageDown":
      return Math.min(total - 1, base + 1);
    case "Home":
      return 0;
    case "End":
      return total - 1;
    default:
      return null;
  }
}
