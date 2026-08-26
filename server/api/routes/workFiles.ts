import { Router, type Request, type Response } from "express";
import path from "path";
import { promises as fsp } from "fs";
import { spawn } from "child_process";
import { workspacePath } from "../../workspace/workspace.js";
import { log } from "../../system/logger/index.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { ONE_HOUR_MS, ONE_MINUTE_MS, ONE_SECOND_MS } from "../../utils/time.js";
import { spawnSystemWorker, type SpawnSystemWorkerResult } from "./agent.js";
import { requestBodyRecord } from "../../utils/requestBody.js";
import { getOptionalStringQuery } from "../../utils/request.js";
import { readJsonOrNull } from "../../utils/files/json.js";
import { isRecord } from "../../utils/types.js";
import { versionSegments } from "../../../src/utils/slides/slideDeck.js";
import { hasDescendantVersion } from "../../../src/utils/slides/versioning.js";

const router = Router();

// ── リクエスト読み出しヘルパー ────────────────────────────────────────────────
// `req.params` / `req.body` は express の型では「何が入っているか未検証」なので、
// as で形を主張せず（#2692）ここで narrow する。パスに含まれる :wd / :version は
// 実際には常に文字列だが、欠けたら空文字にして各ハンドラの
// isValidWorkWdId / isValidWorkVersion による 400 に載せる。

function wdVersionOf(req: Request): { wd: string; version: string } {
  const { wd, version } = req.params;
  return { wd: typeof wd === "string" ? wd : "", version: typeof version === "string" ? version : "" };
}

function wdOf(req: Request): string {
  const { wd } = req.params;
  return typeof wd === "string" ? wd : "";
}

/** narrow 済み body から文字列フィールドを読む（非文字列・未設定は undefined）。 */
function bodyString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

/** narrow 済み body から真偽フィールドを読む（`true` 以外はすべて false）。 */
function bodyBoolean(body: Record<string, unknown>, key: string): boolean {
  return body[key] === true;
}

const PPTX_PATTERN = /\.pptx$/i;
const PPTX_VERSION_DATE_PATTERN = /_(\d{8})_v(\d+)\.pptx$/i;
// 改訂履歴（edit-slide §12-5）。pptx ではないが ReleasedVersion に同居し、
// pptx と同じく D:↔WSL の両方向で同期する（削除はしない＝維持されるべき成果物）。
const HISTORY_FILENAME = "HISTORY.md";
const PPTX_VERSION_PATTERN = /_v(\d+)\.pptx$/i;
const WD_NAME_PATTERN = /^([A-Z]+-\d+)\s+(\S.*)$/;
const WD_ROOT_PATTERN = /^[A-Z]+-\d{5}\s+/;

// スタンプ選択機能（花モチーフの修了証／未受講ペア）。
// 元は data/work/stamps/compressed/<花名>_completed.png / _incompleted.png のペア。
// 選択したペアを WD の Windows 側 `Stamps` フォルダへ「全消し→コピー」する。
const STAMPS_DIR_REL = "data/work/stamps";
const STAMPS_COMPRESSED_SUBDIR = "compressed";
const STAMPS_INDEX_FILENAME = "index.json";
const STAMP_COMPLETED_SUFFIX = "_completed.png";
const STAMP_INCOMPLETED_SUFFIX = "_incompleted.png";
const STAMPS_FOLDER_NAME = "Stamps";
const STAMP_COMPLETED_PATTERN = /_completed\.png$/i;
const STAMP_BASE_PATTERN = /^\w+$/;

// WD-ID（例 GIT-00003）／バージョン名（例 v001・枝番 v001-002）の厳格パターン。
// DELETE のパスパラメータを正規表現で固定し、`.` / `..` / パス区切りを構造的に排除する。
const WD_ID_PATTERN = /^[A-Z]+-\d+$/;
// `\d+(-\d+)*` は各区切りが `-` リテラルで始まり曖昧な重なりが無く線形時間。
// eslint-disable-next-line security/detect-unsafe-regex
const VERSION_NAME_PATTERN = /^v\d+(?:-\d+)*$/;

/** DELETE /api/work/:wd/:version の `:wd` が安全な WD-ID か。 */
export function isValidWorkWdId(wdId: string): boolean {
  return WD_ID_PATTERN.test(wdId);
}

/** DELETE /api/work/:wd/:version の `:version` が安全なバージョン名か。
 *  `ReleasedVersion` や `.`/`..` などは構造的に弾く。 */
export function isValidWorkVersion(version: string): boolean {
  return VERSION_NAME_PATTERN.test(version);
}

/** COM ツールに渡す pptx ファイル名が安全か（純粋判定）。
 *  パス区切り・`..`・先頭ドットを排し、`.pptx` 拡張子のみ許可する。 */
export function isSafePptxFilename(name: string): boolean {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  if (name.startsWith(".")) return false;
  return /\.pptx$/i.test(name);
}

/** `target` が `parent` の直下の `name` という名前のディレクトリか（純粋判定）。
 *  サブフォルダ限定削除の最終ガード：親ディレクトリと basename を照合して
 *  WD ルートや祖先・別ディレクトリを絶対に消さないことを保証する。 */
export function isContainedChild(target: string, parent: string, name: string): boolean {
  const resolvedTarget = path.resolve(target);
  const resolvedParent = path.resolve(parent);
  return path.dirname(resolvedTarget) === resolvedParent && path.basename(resolvedTarget) === name && resolvedTarget !== resolvedParent;
}

// Windows パス → WSL パス変換
function windowsToWsl(winPath: string): string {
  return winPath.replace(/^([A-Za-z]):\\/, (_full, driveLetter: string) => `/mnt/${driveLetter.toLowerCase()}/`).replace(/\\/g, "/");
}

// ディレクトリ一覧（失敗時は空配列）
async function listDirs(dirPath: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    return entries.filter((ent) => ent.isDirectory()).map((ent) => ent.name);
  } catch {
    return [];
  }
}

// ファイル一覧（パターン付き）
async function listFiles(dirPath: string, pattern: RegExp): Promise<string[]> {
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    return entries.filter((ent) => ent.isFile() && pattern.test(ent.name)).map((ent) => ent.name);
  } catch {
    return [];
  }
}

