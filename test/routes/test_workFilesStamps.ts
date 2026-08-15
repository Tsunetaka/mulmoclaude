// Unit tests for the stamp-selector routes in server/api/routes/workFiles.ts:
//   GET  /api/work/stamps       — list stamps + per-category usage
//   POST /api/work/stamp-apply  — wipe the WD's Windows-side Stamps folder, copy the pair
//
// Sandboxed workspace: HOME is redirected to a tmp dir before the module loads
// (mirrors test_workFilesSyncMaterials). A POSIX path is used as the fake D:
// root so windowsToWsl leaves it unchanged and scanRoot reads our fake tree.

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, existsSync, writeFileSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type { Request, Response } from "express";

type RouteModule = typeof import("../../server/api/routes/workFiles.js");
type Handler = (req: Request, res: Response) => Promise<void> | void;

interface StackFrame {
  route?: { path: string; stack: { method: string; handle: Handler }[] };
}
interface RouterInternals {
  stack: StackFrame[];
}

function extractRouteHandler(mod: RouteModule, routePath: string, method: string): Handler {
  const router = mod.default as unknown as RouterInternals;
  for (const frame of router.stack) {
    if (frame.route?.path !== routePath) continue;
    const layer = frame.route.stack.find((stackLayer) => stackLayer.method === method);
    if (layer) return layer.handle;
  }
  throw new Error(`route ${method.toUpperCase()} ${routePath} not registered`);
}

interface StampSibling {
  id: string;
  title: string;
}
interface StampInfo {
  id: string;
  flower: string;
  label: string;
  thumbPath: string;
  completedFile: string;
  incompletedFile: string;
  usedByCurrent: boolean;
  usedBySiblings: StampSibling[];
}
interface WdScan {
  id: string;
  registered: boolean;
  stampNames: string[] | null;
  stampConflicts: { name: string; siblings: { id: string; title: string }[] }[];
}
interface CatScan {
  name: string;
  wds: WdScan[];
}
interface ResultBody {
  stamps?: StampInfo[];
  applied?: boolean;
  removed?: number;
  copied?: string[];
  error?: string;
  categories?: CatScan[];
  rootPath?: string;
}

function mockRes() {
  const state: { status: number; body: ResultBody | undefined } = { status: 200, body: undefined };
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(payload: ResultBody) {
      state.body = payload;
      return res;
    },
  };
  return { state, res: res as unknown as Response };
}

const CURRENT_WD = "GIT-00007";
const SIBLING_WD = "GIT-00008";
const CATEGORY = "TestCat";

let tmpRoot: string;
let workspaceDir: string;
let dRoot: string; // fake D: root (POSIX)
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let stampsHandler: Handler;
let applyHandler: Handler;
let scanHandler: Handler;

function compressedDir(): string {
  return path.join(workspaceDir, "data/work/stamps/compressed");
}
function currentWdWin(): string {
  return path.join(dRoot, CATEGORY, `${CURRENT_WD} Current WD`);
}
function siblingWdWin(): string {
  return path.join(dRoot, CATEGORY, `${SIBLING_WD} Sibling WD`);
}

// Write a stamp pair into compressed/.
function seedStampPair(base: string): void {
  writeFileSync(path.join(compressedDir(), `${base}_completed.png`), "completed-png");
  writeFileSync(path.join(compressedDir(), `${base}_incompleted.png`), "incompleted-png");
}

function seedIndexJson(): void {
  const index = {
    assets: [
      { id: "aaa_completed", label: "アアア 修了証スタンプ（フルカラー）" },
      { id: "bbb_completed", label: "ビビビ 修了証スタンプ（フルカラー）" },
    ],
  };
  writeFileSync(path.join(workspaceDir, "data/work/stamps/index.json"), JSON.stringify(index));
}

before(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), "mulmo-stamps-"));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;
  const { workspacePath } = await import("../../server/workspace/workspace.js");
  workspaceDir = workspacePath;
  mkdirSync(workspaceDir, { recursive: true });
  dRoot = path.join(tmpRoot, "droot");
  const routeMod = await import("../../server/api/routes/workFiles.js");
  stampsHandler = extractRouteHandler(routeMod, "/api/work/stamps", "get");
  applyHandler = extractRouteHandler(routeMod, "/api/work/stamp-apply", "post");
  scanHandler = extractRouteHandler(routeMod, "/api/work/scan", "get");
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  await rm(tmpRoot, { recursive: true, force: true });
});

