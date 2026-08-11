// Unit tests for the explicit material sync route in
// server/api/routes/workFiles.ts — POST /api/work/sync-materials（「同期」ボタン）。
//
// この経路が「素材を D: を正にミラーする唯一の明示操作」であることを固定する。
// 回帰の元:「同期」を押しても常に「素材は最新です（変更なし）」と出る不具合。
// 原因は WD 展開のプレビュー（released-thumbs）が先に素材を取り込んでしまい、
// ボタンが copied:0 / deleted:0 を受け取っていたこと（実測ログで確認）。
// → 展開は素材に触らない（test_workFilesReleasedThumbs.ts §4）。ここでは逆に、
//   D: に変更があるとき「同期」が実数を返すことを検証する。
//
// Sandboxed workspace: HOME is redirected to a tmp dir before the module loads,
// mirroring test_workFilesRegister.

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, existsSync, writeFileSync, statSync, utimesSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type { Request, Response } from "express";
import { ONE_SECOND_MS } from "../../server/utils/time.js";

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

interface ResultBody {
  synced?: boolean;
  copied?: number;
  deleted?: number;
  error?: string;
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

function postReq(body: Record<string, unknown>): Request {
  return { body } as unknown as Request;
}

let tmpRoot: string;
let workspaceDir: string;
let fakeWinWd: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let syncHandler: Handler;

const WD_ID = "GIT-00007";
const SCREENSHOTS = "ScreenShots";
const FRAME_FILES = "FrameFiles";
const LAYOUTS_MD = "DocumentLayouts.md";

before(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), "mulmo-sync-materials-"));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;
  const { workspacePath } = await import("../../server/workspace/workspace.js");
  workspaceDir = workspacePath;
  mkdirSync(workspaceDir, { recursive: true });
  const routeMod = await import("../../server/api/routes/workFiles.js");
  syncHandler = extractRouteHandler(routeMod, "/api/work/sync-materials", "post");
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  await rm(tmpRoot, { recursive: true, force: true });
});

function wdDir(): string {
  return path.join(workspaceDir, "data/work", WD_ID);
}

// A fake (already WSL-form) Windows WD folder — windowsToWsl leaves a
// slash-only absolute path unchanged, so it doubles as the D: source.
beforeEach(async () => {
  await rm(path.join(workspaceDir, "data"), { recursive: true, force: true });
  fakeWinWd = path.join(tmpRoot, "fakewin", WD_ID);
  await rm(fakeWinWd, { recursive: true, force: true });
  mkdirSync(fakeWinWd, { recursive: true });
});

// 「登録済み」にする（data/work/<wd>/ の存在が登録の定義）。
function registerWd(): void {
  mkdirSync(wdDir(), { recursive: true });
}

// D: 側に素材一式を置く（AudioFiles は md のみ対象・wav は除外されるべき）。
function seedWindowsMaterials(): void {
  mkdirSync(path.join(fakeWinWd, FRAME_FILES), { recursive: true });
  writeFileSync(path.join(fakeWinWd, FRAME_FILES, "frame_0001.jpg"), "jpg");
  mkdirSync(path.join(fakeWinWd, SCREENSHOTS), { recursive: true });
  writeFileSync(path.join(fakeWinWd, SCREENSHOTS, "shot.png"), "png");
  mkdirSync(path.join(fakeWinWd, "RelatedMaterials"), { recursive: true });
  writeFileSync(path.join(fakeWinWd, "RelatedMaterials", "ref.pdf"), "pdf");
  writeFileSync(path.join(fakeWinWd, "ProjectInformation.md"), "info");
  writeFileSync(path.join(fakeWinWd, LAYOUTS_MD), "layout");
  mkdirSync(path.join(fakeWinWd, "AudioFiles"), { recursive: true });
  writeFileSync(path.join(fakeWinWd, "AudioFiles", "script.md"), "transcript");
  writeFileSync(path.join(fakeWinWd, "AudioFiles", "session.wav"), "wavdata"); // must NOT be copied
}

describe("POST /api/work/sync-materials — validation", () => {
  it("rejects an invalid wdId", async () => {
    const { state, res } = mockRes();
    await syncHandler(postReq({ wdId: "bad id", windowsWdPath: fakeWinWd }), res);
    assert.equal(state.status, 400);
  });

  it("rejects a missing windowsWdPath", async () => {
    const { state, res } = mockRes();
    await syncHandler(postReq({ wdId: WD_ID }), res);
    assert.equal(state.status, 400);
  });

  it("refuses (409) an unregistered WD and writes nothing", async () => {
    seedWindowsMaterials();
    assert.equal(existsSync(wdDir()), false, "precondition: WD dir absent");
    const { state, res } = mockRes();
    await syncHandler(postReq({ wdId: WD_ID, windowsWdPath: fakeWinWd }), res);
    assert.equal(state.status, 409);
    assert.equal(existsSync(wdDir()), false, "unregistered WD must not be materialised");
  });
});

