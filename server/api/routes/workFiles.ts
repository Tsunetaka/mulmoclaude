import { Router } from "express";
import path from "path";
import { promises as fsp } from "fs";
import { spawn } from "child_process";
import { workspacePath } from "../../workspace/workspace.js";
import { log } from "../../system/logger/index.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";

const router = Router();

const PPTX_PATTERN = /\.pptx$/i;
const PPTX_VERSION_DATE_PATTERN = /_(\d{8})_v(\d+)\.pptx$/i;
const PPTX_VERSION_PATTERN = /_v(\d+)\.pptx$/i;
// eslint-disable-next-line sonarjs/slow-regex
const WD_NAME_PATTERN = /^([A-Z]+-\d+)\s+(.+)$/;
const WD_ROOT_PATTERN = /^[A-Z]+-\d{5}\s+/;

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

interface WorkDirState {
  checkedOutVersion: string | null;
  dirty: boolean;
  stale: boolean;
  windowsMtime: number | null;
  workMtime: number | null;
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

// Windows 側の mtime と work/ 側の mtime を比較して stale を判定
async function checkStale(workDir: string, versionNum: number): Promise<{ stale: boolean; windowsMtime: number | null; workMtime: number | null }> {
  const checkoutSourcePath = path.join(workDir, ".checkout-source");
  try {
    const src = await fsp.readFile(checkoutSourcePath, "utf-8");
    const winPathLine = src.split("\n").find((line) => line.startsWith("windows_path="));
    if (!winPathLine) return { stale: false, windowsMtime: null, workMtime: null };

    const winPath = winPathLine.slice("windows_path=".length).trim();
    const wslPath = windowsToWsl(winPath);
    const vStr = String(versionNum).padStart(3, "0");
    const versionFilePattern = new RegExp(`_v${vStr}\\.pptx$`, "i");

    const winPptxFiles = await listFiles(wslPath, versionFilePattern);
    const workPptxFiles = await listFiles(workDir, versionFilePattern);
    if (winPptxFiles.length === 0 || workPptxFiles.length === 0) return { stale: false, windowsMtime: null, workMtime: null };

    const windowsMtime = await getMtime(path.join(wslPath, winPptxFiles[0]));
    const workMtime = await getMtime(path.join(workDir, workPptxFiles[0]));
    const stale = windowsMtime !== null && workMtime !== null && windowsMtime > workMtime + 5000;
    return { stale, windowsMtime, workMtime };
  } catch {
    return { stale: false, windowsMtime: null, workMtime: null };
  }
}

// WD の work/ 状態を調べる
async function scanWorkDir(wdId: string): Promise<WorkDirState> {
  const workDir = path.join(workspacePath, "data/work", wdId);
  try {
    await fsp.access(workDir);
  } catch {
    return { checkedOutVersion: null, dirty: false, stale: false, windowsMtime: null, workMtime: null };
  }

  const pptxFiles = await listFiles(workDir, PPTX_PATTERN);
  const versionNums = pptxFiles
    .map((filename) => filename.match(PPTX_VERSION_PATTERN))
    .filter((mat): mat is RegExpMatchArray => mat !== null)
    .map((mat) => mat[1])
    .sort()
    .reverse();

  if (versionNums.length === 0) {
    return { checkedOutVersion: null, dirty: false, stale: false, windowsMtime: null, workMtime: null };
  }

  const versionNum = parseInt(versionNums[0], 10);
  const checkedOutVersion = `v${versionNums[0].padStart(3, "0")}`;
  const manifestPath = path.join(workDir, ".thumbcache", checkedOutVersion, "manifest.json");
  const dirty = await checkDirtyFlag(manifestPath);
  const { stale, windowsMtime, workMtime } = await checkStale(workDir, versionNum);

  return { checkedOutVersion, dirty, stale, windowsMtime, workMtime };
}

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

// VersionInfo を取得または新規作成してマップに upsert
function upsertVersion(map: Map<string, VersionInfo>, fname: string, parsed: NonNullable<ReturnType<typeof parsePptxVersion>>): VersionInfo {
  const existing = map.get(parsed.version);
  if (existing) return existing;
  const ver: VersionInfo = { version: parsed.version, versionNum: parsed.versionNum, filename: fname, date: parsed.date, statuses: [] };
  map.set(parsed.version, ver);
  return ver;
}

// work/ 状態をバージョンマップに反映
function applyWorkState(map: Map<string, VersionInfo>, workState: WorkDirState): void {
  if (!workState.checkedOutVersion) return;
  const ver = map.get(workState.checkedOutVersion);
  if (!ver) return;
  if (workState.stale) ver.statuses.push("stale");
  else if (workState.dirty) ver.statuses.push("dirty");
  else ver.statuses.push("checked-out");
}

// バージョンマップを構築（draft + released + work/ 状態）
async function buildVersionMap(wdWslPath: string, workState: WorkDirState): Promise<Map<string, VersionInfo>> {
  const draftFiles = await listFiles(wdWslPath, PPTX_PATTERN);
  const releasedFiles = await listFiles(path.join(wdWslPath, "ReleasedVersion"), PPTX_PATTERN);
  const versionMap = new Map<string, VersionInfo>();

  for (const fname of draftFiles) {
    const parsed = parsePptxVersion(fname);
    if (!parsed) continue;
    upsertVersion(versionMap, fname, parsed).statuses.push("draft");
  }

  for (const fname of releasedFiles) {
    const parsed = parsePptxVersion(fname);
    if (!parsed) continue;
    const ver = upsertVersion(versionMap, fname, parsed);
    ver.statuses = ver.statuses.filter((status) => status !== "draft");
    if (!ver.statuses.includes("released")) ver.statuses.push("released");
  }

  applyWorkState(versionMap, workState);
  return versionMap;
}

// WD フォルダを処理して WdInfo を返す
async function processWdFolder(wdName: string, catWslPath: string, catWinPath: string): Promise<WdInfo | null> {
  const match = wdName.match(WD_NAME_PATTERN);
  if (!match) return null;

  const [, wdId, title] = match;
  const wdWslPath = path.join(catWslPath, wdName);
  const wdWinPath = `${catWinPath}\\${wdName}`;
  const workState = await scanWorkDir(wdId);
  const versionMap = await buildVersionMap(wdWslPath, workState);
  const versions = [...versionMap.values()].sort((verA, verB) => verA.versionNum - verB.versionNum);

  return {
    id: wdId,
    title,
    windowsWdPath: wdWinPath,
    hasCheckedOut: workState.checkedOutVersion !== null,
    checkedOutVersion: workState.checkedOutVersion,
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
    tmpdir = Path(tempfile.mkdtemp())
    try:
        result = subprocess.run(
            ['soffice', '--headless', '--convert-to', 'pdf', '--outdir', str(tmpdir), pptx_path],
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
            ['pdftoppm', '-png', '-r', '96', str(pdf_files[0]), str(tmpdir / 'slide')],
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

// POST /api/work/checkout  (SSE ストリーム)
router.post(API_ROUTES.work.checkout, async (req, res) => {
  const { wdId, windowsWdPath, action, sourceFilename, newFilename } = req.body as {
    wdId: string;
    windowsWdPath: string;
    action: string;
    sourceFilename?: string;
    newFilename?: string;
  };

  if (!wdId || !windowsWdPath || !action) {
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
    const wslWdPath = windowsToWsl(windowsWdPath);

    // 新バージョン作成: Released PPTX を WD 直下にコピー
    if (action === "checkout-new-version") {
      if (!sourceFilename || !newFilename) {
        send("ERROR: sourceFilename and newFilename required for checkout-new-version");
        res.end();
        return;
      }
      const srcPath = path.join(wslWdPath, "ReleasedVersion", sourceFilename);
      const dstPath = path.join(wslWdPath, newFilename);
      send(`📋 コピー: ${sourceFilename} → ${newFilename}`);
      await fsp.copyFile(srcPath, dstPath);
      send("✅ コピー完了");
    }

    // sw-checkout.sh を実行
    const scriptPath = path.join(workspacePath, "data/work/scripts/sw-checkout.sh");
    send(`🔄 チェックアウト開始: ${wdId}`);
    send(`📂 ソース: ${windowsWdPath}`);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("bash", [scriptPath, wdId, wslWdPath], {
        cwd: path.join(workspacePath, "data/work"),
        env: { ...process.env },
      });
      pipeToSse(proc, send);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`sw-checkout.sh exited with code ${String(code)}`));
      });
      proc.on("error", reject);
    });

    send("✅ チェックアウト完了");
    send("🖼 サムネイル生成中...");

    const workDir = path.join(workspacePath, "data/work", wdId);
    await runThumbnails(workDir, send);

    send("✅ サムネイル生成完了");
    send(`DONE:${wdId}`);
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("workFiles.checkout", "checkout failed", { err });
    send(`ERROR: ${msg}`);
    res.end();
  }
});

export default router;