// Fresh workspace + fake D: tree before each test.
beforeEach(async () => {
  await rm(path.join(workspaceDir, "data"), { recursive: true, force: true });
  await rm(path.join(workspaceDir, "config"), { recursive: true, force: true });
  await rm(dRoot, { recursive: true, force: true });
  mkdirSync(compressedDir(), { recursive: true });
  seedStampPair("aaa");
  seedStampPair("bbb");
  seedIndexJson();
  // settings.json points the work root at our POSIX fake D: root.
  mkdirSync(path.join(workspaceDir, "config"), { recursive: true });
  writeFileSync(path.join(workspaceDir, "config/settings.json"), JSON.stringify({ workRootPath: dRoot }));
  // Category with the current WD and a sibling WD.
  mkdirSync(currentWdWin(), { recursive: true });
  mkdirSync(siblingWdWin(), { recursive: true });
});

function getReq(query: Record<string, unknown>): Request {
  return { query } as unknown as Request;
}
function postReq(body: Record<string, unknown>): Request {
  return { body } as unknown as Request;
}

describe("GET /api/work/stamps — validation", () => {
  it("rejects an invalid wdId", async () => {
    const { state, res } = mockRes();
    await stampsHandler(getReq({ wdId: "bad id" }), res);
    assert.equal(state.status, 400);
  });
  it("rejects a missing wdId", async () => {
    const { state, res } = mockRes();
    await stampsHandler(getReq({}), res);
    assert.equal(state.status, 400);
  });
});

describe("GET /api/work/stamps — list + usage", () => {
  it("lists pair-complete stamps with labels and no usage when siblings are empty", async () => {
    const { state, res } = mockRes();
    await stampsHandler(getReq({ wdId: CURRENT_WD }), res);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    const stamps = state.body?.stamps ?? [];
    assert.equal(stamps.length, 2, "two pair-complete stamps");
    assert.deepEqual(
      stamps.map((item) => item.id),
      ["aaa", "bbb"],
      "sorted by base name",
    );
    assert.equal(stamps[0].flower, "アアア", "flower label stripped from index label");
    assert.equal(stamps[0].thumbPath, "data/work/stamps/compressed/aaa_completed.png");
    assert.equal(stamps[0].usedByCurrent, false);
    assert.equal(stamps[0].usedBySiblings.length, 0);
  });

  it("excludes a stamp whose incompleted pair is missing", async () => {
    writeFileSync(path.join(compressedDir(), "ccc_completed.png"), "orphan"); // no _incompleted
    const { state, res } = mockRes();
    await stampsHandler(getReq({ wdId: CURRENT_WD }), res);
    const ids = (state.body?.stamps ?? []).map((item) => item.id);
    assert.ok(!ids.includes("ccc"), "orphan (no incompleted pair) excluded");
  });

  it("flags usedBySiblings when a sibling WD's Stamps holds the completed png", async () => {
    mkdirSync(path.join(siblingWdWin(), "Stamps"), { recursive: true });
    writeFileSync(path.join(siblingWdWin(), "Stamps", "aaa_completed.png"), "x");
    const { state, res } = mockRes();
    await stampsHandler(getReq({ wdId: CURRENT_WD }), res);
    const aaa = (state.body?.stamps ?? []).find((item) => item.id === "aaa");
    assert.ok(aaa, "aaa present");
    assert.equal(aaa?.usedByCurrent, false);
    assert.deepEqual(
      aaa?.usedBySiblings.map((sibling) => sibling.id),
      [SIBLING_WD],
    );
  });

  it("flags usedByCurrent when the current WD's own Stamps holds the completed png", async () => {
    mkdirSync(path.join(currentWdWin(), "Stamps"), { recursive: true });
    writeFileSync(path.join(currentWdWin(), "Stamps", "bbb_completed.png"), "x");
    const { state, res } = mockRes();
    await stampsHandler(getReq({ wdId: CURRENT_WD }), res);
    const bbb = (state.body?.stamps ?? []).find((item) => item.id === "bbb");
    assert.equal(bbb?.usedByCurrent, true);
    assert.equal(bbb?.usedBySiblings.length, 0);
  });
});

