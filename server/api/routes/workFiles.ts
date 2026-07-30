import { Router, type Request, type Response } from "express";
import path from "path";
import { promises as fsp } from "fs";
import { spawn } from "child_process";
import { workspacePath } from "../../workspace/workspace.js";
import { log } from "../../system/logger/index.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { ONE_HOUR_MS } from "../../utils/time.js";
import { versionSegments } from "../../../src/utils/slides/slideDeck.js";
import { hasDescendantVersion } from "../../../src/utils/slides/versioning.js";

const router = Router();

const PPTX_PATTERN = /\.pptx$/i;
const PPTX_VERSION_DATE_PATTERN = /_(\d{8})_v(\d+)\.pptx$/i;
const PPTX_VERSION_PATTERN = /_v(\d+)\.pptx$/i;
const WD_NAME_PATTERN = /^([A-Z]+-\d+)\s+(\S.*)$/;
const WD_ROOT_PATTERN = /^[A-Z]+-\d{5}\s+/;

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
  if (matchWithDate) {
    const verNum = parseInt(matchWithDate[2], 10);
    return { version: `v${String(verNum).padStart(3, "0")}`, versionNum: verNum, date: matchWithDate[1] };
  }
  const matchNoDate = filename.match(PPTX_VERSION_PATTERN);
  if (matchNoDate) {
    const verNum = parseInt(matchNoDate[1], 10);
    return { version: `v${String(verNum).padStart(3, "0")}`, versionNum: verNum, date: "" };
  }
  return null;
}

// manifest.json から dirty フラグを確認
async function checkDirtyFlag(manifestPath: string): Promise<boolean> {
  try {
    const raw = await fsp.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(raw) as { pages?: Record<string, { dirty?: boolean }> };
    return manifest.pages ? Object.values(manifest.pages).some((page) => page.dirty === true) : false;
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
  versions: VersionInfo[];
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
  let struct: StructureLite;
  try {
    struct = JSON.parse(await fsp.readFile(path.join(workDir, name, ".pages", "structure.json"), "utf-8")) as StructureLite;
  } catch {
    return null;
  }
  const locked = struct.pages ? Object.values(struct.pages).some((page) => page.checked_out === true) : false;
  const dirty = await checkDirtyFlag(path.join(workDir, name, ".thumbcache", "manifest.json"));
  const statuses = ["editing"];
  if (locked) statuses.push("checked-out");
  if (dirty) statuses.push("dirty");
  return { version: name, versionNum: versionSegments(name)[0] ?? 0, kind: "editing", filename: "", date: "", source: struct.source, locked, statuses };
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

// WD フォルダを処理して WdInfo を返す（released=Windows/WSL の ReleasedVersion、
// editing=WSL の編集中サブフォルダ）。両者を採番の兄弟集合として 1 リストに束ねる。
async function processWdFolder(wdName: string, catWslPath: string, catWinPath: string): Promise<WdInfo | null> {
  const match = wdName.match(WD_NAME_PATTERN);
  if (!match) return null;

  const [, wdId, title] = match;
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
    versions,
  };
}

// settings.json から workRootPath を読む
async function getWorkRootWin(): Promise<string> {
  const settingsPath = path.join(workspacePath, "config/settings.json");
  try {
    const raw = await fsp.readFile(settingsPath, "utf-8");
    const settings = JSON.parse(raw) as { workRootPath?: string };
    if (settings.workRootPath) return settings.workRootPath;
  } catch {
    // use default
  }
  return "D:\\SW_Doc\\Materials";
}

// WD 名一覧を WdInfo[] に変換
async function resolveWdList(wdNames: string[], catWslPath: string, catWinPath: string): Promise<WdInfo[]> {
  const wds: WdInfo[] = [];
  for (const wdName of wdNames) {
    const wdInfo = await processWdFolder(wdName, catWslPath, catWinPath);
    if (wdInfo) wds.push(wdInfo);
  }
  return wds;
}

// ルートフォルダをスキャンして CategoryInfo[] を返す
async function scanRoot(workRootWin: string): Promise<CategoryInfo[]> {
  const wslRoot = windowsToWsl(workRootWin);
  const allDirNames = await listDirs(wslRoot);
  const uncategorizedWds = allDirNames.filter((dirName) => WD_ROOT_PATTERN.test(dirName));
  const categoryDirs = allDirNames.filter((dirName) => !WD_ROOT_PATTERN.test(dirName));
  const categories: CategoryInfo[] = [];

  for (const catName of categoryDirs) {
    const catWslPath = path.join(wslRoot, catName);
    const catWinPath = `${workRootWin}\\${catName}`;
    const wdNames = await listDirs(catWslPath);
    const wds = await resolveWdList(wdNames, catWslPath, catWinPath);
    if (wds.length > 0) categories.push({ name: catName, wds });
  }

  if (uncategorizedWds.length > 0) {
    const wds = await resolveWdList(uncategorizedWds, wslRoot, workRootWin);
    if (wds.length > 0) categories.push({ name: "（未分類）", wds });
  }

  return categories;
}

// GET /api/work/scan
router.get(API_ROUTES.work.scan, async (req, res) => {
  try {
    const workRootWin = await getWorkRootWin();
    const categories = await scanRoot(workRootWin);
    res.json({ categories, rootPath: workRootWin });
  } catch (err) {
    log.error("workFiles.scan", "scan failed", { err });
    res.status(500).json({ error: "scan failed" });
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
    .sort((itemA, itemB) => parseInt(itemB.mat[1], 10) - parseInt(itemA.mat[1], 10));

  if (withVersions.length === 0) return;

  const [topItem] = withVersions;
  const targetPptx = topItem.fname;
  const vNum = parseInt(topItem.mat[1], 10);
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

interface CheckoutBody {
  wdId: string;
  windowsWdPath: string;
  action: string;
  sourceFilename?: string;
  newFilename?: string;
}

// checkout-new-version 時のみ Released PPTX を WD 直下へコピーする。
// 必須パラメータ欠如なら send でエラーを流して false（呼び出し側は中断）。それ以外は true。
async function copyNewVersionIfNeeded(body: CheckoutBody, wslWdPath: string, send: (line: string) => void): Promise<boolean> {
  if (body.action !== "checkout-new-version") return true;
  if (!body.sourceFilename || !body.newFilename) {
    send("ERROR: sourceFilename and newFilename required for checkout-new-version");
    return false;
  }
  send(`📋 コピー: ${body.sourceFilename} → ${body.newFilename}`);
  await fsp.copyFile(path.join(wslWdPath, "ReleasedVersion", body.sourceFilename), path.join(wslWdPath, body.newFilename));
  send("✅ コピー完了");
  return true;
}

// sw-checkout.sh を spawn し SSE に流す（終了コード 0 以外は reject）。
async function runCheckoutScript(wdId: string, wslWdPath: string, send: (line: string) => void): Promise<void> {
  const scriptPath = path.join(workspacePath, "data/work/scripts/sw-checkout.sh");
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("bash", [scriptPath, wdId, wslWdPath], {
      cwd: path.join(workspacePath, "data/work"),
      env: { ...process.env },
    });
    pipeToSse(proc, send);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`sw-checkout.sh exited with code ${String(code)}`))));
    proc.on("error", reject);
  });
}