describe("POST /api/work/sync-materials — mirrors source materials from D: (D: master)", () => {
  it("copies materials, deletes WSL extras, honours the AudioFiles md-only filter, and reports the real counts", async () => {
    registerWd();
    seedWindowsMaterials();
    // WSL side: a stale FrameFiles extra that must be deleted (D: master).
    mkdirSync(path.join(wdDir(), FRAME_FILES), { recursive: true });
    writeFileSync(path.join(wdDir(), FRAME_FILES, "stale.jpg"), "old");

    const { state, res } = mockRes();
    await syncHandler(postReq({ wdId: WD_ID, windowsWdPath: fakeWinWd }), res);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.equal(state.body?.synced, true);

    assert.equal(existsSync(path.join(wdDir(), FRAME_FILES, "frame_0001.jpg")), true, "frame copied");
    assert.equal(existsSync(path.join(wdDir(), FRAME_FILES, "stale.jpg")), false, "WSL extra frame deleted");
    assert.equal(existsSync(path.join(wdDir(), SCREENSHOTS, "shot.png")), true, "screenshot copied");
    assert.equal(existsSync(path.join(wdDir(), "RelatedMaterials", "ref.pdf")), true, "related material copied");
    assert.equal(existsSync(path.join(wdDir(), "ProjectInformation.md")), true, "project info copied");
    assert.equal(existsSync(path.join(wdDir(), LAYOUTS_MD)), true, "layouts copied");
    assert.equal(existsSync(path.join(wdDir(), "AudioFiles", "script.md")), true, "transcript md copied");
    assert.equal(existsSync(path.join(wdDir(), "AudioFiles", "session.wav")), false, "wav excluded by filter");

    // 実数の報告（UI の「+N 追加・更新 / -M 削除」の元）＝ 6 コピー / 1 削除。
    assert.equal(state.body?.copied, 6, "every D: material is counted as copied");
    assert.equal(state.body?.deleted, 1, "the WSL extra is counted as deleted");
  });

  it("reports the added screenshot and the updated DocumentLayouts.md (the reported bug)", async () => {
    // 一度同期して一致させた後、D: 側でスクショ追加＋レイアウト md 更新 → 2 件と報告されるべき。
    registerWd();
    seedWindowsMaterials();
    const first = mockRes();
    await syncHandler(postReq({ wdId: WD_ID, windowsWdPath: fakeWinWd }), first.res);
    assert.equal(first.state.status, 200, JSON.stringify(first.state.body));

    writeFileSync(path.join(fakeWinWd, SCREENSHOTS, "shot2.png"), "png2");
    // 「更新」判定を決定的にする: mirrorSingleFile は srcMtime <= destMtime を skip とするため、
    // D: 側の更新 mtime を WSL 側コピーより確実に新しくしておく（同一ミリ秒だと取りこぼす）。
    const layoutsSrc = path.join(fakeWinWd, LAYOUTS_MD);
    writeFileSync(layoutsSrc, "layout v2");
    const newer = new Date(statSync(path.join(wdDir(), LAYOUTS_MD)).mtimeMs + ONE_SECOND_MS);
    utimesSync(layoutsSrc, newer, newer);

    const { state, res } = mockRes();
    await syncHandler(postReq({ wdId: WD_ID, windowsWdPath: fakeWinWd }), res);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.equal(state.body?.copied, 2, "added screenshot + updated layouts are reported, not '変更なし'");
    assert.equal(state.body?.deleted, 0);
    assert.equal(existsSync(path.join(wdDir(), SCREENSHOTS, "shot2.png")), true, "added screenshot mirrored");
  });

  it("reports 0/0 only when D: and WSL are genuinely identical", async () => {
    registerWd();
    seedWindowsMaterials();
    const first = mockRes();
    await syncHandler(postReq({ wdId: WD_ID, windowsWdPath: fakeWinWd }), first.res);
    assert.equal(first.state.status, 200, JSON.stringify(first.state.body));

    const { state, res } = mockRes();
    await syncHandler(postReq({ wdId: WD_ID, windowsWdPath: fakeWinWd }), res);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.equal(state.body?.copied, 0, "nothing changed on D: → no copy");
    assert.equal(state.body?.deleted, 0, "nothing changed on D: → no delete");
  });

  it("preserves WSL materials when the D: item is absent (safety valve)", async () => {
    registerWd();
    mkdirSync(path.join(wdDir(), FRAME_FILES), { recursive: true });
    const keep = path.join(wdDir(), FRAME_FILES, "keep.jpg");
    writeFileSync(keep, "keep"); // D: 側に FrameFiles は無い

    const { state, res } = mockRes();
    await syncHandler(postReq({ wdId: WD_ID, windowsWdPath: fakeWinWd }), res);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.equal(existsSync(keep), true, "WSL material preserved when D: lacks the folder");
    assert.equal(state.body?.copied, 0);
    assert.equal(state.body?.deleted, 0);
  });

  it("preserves WSL when the whole D: WD folder is missing (no-op, no deletions)", async () => {
    registerWd();
    mkdirSync(path.join(wdDir(), SCREENSHOTS), { recursive: true });
    const keep = path.join(wdDir(), SCREENSHOTS, "keep.png");
    writeFileSync(keep, "keep");
    await rm(fakeWinWd, { recursive: true, force: true });

    const { state, res } = mockRes();
    await syncHandler(postReq({ wdId: WD_ID, windowsWdPath: fakeWinWd }), res);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.equal(existsSync(keep), true, "WSL preserved when the D: WD root is gone");
    assert.equal(state.body?.copied, 0);
    assert.equal(state.body?.deleted, 0);
  });
});