describe("POST /api/work/stamp-apply — validation", () => {
  it("rejects an invalid wdId", async () => {
    const { state, res } = mockRes();
    await applyHandler(postReq({ wdId: "bad id", stampId: "aaa", windowsWdPath: currentWdWin() }), res);
    assert.equal(state.status, 400);
  });
  it("rejects an unsafe stampId", async () => {
    const { state, res } = mockRes();
    await applyHandler(postReq({ wdId: CURRENT_WD, stampId: "../evil", windowsWdPath: currentWdWin() }), res);
    assert.equal(state.status, 400);
  });
  it("returns 409 when the stamp pair is missing", async () => {
    const { state, res } = mockRes();
    await applyHandler(postReq({ wdId: CURRENT_WD, stampId: "zzz", windowsWdPath: currentWdWin() }), res);
    assert.equal(state.status, 409);
  });
});

describe("POST /api/work/stamp-apply — wipe + copy", () => {
  it("empties the Stamps folder then copies the selected pair", async () => {
    // Pre-existing content that must be wiped.
    const stampsFolder = path.join(currentWdWin(), "Stamps");
    mkdirSync(stampsFolder, { recursive: true });
    writeFileSync(path.join(stampsFolder, "old_completed.png"), "old");
    writeFileSync(path.join(stampsFolder, "old_incompleted.png"), "old");

    const { state, res } = mockRes();
    await applyHandler(postReq({ wdId: CURRENT_WD, stampId: "bbb", windowsWdPath: currentWdWin() }), res);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.equal(state.body?.applied, true);
    assert.equal(state.body?.removed, 2, "two old files removed");
    assert.deepEqual(state.body?.copied, ["bbb_completed.png", "bbb_incompleted.png"]);

    assert.equal(existsSync(path.join(stampsFolder, "old_completed.png")), false, "old wiped");
    assert.equal(existsSync(path.join(stampsFolder, "bbb_completed.png")), true, "completed copied");
    assert.equal(existsSync(path.join(stampsFolder, "bbb_incompleted.png")), true, "incompleted copied");
  });

  it("creates the Stamps folder when it does not exist (removed 0)", async () => {
    const stampsFolder = path.join(currentWdWin(), "Stamps");
    assert.equal(existsSync(stampsFolder), false, "precondition: no Stamps folder");
    const { state, res } = mockRes();
    await applyHandler(postReq({ wdId: CURRENT_WD, stampId: "aaa", windowsWdPath: currentWdWin() }), res);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.equal(state.body?.removed, 0);
    assert.equal(existsSync(path.join(stampsFolder, "aaa_completed.png")), true);
    assert.equal(existsSync(path.join(stampsFolder, "aaa_incompleted.png")), true);
  });
});

// Mark a WD as "registered" by materializing its WSL work folder.
function registerWd(wdId: string): void {
  mkdirSync(path.join(workspaceDir, "data/work", wdId), { recursive: true });
}
// Put a completed stamp png into a WD's Windows-side Stamps folder.
function seedWdStamp(wdWin: string, completedFileName: string): void {
  mkdirSync(path.join(wdWin, "Stamps"), { recursive: true });
  writeFileSync(path.join(wdWin, "Stamps", completedFileName), "x");
}
function scannedWd(body: ResultBody | undefined, wdId: string): WdScan | undefined {
  for (const cat of body?.categories ?? []) {
    const found = cat.wds.find((entry) => entry.id === wdId);
    if (found) return found;
  }
  return undefined;
}