// POST /api/work/checkout  (SSE ストリーム)
router.post(API_ROUTES.work.checkout, async (req, res) => {
  const body = req.body as CheckoutBody;
  if (!body.wdId || !body.windowsWdPath || !body.action) {
    res.status(400).json({ error: "wdId, windowsWdPath, action required" });
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
    const wslWdPath = windowsToWsl(body.windowsWdPath);
    if (!(await copyNewVersionIfNeeded(body, wslWdPath, send))) {
      res.end();
      return;
    }
    send(`🔄 チェックアウト開始: ${body.wdId}`);
    send(`📂 ソース: ${body.windowsWdPath}`);
    await runCheckoutScript(body.wdId, wslWdPath, send);
    send("✅ チェックアウト完了");
    send("🖼 サムネイル生成中...");
    await runThumbnails(path.join(workspacePath, "data/work", body.wdId), send);
    send("✅ サムネイル生成完了");
    send(`DONE:${body.wdId}`);
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("workFiles.checkout", "checkout failed", { err });
    send(`ERROR: ${msg}`);
    res.end();
  }
});

// POST /api/work/thumbnails  (SSE ストリーム)
// wdId だけ受け取り、WD がすでに WSL 上にある前提でサムネイルのみ生成する。
// checkout なしで slide editor に入ったとき（既存 WD を直接開いた場合など）に
// フロントエンドから自動呼び出しされる。
router.post(API_ROUTES.work.thumbnails, async (req, res) => {
  const { wdId } = req.body as { wdId?: string };

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

// .checkout-source から windows_path（/mnt/d 形式）を読む。無ければ null。
async function readCheckoutWindowsPath(wdId: string): Promise<string | null> {
  try {
    const raw = await fsp.readFile(path.join(workspacePath, "data/work", wdId, ".checkout-source"), "utf-8");
    const line = raw.split(/\r?\n/).find((entry) => entry.startsWith("windows_path="));
    const value = line ? line.slice("windows_path=".length).trim() : "";
    return value || null;
  } catch {
    return null;
  }
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
  if (copied.length || deleted.length) {
    log.info("workFiles.syncReleased", "mirrored ReleasedVersion from Windows (D: master)", { wdId, copied, deleted });
  }
  return { copied, deleted };
}

// WSL data/work/<wd>/ReleasedVersion を Windows(D:) の ReleasedVersion へ push（リリース逆同期）。
// diffReleasedMirror(WSL を正) で新/更新の pptx のみコピー。D: 側の他版は削除しない（安全側）。
// WSL 側 ReleasedVersion が空のときは no-op（誤コピー防止の安全弁）。
async function pushReleasedToWindows(wdId: string, windowsWdPath: string | null): Promise<{ copied: string[] }> {
  const empty = { copied: [] as string[] };
  if (!isValidWorkWdId(wdId) || !windowsWdPath) return empty;
  const wslReleasedDir = path.join(workspacePath, "data/work", wdId, "ReleasedVersion");
  const wslFiles = await statPptxList(wslReleasedDir);
  if (wslFiles.length === 0) return empty; // 安全弁: WSL が空なら何もしない
  const winReleasedDir = path.join(windowsToWsl(windowsWdPath), "ReleasedVersion");
  await fsp.mkdir(winReleasedDir, { recursive: true });
  const winFiles = await statPptxList(winReleasedDir);
  const { toCopy } = diffReleasedMirror(wslFiles, winFiles); // WSL を正＝新/更新分のみ
  const copied = await mirrorCopy(wslReleasedDir, winReleasedDir, toCopy);
  if (copied.length) {
    log.info("workFiles.pushReleased", "pushed ReleasedVersion to Windows (WSL→D:)", { wdId, copied });
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

// 登録済み WD の D:→WSL ミラー（ReleasedVersion＋素材）＋リリース済サムネ生成をまとめて行う。
// 「登録」ボタン（register）と、登録済み WD の展開時プレビュー（released-thumbs）が共有する本体。
async function mirrorWindowsAndBuildThumbs(wdId: string, windowsWdPath: string): Promise<ReleasedThumb[]> {
  // D: を正として WSL の ReleasedVersion を先に同期（孤児サムネ/版ズレ解消）。
  await syncReleasedFromWindows(wdId, windowsWdPath);
  // 併せて素材（FrameFiles/ScreenShots/RelatedMaterials/AudioFiles md/*.md 等）を D: を正にミラー。
  await syncSourceMaterialsFromWindows(wdId, windowsWdPath);
  const releasedDirWsl = path.join(windowsToWsl(windowsWdPath), "ReleasedVersion");
  return generateReleasedThumbs(wdId, releasedDirWsl);
}

// data/work/<wdId>/ が実体化済み（＝登録済み）か。
async function isWdRegistered(wdId: string): Promise<boolean> {
  return pathExists(path.join(workspacePath, "data/work", wdId));
}

// POST /api/work/released-thumbs — リリース選択前プレビュー（N5）。
// 未登録（WSL に data/work/<wd>/ が無い）WD では一切ミラー・生成しない（勝手に WD を実体化しない）。
router.post(API_ROUTES.work.releasedThumbs, async (req, res) => {
  const { wdId, windowsWdPath } = req.body as { wdId?: string; windowsWdPath?: string };

  if (!wdId || !isValidWorkWdId(wdId) || !windowsWdPath) {
    res.status(400).json({ error: "wdId (valid WD-ID) and windowsWdPath required" });
    return;
  }

  try {
    if (!(await isWdRegistered(wdId))) {
      res.json({ thumbs: [] }); // 未登録 WD は WSL に何も書かない
      return;
    }
    const thumbs = await mirrorWindowsAndBuildThumbs(wdId, windowsWdPath);
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
  const { wdId, windowsWdPath } = req.body as { wdId?: string; windowsWdPath?: string };

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
  const { wdId, windowsWdPath } = req.body as { wdId?: string; windowsWdPath?: string };

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

// POST /api/work/unregister — WD の WSL 実体（data/work/<wd>/）を丸ごと削除する（「抹消」）。
// 編集中バージョンが 1 つでも残っていれば 409 で拒否（編集中は WSL にしか無く失われるため）。
// Windows(D:) 側には一切触れない（D: が正。再登録でいつでも復元できる）。body `{ wdId }`。
router.post(API_ROUTES.work.unregister, async (req, res) => {
  const { wdId } = req.body as { wdId?: string };

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
// windowsWdPath 省略時は .checkout-source（windows_path）から解決する。JSON。
router.post(API_ROUTES.work.releaseToWindows, async (req, res) => {
  const { wdId, windowsWdPath } = req.body as { wdId?: string; windowsWdPath?: string };
  if (!wdId || !isValidWorkWdId(wdId)) {
    res.status(400).json({ error: "wdId (valid WD-ID) required" });
    return;
  }
  try {
    const winPath = windowsWdPath ?? (await readCheckoutWindowsPath(wdId));
    if (!winPath) {
      res.status(400).json({ error: "windowsWdPath 未指定かつ .checkout-source に windows_path がありません" });
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
  const { wd, version } = req.params as { wd: string; version: string };
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
  if (pptxs.length === 1) {
    return {
      name: pptxs[0],
      note: `⚠ 要求されたソース「${requested}」が見つからないため、ReleasedVersion 内の唯一の pptx「${pptxs[0]}」を使用します（ブラウザが古い一覧の可能性。再読込を推奨）`,
    };
  }
  if (pptxs.length === 0) {
    return { name: null, note: `❌ ReleasedVersion に pptx がありません（要求: ${requested}）` };
  }
  return { name: null, note: `❌ 要求されたソース「${requested}」が見つからず、ReleasedVersion に pptx が複数（${pptxs.length}）あり自動選択できません` };
}

// POST /api/work/:wd/:version/split — ReleasedVersion 由来の新版を COM 分割（SSE）
router.post(API_ROUTES.work.split, async (req, res) => {
  const { sourceFilename, sourceKind, sourceFrom } = req.body as { sourceFilename?: string; sourceKind?: string; sourceFrom?: string };
  if (!sourceFilename || !isSafePptxFilename(sourceFilename)) {
    res.status(400).json({ error: "valid sourceFilename (*.pptx) required" });
    return;
  }
  const ctx = beginComStream(req, res);
  if (!ctx) return;
  // split 前の安全網: D: を正として ReleasedVersion を同期（stale 名の自己回復）。
  // windowsWdPath は body に無いため .checkout-source（windows_path）から解決する。
  const synced = await syncReleasedFromWindows(ctx.wd, await readCheckoutWindowsPath(ctx.wd));
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
  const { outFilename, dedupMasters } = req.body as { outFilename?: string; dedupMasters?: boolean };
  if (!outFilename || !isSafePptxFilename(outFilename)) {
    res.status(400).json({ error: "valid outFilename (*.pptx) required" });
    return;
  }
  const ctx = beginComStream(req, res);
  if (!ctx) return;
  const args = ["combine", ctx.wd, ctx.version, outFilename];
  if (dedupMasters === false) args.push("nodedup");
  // リリース時は結合前に表紙の日付（リリース日）を更新する（バージョン番号は新版作成時に確定済み）。
  // COM 結合は .pages/*.pptx を読むため、先に表紙 pptx を書き換えておけば結合物へ反映される。
  await runUpdateCoverMeta(ctx.wd, ctx.version, COVER_META_FIELDS_RELEASE, ctx.send);
  // 結合成功後、新版 ReleasedVersion を Windows(D:) へ自動 push（L823 の注記どおり
  // 「新版は D: へ push してからミラー」の順序を守る）。windows_path は .checkout-source から。
  await runComScript(args, ctx.wd, ctx.send, async () => {
    const { copied } = await pushReleasedToWindows(ctx.wd, await readCheckoutWindowsPath(ctx.wd));
    if (copied.length) ctx.send(`📤 D: へ push: ${copied.join(", ")}`);
  });
  res.end();
});

// POST /api/work/:wd/:version/canvas-refresh — .pages を COM でページ単位 canvas 再生成（SSE）
router.post(API_ROUTES.work.canvasRefresh, async (req, res) => {
  const { full } = req.body as { full?: boolean };
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
  const raw = await fsp.readFile(structPath, "utf-8");
  const patched = buildForkedStructure(JSON.parse(raw) as Record<string, unknown>, wdId, targetVersion, sourceVersion, jstIsoNow());
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
    const raw = await fsp.readFile(manifestPath, "utf-8");
    const patched = buildForkedManifest(JSON.parse(raw) as Record<string, unknown>, targetVersion);
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

/** new_deck.py の --theme に渡せるテーマ ID（純粋定数・フロントの 10 択と一致）。 */
export const NEW_DECK_THEME_IDS = ["cool", "warm", "vivid", "dark", "plain", "earth", "neutral", "soft", "forest", "premium"] as const;

/** new-deck body の純粋検証。問題があればエラーメッセージ、無ければ null。 */
export function validateNewDeckBody(body: { title?: unknown; theme?: unknown }): string | null {
  if (typeof body.title !== "string" || !body.title.trim()) return "title は必須です";
  if (body.title.length > 200) return "title が長すぎます（200 文字以内）";
  if (typeof body.theme !== "string" || !(NEW_DECK_THEME_IDS as readonly string[]).includes(body.theme)) {
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
  body: { title: string; subtitle?: string; theme: string; confidential?: boolean },
): string[] {
  const args = [scriptPath, "--version-dir", versionDir, "--wd", wdId, "--version", version, "--title", body.title.trim(), "--theme", body.theme];
  if (body.subtitle?.trim()) args.push("--subtitle", body.subtitle.trim());
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
  body: { title: string; subtitle?: string; theme: string; confidential?: boolean },
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
  const { wd, version } = req.params as { wd: string; version: string };
  const body = req.body as { title?: string; subtitle?: string; theme?: string; confidential?: boolean; windowsWdPath?: string };
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
  await mirrorWindowsWdFolder(wd, body.windowsWdPath ?? null, ctx.send);
  await runNewDeck(wd, version, { title: body.title ?? "", subtitle: body.subtitle, theme: body.theme ?? "cool", confidential: body.confidential }, ctx.send);
  res.end();
});

// ── テーマ再適用（Phase2）──────────────────────────────────────────────────
// apply_theme.py（WSL python-pptx・COM 非依存）でデッキ全ページに配色を再適用し、
// structure.json に theme を永続化 → gen_thumbs でサムネ再生成 → DONE。
// canvas は明示「更新」ボタンで後追い。ホスト実行なのでサムネ豆腐は出ない。

/** theme body の純粋検証。問題があればエラーメッセージ、無ければ null。 */
export function validateThemeBody(body: { theme?: unknown }): string | null {
  if (typeof body.theme !== "string" || !(NEW_DECK_THEME_IDS as readonly string[]).includes(body.theme)) {
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
  const { wd, version } = req.params as { wd: string; version: string };
  const body = req.body as { theme?: string };
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
  const ctx = beginComStream(req, res);
  if (!ctx) return;
  await runApplyTheme(wd, version, body.theme ?? "cool", ctx.send);
  res.end();
});

// POST /api/work/:wd/:version/fork-from — 編集中由来の新版を .pages コピーで作成（SSE）
router.post(API_ROUTES.work.forkFrom, async (req, res) => {
  const { wd, version } = req.params as { wd: string; version: string };
  const { sourceVersion } = req.body as { sourceVersion?: string };
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
    const raw = await fsp.readFile(path.join(versionDir, ".pages", "structure.json"), "utf-8");
    const struct = JSON.parse(raw) as { pages?: Record<string, { checked_out?: boolean }> };
    return struct.pages ? Object.values(struct.pages).some((page) => page.checked_out === true) : false;
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
type DeleteVersionResult = { ok: true; wd: string; version: string; wsl: DeleteSide } | { ok: false; status: number; error: string };

// 編集中バージョンの後始末削除：WSL 側の作業サブフォルダ *だけ* を削除する（N1 本体）。
// Windows(D:) には一切触れない（編集中版は WSL のみに存在する運用のため）。
// 2 つのガードで拒否する：
//   ① チェックアウト中ページが残っている → 409（先にチェックイン）。
//   ② 枝番（子孫）バージョンが他に存在する → 409（親を消すと枝番が孤立するため）。
async function deleteVersionSubfolder(wdId: string, version: string): Promise<DeleteVersionResult> {
  const wdDir = path.join(workspacePath, "data/work", wdId);
  const wslVersionDir = path.join(wdDir, version);

  if (await hasLockedPages(wslVersionDir)) {
    return { ok: false, status: 409, error: "チェックアウト中のページが残っています。先にページをチェックインしてください。" };
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
  const { wd: wdId, version } = req.params as { wd: string; version: string };

  if (!isValidWorkWdId(wdId) || !isValidWorkVersion(version)) {
    res.status(400).json({ error: "invalid wd or version" });
    return;
  }

  try {
    const result = await deleteVersionSubfolder(wdId, version);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("workFiles.deleteVersion", "version subfolder delete failed", { err });
    res.status(500).json({ error: msg });
  }
});

export default router;