// mtime 取得（失敗時は null）
async function getMtime(filePath: string): Promise<number | null> {
  try {
    const stat = await fsp.stat(filePath);
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

// PPTX ファイル名からバージョン情報を抽出
function parsePptxVersion(filename: string): { version: string; versionNum: number; date: string } | null {
  const matchWithDate = filename.match(PPTX_VERSION_DATE_PATTERN);
  if (matchWithDate?.[1] && matchWithDate[2]) {
    const verNum = parseInt(matchWithDate[2], 10);
    return { version: `v${String(verNum).padStart(3, "0")}`, versionNum: verNum, date: matchWithDate[1] };
  }
  const matchNoDate = filename.match(PPTX_VERSION_PATTERN);
  if (matchNoDate?.[1]) {
    const verNum = parseInt(matchNoDate[1], 10);
    return { version: `v${String(verNum).padStart(3, "0")}`, versionNum: verNum, date: "" };
  }
  return null;
}

// manifest.json から dirty フラグを確認
async function checkDirtyFlag(manifestPath: string): Promise<boolean> {
  try {
    const manifest = await readJsonOrNull<{ pages?: Record<string, { dirty?: boolean }> }>(manifestPath);
    return manifest?.pages ? Object.values(manifest.pages).some((page) => page.dirty === true) : false;
  } catch {
    return false;
  }
}

// 新 3 階層モデルのバージョン。`kind` で released（実体 pptx・split の元）と
// editing（編集中サブフォルダ）を区別する。採番の兄弟集合はこの version 群。
interface VersionInfo {
  version: string;
  versionNum: number;
  /** released: ReleasedVersion の実体 pptx。editing: WD 直下の編集中サブフォルダ。 */
  kind: "released" | "editing";
  /** released のみ：split の元 pptx ファイル名。editing は空文字。 */
  filename: string;
  date: string;
  /** editing のみ：派生元（structure.json の source）。 */
  source?: { kind: string; from: string };
  /** editing のみ：checked_out ページを持つか。 */
  locked?: boolean;
  statuses: string[];
}

interface WdInfo {
  id: string;
  title: string;
  windowsWdPath: string;
  hasCheckedOut: boolean;
  checkedOutVersion: string | null;
  /** WSL 側 `data/work/<id>/` が実体化済みか（＝「登録」済み）。
   *  未登録の WD は展開してもミラー・サムネ生成を行わず、UI では「登録」ボタンを出す。 */
  registered: boolean;
  /** 現在この WD の Windows 側 Stamps フォルダに設定されている修了証スタンプの花名（複数可）。
   *  null＝未登録／Windows パス読取不可で「表示しない」、[]＝読めたが未選択（UI が赤字表示）、
   *  [名前…]＝設定済み。登録済み WD かつ withStamps 指定のスキャンでのみ算出する。 */
  stampNames: string[] | null;
  /** 同一カテゴリ内で同じスタンプを使っている他 WD がある場合の重複警告（空＝重複なし）。
   *  比較対象は登録の有無を問わずカテゴリ内で D: にそのスタンプを持つ全 WD。 */
  stampConflicts: StampConflict[];
  versions: VersionInfo[];
}

/** スタンプ重複 1 件：name＝花名（解決不可なら base）、siblings＝同じスタンプを使う同カテゴリの他 WD。 */
interface StampConflict {
  name: string;
  siblings: { id: string; title: string }[];
}

interface CategoryInfo {
  name: string;
  wds: WdInfo[];
}

// ReleasedVersion/*.pptx を released バージョンとして列挙する。
async function scanReleasedVersions(wdWslPath: string): Promise<VersionInfo[]> {
  const files = await listFiles(path.join(wdWslPath, "ReleasedVersion"), PPTX_PATTERN);
  const out: VersionInfo[] = [];
  for (const fname of files) {
    const parsed = parsePptxVersion(fname);
    if (!parsed) continue;
    out.push({ version: parsed.version, versionNum: parsed.versionNum, kind: "released", filename: fname, date: parsed.date, statuses: ["released"] });
  }
  return out;
}

interface StructureLite {
  source?: { kind: string; from: string };
  pages?: Record<string, { checked_out?: boolean }>;
}

// 編集中サブフォルダ 1 つを VersionInfo に変換する。structure.json が読めなければ null。
async function readEditingVersion(workDir: string, name: string): Promise<VersionInfo | null> {
  const struct = await readJsonOrNull<StructureLite>(path.join(workDir, name, ".pages", "structure.json"));
  if (!struct) return null;
  const locked = struct.pages ? Object.values(struct.pages).some((page) => page.checked_out === true) : false;
  const dirty = await checkDirtyFlag(path.join(workDir, name, ".thumbcache", "manifest.json"));
  const statuses = ["editing"];
  if (locked) statuses.push("checked-out");
  if (dirty) statuses.push("dirty");
  return {
    version: name,
    versionNum: versionSegments(name)[0] ?? 0,
    kind: "editing",
    filename: "",
    date: "",
    ...(struct.source ? { source: struct.source } : {}),
    locked,
    statuses,
  };
}

// WSL 側 data/work/<wdId>/ のバージョンサブフォルダを editing バージョンとして列挙する。
async function scanEditingVersions(wdId: string): Promise<VersionInfo[]> {
  const workDir = path.join(workspacePath, "data/work", wdId);
  const subdirs = await listDirs(workDir);
  const out: VersionInfo[] = [];
  for (const name of subdirs) {
    if (!VERSION_NAME_PATTERN.test(name)) continue;
    const info = await readEditingVersion(workDir, name);
    if (info) out.push(info);
  }
  return out;
}

// バージョン名の昇順比較（v001 < v002 < v002-001 < v003）。
function compareVersionAsc(verA: VersionInfo, verB: VersionInfo): number {
  const segsA = versionSegments(verA.version);
  const segsB = versionSegments(verB.version);
  const len = Math.max(segsA.length, segsB.length);
  for (let i = 0; i < len; i++) {
    const diff = (segsA[i] ?? -1) - (segsB[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
}

// WD の Windows 側 Stamps に設定中の修了証スタンプの base 集合（昇順）を返す。
// null＝Windows パス未解決/読取不可（UI は非表示）、[]＝読めたが未選択（UI は赤字）。
// 登録の有無は問わない（重複判定は D: の実体で行うため）。
async function resolveWdStampBases(winWdPath: string): Promise<string[] | null> {
  if (!winWdPath) return null;
  const wslWdPath = windowsToWsl(winWdPath);
  // WD フォルダ自体が読めない（D: 未接続など）なら「未選択」と断定せず非表示にする。
  if (!(await pathExists(wslWdPath))) return null;
  const completed = await listFiles(path.join(wslWdPath, STAMPS_FOLDER_NAME), STAMP_COMPLETED_PATTERN);
  return completed.map((name) => name.slice(0, -STAMP_COMPLETED_SUFFIX.length)).sort((left, right) => left.localeCompare(right));
}

// base（例 "bellflower"）→ 花名（index に無ければ base そのもの）。index キーは `<base>_completed`。
function stampFlowerName(base: string, labels: Map<string, string>): string {
  return flowerFromLabel(labels.get(`${base}_completed`) ?? base) || base;
}

// カテゴリ内の各 WD の現在スタンプ base を集める（読取不可の WD はマップに載せない）。登録の有無は問わない。
async function collectStampBases(wds: WdInfo[]): Promise<Map<string, string[]>> {
  const byWd = new Map<string, string[]>();
  for (const entry of wds) {
    const bases = await resolveWdStampBases(entry.windowsWdPath);
    if (bases !== null) byWd.set(entry.id, bases);
  }
  return byWd;
}

// base → そのスタンプを使う WD（{id,title}）一覧。カテゴリ内の重複検出に使う。
function buildStampUsage(wds: WdInfo[], basesByWd: Map<string, string[]>): Map<string, { id: string; title: string }[]> {
  const usage = new Map<string, { id: string; title: string }[]>();
  for (const entry of wds) {
    for (const base of basesByWd.get(entry.id) ?? []) {
      const arr = usage.get(base) ?? [];
      arr.push({ id: entry.id, title: entry.title.trim() });
      usage.set(base, arr);
    }
  }
  return usage;
}

// 登録済み WD 1 件に表示用スタンプ名と重複警告を埋める（in-place）。
function assignStampInfo(
  target: WdInfo,
  basesByWd: Map<string, string[]>,
  usage: Map<string, { id: string; title: string }[]>,
  labels: Map<string, string>,
): void {
  const bases = basesByWd.get(target.id);
  if (bases === undefined) {
    target.stampNames = null; // Windows パス読取不可 → 非表示
    return;
  }
  target.stampNames = bases.map((base) => stampFlowerName(base, labels));
  const conflicts: StampConflict[] = [];
  for (const base of bases) {
    const siblings = (usage.get(base) ?? []).filter((entry) => entry.id !== target.id);
    if (siblings.length > 0) conflicts.push({ name: stampFlowerName(base, labels), siblings });
  }
  target.stampConflicts = conflicts;
}

// カテゴリ全体を走査し、登録済み各 WD の現在スタンプ名と同カテゴリ重複警告を算出する。
async function populateStampInfo(wds: WdInfo[], labels: Map<string, string>): Promise<void> {
  const basesByWd = await collectStampBases(wds);
  const usage = buildStampUsage(wds, basesByWd);
  for (const entry of wds) {
    if (entry.registered) assignStampInfo(entry, basesByWd, usage, labels);
  }
}

// WD フォルダを処理して WdInfo を返す（released=Windows/WSL の ReleasedVersion、
// editing=WSL の編集中サブフォルダ）。両者を採番の兄弟集合として 1 リストに束ねる。
// スタンプ名／重複警告はカテゴリ単位の後処理（populateStampInfo）で埋める。
async function processWdFolder(wdName: string, catWslPath: string, catWinPath: string): Promise<WdInfo | null> {
  const match = wdName.match(WD_NAME_PATTERN);
  if (!match) return null;

  const [, wdId, title] = match;
  if (wdId === undefined || title === undefined) return null;
  const wdWinPath = `${catWinPath}\\${wdName}`;
  const released = await scanReleasedVersions(path.join(catWslPath, wdName));
  const editing = await scanEditingVersions(wdId);
  const versions = [...released, ...editing].sort(compareVersionAsc);
  const lockedEditing = editing.find((ver) => ver.locked);
  const registered = await pathExists(path.join(workspacePath, "data/work", wdId));

  return {
    id: wdId,
    title,
    windowsWdPath: wdWinPath,
    hasCheckedOut: Boolean(lockedEditing),
    checkedOutVersion: lockedEditing?.version ?? null,
    registered,
    stampNames: null,
    stampConflicts: [],
    versions,
  };
}

// settings.json から workRootPath を読む
async function getWorkRootWin(): Promise<string> {
  const settingsPath = path.join(workspacePath, "config/settings.json");
  const settings = await readJsonOrNull<{ workRootPath?: string }>(settingsPath);
  if (settings?.workRootPath) return settings.workRootPath;
  return "D:\\SW_Doc\\Materials";
}

// WD 名一覧を WdInfo[] に変換。stampLabels 非 null のときカテゴリ単位でスタンプ名／重複警告を算出する。
async function resolveWdList(wdNames: string[], catWslPath: string, catWinPath: string, stampLabels: Map<string, string> | null): Promise<WdInfo[]> {
  const wds: WdInfo[] = [];
  for (const wdName of wdNames) {
    const wdInfo = await processWdFolder(wdName, catWslPath, catWinPath);
    if (wdInfo) wds.push(wdInfo);
  }
  if (stampLabels) await populateStampInfo(wds, stampLabels);
  return wds;
}

// ルートフォルダをスキャンして CategoryInfo[] を返す。
// withStamps=true のときだけ、登録済み WD の現在設定中スタンプ名を算出する
// （作業ファイル選択画面のスキャンだけが要求。他の内部呼び出しは余計な Stamps 走査を避ける）。
async function scanRoot(workRootWin: string, opts?: { withStamps?: boolean }): Promise<CategoryInfo[]> {
  const wslRoot = windowsToWsl(workRootWin);
  const allDirNames = await listDirs(wslRoot);
  const uncategorizedWds = allDirNames.filter((dirName) => WD_ROOT_PATTERN.test(dirName));
  const categoryDirs = allDirNames.filter((dirName) => !WD_ROOT_PATTERN.test(dirName));
  const categories: CategoryInfo[] = [];
  const stampLabels = opts?.withStamps ? await readStampLabels(path.join(workspacePath, STAMPS_DIR_REL)) : null;

  for (const catName of categoryDirs) {
    const catWslPath = path.join(wslRoot, catName);
    const catWinPath = `${workRootWin}\\${catName}`;
    const wdNames = await listDirs(catWslPath);
    const wds = await resolveWdList(wdNames, catWslPath, catWinPath, stampLabels);
    if (wds.length > 0) categories.push({ name: catName, wds });
  }

  if (uncategorizedWds.length > 0) {
    const wds = await resolveWdList(uncategorizedWds, wslRoot, workRootWin, stampLabels);
    if (wds.length > 0) categories.push({ name: "（未分類）", wds });
  }

  return categories;
}

/** WD-ID からフォルダ名の「Doc ID 以降」＝メインタイトルを解決する（D: マスターを走査）。
 *  見つからない / スキャン失敗時は null（呼び出し側で python の元表紙抽出にフォールバック）。 */
export async function resolveWdTitle(wdId: string): Promise<string | null> {
  try {
    const categories = await scanRoot(await getWorkRootWin());
    for (const cat of categories) {
      const found = cat.wds.find((entry) => entry.id === wdId);
      if (found) return found.title.trim() || null;
    }
  } catch (err) {
    log.warn("workFiles.resolveWdTitle", "title resolve failed", { wdId, err });
  }
  return null;
}

/** WD-ID から D: フォルダの Windows パスを解決する（D: マスターを走査）。
 *  リリース逆同期（D: へ push）・split 前同期・頁チェックアウト等で共通に使う。
 *  見つからない / スキャン失敗時は null。 */
export async function resolveWdWindowsPath(wdId: string): Promise<string | null> {
  try {
    const categories = await scanRoot(await getWorkRootWin());
    for (const cat of categories) {
      const found = cat.wds.find((entry) => entry.id === wdId);
      if (found) return found.windowsWdPath.trim() || null;
    }
  } catch (err) {
    log.warn("workFiles.resolveWdWindowsPath", "windows path resolve failed", { wdId, err });
  }
  return null;
}

// GET /api/work/scan
router.get(API_ROUTES.work.scan, async (req, res) => {
  try {
    const workRootWin = await getWorkRootWin();
    const categories = await scanRoot(workRootWin, { withStamps: true });
    res.json({ categories, rootPath: workRootWin });
  } catch (err) {
    log.error("workFiles.scan", "scan failed", { err });
    res.status(500).json({ error: "scan failed" });
  }
});

// ── アセットピッカー用カタログ（icons / images の index.json 読取） ──────────
interface AssetIndexEntry {
  id?: string;
  file?: string;
  label?: string;
  description?: string;
  color_tone?: string;
  tags?: string[];
  status?: string;
  icon_type?: string | null;
  step_number?: number | null;
  slide_position?: string | null;
}
interface AssetIndexFile {
  assets?: AssetIndexEntry[];
}
interface AssetCatalogItem {
  kind: "icon" | "image";
  id: string;
  label: string;
  description: string;
  path: string;
  colorTone: string;
  tags: string[];
  iconType: string | null;
  stepNumber: number | null;
  slidePosition: string | null;
}

// Reads data/work/<subdir>/index.json and maps its entries to catalog items.
// The stored `file` is relative to the index (e.g. "compressed/icon_x.png"),
// so we prefix it with the workspace-relative asset dir. Non-usable ("使用可"
// 以外) and id-less rows are dropped. Missing / unreadable index → [].
async function readAssetIndex(subdir: "icons" | "images", kind: "icon" | "image"): Promise<AssetCatalogItem[]> {
  const indexPath = path.join(workspacePath, "data/work", subdir, "index.json");
  const parsed = await readJsonOrNull<AssetIndexFile>(indexPath);
  if (!parsed) {
    log.warn("workFiles.assetCatalog", "index read failed", { subdir, indexPath });
    return [];
  }
  const items: AssetCatalogItem[] = [];
  for (const entry of parsed.assets ?? []) {
    if (!entry.id || !entry.file) continue;
    if (entry.status && entry.status !== "使用可") continue;
    items.push({
      kind,
      id: entry.id,
      label: entry.label ?? entry.id,
      description: entry.description ?? "",
      path: path.posix.join("data/work", subdir, entry.file),
      colorTone: entry.color_tone ?? "",
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      iconType: entry.icon_type ?? null,
      stepNumber: typeof entry.step_number === "number" ? entry.step_number : null,
      slidePosition: entry.slide_position ?? null,
    });
  }
  return items;
}

router.get(API_ROUTES.work.assetCatalog, async (_req, res) => {
  try {
    const [icons, images] = await Promise.all([readAssetIndex("icons", "icon"), readAssetIndex("images", "image")]);
    res.json({ icons, images });
  } catch (err) {
    log.error("workFiles.assetCatalog", "catalog build failed", { err });
    res.status(500).json({ error: "asset catalog failed" });
  }
});

// サムネイル生成 Python スクリプト（実行時に /tmp に書き出す）
const THUMB_SCRIPT = `
import sys, json, zipfile, hashlib, datetime, shutil, subprocess, tempfile
from pathlib import Path

pptx_path = sys.argv[1]
cache_dir = Path(sys.argv[2])
version_num = int(sys.argv[3])

def get_slide_hashes(pp):
    hashes = {}
    with zipfile.ZipFile(pp) as z:
        slide_files = sorted([n for n in z.namelist() if n.startswith('ppt/slides/slide') and n.endswith('.xml')])
        for idx, name in enumerate(slide_files, start=1):
            data = z.read(name)
            hashes[str(idx)] = hashlib.sha1(data).hexdigest()
    return hashes

hashes = get_slide_hashes(pptx_path)
total = len(hashes)

manifest_file = cache_dir / 'manifest.json'
existing_pages = {}
if manifest_file.exists():
    try:
        with open(manifest_file, encoding='utf-8') as fp:
            existing_pages = json.load(fp).get('pages', {})
    except Exception:
        pass

changed = [pg for pg, hv in hashes.items() if existing_pages.get(pg, {}).get('hash') != hv]
print(f'変更ページ数: {len(changed)}/{total}', flush=True)

if changed:
    soffice_bin = shutil.which('soffice') or shutil.which('libreoffice')
    pdftoppm_bin = shutil.which('pdftoppm')
    missing = []
    if not soffice_bin:
        missing.append('LibreOffice (soffice)')
    if not pdftoppm_bin:
        missing.append('poppler-utils (pdftoppm)')
    if missing:
        print('ERROR: サムネイル生成に必要なコマンドが見つかりません: ' + ', '.join(missing), flush=True)
        print('  サーバー稼働ホスト(WSL)で次を実行してください: sudo apt install -y libreoffice poppler-utils', flush=True)
        sys.exit(1)
    tmpdir = Path(tempfile.mkdtemp())
    try:
        result = subprocess.run(
            [soffice_bin, '--headless', '--convert-to', 'pdf', '--outdir', str(tmpdir), pptx_path],
            capture_output=True, text=True, timeout=300
        )
        if result.returncode != 0:
            print('ERROR: LibreOffice 変換失敗:', result.stderr, flush=True)
            sys.exit(1)
        pdf_files = list(tmpdir.glob('*.pdf'))
        if not pdf_files:
            print('ERROR: PDF が生成されませんでした', flush=True)
            sys.exit(1)
        result = subprocess.run(
            [pdftoppm_bin, '-png', '-r', '96', str(pdf_files[0]), str(tmpdir / 'slide')],
            capture_output=True, text=True, timeout=300
        )
        if result.returncode != 0:
            print('ERROR: pdftoppm 変換失敗:', result.stderr, flush=True)
            sys.exit(1)
        for pg_idx, img in enumerate(sorted(tmpdir.glob('slide-*.png')), start=1):
            dst = cache_dir / f'p{pg_idx:03d}_md.png'
            shutil.copy(img, dst)
            print(f'  v p{pg_idx:03d}_md.png', flush=True)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
else:
    print('キャッシュ有効。サムネイル再生成をスキップします', flush=True)

pages = {}
for pg_num, hv in hashes.items():
    md_file = f'p{int(pg_num):03d}_md.png'
    prev = existing_pages.get(pg_num, {})
    pages[pg_num] = {
        'md': md_file if (cache_dir / md_file).exists() else None,
        'sm': None, 'hash': hv,
        'checked_out': prev.get('checked_out', False),
        'checkout_by': prev.get('checkout_by', None),
        'dirty': prev.get('dirty', False),
        'title': prev.get('title', '')
    }

sections = []
try:
    import xml.etree.ElementTree as ET
    NS_P   = 'http://schemas.openxmlformats.org/presentationml/2006/main'
    NS_P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main'
    with zipfile.ZipFile(pptx_path) as z:
        if 'ppt/presentation.xml' in z.namelist():
            tree = ET.fromstring(z.read('ppt/presentation.xml'))
            ext_lst = tree.find(f'.//{{{NS_P}}}extLst')
            if ext_lst is not None:
                for ext in ext_lst.findall(f'.//{{{NS_P}}}ext'):
                    sectionLst = ext.find(f'{{{NS_P14}}}sectionLst')
                    if sectionLst is not None:
                        for sec in sectionLst.findall(f'{{{NS_P14}}}section'):
                            sname = sec.get('name', '')
                            spLst = sec.find(f'{{{NS_P14}}}sldIdLst')
                            sslides = []
                            if spLst is not None:
                                sids = [sp.get('id') for sp in spLst]
                                prs_slds = tree.findall(f'.//{{{NS_P}}}sldId')
                                id2idx = {sl.get('id'): str(ii+1) for ii, sl in enumerate(prs_slds)}
                                sslides = [int(id2idx[sid]) for sid in sids if sid in id2idx]
                            sections.append({'name': sname, 'slides': sslides})
except Exception as ex:
    print(f'セクション読み取りエラー（無視）: {ex}', flush=True)

try:
    from pptx import Presentation
    prs = Presentation(pptx_path)
    for pg_idx, slide in enumerate(prs.slides, start=1):
        pg_key = str(pg_idx)
        pg_title = ''
        for shape in slide.shapes:
            if hasattr(shape, 'placeholder_format') and shape.placeholder_format:
                if shape.placeholder_format.idx == 0 and shape.has_text_frame:
                    pg_title = shape.text_frame.text.strip()[:80]
                    break
        if pg_key in pages:
            pages[pg_key]['title'] = pg_title
except Exception as ex:
    print(f'タイトル読み取りエラー（無視）: {ex}', flush=True)

manifest = {
    'pptx': Path(pptx_path).name, 'version': version_num, 'total_pages': total,
    'generated_at': datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).isoformat(timespec='seconds'),
    'rule': 1, 'rule_label': '編集中', 'sections': sections, 'pages': pages
}
with open(manifest_file, 'w', encoding='utf-8') as fp:
    json.dump(manifest, fp, ensure_ascii=False, indent=2)
print('manifest.json 更新完了', flush=True)
`;

// spawn の stdout/stderr を SSE ラインに変換するヘルパー
function pipeToSse(proc: ReturnType<typeof spawn>, send: (line: string) => void, prefix = ""): void {
  const toLines = (data: Buffer): void => {
    data
      .toString()
      .split("\n")
      .filter((line) => line.trim())
      .forEach((line) => send(`${prefix}${line}`));
  };
  proc.stdout?.on("data", toLines);
  proc.stderr?.on("data", (data: Buffer) => {
    data
      .toString()
      .split("\n")
      .filter((line) => line.trim())
      .forEach((line) => send(`⚠ ${line}`));
  });
}

// サムネイル生成
async function runThumbnails(workDir: string, send: (line: string) => void): Promise<void> {
  const pptxFiles = await listFiles(workDir, PPTX_PATTERN);
  const withVersions = pptxFiles
    .map((fname) => ({ fname, mat: fname.match(PPTX_VERSION_PATTERN) }))
    .filter((item): item is { fname: string; mat: RegExpMatchArray } => item.mat !== null)
    .sort((itemA, itemB) => parseInt(itemB.mat[1] ?? "0", 10) - parseInt(itemA.mat[1] ?? "0", 10));

  const [topItem] = withVersions;
  if (!topItem) return;

  const targetPptx = topItem.fname;
  const vNum = parseInt(topItem.mat[1] ?? "0", 10);
  const vStr = `v${String(vNum).padStart(3, "0")}`;
  const cacheDir = path.join(workDir, ".thumbcache", vStr);
  await fsp.mkdir(cacheDir, { recursive: true });

  const thumbScriptPath = `/tmp/mulmo_thumb_${Date.now()}.py`;
  await fsp.writeFile(thumbScriptPath, THUMB_SCRIPT);
  const pptxFullPath = path.join(workDir, targetPptx);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("python3", [thumbScriptPath, pptxFullPath, cacheDir, String(vNum)], {
      env: { ...process.env },
    });
    pipeToSse(proc, send);
    proc.on("close", (code) => {
      fsp.unlink(thumbScriptPath).catch(() => {});
      if (code === 0) resolve();
      else reject(new Error(`thumbnail script exited with code ${String(code)}`));
    });
    proc.on("error", reject);
  });
}

// POST /api/work/thumbnails  (SSE ストリーム)
// wdId だけ受け取り、WD がすでに WSL 上にある前提でサムネイルのみ生成する。
// checkout なしで slide editor に入ったとき（既存 WD を直接開いた場合など）に
// フロントエンドから自動呼び出しされる。
router.post(API_ROUTES.work.thumbnails, async (req, res) => {
  const wdId = bodyString(requestBodyRecord(req.body), "wdId");

  if (!wdId) {
    res.status(400).json({ error: "wdId required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (line: string): void => {
    res.write(`data: ${line}\n\n`);
  };

  try {
    const workDir = path.join(workspacePath, "data/work", wdId);
    await runThumbnails(workDir, send);
    send(`DONE:${wdId}`);
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("workFiles.thumbnails", "thumbnail generation failed", { err });
    send(`ERROR: ${msg}`);
    res.end();
  }
});

// ── リリース選択前プレビュー（N5）──────────────────────────────────────────
// ReleasedVersion/*.pptx の表紙 1 枚を data/work/<wd>/.releasedthumbs/<version>.png
// に生成する。実行時に /tmp に書き出す Python スクリプト（cover のみ・manifest なし）。
const RELEASED_THUMB_SCRIPT = `
import sys, subprocess, tempfile, shutil
from pathlib import Path

pptx_path = sys.argv[1]
out_png = Path(sys.argv[2])

soffice_bin = shutil.which('soffice') or shutil.which('libreoffice')
pdftoppm_bin = shutil.which('pdftoppm')
missing = []
if not soffice_bin:
    missing.append('LibreOffice (soffice)')
if not pdftoppm_bin:
    missing.append('poppler-utils (pdftoppm)')
if missing:
    print('ERROR: 表紙サムネ生成に必要なコマンドが見つかりません: ' + ', '.join(missing), flush=True)
    print('  サーバー稼働ホスト(WSL)で次を実行してください: sudo apt install -y libreoffice poppler-utils', flush=True)
    sys.exit(1)

tmpdir = Path(tempfile.mkdtemp())
try:
    result = subprocess.run(
        [soffice_bin, '--headless', '--convert-to', 'pdf', '--outdir', str(tmpdir), pptx_path],
        capture_output=True, text=True, timeout=300
    )
    if result.returncode != 0:
        print('ERROR: LibreOffice 変換失敗:', result.stderr, flush=True)
        sys.exit(1)
    pdf_files = list(tmpdir.glob('*.pdf'))
    if not pdf_files:
        print('ERROR: PDF が生成されませんでした', flush=True)
        sys.exit(1)
    out_png.parent.mkdir(parents=True, exist_ok=True)
    prefix = tmpdir / 'cover'
    result = subprocess.run(
        [pdftoppm_bin, '-png', '-f', '1', '-l', '1', '-r', '96', '-singlefile', str(pdf_files[0]), str(prefix)],
        capture_output=True, text=True, timeout=300
    )
    if result.returncode != 0:
        print('ERROR: pdftoppm 変換失敗:', result.stderr, flush=True)
        sys.exit(1)
    cover = Path(str(prefix) + '.png')
    if not cover.exists():
        candidates = sorted(tmpdir.glob('cover*.png'))
        if not candidates:
            print('ERROR: 表紙 PNG が生成されませんでした', flush=True)
            sys.exit(1)
        cover = candidates[0]
    shutil.copyfile(cover, out_png)
    print('OK ' + out_png.name, flush=True)
finally:
    shutil.rmtree(tmpdir, ignore_errors=True)
`;

/** サムネを作り直すべきか（純粋判定）。サムネ未生成（thumbMtime=null）なら true、
 *  pptx が消えている（pptxMtime=null）なら既存サムネ温存で false、
 *  それ以外は pptx の方が新しい（mtime 比較）なら true。 */
export function thumbNeedsRebuild(pptxMtime: number | null, thumbMtime: number | null): boolean {
  if (thumbMtime === null) return true;
  if (pptxMtime === null) return false;
  return pptxMtime > thumbMtime;
}

// 1 つの pptx の表紙サムネを生成（既存 THUMB_SCRIPT と同じ /tmp 書き出し方式）。
async function runCoverThumb(pptxFull: string, thumbFull: string): Promise<void> {
  const scriptPath = `/tmp/mulmo_cover_${Date.now()}_${path.basename(thumbFull)}.py`;
  await fsp.writeFile(scriptPath, RELEASED_THUMB_SCRIPT);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("python3", [scriptPath, pptxFull, thumbFull], { env: { ...process.env } });
    let stderr = "";
    proc.stdout?.on("data", (data: Buffer) => {
      if (data.toString().includes("ERROR:")) stderr += data.toString();
    });
    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    proc.on("close", (code) => {
      fsp.unlink(scriptPath).catch(() => {});
      if (code === 0) resolve();
      else reject(new Error(`cover thumb script exited with code ${String(code)}: ${stderr.trim()}`));
    });
    proc.on("error", reject);
  });
}

interface ReleasedThumb {
  version: string;
  path: string;
  generated: boolean;
  error?: string;
}

// ReleasedVersion に対応する pptx が無くなった孤児サムネ（<version>.png）を削除し、
// .releasedthumbs のバージョン集合を ReleasedVersion 側へ常に一致させる。
// 人間が ReleasedVersion のファイルを差し替え/削除しても孤児サムネが残らないようにする。
// 返り値：削除したバージョン名の配列。
async function pruneOrphanReleasedThumbs(thumbsDir: string, liveVersions: Set<string>): Promise<string[]> {
  const pngs = await listFiles(thumbsDir, /\.png$/i);
  const pruned: string[] = [];
  for (const png of pngs) {
    const version = path.basename(png, path.extname(png));
    if (!VERSION_NAME_PATTERN.test(version) || liveVersions.has(version)) continue;
    try {
      await fsp.unlink(path.join(thumbsDir, png));
      pruned.push(version);
    } catch {
      // 削除失敗は無視（次回再試行）
    }
  }
  return pruned;
}

// 古い/欠落のサムネだけ生成して結果を返す。1 件失敗しても他は継続する。
// 生成前に孤児サムネ（ReleasedVersion に実体が無いバージョン）を削除して同期する。
async function generateReleasedThumbs(wdId: string, releasedDirWsl: string): Promise<ReleasedThumb[]> {
  const thumbsDir = path.join(workspacePath, "data/work", wdId, ".releasedthumbs");
  const releasedFiles = await listFiles(releasedDirWsl, PPTX_PATTERN);
  const byVersion = new Map<string, string>();
  for (const fname of releasedFiles) {
    const parsed = parsePptxVersion(fname);
    if (parsed) byVersion.set(parsed.version, fname);
  }

  const pruned = await pruneOrphanReleasedThumbs(thumbsDir, new Set(byVersion.keys()));
  if (pruned.length > 0) log.info("workFiles.releasedThumbs", "pruned orphan released thumbs", { wdId, pruned });

  const results: ReleasedThumb[] = [];
  for (const [version, fname] of byVersion) {
    const pptxFull = path.join(releasedDirWsl, fname);
    const thumbFull = path.join(thumbsDir, `${version}.png`);
    const relPath = path.join("data/work", wdId, ".releasedthumbs", `${version}.png`);
    const stale = thumbNeedsRebuild(await getMtime(pptxFull), await getMtime(thumbFull));
    if (!stale) {
      results.push({ version, path: relPath, generated: false });
      continue;
    }
    try {
      await runCoverThumb(pptxFull, thumbFull);
      results.push({ version, path: relPath, generated: true });
    } catch (err) {
      results.push({ version, path: relPath, generated: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

// ── ReleasedVersion ミラー同期（Windows D: を正・WSL を一致）────────────────
// D: と WSL の ReleasedVersion は常に一致しているべき（D: が正）。WSL 側は
// resolveSplitSource（split）や 小町谷さんの Explorer 閲覧が参照するため、
// D: を正としてコピー（D: が新しい/欠落）＋ 削除（WSL 余剰）で完全一致させる。
export interface MirrorFile {
  name: string;
  mtimeMs: number;
}

/** D: を正として WSL ReleasedVersion を一致させる差分（純粋・テスト対象）。
 *  toCopy: D: に有って WSL に無い or D: が新しい pptx（D:→WSL コピー対象）。
 *  toDelete: WSL に有って D: に無い pptx（削除対象＝完全一致方向）。 */
export function diffReleasedMirror(windows: MirrorFile[], wsl: MirrorFile[]): { toCopy: string[]; toDelete: string[] } {
  const wslByName = new Map(wsl.map((file) => [file.name, file.mtimeMs]));
  const winNames = new Set(windows.map((file) => file.name));
  const toCopy = windows
    .filter((winFile) => {
      const wslMtime = wslByName.get(winFile.name);
      return wslMtime === undefined || winFile.mtimeMs > wslMtime;
    })
    .map((winFile) => winFile.name);
  const toDelete = wsl.filter((wslFile) => !winNames.has(wslFile.name)).map((wslFile) => wslFile.name);
  return { toCopy, toDelete };
}

// ディレクトリ内 pptx の {name, mtimeMs} 一覧（ミラー差分用）。
async function statPptxList(dir: string): Promise<MirrorFile[]> {
  const names = await listFiles(dir, PPTX_PATTERN);
  const out: MirrorFile[] = [];
  for (const name of names) {
    const mtimeMs = await getMtime(path.join(dir, name));
    if (mtimeMs !== null) out.push({ name, mtimeMs });
  }
  return out;
}

// D:→WSL コピー（最終ガード: 直下・安全な pptx 名のみ）。
async function mirrorCopy(srcDir: string, destDir: string, names: string[]): Promise<string[]> {
  const done: string[] = [];
  for (const name of names) {
    const dest = path.join(destDir, name);
    if (!isSafePptxFilename(name) || !isContainedChild(dest, destDir, name)) continue;
    try {
      await fsp.copyFile(path.join(srcDir, name), dest);
      done.push(name);
    } catch {
      // 個別失敗は無視（次回再試行）
    }
  }
  return done;
}

// WSL 側 extras 削除（最終ガード: 直下・安全な pptx 名のみ）。
async function mirrorDelete(dir: string, names: string[]): Promise<string[]> {
  const done: string[] = [];
  for (const name of names) {
    const target = path.join(dir, name);
    if (!isSafePptxFilename(name) || !isContainedChild(target, dir, name)) continue;
    try {
      await fsp.unlink(target);
      done.push(name);
    } catch {
      // 個別失敗は無視（次回再試行）
    }
  }
  return done;
}

/** HISTORY.md をコピーすべきか（src が存在し、dest 欠落 or src が新しい）。純粋・テスト対象。 */
export function shouldCopyHistory(srcMtime: number | null, destMtime: number | null): boolean {
  if (srcMtime === null) return false;
  return destMtime === null || srcMtime > destMtime;
}

// ReleasedVersion 直下の HISTORY.md を src→dest へ、新しければコピーする（削除はしない）。
// pptx ミラー／プッシュと同じ両方向で呼ぶ。コピーしたら true。
async function mirrorHistoryFile(srcDir: string, destDir: string): Promise<boolean> {
  const src = path.join(srcDir, HISTORY_FILENAME);
  const dest = path.join(destDir, HISTORY_FILENAME);
  if (!isContainedChild(dest, destDir, HISTORY_FILENAME)) return false;
  if (!shouldCopyHistory(await getMtime(src), await getMtime(dest))) return false;
  try {
    await fsp.mkdir(destDir, { recursive: true });
    await fsp.copyFile(src, dest);
    return true;
  } catch {
    return false; // 個別失敗は無視（次回再試行）
  }
}

// Windows D: を正として WSL data/work/<wd>/ReleasedVersion を D: の ReleasedVersion に一致させる。
// D: に有って WSL に無い/古い pptx をコピー、WSL に有って D: に無い pptx を削除（完全一致）。
// D: 側 ReleasedVersion が存在しない or pptx 0 件のときは WSL を温存し何もしない（誤削除防止の安全弁）。
// ⚠ combine（リリース）配線時の注意: 新版は D: へ push（checkin）してからミラーすること。
//    さもないと「WSL に有って D: に無い」判定で作りたての新版が削除され得る。
async function syncReleasedFromWindows(wdId: string, windowsWdPath: string | null): Promise<{ copied: string[]; deleted: string[] }> {
  const empty = { copied: [], deleted: [] };
  if (!isValidWorkWdId(wdId) || !windowsWdPath) return empty;
  const winReleasedDir = path.join(windowsToWsl(windowsWdPath), "ReleasedVersion");
  if (!(await pathExists(winReleasedDir))) return empty;
  const winFiles = await statPptxList(winReleasedDir);
  if (winFiles.length === 0) return empty; // 安全弁: D: が空なら WSL を温存

  const wslReleasedDir = path.join(workspacePath, "data/work", wdId, "ReleasedVersion");
  const wslFiles = await statPptxList(wslReleasedDir);
  const { toCopy, toDelete } = diffReleasedMirror(winFiles, wslFiles);
  await fsp.mkdir(wslReleasedDir, { recursive: true });

  const copied = await mirrorCopy(winReleasedDir, wslReleasedDir, toCopy);
  const deleted = await mirrorDelete(wslReleasedDir, toDelete);
  const historyCopied = await mirrorHistoryFile(winReleasedDir, wslReleasedDir);
  if (copied.length || deleted.length || historyCopied) {
    log.info("workFiles.syncReleased", "mirrored ReleasedVersion from Windows (D: master)", { wdId, copied, deleted, historyCopied });
  }
  return { copied, deleted };
}

// WSL data/work/<wd>/ReleasedVersion を Windows(D:) の ReleasedVersion へ push（リリース逆同期）。
// diffReleasedMirror(WSL を正) で新/更新の pptx のみコピー。D: 側の他版は削除しない（安全側）。
// WSL 側 ReleasedVersion が空のときは no-op（誤コピー防止の安全弁）。
async function pushReleasedToWindows(wdId: string, windowsWdPath: string | null): Promise<{ copied: string[] }> {
  const empty: { copied: string[] } = { copied: [] };
  if (!isValidWorkWdId(wdId) || !windowsWdPath) return empty;
  const wslReleasedDir = path.join(workspacePath, "data/work", wdId, "ReleasedVersion");
  const wslFiles = await statPptxList(wslReleasedDir);
  if (wslFiles.length === 0) return empty; // 安全弁: WSL が空なら何もしない
  const winReleasedDir = path.join(windowsToWsl(windowsWdPath), "ReleasedVersion");
  await fsp.mkdir(winReleasedDir, { recursive: true });
  const winFiles = await statPptxList(winReleasedDir);
  const { toCopy } = diffReleasedMirror(wslFiles, winFiles); // WSL を正＝新/更新分のみ
  const copied = await mirrorCopy(wslReleasedDir, winReleasedDir, toCopy);
  const historyCopied = await mirrorHistoryFile(wslReleasedDir, winReleasedDir);
  if (copied.length || historyCopied) {
    log.info("workFiles.pushReleased", "pushed ReleasedVersion to Windows (WSL→D:)", { wdId, copied, historyCopied });
  }
  return { copied };
}

// ── 素材フォルダ D:→WSL ミラー（スライド生成用の素材・基礎情報）────────────
// FrameFiles/ScreenShots/RelatedMaterials（ディレクトリ）・ProjectInformation.md/
// DocumentLayouts.md（単体）・AudioFiles の逐語録 *.md（wav 除外）を D: を正に
// WSL へミラーする。サンドボックスの Claude は /mnt/d を読めないため、生成の素材を
// WSL 側へ取り込む。対象は下記 allowlist のみ＝WD 直下の editing サブフォルダ・
// ReleasedVersion には一切触れない。
// dir: 再帰フルミラー（D: に無いファイル/サブフォルダは削除）。
// filter 付き dir: そのディレクトリ直下で filter に合う拡張子のみ管理（他は非干渉）。
// file: 単体ミラー。各項目とも D: に無ければ温存（誤削除防止の安全弁）。
interface MaterialItem {
  name: string;
  kind: "dir" | "file";
  filter?: RegExp;
}
const SOURCE_MATERIALS: MaterialItem[] = [
  { name: "FrameFiles", kind: "dir" },
  { name: "ScreenShots", kind: "dir" },
  { name: "RelatedMaterials", kind: "dir" },
  { name: "AudioFiles", kind: "dir", filter: /\.md$/i }, // 逐語録 md のみ（wav は対象外）
  { name: "ProjectInformation.md", kind: "file" },
  { name: "DocumentLayouts.md", kind: "file" },
];

// withFileTypes 版 readdir（失敗時は空配列）。
async function readdirTypes(dir: string): Promise<import("fs").Dirent[]> {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// 単体ファイルのミラー（D: が新しい/欠落ならコピー）。D: に無ければ no-op（WSL 温存）。
async function mirrorSingleFile(srcFile: string, destFile: string): Promise<boolean> {
  const srcMtime = await getMtime(srcFile);
  if (srcMtime === null) return false; // D: に無い → 温存
  const destMtime = await getMtime(destFile);
  if (destMtime !== null && srcMtime <= destMtime) return false; // WSL が最新 → skip
  await fsp.mkdir(path.dirname(destFile), { recursive: true });
  await fsp.copyFile(srcFile, destFile);
  return true;
}

// filter に合う直下ファイルのみをミラー（他のファイル・サブフォルダは非干渉）。
async function mirrorFlatFiltered(srcDir: string, destDir: string, filter: RegExp): Promise<{ copied: number; deleted: number }> {
  const srcNames = await listFiles(srcDir, filter);
  await fsp.mkdir(destDir, { recursive: true });
  let copied = 0;
  for (const name of srcNames) {
    if (await mirrorSingleFile(path.join(srcDir, name), path.join(destDir, name))) copied++;
  }
  const srcSet = new Set(srcNames);
  let deleted = 0;
  for (const name of await listFiles(destDir, filter)) {
    if (srcSet.has(name)) continue;
    try {
      await fsp.unlink(path.join(destDir, name));
      deleted++;
    } catch {
      // 個別失敗は無視
    }
  }
  return { copied, deleted };
}

// ディレクトリの再帰フルミラー（D: を正・D: に無い WSL 側は削除）。
async function mirrorTreeFull(srcDir: string, destDir: string): Promise<{ copied: number; deleted: number }> {
  await fsp.mkdir(destDir, { recursive: true });
  const srcEntries = await readdirTypes(srcDir);
  const srcNames = new Set(srcEntries.map((ent) => ent.name));
  let copied = 0;
  let deleted = 0;
  for (const ent of srcEntries) {
    const src = path.join(srcDir, ent.name);
    const dest = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      const sub = await mirrorTreeFull(src, dest);
      copied += sub.copied;
      deleted += sub.deleted;
    } else if (ent.isFile() && (await mirrorSingleFile(src, dest))) {
      copied++;
    }
  }
  for (const ent of await readdirTypes(destDir)) {
    if (srcNames.has(ent.name)) continue;
    try {
      await fsp.rm(path.join(destDir, ent.name), { recursive: true, force: true });
      deleted++;
    } catch {
      // 個別失敗は無視
    }
  }
  return { copied, deleted };
}

// 1 素材項目をミラー（kind/filter に応じて分岐）。
async function mirrorMaterialItem(item: MaterialItem, src: string, dest: string): Promise<{ copied: number; deleted: number }> {
  if (item.kind === "file") {
    const done = await mirrorSingleFile(src, dest);
    return { copied: done ? 1 : 0, deleted: 0 };
  }
  if (!(await pathExists(src))) return { copied: 0, deleted: 0 }; // D: に無い dir は温存
  if (item.filter) return mirrorFlatFiltered(src, dest, item.filter);
  return mirrorTreeFull(src, dest);
}

// D: を正として WD 直下の素材（SOURCE_MATERIALS）を WSL にミラーする。
// D: 側 WD ルートが存在しない場合は no-op（誤削除防止）。
async function syncSourceMaterialsFromWindows(wdId: string, windowsWdPath: string | null): Promise<{ copied: number; deleted: number }> {
  const total = { copied: 0, deleted: 0 };
  if (!isValidWorkWdId(wdId) || !windowsWdPath) return total;
  const winWdDir = windowsToWsl(windowsWdPath);
  if (!(await pathExists(winWdDir))) return total;
  const wslWdDir = path.join(workspacePath, "data/work", wdId);
  for (const item of SOURCE_MATERIALS) {
    const res = await mirrorMaterialItem(item, path.join(winWdDir, item.name), path.join(wslWdDir, item.name));
    total.copied += res.copied;
    total.deleted += res.deleted;
  }
  if (total.copied || total.deleted) {
    log.info("workFiles.syncMaterials", "mirrored source materials from Windows (D: master)", { wdId, ...total });
  }
  return total;
}

// 登録済み WD の D:→WSL ミラー（ReleasedVersion のみ）＋リリース済サムネ生成。
// WD 展開時のプレビュー（released-thumbs）が使う本体。
// 素材（SOURCE_MATERIALS）には触れない ── 素材の取り込みは「登録」(register) と
// 「同期」(sync-materials) だけの責務。展開プレビューが先に取り込むと、直後に押した
// 「同期」が copied:0 を返し「素材は最新です（変更なし）」と誤報告する。
async function mirrorReleasedAndBuildThumbs(wdId: string, windowsWdPath: string): Promise<ReleasedThumb[]> {
  // D: を正として WSL の ReleasedVersion を先に同期（孤児サムネ/版ズレ解消）。
  await syncReleasedFromWindows(wdId, windowsWdPath);
  const releasedDirWsl = path.join(windowsToWsl(windowsWdPath), "ReleasedVersion");
  return generateReleasedThumbs(wdId, releasedDirWsl);
}

// 「登録」用：素材（FrameFiles/ScreenShots/RelatedMaterials/AudioFiles md/*.md 等）も
// 併せて D: を正にミラーしてから ReleasedVersion 同期＋サムネ生成を行う。
async function mirrorWindowsAndBuildThumbs(wdId: string, windowsWdPath: string): Promise<ReleasedThumb[]> {
  await syncSourceMaterialsFromWindows(wdId, windowsWdPath);
  return mirrorReleasedAndBuildThumbs(wdId, windowsWdPath);
}

// data/work/<wdId>/ が実体化済み（＝登録済み）か。
async function isWdRegistered(wdId: string): Promise<boolean> {
  return pathExists(path.join(workspacePath, "data/work", wdId));
}

// POST /api/work/released-thumbs — リリース選択前プレビュー（N5）。
// 未登録（WSL に data/work/<wd>/ が無い）WD では一切ミラー・生成しない（勝手に WD を実体化しない）。
// 素材フォルダには触れない（D: の素材の取り込みは「登録」と「同期」だけが行う）。
router.post(API_ROUTES.work.releasedThumbs, async (req, res) => {
  const reqBody = requestBodyRecord(req.body);
  const wdId = bodyString(reqBody, "wdId");
  const windowsWdPath = bodyString(reqBody, "windowsWdPath");

  if (!wdId || !isValidWorkWdId(wdId) || !windowsWdPath) {
    res.status(400).json({ error: "wdId (valid WD-ID) and windowsWdPath required" });
    return;
  }

  try {
    if (!(await isWdRegistered(wdId))) {
      res.json({ thumbs: [] }); // 未登録 WD は WSL に何も書かない
      return;
    }
    const thumbs = await mirrorReleasedAndBuildThumbs(wdId, windowsWdPath);
    res.json({ thumbs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("workFiles.releasedThumbs", "released thumb generation failed", { err });
    res.status(500).json({ error: msg });
  }
});

// POST /api/work/register — WD を WSL に「登録」する（明示操作でのみ実体化）。
// data/work/<wd>/ を作成（空 WD でも登録できるよう mkdir）し、D: を正に素材・
// ReleasedVersion をミラーしてリリース済サムネまで生成する。body `{ wdId, windowsWdPath }`。
router.post(API_ROUTES.work.register, async (req, res) => {
  const reqBody = requestBodyRecord(req.body);
  const wdId = bodyString(reqBody, "wdId");
  const windowsWdPath = bodyString(reqBody, "windowsWdPath");

  if (!wdId || !isValidWorkWdId(wdId) || !windowsWdPath) {
    res.status(400).json({ error: "wdId (valid WD-ID) and windowsWdPath required" });
    return;
  }

  try {
    await fsp.mkdir(path.join(workspacePath, "data/work", wdId), { recursive: true });
    const thumbs = await mirrorWindowsAndBuildThumbs(wdId, windowsWdPath);
    log.info("workFiles.register", "registered WD on WSL", { wdId });
    res.json({ registered: true, thumbs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("workFiles.register", "WD registration failed", { err });
    res.status(500).json({ error: msg });
  }
});

// POST /api/work/sync-materials — 登録済み WD の素材フォルダだけを D:(Windows) から WSL へ再同期する（「同期」）。
// SOURCE_MATERIALS（ScreenShots/RelatedMaterials/FrameFiles/AudioFiles の *.md/ProjectInformation.md/
// DocumentLayouts.md）を D: を正に完全一致ミラーし、追加・更新・削除を反映する。ReleasedVersion と
// .checkedoutpages には一切触れない（役割分離＝リリースは release-to-windows、頁は sw-page-checkin）。
// 未登録 WD は 409（先に「登録」が必要）。body `{ wdId, windowsWdPath }`。
router.post(API_ROUTES.work.syncMaterials, async (req, res) => {
  const reqBody = requestBodyRecord(req.body);
  const wdId = bodyString(reqBody, "wdId");
  const windowsWdPath = bodyString(reqBody, "windowsWdPath");

  if (!wdId || !isValidWorkWdId(wdId) || !windowsWdPath) {
    res.status(400).json({ error: "wdId (valid WD-ID) and windowsWdPath required" });
    return;
  }

  try {
    if (!(await isWdRegistered(wdId))) {
      res.status(409).json({ error: "未登録の WD は同期できません。先に「登録」してください。" });
      return;
    }
    const { copied, deleted } = await syncSourceMaterialsFromWindows(wdId, windowsWdPath);
    log.info("workFiles.syncMaterials", "manual source-material sync from Windows", { wdId, copied, deleted });
    res.json({ synced: true, copied, deleted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("workFiles.syncMaterials", "source-material sync failed", { err });
    res.status(500).json({ error: msg });
  }
});

// ── スタンプ選択（Windows 側 Stamps フォルダ）────────────────────────────────
// 「スタンプ選択」ボタン用。data/work/stamps/compressed の花モチーフのペア（修了証
// _completed.png / 未受講 _incompleted.png）から 1 件を選び、WD の Windows 側
// `Stamps` フォルダへ「既存を全消し→ペアをコピー」する。使用状況は同一カテゴリの
// 兄弟 WD の Stamps を走査して算出する（ファイル名一致）。

interface StampInfo {
  id: string; // 花名ベース（例 "bellflower"）＝選択キー
  flower: string; // 表示ラベル（例 "キキョウ"）
  label: string; // index.json のフルラベル or フォールバック
  thumbPath: string; // workspace 相対（/api/files/raw?path= で表示）
  completedFile: string;
  incompletedFile: string;
  usedByCurrent: boolean;
  usedBySiblings: { id: string; title: string }[];
}

interface StampIndexEntry {
  id?: string;
  label?: string;
}

// スタンプ png ファイル名の安全判定（パス区切り・`..`・先頭ドットを排し .png のみ許可）。
function isSafeStampFilename(name: string): boolean {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  if (name.startsWith(".")) return false;
  return /\.png$/i.test(name);
}

// 選択キー（花名ベース）の安全判定。英数字とアンダースコアのみ。
function isSafeStampBase(base: string): boolean {
  return STAMP_BASE_PATTERN.test(base);
}

// フルラベルから短い花名を取り出す（例「キキョウ 修了証スタンプ（フルカラー）」→「キキョウ」）。
function flowerFromLabel(label: string): string {
  const idx = label.indexOf("修了証スタンプ");
  return (idx >= 0 ? label.slice(0, idx) : label).trim();
}

// compressed 内でペアの揃った花名ベースを列挙する（_incompleted 欠けは warn して除外）。
async function listStampBases(compressedDir: string): Promise<string[]> {
  const completed = await listFiles(compressedDir, STAMP_COMPLETED_PATTERN);
  const bases: string[] = [];
  for (const name of completed) {
    const base = name.slice(0, -STAMP_COMPLETED_SUFFIX.length);
    if (await pathExists(path.join(compressedDir, `${base}${STAMP_INCOMPLETED_SUFFIX}`))) bases.push(base);
    else log.warn("workFiles.stamps", "stamp missing incompleted pair", { base });
  }
  return bases.sort((left, right) => left.localeCompare(right));
}

// index.json から `<id>_completed` → label のマップを作る（無ければ空マップ）。
async function readStampLabels(stampsDir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const parsed = await readJsonOrNull<{ assets?: StampIndexEntry[] }>(path.join(stampsDir, STAMPS_INDEX_FILENAME));
    for (const asset of parsed?.assets ?? []) {
      if (asset.id && asset.label) map.set(asset.id, asset.label);
    }
  } catch {
    // index が無い / 壊れている → フォールバックラベルを使う
  }
  return map;
}

// WD の Windows 側 Stamps に置かれた `*_completed.png` の花名ベース集合を返す。
async function stampsInWdFolder(winWdPath: string): Promise<Set<string>> {
  const wslStamps = path.join(windowsToWsl(winWdPath), STAMPS_FOLDER_NAME);
  const completed = await listFiles(wslStamps, STAMP_COMPLETED_PATTERN);
  return new Set(completed.map((name) => name.slice(0, -STAMP_COMPLETED_SUFFIX.length)));
}

// wdId が属するカテゴリを特定し、その WD 自身と同列の兄弟 WD を返す。
async function resolveStampSiblings(wdId: string): Promise<{ current: WdInfo | null; siblings: WdInfo[] }> {
  const categories = await scanRoot(await getWorkRootWin());
  for (const cat of categories) {
    const current = cat.wds.find((entry) => entry.id === wdId);
    if (current) return { current, siblings: cat.wds.filter((entry) => entry.id !== wdId) };
  }
  return { current: null, siblings: [] };
}

// 1 スタンプ分の StampInfo を組み立てる（純粋関数）。
function toStampInfo(base: string, labels: Map<string, string>, currentSet: Set<string>, siblingSets: { wd: WdInfo; set: Set<string> }[]): StampInfo {
  const label = labels.get(`${base}_completed`) ?? base;
  const usedBySiblings = siblingSets.filter((entry) => entry.set.has(base)).map((entry) => ({ id: entry.wd.id, title: entry.wd.title.trim() }));
  return {
    id: base,
    flower: flowerFromLabel(label) || base,
    label,
    thumbPath: `${STAMPS_DIR_REL}/${STAMPS_COMPRESSED_SUBDIR}/${base}${STAMP_COMPLETED_SUFFIX}`,
    completedFile: `${base}${STAMP_COMPLETED_SUFFIX}`,
    incompletedFile: `${base}${STAMP_INCOMPLETED_SUFFIX}`,
    usedByCurrent: currentSet.has(base),
    usedBySiblings,
  };
}

// スタンプ一覧＋当該 WD カテゴリの使用状況を組み立てる。
async function buildStampInfos(wdId: string): Promise<StampInfo[]> {
  const stampsDir = path.join(workspacePath, STAMPS_DIR_REL);
  const compressedDir = path.join(stampsDir, STAMPS_COMPRESSED_SUBDIR);
  const [bases, labels, ctx] = await Promise.all([listStampBases(compressedDir), readStampLabels(stampsDir), resolveStampSiblings(wdId)]);
  const currentSet = ctx.current ? await stampsInWdFolder(ctx.current.windowsWdPath) : new Set<string>();
  const siblingSets = await Promise.all(ctx.siblings.map(async (entry) => ({ wd: entry, set: await stampsInWdFolder(entry.windowsWdPath) })));
  return bases.map((base) => toStampInfo(base, labels, currentSet, siblingSets));
}

// Stamps フォルダ直下のエントリを全削除する（Stamps 自身は消さない）。削除数を返す。
async function wipeStampsFolder(stampsDir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await fsp.readdir(stampsDir);
  } catch {
    return 0; // まだ存在しない
  }
  let removed = 0;
  for (const name of entries) {
    const target = path.join(stampsDir, name);
    if (!isContainedChild(target, stampsDir, name)) continue;
    try {
      await fsp.rm(target, { recursive: true, force: true });
      removed++;
    } catch {
      // 個別失敗は無視
    }
  }
  return removed;
}

// 選択スタンプのペア（compressed）を Stamps フォルダへコピーする。コピー名の配列を返す。
async function copyStampPair(compressedDir: string, stampsDir: string, base: string): Promise<string[]> {
  const names = [`${base}${STAMP_COMPLETED_SUFFIX}`, `${base}${STAMP_INCOMPLETED_SUFFIX}`];
  const copied: string[] = [];
  for (const name of names) {
    const dest = path.join(stampsDir, name);
    if (!isSafeStampFilename(name) || !isContainedChild(dest, stampsDir, name)) continue;
    await fsp.copyFile(path.join(compressedDir, name), dest);
    copied.push(name);
  }
  return copied;
}

// GET /api/work/stamps?wdId=<id> — スタンプ一覧＋当該 WD カテゴリの使用状況。
router.get(API_ROUTES.work.stamps, async (req, res) => {
  const wdId = typeof req.query.wdId === "string" ? req.query.wdId : "";
  if (!wdId || !isValidWorkWdId(wdId)) {
    res.status(400).json({ error: "wdId (valid WD-ID) required" });
    return;
  }
  try {
    const stamps = await buildStampInfos(wdId);
    res.json({ stamps });
  } catch (err) {
    log.error("workFiles.stamps", "list stamps failed", { err });
    res.status(500).json({ error: "スタンプ一覧の取得に失敗しました" });
  }
});

// POST /api/work/stamp-apply — 選択スタンプのペアを WD の Windows 側 Stamps へ
// 「全消し→コピー」する。body `{ wdId, stampId, windowsWdPath? }`。
router.post(API_ROUTES.work.stampApply, async (req, res) => {
  const reqBody = requestBodyRecord(req.body);
  const wdId = bodyString(reqBody, "wdId");
  const stampId = bodyString(reqBody, "stampId");
  const windowsWdPath = bodyString(reqBody, "windowsWdPath");
  if (!wdId || !isValidWorkWdId(wdId) || !stampId || !isSafeStampBase(stampId)) {
    res.status(400).json({ error: "wdId (valid WD-ID) と stampId が必要です" });
    return;
  }
  try {
    const compressedDir = path.join(workspacePath, STAMPS_DIR_REL, STAMPS_COMPRESSED_SUBDIR);
    const completed = path.join(compressedDir, `${stampId}${STAMP_COMPLETED_SUFFIX}`);
    const incompleted = path.join(compressedDir, `${stampId}${STAMP_INCOMPLETED_SUFFIX}`);
    if (!(await pathExists(completed)) || !(await pathExists(incompleted))) {
      res.status(409).json({ error: "スタンプのペア（修了証／未受講）が見つかりません" });
      return;
    }
    const winPath = windowsWdPath ?? (await resolveWdWindowsPath(wdId));
    if (!winPath) {
      res.status(409).json({ error: "Windows パスを解決できませんでした" });
      return;
    }
    const stampsDir = path.join(windowsToWsl(winPath), STAMPS_FOLDER_NAME);
    await fsp.mkdir(stampsDir, { recursive: true });
    const removed = await wipeStampsFolder(stampsDir);
    const copied = await copyStampPair(compressedDir, stampsDir, stampId);
    log.info("workFiles.stampApply", "applied stamp to WD Stamps folder", { wdId, stampId, removed, copied });
    res.json({ applied: true, wdId, stampId, removed, copied });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("workFiles.stampApply", "apply stamp failed", { err });
    res.status(500).json({ error: msg });
  }
});

// POST /api/work/unregister — WD の WSL 実体（data/work/<wd>/）を丸ごと削除する（「抹消」）。
// 編集中バージョンが 1 つでも残っていれば 409 で拒否（編集中は WSL にしか無く失われるため）。
// Windows(D:) 側には一切触れない（D: が正。再登録でいつでも復元できる）。body `{ wdId }`。
router.post(API_ROUTES.work.unregister, async (req, res) => {
  const wdId = bodyString(requestBodyRecord(req.body), "wdId");

  if (!wdId || !isValidWorkWdId(wdId)) {
    res.status(400).json({ error: "wdId (valid WD-ID) required" });
    return;
  }

  try {
    const editing = await scanEditingVersions(wdId);
    if (editing.length > 0) {
      res.status(409).json({ error: "編集中バージョンが残っています。リリース済のみの状態でのみ抹消できます。" });
      return;
    }
    const workDataDir = path.join(workspacePath, "data/work");
    const deleted = await removeContainedDir(path.join(workDataDir, wdId), workDataDir, wdId);
    log.info("workFiles.unregister", "unregistered WD on WSL", { wdId, deleted });
    res.json({ unregistered: true, deleted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("workFiles.unregister", "WD unregistration failed", { err });
    res.status(500).json({ error: msg });
  }
});

// POST /api/work/release-to-windows — WSL の ReleasedVersion を Windows(D:) へ push（逆同期）。
// windowsWdPath 省略時は D: フォルダ名スキャン（resolveWdWindowsPath）で解決する。JSON。
router.post(API_ROUTES.work.releaseToWindows, async (req, res) => {
  const reqBody = requestBodyRecord(req.body);
  const wdId = bodyString(reqBody, "wdId");
  const windowsWdPath = bodyString(reqBody, "windowsWdPath");
  if (!wdId || !isValidWorkWdId(wdId)) {
    res.status(400).json({ error: "wdId (valid WD-ID) required" });
    return;
  }
  try {
    const winPath = windowsWdPath ?? (await resolveWdWindowsPath(wdId));
    if (!winPath) {
      res.status(400).json({ error: "windowsWdPath 未指定かつ D: 上に該当 WD フォルダが見つかりません" });
      return;
    }
    const { copied } = await pushReleasedToWindows(wdId, winPath);
    res.json({ copied, windowsWdPath: winPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("workFiles.releaseToWindows", "push to Windows failed", { err });
    res.status(500).json({ error: msg });
  }
});

// ── Windows COM 分割/結合の配線（split / combine）──────────────────────────
// data/work/scripts/sw-com.sh を WSL ホストが spawn し、SSE で進捗を流す。
// sw-com.sh が python.exe 検出・wslpath 変換・COM ツール実行・終了コード変換を担う。

// sw-com.sh の終了コードを人間向けメッセージにする（split/combine 共通）。
function comExitMessage(code: number | null): string {
  switch (code) {
    case 0:
      return "✅ 完了";
    case 2:
      return "ERROR: pywin32 が使える Windows Python が見つかりません（pip install pywin32）";
    case 3:
      return "ERROR: PowerPoint が起動中、または入力が不正です。PowerPoint を全て閉じて再実行してください";
    default:
      return `ERROR: COM ツールが失敗しました（exit ${String(code)}）`;
  }
}

// gen_thumbs.py（WSL LibreOffice・COM 非依存）を spawn してページサムネを生成する。
// 対象バージョンの `.pages`（structure.json 同梱）→ `.thumbcache/<id>_md.png`。
// full=true で全ページ強制再生成、false で欠落 or dirty のみ差分再生成（dirty は保持）。
// 失敗しても呼び出し側フローは止めない（サムネは後追い再生成できる）。
async function runGenThumbs(wdId: string, version: string, send: (line: string) => void, full = true): Promise<void> {
  const versionDir = path.join(workspacePath, "data/work", wdId, version);
  const pagesDir = path.join(versionDir, ".pages");
  const thumbDir = path.join(versionDir, ".thumbcache");
  await fsp.mkdir(thumbDir, { recursive: true });
  const scriptPath = path.join(workspacePath, "data/work/tools/gen_thumbs.py");
  const genArgs = [scriptPath, "--pages-dir", pagesDir, "--thumb-dir", thumbDir];
  if (full) genArgs.push("--full");
  await new Promise<void>((resolve) => {
    const proc = spawn("python3", genArgs, {
      env: { ...process.env },
    });
    pipeToSse(proc, send, "🖼 ");
    proc.on("close", () => resolve());
    proc.on("error", (err) => {
      send(`⚠ gen_thumbs: ${err.message}`);
      resolve();
    });
  });
}

// 新版作成 / リリース時に表紙の日付・バージョン番号を更新する項目セット（update_cover_meta --fields）。
const COVER_META_FIELDS_NEW_VERSION = "date,version"; // 新版作成: 作成日 + バージョン番号
const COVER_META_FIELDS_RELEASE = "date"; // リリース: 日付（リリース日）のみ

// update_cover_meta.py（python-pptx・COM 非依存）を spawn し、表紙ページの日付 /
// バージョン番号を更新する。表紙 pptx を書き換えると manifest で表紙が dirty 化され、
// 後続の gen_thumbs（差分）とユーザーの canvas 更新で反映される。表紙 / 日付ボックス /
// DocIdVersionLabel を持たない外部デッキやロック中の表紙は安全にスキップされる。
// 失敗しても新版作成 / リリースのフロー自体は止めない（警告のみ）。
async function runUpdateCoverMeta(wdId: string, version: string, fields: string, send: (line: string) => void): Promise<void> {
  const versionDir = path.join(workspacePath, "data/work", wdId, version);
  const scriptPath = path.join(workspacePath, "data/work/tools/update_cover_meta.py");
  const metaArgs = [scriptPath, "--version-dir", versionDir, "--wd", wdId, "--version", version, "--fields", fields];
  await new Promise<void>((resolve) => {
    const proc = spawn("python3", metaArgs, { env: { ...process.env } });
    pipeToSse(proc, send, "📅 ");
    proc.on("close", () => resolve());
    proc.on("error", (err) => {
      send(`⚠ update_cover_meta: ${err.message}`);
      resolve();
    });
  });
}

// history_md.py gate（改訂履歴・edit-slide §12-5）の終了コード＋出力を判定する（純粋・テスト対象）。
// GATE:STALE（exit 2）→ ブロック。GATE:OK（exit 0）→ 通過。それ以外（ツール異常）→
// フェイルオープン（reason="unverified"）＝リリースを恒久ロックしない。
export function interpretHistoryGate(code: number | null, out: string): { proceed: boolean; reason: string } {
  const stale = out.match(/GATE:STALE:(.*)/);
  if (code === 2 || stale) {
    return { proceed: false, reason: (stale?.[1] ?? "改訂履歴が未更新です").trim() };
  }
  if (code === 0 && /GATE:OK/.test(out)) return { proceed: true, reason: "ok" };
  return { proceed: true, reason: "unverified" }; // 想定外＝検証不能。続行（警告は呼び出し側）。
}

// history_md.py gate を spawn して改訂履歴の未更新を検査する（COM 非依存）。
// proceed=false のとき combine（リリース）を中止する。ツール異常時はフェイルオープン。
async function runHistoryGate(wdId: string, version: string): Promise<{ proceed: boolean; reason: string }> {
  const versionDir = path.join(workspacePath, "data/work", wdId, version);
  const scriptPath = path.join(workspacePath, "data/work/tools/history_md.py");
  const gateArgs = [scriptPath, "gate", "--wd", wdId, "--version-dir", versionDir];
  return await new Promise((resolve) => {
    let out = "";
    const proc = spawn("python3", gateArgs, { env: { ...process.env } });
    proc.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString()));
    proc.stderr?.on("data", (chunk: Buffer) => (out += chunk.toString()));
    proc.on("close", (code) => resolve(interpretHistoryGate(code, out)));
    proc.on("error", () => resolve({ proceed: true, reason: "unverified" }));
  });
}

// sw-com.sh を spawn して SSE に流す。成功(0)なら（onSuccess があれば実行してから）
// DONE、それ以外は ERROR を送る。onSuccess は成功時の後処理（例: gen_thumbs）。
async function runComScript(args: string[], wdId: string, send: (line: string) => void, onSuccess?: () => Promise<void>): Promise<void> {
  const scriptPath = path.join(workspacePath, "data/work/scripts/sw-com.sh");
  await new Promise<void>((resolve) => {
    const proc = spawn("bash", [scriptPath, ...args], {
      cwd: path.join(workspacePath, "data/work"),
      env: { ...process.env },
    });
    pipeToSse(proc, send);
    proc.on("close", (code) => {
      send(comExitMessage(code));
      const finish = async (): Promise<void> => {
        if (code === 0 && onSuccess) await onSuccess();
        send(code === 0 ? `DONE:${wdId}` : `ERROR: exit ${String(code)}`);
        resolve();
      };
      finish().catch((err) => {
        send(`⚠ ${err instanceof Error ? err.message : String(err)}`);
        send(`DONE:${wdId}`);
        resolve();
      });
    });
    proc.on("error", (err) => {
      send(`ERROR: ${err.message}`);
      resolve();
    });
  });
}

// COM 系エンドポイント共通の前処理（パラメータ検証 ＋ SSE ヘッダ）。
// 不正なら 400 を返して null、OK なら send 関数を返す。
function beginComStream(req: Request, res: Response): { wd: string; version: string; send: (line: string) => void } | null {
  const { wd, version } = wdVersionOf(req);
  if (!isValidWorkWdId(wd) || !isValidWorkVersion(version)) {
    res.status(400).json({ error: "invalid wd or version" });
    return null;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  return { wd, version, send: (line: string) => res.write(`data: ${line}\n\n`) };
}

// split の実ソースファイル名を解決する。要求されたファイルが ReleasedVersion に
// 実在すればそれを使う。実在しない場合でも ReleasedVersion に .pptx が
// ちょうど 1 つならそれを採用する（stale 名の自己回復）。
// 注: ReleasedVersion は D:→WSL ミラー（D: が正）で複数版を持ち得る。split 前に
// syncReleasedFromWindows で D: と一致させるため、通常は要求名が実在して分岐 1 で解決する。
// 複数版あって要求名が見つからない場合のみ自動選択不能エラー（ブラウザ再読込で解消）。
// 返り値 { name, note }：name が null なら解決不能。note は警告メッセージ（無ければ空）。
async function resolveSplitSource(wdId: string, requested: string): Promise<{ name: string | null; note: string }> {
  const releasedDir = path.join(workspacePath, "data/work", wdId, "ReleasedVersion");
  if ((await getMtime(path.join(releasedDir, requested))) !== null) {
    return { name: requested, note: "" };
  }
  const pptxs = await listFiles(releasedDir, PPTX_PATTERN);
  const [onlyPptx] = pptxs;
  if (pptxs.length === 1 && onlyPptx !== undefined) {
    return {
      name: onlyPptx,
      note: `⚠ 要求されたソース「${requested}」が見つからないため、ReleasedVersion 内の唯一の pptx「${onlyPptx}」を使用します（ブラウザが古い一覧の可能性。再読込を推奨）`,
    };
  }
  if (pptxs.length === 0) {
    return { name: null, note: `❌ ReleasedVersion に pptx がありません（要求: ${requested}）` };
  }
  return { name: null, note: `❌ 要求されたソース「${requested}」が見つからず、ReleasedVersion に pptx が複数（${pptxs.length}）あり自動選択できません` };
}

// POST /api/work/:wd/:version/split — ReleasedVersion 由来の新版を COM 分割（SSE）
router.post(API_ROUTES.work.split, async (req, res) => {
  const reqBody = requestBodyRecord(req.body);
  const sourceFilename = bodyString(reqBody, "sourceFilename");
  const sourceKind = bodyString(reqBody, "sourceKind");
  const sourceFrom = bodyString(reqBody, "sourceFrom");
  if (!sourceFilename || !isSafePptxFilename(sourceFilename)) {
    res.status(400).json({ error: "valid sourceFilename (*.pptx) required" });
    return;
  }
  const ctx = beginComStream(req, res);
  if (!ctx) return;
  // split 前の安全網: D: を正として ReleasedVersion を同期（stale 名の自己回復）。
  // windowsWdPath は body に無いため D: フォルダ名スキャン（resolveWdWindowsPath）で解決する。
  const synced = await syncReleasedFromWindows(ctx.wd, await resolveWdWindowsPath(ctx.wd));
  if (synced.copied.length || synced.deleted.length) {
    ctx.send(`🔄 ReleasedVersion を D: に同期（+${synced.copied.length}/-${synced.deleted.length}）`);
  }
  const resolved = await resolveSplitSource(ctx.wd, sourceFilename);
  if (resolved.note) ctx.send(resolved.note);
  if (!resolved.name) {
    ctx.send(`ERROR: ${resolved.note}`);
    ctx.send(`ERROR: exit 1`);
    res.end();
    return;
  }
  // フォールバックで別ファイルを採用した場合は、古い版を指す sourceFrom を捨てて
  // ツール側の「ファイル名から既定」に委ねる（誤った由来メタの記録を防ぐ）。
  const effectiveFrom = resolved.name === sourceFilename ? (sourceFrom ?? "") : "";
  const args = ["split", ctx.wd, ctx.version, resolved.name, sourceKind ?? "released", effectiveFrom];
  // 案A：COM 分割の成功後にサーバー側で表紙メタ（作成日 + バージョン番号）を更新してから
  // gen_thumbs でサムネまで生成し、エディタが即サムネ表示できるようにする
  // （canvas は明示「更新」ボタンで後追い）。
  await runComScript(args, ctx.wd, ctx.send, async () => {
    await runUpdateCoverMeta(ctx.wd, ctx.version, COVER_META_FIELDS_NEW_VERSION, ctx.send);
    await runGenThumbs(ctx.wd, ctx.version, ctx.send);
  });
  res.end();
});

// POST /api/work/:wd/:version/combine — .pages を COM 結合して ReleasedVersion へ（SSE）
router.post(API_ROUTES.work.combine, async (req, res) => {
  const reqBody = requestBodyRecord(req.body);
  const outFilename = bodyString(reqBody, "outFilename");
  const dedupMasters = bodyBoolean(reqBody, "dedupMasters");
  const force = bodyBoolean(reqBody, "force");
  if (!outFilename || !isSafePptxFilename(outFilename)) {
    res.status(400).json({ error: "valid outFilename (*.pptx) required" });
    return;
  }
  {
    const { wd, version } = wdVersionOf(req);
    if (isValidWorkWdId(wd) && isValidWorkVersion(version) && (await blockIfLockedForBulk(wd, version, res))) return;
  }
  const ctx = beginComStream(req, res);
  if (!ctx) return;
  // 改訂履歴ゲート（§12-5）：改訂履歴頁が無い / 概要セクションが無い / 版セット不一致なら
  // リリース（結合）を中止する。force=true で回避可（緊急用・UI 非公開）。
  if (force === true) {
    ctx.send("⚠ force 指定により改訂履歴ゲートをスキップしました");
  } else {
    const gate = await runHistoryGate(ctx.wd, ctx.version);
    if (!gate.proceed) {
      ctx.send(`⛔ リリースを中止しました：改訂履歴が未更新です（${gate.reason}）。`);
      ctx.send("　→ 「改訂履歴を更新して」を実行し、概要セクション先頭の改訂履歴頁を最新化してから、もう一度リリースしてください。");
      res.end();
      return;
    }
    ctx.send(gate.reason === "unverified" ? "⚠ 改訂履歴ゲートを検証できませんでした（続行します）" : "✅ 改訂履歴ゲート: OK");
  }
  const args = ["combine", ctx.wd, ctx.version, outFilename];
  if (dedupMasters === false) args.push("nodedup");
  // リリース時は結合前に表紙の日付（リリース日）を更新する（バージョン番号は新版作成時に確定済み）。
  // COM 結合は .pages/*.pptx を読むため、先に表紙 pptx を書き換えておけば結合物へ反映される。
  await runUpdateCoverMeta(ctx.wd, ctx.version, COVER_META_FIELDS_RELEASE, ctx.send);
  // 結合成功後、新版 ReleasedVersion を Windows(D:) へ自動 push（L823 の注記どおり
  // 「新版は D: へ push してからミラー」の順序を守る）。Windows パスは D: フォルダ名
  // スキャン（resolveWdWindowsPath）で解決する。
  await runComScript(args, ctx.wd, ctx.send, async () => {
    const winPath = await resolveWdWindowsPath(ctx.wd);
    if (!winPath) {
      ctx.send("⚠ Windows パスを解決できず、D: への push をスキップしました（ReleasedVersion は WSL に生成済み）");
      return;
    }
    const { copied } = await pushReleasedToWindows(ctx.wd, winPath);
    ctx.send(copied.length ? `📤 D: へ push: ${copied.join(", ")}` : "ℹ D: は既に最新です（push 対象なし）");
  });
  res.end();
});

// POST /api/work/:wd/:version/canvas-refresh — .pages を COM でページ単位 canvas 再生成（SSE）
router.post(API_ROUTES.work.canvasRefresh, async (req, res) => {
  const full = bodyBoolean(requestBodyRecord(req.body), "full");
  const ctx = beginComStream(req, res);
  if (!ctx) return;
  const args = ["canvas", ctx.wd, ctx.version];
  if (full === true) args.push("full");
  await runComScript(args, ctx.wd, ctx.send);
  res.end();
});

// 現在時刻を JST (+09:00) ISO 文字列で返す（structure.json の created/updated 用）。
function jstIsoNow(): string {
  const jst = new Date(Date.now() + 9 * ONE_HOUR_MS);
  return jst.toISOString().replace("Z", "+09:00");
}

/** フォーク先 structure.json を構築（純粋）。元の構造（sections/pages）は温存し、
 *  version・source・created_at・updated_at だけを新版向けに差し替える。 */
export function buildForkedStructure(
  source: Record<string, unknown>,
  wdId: string,
  targetVersion: string,
  sourceVersion: string,
  nowIso: string,
): Record<string, unknown> {
  return {
    ...source,
    wd: wdId,
    version: targetVersion,
    source: { kind: "editing", from: sourceVersion },
    created_at: nowIso,
    updated_at: nowIso,
  };
}

/** フォーク先 manifest.json を構築（純粋）。ページは元版とバイト同一なので
 *  レンダ情報（thumb/canvas/content_hash/dirty）はそのまま引き継ぎ、version だけ差し替える。 */
export function buildForkedManifest(source: Record<string, unknown>, targetVersion: string): Record<string, unknown> {
  return { ...source, version: targetVersion };
}

// パス（ファイル/ディレクトリ）が存在するか。
async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

// fork-from の事前検証（JSON エラーで返す・SSE ヘッダ flush 前に呼ぶ）。
// 元に structure.json が無ければ 400、作成先が既存なら 409、元にロックが
// 残っていれば 409。問題なければ null。
async function preflightFork(wdId: string, targetVersion: string, sourceVersion: string): Promise<{ status: number; error: string } | null> {
  const wdDir = path.join(workspacePath, "data/work", wdId);
  const srcStruct = path.join(wdDir, sourceVersion, ".pages", "structure.json");
  try {
    await fsp.access(srcStruct);
  } catch {
    return { status: 400, error: "元バージョンの structure.json が見つかりません" };
  }
  try {
    await fsp.access(path.join(wdDir, targetVersion, ".pages"));
    return { status: 409, error: "作成先バージョンは既に存在します" };
  } catch {
    // 作成先が無いのが正常
  }
  if (await hasLockedPages(path.join(wdDir, sourceVersion))) {
    return { status: 409, error: "元バージョンにチェックアウト中のページが残っています" };
  }
  return null;
}

// フォーク先 structure.json の version/source を新版へ書き換える。
async function patchForkStructure(structPath: string, wdId: string, targetVersion: string, sourceVersion: string): Promise<void> {
  const parsed = await readJsonOrNull<unknown>(structPath);
  if (!isRecord(parsed)) throw new Error(`structure.json を読めませんでした: ${structPath}`);
  const patched = buildForkedStructure(parsed, wdId, targetVersion, sourceVersion, jstIsoNow());
  await fsp.writeFile(structPath, `${JSON.stringify(patched, null, 2)}\n`, "utf-8");
}

// 元の .thumbcache があればコピーし manifest の version を差し替える。コピーしたら true。
async function copyForkThumbcache(srcDir: string, dstDir: string, targetVersion: string): Promise<boolean> {
  const srcThumb = path.join(srcDir, ".thumbcache");
  if (!(await pathExists(srcThumb))) return false;
  const dstThumb = path.join(dstDir, ".thumbcache");
  await fsp.cp(srcThumb, dstThumb, { recursive: true });
  const manifestPath = path.join(dstThumb, "manifest.json");
  if (await pathExists(manifestPath)) {
    const parsed = await readJsonOrNull<unknown>(manifestPath);
    if (!isRecord(parsed)) throw new Error(`manifest.json を読めませんでした: ${manifestPath}`);
    const patched = buildForkedManifest(parsed, targetVersion);
    await fsp.writeFile(manifestPath, `${JSON.stringify(patched, null, 2)}\n`, "utf-8");
  }
  return true;
}

// 元の .pagecanvas があればコピー、無ければ空ディレクトリを作る。
async function copyForkCanvas(srcDir: string, dstDir: string): Promise<void> {
  const srcCanvas = path.join(srcDir, ".pagecanvas");
  const dstCanvas = path.join(dstDir, ".pagecanvas");
  if (await pathExists(srcCanvas)) {
    await fsp.cp(srcCanvas, dstCanvas, { recursive: true });
  } else {
    await fsp.mkdir(dstCanvas, { recursive: true });
  }
}

// fork-from の本体（案A）：元 .pages / .thumbcache / .pagecanvas をコピーして新版を作る。
// ページは元版とバイト同一なので canvas/thumb もコピーすれば dirty 無しで即・高解像度表示できる。
// 元に .thumbcache が無い場合のみ gen_thumbs でサムネを生成する。
async function performFork(wdId: string, targetVersion: string, sourceVersion: string, send: (line: string) => void): Promise<void> {
  const wdDir = path.join(workspacePath, "data/work", wdId);
  const srcDir = path.join(wdDir, sourceVersion);
  const dstDir = path.join(wdDir, targetVersion);

  send(`📄 ${sourceVersion} をコピー中...`);
  await fsp.cp(path.join(srcDir, ".pages"), path.join(dstDir, ".pages"), { recursive: true });
  await patchForkStructure(path.join(dstDir, ".pages", "structure.json"), wdId, targetVersion, sourceVersion);

  const hasThumb = await copyForkThumbcache(srcDir, dstDir, targetVersion);
  await copyForkCanvas(srcDir, dstDir);
  send(`✅ ${sourceVersion} → ${targetVersion} をコピーしました`);

  // 新版なので表紙の日付（作成日）・バージョン番号を更新する（表紙ページが dirty 化される）。
  await runUpdateCoverMeta(wdId, targetVersion, COVER_META_FIELDS_NEW_VERSION, send);

  if (hasThumb) {
    // 引き継いだサムネのうち表紙だけがメタ更新で dirty。差分再生成で表紙サムネのみ更新する
    // （canvas は dirty のまま → 明示「更新」ボタンで後追い反映）。
    send("🖼 サムネ・canvas を元版から引き継ぎ（表紙のみ差分再生成）");
    await runGenThumbs(wdId, targetVersion, send, false);
  } else {
    await runGenThumbs(wdId, targetVersion, send);
  }
}

// ── 新規デッキ作成（N3・UI モーダル発）─────────────────────────────────────
// new_deck.py（WSL python-pptx・COM 非依存）で表紙 1 枚＋structure.json を生成し、
// 続けて gen_thumbs でサムネまで作る。canvas は明示「更新」ボタンで後追い。

/** new_deck.py の --theme に渡せるテーマ ID（純粋定数・フロントの 12 択と一致）。 */
export const NEW_DECK_THEME_IDS = ["cool", "warm", "vivid", "dark", "plain", "earth", "neutral", "soft", "forest", "premium", "tropical", "marine"] as const;

/** 受け取った値がテーマ ID カタログに載っているか（未知・非文字列は false）。 */
function isNewDeckThemeId(value: unknown): boolean {
  return NEW_DECK_THEME_IDS.some((themeId) => themeId === value);
}

/** new-deck body の純粋検証。問題があればエラーメッセージ、無ければ null。 */
export function validateNewDeckBody(body: { title?: unknown; theme?: unknown }): string | null {
  if (typeof body.title !== "string" || !body.title.trim()) return "title は必須です";
  if (body.title.length > 200) return "title が長すぎます（200 文字以内）";
  if (!isNewDeckThemeId(body.theme)) {
    return `theme は ${NEW_DECK_THEME_IDS.join("/")} のいずれかを指定してください`;
  }
  return null;
}

// new_deck.py の CLI 引数を組み立てる（純粋）。
export function buildNewDeckArgs(
  scriptPath: string,
  versionDir: string,
  wdId: string,
  version: string,
  body: { title: string; theme: string; confidential?: boolean },
): string[] {
  const args = [scriptPath, "--version-dir", versionDir, "--wd", wdId, "--version", version, "--title", body.title.trim(), "--theme", body.theme];
  if (body.confidential === false) args.push("--no-confidential");
  return args;
}

// 新規作成時に D: 側の WD フォルダ構成（ReleasedVersion＋素材フォルダ）を WSL へミラーする。
// released-thumbs エンドポイントと同じ D: を正・allowlist 固定の安全ミラー。
// windowsWdPath が無ければ no-op（誤削除防止）。SSE に進捗を流す。
async function mirrorWindowsWdFolder(wdId: string, windowsWdPath: string | null, send: (line: string) => void): Promise<void> {
  if (!windowsWdPath) return;
  send("🔄 D: の WD フォルダ構成（ReleasedVersion・素材）を WSL にミラー中...");
  const released = await syncReleasedFromWindows(wdId, windowsWdPath);
  const materials = await syncSourceMaterialsFromWindows(wdId, windowsWdPath);
  const copied = released.copied.length + materials.copied;
  const deleted = released.deleted.length + materials.deleted;
  send(`🔄 ミラー完了: コピー ${String(copied)} 件 / 削除 ${String(deleted)} 件`);
}

// new_deck.py を spawn して SSE に流す。成功(0)なら gen_thumbs → DONE、失敗なら ERROR。
async function runNewDeck(
  wdId: string,
  version: string,
  body: { title: string; theme: string; confidential?: boolean },
  send: (line: string) => void,
): Promise<void> {
  const versionDir = path.join(workspacePath, "data/work", wdId, version);
  const scriptPath = path.join(workspacePath, "data/work/tools/new_deck.py");
  const args = buildNewDeckArgs(scriptPath, versionDir, wdId, version, body);
  await new Promise<void>((resolve) => {
    const proc = spawn("python3", args, { env: { ...process.env } });
    pipeToSse(proc, send, "📄 ");
    proc.on("close", (code) => {
      const finish = async (): Promise<void> => {
        if (code === 0) {
          await runGenThumbs(wdId, version, send);
          send(`DONE:${wdId}`);
        } else {
          send("ERROR: new_deck.py が失敗しました（WSL ホストに python-pptx / lxml が必要: pip install python-pptx lxml --break-system-packages）");
          send(`ERROR: exit ${String(code)}`);
        }
        resolve();
      };
      finish().catch((err) => {
        send(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
        resolve();
      });
    });
    proc.on("error", (err) => {
      send(`ERROR: ${err.message}`);
      resolve();
    });
  });
}

// POST /api/work/:wd/:version/new-deck — 新規デッキ作成（SSE）
router.post(API_ROUTES.work.newDeck, async (req, res) => {
  const { wd, version } = wdVersionOf(req);
  const body = requestBodyRecord(req.body);
  if (!isValidWorkWdId(wd) || !isValidWorkVersion(version)) {
    res.status(400).json({ error: "invalid wd or version" });
    return;
  }
  const bodyError = validateNewDeckBody(body);
  if (bodyError) {
    res.status(400).json({ error: bodyError });
    return;
  }
  // preflight: 作成先に structure.json が既存なら誤上書き防止（new_deck.py と同じガードを JSON で先に返す）
  if (await pathExists(path.join(workspacePath, "data/work", wd, version, ".pages", "structure.json"))) {
    res.status(409).json({ error: "作成先バージョンには既に structure.json が存在します" });
    return;
  }
  const ctx = beginComStream(req, res);
  if (!ctx) return;
  // 先に D: 側の WD フォルダ構成（素材・ReleasedVersion）を WSL へミラーしてから v001 を生成する。
  await mirrorWindowsWdFolder(wd, bodyString(body, "windowsWdPath") ?? null, ctx.send);
  await runNewDeck(
    wd,
    version,
    {
      title: bodyString(body, "title") ?? "",
      theme: bodyString(body, "theme") ?? "cool",
      ...(body.confidential !== undefined ? { confidential: bodyBoolean(body, "confidential") } : {}),
    },
    ctx.send,
  );
  res.end();
});

// ── テーマ再適用（Phase2）──────────────────────────────────────────────────
// apply_theme.py（WSL python-pptx・COM 非依存）でデッキ全ページに配色を再適用し、
// structure.json に theme を永続化 → gen_thumbs でサムネ再生成 → DONE。
// canvas は明示「更新」ボタンで後追い。ホスト実行なのでサムネ豆腐は出ない。

/** theme body の純粋検証。問題があればエラーメッセージ、無ければ null。 */
export function validateThemeBody(body: { theme?: unknown }): string | null {
  if (!isNewDeckThemeId(body.theme)) {
    return `theme は ${NEW_DECK_THEME_IDS.join("/")} のいずれかを指定してください`;
  }
  return null;
}

/** apply_theme.py の CLI 引数を組み立てる（純粋）。 */
export function buildApplyThemeArgs(scriptPath: string, versionDir: string, theme: string): string[] {
  return [scriptPath, "--version-dir", versionDir, "--theme", theme];
}

// apply_theme.py を spawn して SSE に流す。成功(0)なら gen_thumbs → DONE、失敗なら ERROR。
async function runApplyTheme(wdId: string, version: string, theme: string, send: (line: string) => void): Promise<void> {
  const versionDir = path.join(workspacePath, "data/work", wdId, version);
  const scriptPath = path.join(workspacePath, "data/work/tools/apply_theme.py");
  const args = buildApplyThemeArgs(scriptPath, versionDir, theme);
  await new Promise<void>((resolve) => {
    const proc = spawn("python3", args, { env: { ...process.env } });
    pipeToSse(proc, send, "🎨 ");
    proc.on("close", (code) => {
      const finish = async (): Promise<void> => {
        if (code === 0) {
          await runGenThumbs(wdId, version, send);
          send(`DONE:${wdId}`);
        } else {
          send("ERROR: apply_theme.py が失敗しました（WSL ホストに python-pptx / lxml が必要: pip install python-pptx lxml --break-system-packages）");
          send(`ERROR: exit ${String(code)}`);
        }
        resolve();
      };
      finish().catch((err) => {
        send(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
        resolve();
      });
    });
    proc.on("error", (err) => {
      send(`ERROR: ${err.message}`);
      resolve();
    });
  });
}

// POST /api/work/:wd/:version/theme — デッキ全ページにテーマ再適用（SSE）
router.post(API_ROUTES.work.theme, async (req, res) => {
  const { wd, version } = wdVersionOf(req);
  const body = requestBodyRecord(req.body);
  if (!isValidWorkWdId(wd) || !isValidWorkVersion(version)) {
    res.status(400).json({ error: "invalid wd or version" });
    return;
  }
  const bodyError = validateThemeBody(body);
  if (bodyError) {
    res.status(400).json({ error: bodyError });
    return;
  }
  // preflight: 対象バージョンに structure.json が無ければ 404（SSE flush 前に JSON で返す）
  if (!(await pathExists(path.join(workspacePath, "data/work", wd, version, ".pages", "structure.json")))) {
    res.status(404).json({ error: "対象バージョンに structure.json がありません" });
    return;
  }
  // 一括操作ゲート：ロック中ページがあればブロック（先にチェックイン）。
  if (await blockIfLockedForBulk(wd, version, res)) return;
  const ctx = beginComStream(req, res);
  if (!ctx) return;
  await runApplyTheme(wd, version, bodyString(body, "theme") ?? "cool", ctx.send);
  res.end();
});

// ── テンプレート適用 ──────────────────────────────────────────────────────────
// apply_template.py（WSL python-pptx・COM 非依存）で全ページを指定テンプレの土台に
// 作り替え、apply_theme に委譲して配色 → gen_thumbs でサムネ再生成 → DONE。
// 「テンプレの部品を元に挿入」ではなく「テンプレを土台に元の記載内容を転記した新ページ」
// に置換する（整形コピー方式）。先頭＝表紙 / 他＝本文。テーマ未適用なら plain。

const TEMPLATES_DIR = "data/styles/powerpoint";
// テンプレ ID（拡張子なしファイル名）に許すのは英数始まりの英数・._- のみ（線形＝ReDoS 無し）。
// パス区切り `/` や先頭 `.`（`..` 等）を含む値は弾く。実在チェックは listTemplateIds が担う。
const TEMPLATE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** data/styles/powerpoint/*.pptx を走査してテンプレ ID 一覧を返す（.bak.pptx は除外）。 */
async function listTemplateIds(): Promise<string[]> {
  const dir = path.join(workspacePath, TEMPLATES_DIR);
  const ids = (await readdirTypes(dir))
    .filter((ent) => ent.isFile() && /\.pptx$/i.test(ent.name) && !/\.bak\.pptx$/i.test(ent.name))
    .map((ent) => ent.name.replace(/\.pptx$/i, ""));
  return ids.sort((left, right) => left.localeCompare(right));
}

// GET /api/work/templates — 適用可能なテンプレート一覧（リボンのプルダウン用）
router.get(API_ROUTES.work.templates, async (_req, res) => {
  try {
    const templates = (await listTemplateIds()).map((tid) => ({ id: tid, label: tid }));
    res.json({ templates });
  } catch (err) {
    log.error("workFiles.templates", "list failed", { err });
    res.status(500).json({ error: "template list failed" });
  }
});

// GET /api/work/:wd/title — D: フォルダ名由来のメインタイトルを解決して返す。
// スライド編集画面の「リリース」ボタンが既定ファイル名を組み立てるために使う。
// 解決失敗（D: 走査不可・未登録）は 200 + { title: null }（呼び出し側で WD-ID のみに縮退）。
router.get(API_ROUTES.work.wdTitle, async (req, res) => {
  const wdId = wdOf(req);
  const title = await resolveWdTitle(wdId);
  res.json({ title });
});

/** apply-template body の純粋検証。問題があればエラーメッセージ、無ければ null。 */
export function validateApplyTemplateBody(body: { template?: unknown; theme?: unknown }): string | null {
  if (body.template !== undefined && (typeof body.template !== "string" || !TEMPLATE_ID_RE.test(body.template))) {
    return "template は英数・._- のみのテンプレ ID を指定してください";
  }
  if (body.theme !== undefined && !isNewDeckThemeId(body.theme)) {
    return `theme は ${NEW_DECK_THEME_IDS.join("/")} のいずれかを指定してください`;
  }
  return null;
}

/** apply_template.py の CLI 引数を組み立てる（純粋）。template/theme/title は省略可。 */
export function buildApplyTemplateArgs(scriptPath: string, versionDir: string, template?: string, theme?: string, title?: string): string[] {
  const args = [scriptPath, "--version-dir", versionDir];
  if (template) args.push("--template", template);
  if (theme) args.push("--theme", theme);
  // 表紙メインタイトル＝フォルダ名の Doc ID 以降。渡せば表紙・Thank You を元ページ非依存で
  // 生成する（未指定時は python 側が元表紙から抽出フォールバック）。
  if (title && title.trim()) args.push("--title", title.trim());
  return args;
}

// apply_template.py を spawn して SSE に流す。成功(0)なら gen_thumbs → DONE、失敗なら ERROR。
async function runApplyTemplate(
  wdId: string,
  version: string,
  template: string | undefined,
  theme: string | undefined,
  send: (line: string) => void,
): Promise<void> {
  const versionDir = path.join(workspacePath, "data/work", wdId, version);
  const scriptPath = path.join(workspacePath, "data/work/tools/apply_template.py");
  // フォルダ名からメインタイトルを解決して渡す（表紙・Thank You を元ページ非依存で生成）。
  const title = await resolveWdTitle(wdId);
  const args = buildApplyTemplateArgs(scriptPath, versionDir, template, theme, title ?? undefined);
  await new Promise<void>((resolve) => {
    const proc = spawn("python3", args, { env: { ...process.env } });
    pipeToSse(proc, send, "🧩 ");
    proc.on("close", (code) => {
      const finish = async (): Promise<void> => {
        if (code === 0) {
          await runGenThumbs(wdId, version, send);
          send(`DONE:${wdId}`);
        } else {
          send("ERROR: apply_template.py が失敗しました（WSL ホストに python-pptx / lxml が必要: pip install python-pptx lxml --break-system-packages）");
          send(`ERROR: exit ${String(code)}`);
        }
        resolve();
      };
      finish().catch((err) => {
        send(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
        resolve();
      });
    });
    proc.on("error", (err) => {
      send(`ERROR: ${err.message}`);
      resolve();
    });
  });
}

// POST /api/work/:wd/:version/apply-template — 全ページをテンプレ土台に作り替え（SSE）
router.post(API_ROUTES.work.applyTemplate, async (req, res) => {
  const { wd, version } = wdVersionOf(req);
  const body = requestBodyRecord(req.body);
  if (!isValidWorkWdId(wd) || !isValidWorkVersion(version)) {
    res.status(400).json({ error: "invalid wd or version" });
    return;
  }
  const bodyError = validateApplyTemplateBody(body);
  if (bodyError) {
    res.status(400).json({ error: bodyError });
    return;
  }
  const template = bodyString(body, "template");
  const theme = bodyString(body, "theme");
  if (template && !(await listTemplateIds()).includes(template)) {
    res.status(404).json({ error: `テンプレートが見つかりません: ${template}` });
    return;
  }
  // preflight: structure.json が無ければ 404（SSE flush 前に JSON で返す）
  if (!(await pathExists(path.join(workspacePath, "data/work", wd, version, ".pages", "structure.json")))) {
    res.status(404).json({ error: "対象バージョンに structure.json がありません" });
    return;
  }
  // 一括操作ゲート：ロック中ページがあればブロック（先にチェックイン）。
  if (await blockIfLockedForBulk(wd, version, res)) return;
  const ctx = beginComStream(req, res);
  if (!ctx) return;
  await runApplyTemplate(wd, version, template, theme, ctx.send);
  res.end();
});

// POST /api/work/:wd/:version/fork-from — 編集中由来の新版を .pages コピーで作成（SSE）
router.post(API_ROUTES.work.forkFrom, async (req, res) => {
  const { wd, version } = wdVersionOf(req);
  const sourceVersion = bodyString(requestBodyRecord(req.body), "sourceVersion");
  if (!isValidWorkWdId(wd) || !isValidWorkVersion(version)) {
    res.status(400).json({ error: "invalid wd or version" });
    return;
  }
  if (!sourceVersion || !isValidWorkVersion(sourceVersion)) {
    res.status(400).json({ error: "valid sourceVersion required" });
    return;
  }
  if (sourceVersion === version) {
    res.status(400).json({ error: "sourceVersion と同じバージョンにはフォークできません" });
    return;
  }
  const pre = await preflightFork(wd, version, sourceVersion);
  if (pre) {
    res.status(pre.status).json({ error: pre.error });
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const send = (line: string): void => {
    res.write(`data: ${line}\n\n`);
  };
  try {
    await performFork(wd, version, sourceVersion, send);
    send(`DONE:${wd}`);
  } catch (err) {
    log.error("workFiles.forkFrom", "fork failed", { err });
    send(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
  res.end();
});

// structure.json に checked_out:true のページが残っているか（編集中ガード）。
// structure.json が無い／壊れている場合は「ロック無し」とみなす（後始末は許可）。
async function hasLockedPages(versionDir: string): Promise<boolean> {
  try {
    const struct = await readJsonOrNull<{ pages?: Record<string, { checked_out?: boolean }> }>(path.join(versionDir, ".pages", "structure.json"));
    return struct?.pages ? Object.values(struct.pages).some((page) => page.checked_out === true) : false;
  } catch {
    return false;
  }
}

// 親ディレクトリ直下の指定名フォルダだけを安全に削除する。
// 二重ガード（正規表現＋ isContainedChild）に通らなければ例外で中止。
// 既に存在しない場合は false（削除なし）を返す。
async function removeContainedDir(target: string, parent: string, name: string): Promise<boolean> {
  if (!isContainedChild(target, parent, name)) {
    throw new Error(`refusing to delete a path outside the expected parent: ${target}`);
  }
  try {
    await fsp.access(target);
  } catch {
    return false;
  }
  await fsp.rm(target, { recursive: true, force: true });
  return true;
}

interface DeleteSide {
  path: string | null;
  deleted: boolean;
}
type DeleteVersionResult = { ok: true; wd: string; version: string; wsl: DeleteSide } | { ok: false; status: number; error: string; locked?: boolean };

// 編集中バージョンの後始末削除：WSL 側の作業サブフォルダ *だけ* を削除する（N1 本体）。
// Windows(D:) には一切触れない（編集中版は WSL のみに存在する運用のため）。
// 2 つのガードで拒否する：
//   ① チェックアウト中ページが残っている → 409（先にチェックイン）。
//   ② 枝番（子孫）バージョンが他に存在する → 409（親を消すと枝番が孤立するため）。
async function deleteVersionSubfolder(wdId: string, version: string, force = false): Promise<DeleteVersionResult> {
  const wdDir = path.join(workspacePath, "data/work", wdId);
  const wslVersionDir = path.join(wdDir, version);

  // ロック中ページがあれば既定はブロック。force=true（UI の確認ダイアログ経由）で強行可
  // （Windows 側 .checkedoutpages の編集は失われる旨は UI が明示する）。
  if (!force && (await hasLockedPages(wslVersionDir))) {
    return { ok: false, status: 409, locked: true, error: "チェックアウト中のページが残っています。先にページをチェックインしてください。" };
  }

  // 子孫（枝番）ガード：WSL 上の編集中バージョン名で判定する。
  const editingNames = (await scanEditingVersions(wdId)).map((ver) => ver.version);
  if (hasDescendantVersion(version, editingNames)) {
    return { ok: false, status: 409, error: "枝番（子孫）バージョンが存在するため削除できません。先に枝番を削除してください。" };
  }

  const wslDeleted = await removeContainedDir(wslVersionDir, wdDir, version);

  return {
    ok: true,
    wd: wdId,
    version,
    wsl: { path: wslVersionDir, deleted: wslDeleted },
  };
}

// DELETE /api/work/:wd/:version — 編集中バージョンの WSL サブフォルダ限定削除（N1・D: 不変）
router.delete(API_ROUTES.work.version, async (req, res) => {
  const { wd: wdId, version } = wdVersionOf(req);

  if (!isValidWorkWdId(wdId) || !isValidWorkVersion(version)) {
    res.status(400).json({ error: "invalid wd or version" });
    return;
  }

  // ?force=1（UI の確認ダイアログ経由）でロック中でも強行削除する。
  const forceParam = getOptionalStringQuery(req, "force");
  const force = forceParam === "1" || forceParam === "true";
  try {
    const result = await deleteVersionSubfolder(wdId, version, force);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error, locked: result.locked });
      return;
    }
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("workFiles.deleteVersion", "version subfolder delete failed", { err });
    res.status(500).json({ error: msg });
  }
});

// ── 頁単位チェックアウト／チェックイン ───────────────────────────────────────
// 選んだページだけを Windows へ出して手編集する往復機能。slide_struct.py の
// checkout/checkin CLI（COM 非依存・WSL 完結）を spawn し、`.checkedoutpages/` を
// Windows(D:) とミラーする。Windows パスは combine と同じ二段構えで解決する。

// ページ ID（例 p-1a2b3c4d）。structure.json のキーと同じ厳格パターン。
const PAGE_ID_RE = /^p-[0-9a-f]{8}$/;

interface StructPageEntry {
  file: string;
  checked_out?: boolean;
}

// 頁単位操作の共通コンテキスト（各ヘルパの引数数を抑えるためにまとめる）。
interface PageOpCtx {
  wdId: string;
  version: string;
  versionDir: string;
  pages: Record<string, StructPageEntry>;
  send: (line: string) => void;
}

// structure.json の pages マップを読む（ページ ID → {file, checked_out}）。無ければ null。
async function readStructurePagesMap(versionDir: string): Promise<Record<string, StructPageEntry> | null> {
  try {
    const parsed = await readJsonOrNull<{ pages?: Record<string, StructPageEntry> }>(path.join(versionDir, ".pages", "structure.json"));
    if (!parsed) return null; // 読めない＝「バージョンに structure.json が無い」（呼び側で 404）
    return parsed.pages ?? {};
  } catch {
    return null;
  }
}

// 必須ページ ID 配列の検証。空/型不正/パターン不一致は null。
export function validateRequiredPageIds(ids: unknown): string[] | null {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const out: string[] = [];
  for (const pageId of ids) {
    if (typeof pageId !== "string" || !PAGE_ID_RE.test(pageId)) return null;
    out.push(pageId);
  }
  return out;
}

// 任意ページ ID 配列の検証。undefined は []（未指定）、型/パターン不正は null。
export function validateOptionalPageIds(ids: unknown): string[] | null {
  if (ids === undefined) return [];
  return Array.isArray(ids) && ids.length === 0 ? [] : validateRequiredPageIds(ids);
}

// 往復用 .checkedoutpages ディレクトリ（WSL 側 / Windows 側）。
function localCheckedoutDir(wdId: string, version: string): string {
  return path.join(workspacePath, "data/work", wdId, version, ".checkedoutpages");
}
function winCheckedoutDir(winPath: string, version: string): string {
  return path.join(windowsToWsl(winPath), version, ".checkedoutpages");
}

// ページ ID 群 → structure 上のファイル名群（未掲載は除外）。
function filesForPages(pages: Record<string, StructPageEntry>, pageIds: string[]): string[] {
  return pageIds.map((pageId) => pages[pageId]?.file).filter((name): name is string => Boolean(name));
}

// slide_struct.py を spawn し SSE に流す。終了コードを返す（spawn 失敗は 1）。
async function runSlideStruct(args: string[], send: (line: string) => void, prefix = "🔖 "): Promise<number> {
  const scriptPath = path.join(workspacePath, "data/work/tools/slide_struct.py");
  return new Promise<number>((resolve) => {
    const proc = spawn("python3", [scriptPath, ...args], { env: { ...process.env } });
    pipeToSse(proc, send, prefix);
    proc.on("close", (code) => resolve(code ?? 1));
    proc.on("error", (err) => {
      send(`⚠ ${err.message}`);
      resolve(1);
    });
  });
}

// 一括操作（リリース/テーマ/テンプレ適用）のロックゲート。ロック中なら 409 を返し true。
async function blockIfLockedForBulk(wdId: string, version: string, res: Response): Promise<boolean> {
  const versionDir = path.join(workspacePath, "data/work", wdId, version);
  if (await hasLockedPages(versionDir)) {
    res.status(409).json({ error: "チェックアウト中のページがあります。先にページをチェックインしてください。", locked: true });
    return true;
  }
  return false;
}

// リクエストからページ操作コンテキストを組み立てる。検証失敗時は res にエラーを返して null。
async function buildPageOpCtx(req: Request, res: Response): Promise<PageOpCtx | null> {
  const { wd, version } = wdVersionOf(req);
  if (!isValidWorkWdId(wd) || !isValidWorkVersion(version)) {
    res.status(400).json({ error: "invalid wd or version" });
    return null;
  }
  const versionDir = path.join(workspacePath, "data/work", wd, version);
  const pages = await readStructurePagesMap(versionDir);
  if (!pages) {
    res.status(404).json({ error: "対象バージョンに structure.json がありません" });
    return null;
  }
  const stream = beginComStream(req, res);
  if (!stream) return null;
  return { wdId: wd, version, versionDir, pages, send: stream.send };
}

// POST /api/work/:wd/:version/page-checkout — 選択ページを Windows へ出す（SSE）
router.post(API_ROUTES.work.pageCheckout, async (req, res) => {
  const pageIds = validateRequiredPageIds(requestBodyRecord(req.body).pageIds);
  if (!pageIds) {
    res.status(400).json({ error: "pageIds（p-XXXXXXXX の配列）が必要です" });
    return;
  }
  const ctx = await buildPageOpCtx(req, res);
  if (!ctx) return;
  await runPageCheckout(ctx, pageIds);
  res.end();
});

// checkout 本体：存在しない/既ロックは除外→slide_struct checkout→Windows へ push。
async function runPageCheckout(ctx: PageOpCtx, pageIds: string[]): Promise<void> {
  const eligible: string[] = [];
  for (const pageId of pageIds) {
    if (!ctx.pages[pageId]) ctx.send(`ℹ スキップ（存在しないページ）: ${pageId}`);
    else if (ctx.pages[pageId].checked_out) ctx.send(`ℹ スキップ（既にチェックアウト中）: ${pageId}`);
    else eligible.push(pageId);
  }
  if (eligible.length === 0) {
    ctx.send("⚠ チェックアウト対象のページがありません");
    ctx.send(`DONE:${ctx.wdId}`);
    return;
  }
  const args = ["checkout", "--version-dir", ctx.versionDir, "--by", "windows"];
  eligible.forEach((pageId) => args.push("--page", pageId));
  const code = await runSlideStruct(args, ctx.send);
  if (code !== 0) {
    ctx.send(`ERROR: checkout に失敗しました（exit ${String(code)}）`);
    return;
  }
  await pushCheckedoutToWindows(ctx, filesForPages(ctx.pages, eligible));
  ctx.send(`DONE:${ctx.wdId}`);
}

// .checkedoutpages（WSL）→ Windows(D:) へ pptx を push。
async function pushCheckedoutToWindows(ctx: PageOpCtx, files: string[]): Promise<void> {
  const winPath = await resolveWdWindowsPath(ctx.wdId);
  if (!winPath) {
    ctx.send("⚠ Windows パスを解決できず、D: への push をスキップしました（.checkedoutpages は WSL に生成済み）");
    return;
  }
  const winDir = winCheckedoutDir(winPath, ctx.version);
  await fsp.mkdir(winDir, { recursive: true });
  const copied = await mirrorCopy(localCheckedoutDir(ctx.wdId, ctx.version), winDir, files);
  ctx.send(copied.length ? `📤 Windows へ push: ${copied.join(", ")}` : "ℹ Windows へ push する対象がありません");
}

// POST /api/work/:wd/:version/page-checkin — チェックアウト中ページを戻す/破棄する（SSE）
router.post(API_ROUTES.work.pageCheckin, async (req, res) => {
  const body = requestBodyRecord(req.body);
  const apply = validateOptionalPageIds(body.apply);
  const discard = validateOptionalPageIds(body.discard);
  if (apply === null || discard === null) {
    res.status(400).json({ error: "apply / discard は p-XXXXXXXX の配列で指定してください" });
    return;
  }
  const ctx = await buildPageOpCtx(req, res);
  if (!ctx) return;
  await runPageCheckin(ctx, apply, discard);
  res.end();
});

// checkin 本体：apply 群（pull→存在検証→取り込み→掃除）と discard 群（ロック解除のみ）。
async function runPageCheckin(ctx: PageOpCtx, apply: string[], discard: string[]): Promise<void> {
  // apply/discard 両省略時は、現在ロック中の全ページを apply とみなす。
  const applyIds = apply.length === 0 && discard.length === 0 ? Object.keys(ctx.pages).filter((pageId) => ctx.pages[pageId]?.checked_out) : apply;
  const winPath = await resolveWdWindowsPath(ctx.wdId);
  try {
    const appliedAny = await checkinApplyGroup(ctx, applyIds, winPath);
    await checkinDiscardGroup(ctx, discard, winPath);
    if (appliedAny) {
      ctx.send("🖼 サムネイル再生成中...");
      await runGenThumbs(ctx.wdId, ctx.version, ctx.send, false); // dirty のみ差分再生成
    }
    ctx.send(`DONE:${ctx.wdId}`);
  } catch (err) {
    ctx.send(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// apply 群の pull と安全弁：Windows から pull → 編集済み pptx が存在するページだけ返す。
async function pullAndVerifyApply(ctx: PageOpCtx, applyIds: string[], winPath: string | null): Promise<string[]> {
  const localDir = localCheckedoutDir(ctx.wdId, ctx.version);
  await fsp.mkdir(localDir, { recursive: true });
  if (winPath) {
    const pulled = await mirrorCopy(winCheckedoutDir(winPath, ctx.version), localDir, filesForPages(ctx.pages, applyIds));
    ctx.send(pulled.length ? `📥 Windows から pull: ${pulled.join(", ")}` : "ℹ Windows から pull する対象がありません");
  } else {
    ctx.send("⚠ Windows パスを解決できず、pull をスキップしました（WSL の .checkedoutpages を使用）");
  }
  const present: string[] = [];
  for (const pageId of applyIds) {
    const fileName = ctx.pages[pageId]?.file;
    if (fileName && (await pathExists(path.join(localDir, fileName)))) present.push(pageId);
    else ctx.send(`⚠ 編集済み pptx が見つからないためスキップ（ロック維持）: ${pageId}`);
  }
  return present;
}

// apply 群：pull＋存在検証 → 取り込み（--mode apply）→ Windows 掃除。取り込んだら true。
async function checkinApplyGroup(ctx: PageOpCtx, applyIds: string[], winPath: string | null): Promise<boolean> {
  if (applyIds.length === 0) return false;
  const present = await pullAndVerifyApply(ctx, applyIds, winPath);
  if (present.length === 0) return false;
  const args = ["checkin", "--version-dir", ctx.versionDir, "--mode", "apply"];
  present.forEach((pageId) => args.push("--page", pageId));
  const code = await runSlideStruct(args, ctx.send);
  if (code !== 0) {
    ctx.send(`ERROR: checkin（取り込み）に失敗しました（exit ${String(code)}）`);
    return false;
  }
  await cleanWindowsCheckedout(ctx, winPath, filesForPages(ctx.pages, present), "🧹 Windows 側を掃除");
  return true;
}

// discard 群：取り込まずロック解除のみ（--mode discard）＋ Windows 側掃除。
async function checkinDiscardGroup(ctx: PageOpCtx, discard: string[], winPath: string | null): Promise<void> {
  if (discard.length === 0) return;
  const args = ["checkin", "--version-dir", ctx.versionDir, "--mode", "discard"];
  discard.forEach((pageId) => args.push("--page", pageId));
  const code = await runSlideStruct(args, ctx.send);
  if (code !== 0) {
    ctx.send(`ERROR: checkin（破棄）に失敗しました（exit ${String(code)}）`);
    return;
  }
  await cleanWindowsCheckedout(ctx, winPath, filesForPages(ctx.pages, discard), "🧹 Windows 側を掃除（破棄）");
}

// Windows(D:) 側 .checkedoutpages から指定 pptx を削除する（掃除）。winPath 未解決なら no-op。
async function cleanWindowsCheckedout(ctx: PageOpCtx, winPath: string | null, files: string[], label: string): Promise<void> {
  if (!winPath || files.length === 0) return;
  const del = await mirrorDelete(winCheckedoutDir(winPath, ctx.version), files);
  if (del.length) ctx.send(`${label}: ${del.join(", ")}`);
}

// ── 頁編集（削除・移動・新規追加）— COM 非依存・WSL のみ（page_ops.py）─────────
// 表紙（先頭セクション）／Thank You セクションは固定＝これらの頁は編集不可（python 側で拒否）。
// チェックアウト中は blockIfLockedForBulk で 409（構造編集はチェックイン後）。

// 構造編集コンテキスト（3 ルート共通）。
interface StructEditCtx {
  wd: string;
  version: string;
  versionDir: string;
  send: (line: string) => void;
}

// セクション名の検証（任意の日本語可・改行/過長は不可）。
function isValidSectionName(name: unknown): name is string {
  return typeof name === "string" && name.length >= 1 && name.length <= 100 && !/[\r\n]/.test(name);
}

export interface PageMoveBody {
  pageId: string;
  toSection: string;
  toIndex: number;
}
// page-move body の検証。不正なら null。
export function validatePageMoveBody(body: unknown): PageMoveBody | null {
  if (!isRecord(body)) return null;
  const { pageId, toSection, toIndex } = body;
  if (typeof pageId !== "string" || !PAGE_ID_RE.test(pageId)) return null;
  if (!isValidSectionName(toSection)) return null;
  if (typeof toIndex !== "number" || !Number.isInteger(toIndex) || toIndex < 0) return null;
  return { pageId, toSection, toIndex };
}

export interface PageAddBody {
  section: string;
  toIndex: number;
  template?: string;
}
// page-add body の検証。不正なら null。
export function validatePageAddBody(body: unknown): PageAddBody | null {
  if (!isRecord(body)) return null;
  const { section, toIndex, template } = body;
  if (!isValidSectionName(section)) return null;
  if (typeof toIndex !== "number" || !Number.isInteger(toIndex) || toIndex < 0) return null;
  if (template !== undefined && (typeof template !== "string" || template.length > 200)) return null;
  return { section, toIndex, ...(typeof template === "string" ? { template } : {}) };
}

export interface SetTitleBody {
  pageId: string;
  title: string;
}
// page-set-title body の検証。不正なら null。空タイトル（クリア）は許可・改行不可・500 文字以内。
export function validateSetTitleBody(body: unknown): SetTitleBody | null {
  if (!isRecord(body)) return null;
  const { pageId, title } = body;
  if (typeof pageId !== "string" || !PAGE_ID_RE.test(pageId)) return null;
  if (typeof title !== "string" || title.length > 500 || /[\r\n]/.test(title)) return null;
  return { pageId, title };
}

// page_ops get-title の stdout から `TITLE:<json>` 行を取り出す（無ければ ""）。
export function parseTitleOutput(out: string): string {
  const marker = "TITLE:";
  const line = out.split(/\r?\n/).find((entry) => entry.startsWith(marker));
  if (!line) return "";
  try {
    const parsed: unknown = JSON.parse(line.slice(marker.length));
    return typeof parsed === "string" ? parsed : "";
  } catch {
    return "";
  }
}

// ── テキストボックス編集（本文文字列・仕様 2026-08-02）body 検証 / 出力パース ──────────
// 個々のテキストボックスは shape_id（スライド内一意）で指す。text は改行を含む複数段落。

const TEXTBOX_TEXT_MAX = 5000;

export interface TextboxInfo {
  id: number;
  rect: [number, number, number, number];
  text: string;
}
export interface TextboxesResult {
  editable: boolean;
  boxes: TextboxInfo[];
}

export interface SetTextboxBody {
  pageId: string;
  shapeId: number;
  text: string;
}
// page-set-textbox body の検証。不正なら null。空テキスト（クリア）は許可・改行可・5000 文字以内。
export function validateSetTextboxBody(body: unknown): SetTextboxBody | null {
  if (!isRecord(body)) return null;
  const { pageId, shapeId, text } = body;
  if (typeof pageId !== "string" || !PAGE_ID_RE.test(pageId)) return null;
  if (typeof shapeId !== "number" || !Number.isInteger(shapeId) || shapeId < 0) return null;
  if (typeof text !== "string" || text.length > TEXTBOX_TEXT_MAX) return null;
  return { pageId, shapeId, text };
}

// 0〜1 正規化された rect（[nx,ny,nw,nh]）として妥当か。
function isValidRect(rect: unknown): rect is [number, number, number, number] {
  return Array.isArray(rect) && rect.length === 4 && rect.every((num) => typeof num === "number" && Number.isFinite(num));
}

// page_ops get-textboxes の stdout から `TEXTBOXES:<json>` 行を取り出す（無ければ editable:false）。
export function parseTextboxesOutput(out: string): TextboxesResult {
  const marker = "TEXTBOXES:";
  const line = out.split(/\r?\n/).find((entry) => entry.startsWith(marker));
  if (!line) return { editable: false, boxes: [] };
  try {
    const parsed: unknown = JSON.parse(line.slice(marker.length));
    if (!isRecord(parsed)) return { editable: false, boxes: [] };
    const editable = parsed.editable === true;
    const rawBoxes = Array.isArray(parsed.boxes) ? parsed.boxes : [];
    const boxes: TextboxInfo[] = [];
    for (const raw of rawBoxes) {
      if (!isRecord(raw)) continue;
      const { id, rect, text } = raw;
      if (typeof id !== "number" || !Number.isInteger(id)) continue;
      if (!isValidRect(rect)) continue;
      if (typeof text !== "string") continue;
      boxes.push({ id, rect, text });
    }
    return { editable, boxes };
  } catch {
    return { editable: false, boxes: [] };
  }
}

// ── セクション編集（追加・移動・削除・リネーム）の body 検証 ──────────────────────
// 検証は python（page_ops.py）が真実源（固定・予約・重複・非空削除は exit 2）。ここでは
// リクエスト形状だけを確かめ、帯・予約・重複の判定は python に委ねる。

export interface SectionAddBody {
  name: string;
  toIndex: number;
}
export function validateSectionAddBody(body: unknown): SectionAddBody | null {
  if (!isRecord(body)) return null;
  const { name, toIndex } = body;
  if (!isValidSectionName(name)) return null;
  if (typeof toIndex !== "number" || !Number.isInteger(toIndex) || toIndex < 1) return null;
  return { name, toIndex };
}

export interface SectionMoveBody {
  name: string;
  direction: "up" | "down";
}
export function validateSectionMoveBody(body: unknown): SectionMoveBody | null {
  if (!isRecord(body)) return null;
  const { name, direction } = body;
  if (!isValidSectionName(name)) return null;
  if (direction !== "up" && direction !== "down") return null;
  return { name, direction };
}

export interface SectionDeleteBody {
  name: string;
}
export function validateSectionDeleteBody(body: unknown): SectionDeleteBody | null {
  if (!isRecord(body)) return null;
  const { name } = body;
  if (!isValidSectionName(name)) return null;
  return { name };
}

export interface SectionRenameBody {
  name: string;
  toName: string;
}
export function validateSectionRenameBody(body: unknown): SectionRenameBody | null {
  if (!isRecord(body)) return null;
  const { name, toName } = body;
  if (!isValidSectionName(name) || !isValidSectionName(toName)) return null;
  return { name, toName };
}

// page_ops.py を spawn し SSE に流す。終了コードを返す（spawn 失敗は 1）。
async function runPageOps(args: string[], send: (line: string) => void): Promise<number> {
  const scriptPath = path.join(workspacePath, "data/work/tools/page_ops.py");
  return new Promise<number>((resolve) => {
    const proc = spawn("python3", [scriptPath, ...args], { env: { ...process.env } });
    pipeToSse(proc, send, "📄 ");
    proc.on("close", (code) => resolve(code ?? 1));
    proc.on("error", (err) => {
      send(`⚠ ${err.message}`);
      resolve(1);
    });
  });
}

// page_ops.py を spawn し stdout を捕捉する（GET 用・SSE ではない）。{ code, out } を返す。
async function runPageOpsCapture(args: string[]): Promise<{ code: number; out: string }> {
  const scriptPath = path.join(workspacePath, "data/work/tools/page_ops.py");
  return new Promise((resolve) => {
    const proc = spawn("python3", [scriptPath, ...args], { env: { ...process.env } });
    let out = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    proc.on("close", (code) => resolve({ code: code ?? 1, out }));
    proc.on("error", () => resolve({ code: 1, out }));
  });
}

// wd/version 検証 → ロックゲート（409）→ SSE 開始。失敗時は res へ返して null。
async function beginStructEdit(req: Request, res: Response): Promise<StructEditCtx | null> {
  const { wd, version } = wdVersionOf(req);
  if (!isValidWorkWdId(wd) || !isValidWorkVersion(version)) {
    res.status(400).json({ error: "invalid wd or version" });
    return null;
  }
  if (await blockIfLockedForBulk(wd, version, res)) return null;
  const stream = beginComStream(req, res);
  if (!stream) return null;
  const versionDir = path.join(workspacePath, "data/work", wd, version);
  return { wd, version, versionDir, send: stream.send };
}

// page_ops 実行後の共通後処理：成功ならサムネ再生成＋DONE、失敗なら ERROR。
async function finishStructEdit(ctx: StructEditCtx, code: number, label: string): Promise<void> {
  if (code !== 0) {
    ctx.send(`ERROR: ${label}に失敗しました（exit ${String(code)}）`);
    return;
  }
  ctx.send("🖼 サムネイル再生成中...");
  await runGenThumbs(ctx.wd, ctx.version, ctx.send, false); // 欠落＋dirty のみ差分再生成
  ctx.send(`DONE:${ctx.wd}`);
}

// POST /api/work/:wd/:version/page-delete — 頁を削除する（SSE）
router.post(API_ROUTES.work.pageDelete, async (req, res) => {
  const pageIds = validateRequiredPageIds(requestBodyRecord(req.body).pageIds);
  if (!pageIds) {
    res.status(400).json({ error: "pageIds（p-XXXXXXXX の配列）が必要です" });
    return;
  }
  const ctx = await beginStructEdit(req, res);
  if (!ctx) return;
  let code = 0;
  for (const pageId of pageIds) {
    code = await runPageOps(["delete", "--version-dir", ctx.versionDir, "--page", pageId], ctx.send);
    if (code !== 0) break;
  }
  await finishStructEdit(ctx, code, "頁の削除");
  res.end();
});

// POST /api/work/:wd/:version/page-move — 頁を移動／並べ替えする（SSE）
router.post(API_ROUTES.work.pageMove, async (req, res) => {
  const body = validatePageMoveBody(req.body);
  if (!body) {
    res.status(400).json({ error: "pageId（p-XXXXXXXX）/ toSection / toIndex（0 以上の整数）が必要です" });
    return;
  }
  const ctx = await beginStructEdit(req, res);
  if (!ctx) return;
  const code = await runPageOps(
    ["move", "--version-dir", ctx.versionDir, "--page", body.pageId, "--to-section", body.toSection, "--to-index", String(body.toIndex)],
    ctx.send,
  );
  await finishStructEdit(ctx, code, "頁の移動");
  res.end();
});

// POST /api/work/:wd/:version/page-add — 空の本文ページを追加する（SSE）
router.post(API_ROUTES.work.pageAdd, async (req, res) => {
  const body = validatePageAddBody(req.body);
  if (!body) {
    res.status(400).json({ error: "section / toIndex（0 以上の整数）が必要です" });
    return;
  }
  const ctx = await beginStructEdit(req, res);
  if (!ctx) return;
  const args = ["add", "--version-dir", ctx.versionDir, "--section", body.section, "--to-index", String(body.toIndex)];
  if (body.template) args.push("--template", body.template);
  const code = await runPageOps(args, ctx.send);
  await finishStructEdit(ctx, code, "頁の追加");
  res.end();
});

// GET /api/work/:wd/:version/page-title?pageId=... — 現在頁のタイトルを返す（編集 UI 初期値）
// 読み取り専用（get-title・固定/ロック判定なし）。SSE ではなく stdout を捕捉して JSON で返す。
router.get(API_ROUTES.work.pageTitle, async (req, res) => {
  const { wd, version } = wdVersionOf(req);
  const pageId = getOptionalStringQuery(req, "pageId");
  if (!isValidWorkWdId(wd) || !isValidWorkVersion(version)) {
    res.status(400).json({ error: "invalid wd or version" });
    return;
  }
  if (typeof pageId !== "string" || !PAGE_ID_RE.test(pageId)) {
    res.status(400).json({ error: "pageId（p-XXXXXXXX）が必要です" });
    return;
  }
  const versionDir = path.join(workspacePath, "data/work", wd, version);
  const { code, out } = await runPageOpsCapture(["get-title", "--version-dir", versionDir, "--page", pageId]);
  if (code !== 0) {
    res.status(500).json({ error: "タイトルの取得に失敗しました" });
    return;
  }
  res.json({ title: parseTitleOutput(out) });
});

// POST /api/work/:wd/:version/page-set-title — 現在頁のタイトルを設定する（SSE）
// 空文字＝クリア可。表紙／Thank You の頁は page_ops.py が exit 2 で拒否する。
router.post(API_ROUTES.work.pageSetTitle, async (req, res) => {
  const body = validateSetTitleBody(req.body);
  if (!body) {
    res.status(400).json({ error: "pageId（p-XXXXXXXX）/ title（500 文字以内・改行不可）が必要です" });
    return;
  }
  const ctx = await beginStructEdit(req, res);
  if (!ctx) return;
  const code = await runPageOps(["set-title", "--version-dir", ctx.versionDir, "--page", body.pageId, "--title", body.title], ctx.send);
  await finishStructEdit(ctx, code, "タイトルの設定");
  res.end();
});

// GET /api/work/:wd/:version/page-textboxes?pageId=... — 編集可能テキストボックスを列挙する
// 読み取り専用（get-textboxes）。SSE ではなく stdout を捕捉して JSON で返す。編集対象外の頁は
// editable:false・boxes:[] を返す（表紙・Thank You・未分類・チェックアウト中）。
router.get(API_ROUTES.work.pageTextboxes, async (req, res) => {
  const { wd, version } = wdVersionOf(req);
  const pageId = getOptionalStringQuery(req, "pageId");
  if (!isValidWorkWdId(wd) || !isValidWorkVersion(version)) {
    res.status(400).json({ error: "invalid wd or version" });
    return;
  }
  if (typeof pageId !== "string" || !PAGE_ID_RE.test(pageId)) {
    res.status(400).json({ error: "pageId（p-XXXXXXXX）が必要です" });
    return;
  }
  const versionDir = path.join(workspacePath, "data/work", wd, version);
  const { code, out } = await runPageOpsCapture(["get-textboxes", "--version-dir", versionDir, "--page", pageId]);
  if (code !== 0) {
    res.status(500).json({ error: "テキストボックスの取得に失敗しました" });
    return;
  }
  res.json(parseTextboxesOutput(out));
});

// POST /api/work/:wd/:version/page-set-textbox — テキストボックスの文字列を設定する（SSE）
// 空文字＝クリア可。表紙・Thank You・チェックアウト頁・非対象シェイプは page_ops.py が exit 2 で拒否。
router.post(API_ROUTES.work.pageSetTextbox, async (req, res) => {
  const body = validateSetTextboxBody(req.body);
  if (!body) {
    res.status(400).json({ error: "pageId（p-XXXXXXXX）/ shapeId（0 以上の整数）/ text（5000 文字以内）が必要です" });
    return;
  }
  const ctx = await beginStructEdit(req, res);
  if (!ctx) return;
  const code = await runPageOps(
    ["set-textbox", "--version-dir", ctx.versionDir, "--page", body.pageId, "--shape-id", String(body.shapeId), "--text", body.text],
    ctx.send,
  );
  await finishStructEdit(ctx, code, "テキストの設定");
  res.end();
});

// ── セクション編集（追加・移動・削除・リネーム）— page_ops.py の section-* を spawn ──
// 頁編集と同じゲート（beginStructEdit＝wd/version 検証＋チェックアウト中 409）と
// 後処理（finishStructEdit＝gen_thumbs 差分再生成＋DONE）を共有する。

// POST /api/work/:wd/:version/section-add — 空のセクションを追加する（SSE）
router.post(API_ROUTES.work.sectionAdd, async (req, res) => {
  const body = validateSectionAddBody(req.body);
  if (!body) {
    res.status(400).json({ error: "name / toIndex（1 以上の整数）が必要です" });
    return;
  }
  const ctx = await beginStructEdit(req, res);
  if (!ctx) return;
  const code = await runPageOps(["section-add", "--version-dir", ctx.versionDir, "--name", body.name, "--to-index", String(body.toIndex)], ctx.send);
  await finishStructEdit(ctx, code, "セクションの追加");
  res.end();
});

// POST /api/work/:wd/:version/section-move — セクションを上下 1 つ移動する（SSE）
router.post(API_ROUTES.work.sectionMove, async (req, res) => {
  const body = validateSectionMoveBody(req.body);
  if (!body) {
    res.status(400).json({ error: "name / direction（up | down）が必要です" });
    return;
  }
  const ctx = await beginStructEdit(req, res);
  if (!ctx) return;
  const code = await runPageOps(["section-move", "--version-dir", ctx.versionDir, "--name", body.name, "--direction", body.direction], ctx.send);
  await finishStructEdit(ctx, code, "セクションの移動");
  res.end();
});

// POST /api/work/:wd/:version/section-delete — 空のセクションを削除する（SSE）
router.post(API_ROUTES.work.sectionDelete, async (req, res) => {
  const body = validateSectionDeleteBody(req.body);
  if (!body) {
    res.status(400).json({ error: "name が必要です" });
    return;
  }
  const ctx = await beginStructEdit(req, res);
  if (!ctx) return;
  const code = await runPageOps(["section-delete", "--version-dir", ctx.versionDir, "--name", body.name], ctx.send);
  await finishStructEdit(ctx, code, "セクションの削除");
  res.end();
});

// POST /api/work/:wd/:version/section-rename — セクションをリネームする（SSE）
router.post(API_ROUTES.work.sectionRename, async (req, res) => {
  const body = validateSectionRenameBody(req.body);
  if (!body) {
    res.status(400).json({ error: "name / toName が必要です" });
    return;
  }
  const ctx = await beginStructEdit(req, res);
  if (!ctx) return;
  const code = await runPageOps(["section-rename", "--version-dir", ctx.versionDir, "--name", body.name, "--to-name", body.toName], ctx.send);
  await finishStructEdit(ctx, code, "セクションのリネーム");
  res.end();
});

// ── 教材索引 CSV の生成（カテゴリ見出しの [索引作成] ボタン）─────────────────
//
// 8 列のうち 6 列は機械的に決まり、`Description` と `Tags` の 2 列だけは資料の
// 内容を読んで書く必要がある。そのため python ツール（機械列）＋ hidden agent
// worker（Claude が書く 2 列）の 2 レイヤ構成になる。
//
//   Phase 1  build_index.py scan   … 機械列＋資料抜粋の下書きを WSL に生成
//   Phase 2  hidden agent worker   … Description / Tags を rows/*.json に書く
//   Phase 3  build_index.py apply  … マージして D: へ反映
//
// **Phase 3 は worker の完了フックの中で走る**（SSE ハンドラの中ではない）。
// モーダルを閉じても・ブラウザをリロードしても D: への反映は完走し、SSE が
// 切れている場合は送信を諦めるだけ。サンドボックスの Claude は D: に書けないので、
// Claude はステージングにだけ書き、D: への反映はサーバーが行う（既存のリリース
// 逆同期と同じ役割分担）。

const INDEX_STAGING_ROOT = "data/work/.index";
const INDEX_SCRIPT = "data/work/tools/build_index.py";
const INDEX_SKILL = "build-training-index";
const INDEX_WORKER_ROLE = "general";
const INDEX_PROGRESS_POLL_MS = 2 * ONE_SECOND_MS;
const INDEX_OBSERVE_TIMEOUT_MS = 10 * ONE_MINUTE_MS;
// build_index.py の「書き出す行が 0 件（D: 未変更）」。既存 CSV をヘッダだけの
// CSV で潰さないための安全弁が働いた印。
const INDEX_EXIT_EMPTY = 3;

/** `category` がスキャン結果のカテゴリ名の集合に含まれるか（純粋判定）。
 *  **これがパス操作の許可リスト**であり、`..` やパス区切りの混入を構造的に
 *  排除する（`isValidWorkWdId()` と同じ思想）。以降ステージングのパスに
 *  カテゴリ名をそのまま使えるのは、この検証を通っているからである。 */
export function isAllowedIndexCategory(category: unknown, categories: { name: string }[]): category is string {
  return typeof category === "string" && category.length > 0 && categories.some((cat) => cat.name === category);
}

/** scan の stdout から最終行 `PENDING: <n>` を読む（純粋）。
 *  欠落・不正なら null＝「pending 不明」とし、呼び出し側は Phase 2 を実行する
 *  （記入を飛ばして空欄の CSV を書くより、余分に 1 回走らせるほうが安全）。 */
export function parsePendingCount(lines: string[]): number | null {
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    if (line === undefined) continue;
    const matched = /^PENDING:\s*(\d+)$/.exec(line.trim());
    if (matched?.[1]) return parseInt(matched[1], 10);
  }
  return null;
}

/** `rows/` のファイル数から進捗行を組み立てる（純粋）。前回送った件数と同じなら
 *  null＝送らない（2 秒ごとに同じ行を並べないため）。 */
export function buildIndexProgressLine(written: number, total: number, lastSent: number | null): string | null {
  if (written === lastSent) return null;
  // pending 件数が読めなかったとき（`PENDING:` 行が無い＝total 0）は分母を出さない。
  if (total <= 0) return `Claude が記入中... (${written} 件)`;
  return `Claude が記入中... (${written}/${total})`;
}

/** build_index.py の CLI 引数を組み立てる（純粋）。 */
export function buildIndexScriptArgs(subcommand: "scan" | "apply", scriptPath: string, ctx: BuildIndexContext): string[] {
  return [scriptPath, subcommand, "--work-root", ctx.workRootWin, "--category", ctx.category, "--staging", ctx.staging];
}

export interface BuildIndexContext {
  category: string;
  workRootWin: string;
  /** ステージングの絶対パス（`<workspace>/data/work/.index/<カテゴリ>`）。 */
  staging: string;
  /** worker に渡すワークスペース相対パス。 */
  stagingRel: string;
}

/** 実行中のカテゴリ。Phase 1 の直前に登録し、Phase 3 の完了時（成功・失敗どちらも）
 *  に外す。プロセス内メモリで良い ── worker はプロセスと共に死ぬので、永続化すると
 *  ボタンが固まるだけ（`collectionAgentActions.ts` の `running` Map と同じ流儀）。 */
const buildingIndex = new Set<string>();

/** そのカテゴリの索引作成が実行中か（ルートの 409 判定）。 */
export function isBuildingIndex(category: string): boolean {
  return buildingIndex.has(category);
}

/** テスト専用：実行中ガードを空にする。 */
export function resetBuildIndexForTesting(): void {
  buildingIndex.clear();
}

/** 注入可能な seam（既定は実モジュール。テストは実エージェント・実 python を動かさない）。 */
export interface BuildIndexDeps {
  runScript: (subcommand: "scan" | "apply", ctx: BuildIndexContext, send: (line: string) => void) => Promise<{ code: number; lines: string[] }>;
  spawnWorker: (args: {
    message: string;
    roleId: string;
    hidden: boolean;
    onComplete?: ((outcome: { didError: boolean }) => void | Promise<void>) | undefined;
  }) => Promise<SpawnSystemWorkerResult>;
  /** 進捗表示用に `rows/*.json` の件数を数える。 */
  countWrittenRows: (ctx: BuildIndexContext) => Promise<number>;
  /** 進捗ポーリングの待ち。テストは即時解決に差し替えて 2 秒待たない。 */
  wait: (delayMs: number) => Promise<void>;
}

// build_index.py を spawn して stdout/stderr を SSE に流し、exit code と全行を返す。
// `PENDING: <n>` を読むために生の行も溜める（SSE 側は pipeToSse の整形済み）。
async function spawnBuildIndex(subcommand: "scan" | "apply", ctx: BuildIndexContext, send: (line: string) => void): Promise<{ code: number; lines: string[] }> {
  const args = buildIndexScriptArgs(subcommand, path.join(workspacePath, INDEX_SCRIPT), ctx);
  const lines: string[] = [];
  return new Promise((resolve) => {
    const proc = spawn("python3", args, { env: { ...process.env } });
    pipeToSse(proc, (line) => {
      lines.push(line);
      send(line);
    });
    proc.on("close", (code) => resolve({ code: code ?? 1, lines }));
    proc.on("error", (err) => {
      send(`⚠ ${err.message}`);
      resolve({ code: 1, lines });
    });
  });
}

async function countWrittenIndexRows(ctx: BuildIndexContext): Promise<number> {
  return (await listFiles(path.join(ctx.staging, "rows"), /\.json$/i)).length;
}

const defaultBuildIndexDeps: BuildIndexDeps = {
  runScript: spawnBuildIndex,
  spawnWorker: spawnSystemWorker,
  countWrittenRows: countWrittenIndexRows,
  wait: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
};

interface BuildIndexRun {
  ctx: BuildIndexContext;
  send: (line: string) => void;
  deps: BuildIndexDeps;
  /** Phase 3 が終わった（＝この実行は完結した）。SSE 観測の終了条件。 */
  done: boolean;
  /** 進捗行として最後に送った件数（差分が無いときは送らない）。 */
  lastProgress: number | null;
  /** 進捗の分母＝Claude が書く件数（pending）。`rows/` はこの数までしか増えない。 */
  total: number;
}

// この実行を終わらせる（実行中ガードを外し、SSE 観測ループの終了条件を立てる）。
// 成功・失敗・例外のどれでも必ず通す ── 通し忘れるとボタンが 409 で固まる。
function finishIndexRun(run: BuildIndexRun): void {
  run.done = true;
  buildingIndex.delete(run.ctx.category);
}

// Phase 3。worker の完了フックの中（または pending 0 件のとき直接）から呼ばれる。
async function applyIndex(run: BuildIndexRun): Promise<void> {
  try {
    const applied = await run.deps.runScript("apply", run.ctx, run.send);
    if (applied.code === INDEX_EXIT_EMPTY) {
      run.send("ERROR: 書き出す行が 0 件のため D: を変更しませんでした");
    } else if (applied.code !== 0) {
      run.send(`ERROR: 索引の反映に失敗しました（exit ${String(applied.code)}）`);
    } else {
      run.send(`DONE: ${run.ctx.category} Index.csv`);
    }
  } catch (err) {
    log.error("workFiles.buildIndex", "apply failed", { category: run.ctx.category, err });
    run.send(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    finishIndexRun(run);
  }
}

// SSE の観測だけを行う（worker は kill しない）。10 分で諦めて SSE を閉じるが、
// 完了フックはそのまま生きているので D: への反映は後から完走する。
async function observeIndexProgress(run: BuildIndexRun): Promise<void> {
  const deadline = Date.now() + INDEX_OBSERVE_TIMEOUT_MS;
  while (!run.done) {
    if (Date.now() >= deadline) {
      run.send("⚠ Claude の処理が長引いています。バックグラウンドで続行中です（完了すると D: に反映されます）");
      return;
    }
    await run.deps.wait(INDEX_PROGRESS_POLL_MS);
    if (run.done) return;
    const written = await run.deps.countWrittenRows(run.ctx);
    const line = buildIndexProgressLine(written, run.total, run.lastProgress);
    if (line) {
      run.send(line);
      run.lastProgress = written;
    }
  }
}

// Phase 2。hidden worker を起動し、完了フックに Phase 3 を仕込む。起動できなければ
// ガードを外して false（呼び出し側は ERROR を出して終わる）。
async function launchIndexWorker(run: BuildIndexRun): Promise<boolean> {
  const launch = await run.deps.spawnWorker({
    message: `/${INDEX_SKILL} "${run.ctx.stagingRel}"`,
    roleId: INDEX_WORKER_ROLE,
    hidden: true,
    onComplete: () => applyIndex(run),
  });
  if (launch.ok) {
    log.info("workFiles.buildIndex", "worker dispatched", { category: run.ctx.category, chatId: launch.chatId, pending: run.total });
    return true;
  }
  run.send(`ERROR: ${launch.error}`);
  finishIndexRun(run);
  return false;
}

/** 3 フェーズの本体。実行中ガードの登録も解除もこの関数が持つ ── 登録は Phase 1 の
 *  spawn より前（最初の await より前）に同期的に行うので、ルートの 409 判定から
 *  ここまでの間に別の POST が割り込む余地はない。 */
export async function runBuildIndex(ctx: BuildIndexContext, send: (line: string) => void, deps: BuildIndexDeps = defaultBuildIndexDeps): Promise<void> {
  const run: BuildIndexRun = { ctx, send, deps, done: false, lastProgress: null, total: 0 };
  buildingIndex.add(ctx.category);
  const scan = await deps.runScript("scan", ctx, send);
  if (scan.code !== 0) {
    send(`ERROR: 索引の下書き生成に失敗しました（exit ${String(scan.code)}）`);
    finishIndexRun(run);
    return;
  }
  const pending = parsePendingCount(scan.lines);
  if (pending === 0) {
    // 全行が既存 CSV から引き継げた ── Claude を呼ばずに Phase 3 へ直行する。
    await applyIndex(run);
    return;
  }
  run.total = pending ?? 0;
  if (pending === null) send("⚠ pending 件数を読めませんでした（記入を実行します）");
  if (!(await launchIndexWorker(run))) return;
  await observeIndexProgress(run);
}

// POST /api/work/build-index — カテゴリの教材索引 CSV を生成する（SSE）
router.post(API_ROUTES.work.buildIndex, async (req, res) => {
  const { category } = requestBodyRecord(req.body);
  const workRootWin = await getWorkRootWin();
  const categories = await scanRoot(workRootWin);
  if (!isAllowedIndexCategory(category, categories)) {
    res.status(400).json({ error: "category が不正です（スキャン結果のカテゴリ名を指定してください）" });
    return;
  }
  if (isBuildingIndex(category)) {
    res.status(409).json({ error: `「${category}」の索引作成は実行中です` });
    return;
  }
  const stagingRel = `${INDEX_STAGING_ROOT}/${category}`;
  const ctx: BuildIndexContext = { category, workRootWin, staging: path.join(workspacePath, INDEX_STAGING_ROOT, category), stagingRel };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  // SSE が切れている（モーダルを閉じた・リロードした）場合は黙って捨てる。
  // Phase 2/3 は SSE と無関係に完走する。
  const send = (line: string): void => {
    if (res.writableEnded) return;
    res.write(`data: ${line}\n\n`);
  };

  // 登録は runBuildIndex が Phase 1 の spawn より前に同期的に行う（この 409 判定と
  // 登録の間に await が無いので、二重 POST は必ずここで弾かれる）。
  try {
    await runBuildIndex(ctx, send);
  } catch (err) {
    log.error("workFiles.buildIndex", "build index failed", { category, err });
    send(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    buildingIndex.delete(category);
  }
  res.end();
});

export default router;