describe("GET /api/work/scan — stampNames (list-view current stamp)", () => {
  it("resolves the flower name from index.json for a registered WD with a stamp set", async () => {
    registerWd(CURRENT_WD);
    seedWdStamp(currentWdWin(), "aaa_completed.png");
    const { state, res } = mockRes();
    await scanHandler(getReq({}), res);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.deepEqual(scannedWd(state.body, CURRENT_WD)?.stampNames, ["アアア"]);
  });

  it("returns [] (未選択) for a registered WD whose Stamps folder is empty/absent", async () => {
    registerWd(CURRENT_WD);
    const { state, res } = mockRes();
    await scanHandler(getReq({}), res);
    assert.deepEqual(scannedWd(state.body, CURRENT_WD)?.stampNames, []);
  });

  it("returns null (hidden) for an unregistered WD even if a stamp sits on Windows", async () => {
    // GIT-00008 is NOT registered (no WSL work folder), but its D: Stamps holds a stamp.
    seedWdStamp(siblingWdWin(), "aaa_completed.png");
    const { state, res } = mockRes();
    await scanHandler(getReq({}), res);
    const sibling = scannedWd(state.body, SIBLING_WD);
    assert.equal(sibling?.registered, false);
    assert.equal(sibling?.stampNames, null);
  });

  it("falls back to the filename base when the stamp is not in index.json", async () => {
    registerWd(CURRENT_WD);
    seedWdStamp(currentWdWin(), "zzz_completed.png"); // no index label / not in compressed
    const { state, res } = mockRes();
    await scanHandler(getReq({}), res);
    assert.deepEqual(scannedWd(state.body, CURRENT_WD)?.stampNames, ["zzz"]);
  });

  it("joins multiple completed stamps sorted by base (anomaly case)", async () => {
    registerWd(CURRENT_WD);
    seedWdStamp(currentWdWin(), "bbb_completed.png");
    writeFileSync(path.join(currentWdWin(), "Stamps", "aaa_completed.png"), "x");
    const { state, res } = mockRes();
    await scanHandler(getReq({}), res);
    // sorted by base: aaa → アアア, bbb → ビビビ
    assert.deepEqual(scannedWd(state.body, CURRENT_WD)?.stampNames, ["アアア", "ビビビ"]);
  });
});

describe("GET /api/work/scan — stampConflicts (same-category duplicate warning)", () => {
  it("flags both registered WDs when they share a stamp in the same category", async () => {
    registerWd(CURRENT_WD);
    registerWd(SIBLING_WD);
    seedWdStamp(currentWdWin(), "aaa_completed.png");
    seedWdStamp(siblingWdWin(), "aaa_completed.png");
    const { state, res } = mockRes();
    await scanHandler(getReq({}), res);
    const current = scannedWd(state.body, CURRENT_WD);
    const sibling = scannedWd(state.body, SIBLING_WD);
    assert.equal(current?.stampConflicts.length, 1);
    assert.equal(current?.stampConflicts[0].name, "アアア");
    assert.deepEqual(
      current?.stampConflicts[0].siblings.map((entry) => entry.id),
      [SIBLING_WD],
    );
    assert.deepEqual(
      sibling?.stampConflicts[0].siblings.map((entry) => entry.id),
      [CURRENT_WD],
    );
  });

  it("counts an UNREGISTERED sibling's D: stamp as a conflict (registration-agnostic scope)", async () => {
    registerWd(CURRENT_WD); // sibling stays unregistered
    seedWdStamp(currentWdWin(), "aaa_completed.png");
    seedWdStamp(siblingWdWin(), "aaa_completed.png");
    const { state, res } = mockRes();
    await scanHandler(getReq({}), res);
    const current = scannedWd(state.body, CURRENT_WD);
    const sibling = scannedWd(state.body, SIBLING_WD);
    assert.deepEqual(
      current?.stampConflicts.map((conflict) => conflict.name),
      ["アアア"],
      "registered WD is warned about the unregistered sibling",
    );
    assert.equal(sibling?.registered, false);
    assert.equal(sibling?.stampNames, null, "unregistered sibling shows nothing");
    assert.deepEqual(sibling?.stampConflicts, [], "unregistered sibling carries no warning");
  });

  it("reports no conflict when the two WDs use different stamps", async () => {
    registerWd(CURRENT_WD);
    registerWd(SIBLING_WD);
    seedWdStamp(currentWdWin(), "aaa_completed.png");
    seedWdStamp(siblingWdWin(), "bbb_completed.png");
    const { state, res } = mockRes();
    await scanHandler(getReq({}), res);
    assert.deepEqual(scannedWd(state.body, CURRENT_WD)?.stampConflicts, []);
    assert.deepEqual(scannedWd(state.body, SIBLING_WD)?.stampConflicts, []);
  });
});
