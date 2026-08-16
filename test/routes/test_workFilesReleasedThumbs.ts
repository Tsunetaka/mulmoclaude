// Unit tests for the N5 "release pre-selection preview" route in
// server/api/routes/workFiles.ts — POST /api/work/released-thumbs.
//
// Two layers:
//   1. thumbNeedsRebuild — pure staleness rule (missing / pptx newer).
//   2. Route handler over a sandboxed workspace. We exercise the
//      orchestration paths that do NOT shell out to LibreOffice:
//      validation (400), an up-to-date thumb (generated:false), and a
//      WD with no ReleasedVersion (empty result). Real cover rendering
//      is heavy (soffice + pdftoppm) and is verified manually.

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, utimesSync, existsSync } from "fs";
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

interface ThumbEntry {
  version: string;
  path: string;
  generated: boolean;
  error?: string;
}
interface ResultBody {
  error?: string;
  thumbs?: ThumbEntry[];
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

function req(body: unknown): Request {
  return { body } as unknown as Request;
}

// ── 1. Pure staleness rule ────────────────────────────────────────
describe("thumbNeedsRebuild (pure)", () => {
  it("rebuilds when the thumb is missing", async () => {
    const { thumbNeedsRebuild } = await import("../../server/api/routes/workFiles.js");
    assert.equal(thumbNeedsRebuild(1000, null), true);
    assert.equal(thumbNeedsRebuild(null, null), true);
  });

  it("keeps an existing thumb when the pptx is gone", async () => {
    const { thumbNeedsRebuild } = await import("../../server/api/routes/workFiles.js");
    assert.equal(thumbNeedsRebuild(null, 1000), false);
  });

  it("rebuilds only when the pptx is strictly newer than the thumb", async () => {
    const { thumbNeedsRebuild } = await import("../../server/api/routes/workFiles.js");
    assert.equal(thumbNeedsRebuild(2000, 1000), true, "pptx newer");
    assert.equal(thumbNeedsRebuild(1000, 2000), false, "thumb newer");
    assert.equal(thumbNeedsRebuild(1000, 1000), false, "equal → no rebuild");
  });
});

// ── 2. Route handler over a sandboxed workspace ───────────────────
let tmpRoot: string;
let workspaceDir: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let thumbsHandler: Handler;

const WD_ID = "GIT-00003";

before(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), "mulmo-released-thumbs-"));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;
  const { workspacePath } = await import("../../server/workspace/workspace.js");
  workspaceDir = workspacePath;
  mkdirSync(workspaceDir, { recursive: true });
  const routeMod = await import("../../server/api/routes/workFiles.js");
  thumbsHandler = extractRouteHandler(routeMod, "/api/work/released-thumbs", "post");
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  await rm(tmpRoot, { recursive: true, force: true });
});

// Fake (already WSL-form) Windows WD base — windowsToWsl leaves a
// non-drive-letter path unchanged, so a plain tmp path works as the
// "windowsWdPath" the route would receive from a scan.
function fakeWinWd(): string {
  return path.join(tmpRoot, "fakewin", WD_ID);
}

beforeEach(async () => {
  await rm(path.join(workspaceDir, "data"), { recursive: true, force: true });
  await rm(path.join(tmpRoot, "fakewin"), { recursive: true, force: true });
});

describe("POST /api/work/released-thumbs — validation", () => {
  it("rejects an invalid wdId", async () => {
    const { state, res } = mockRes();
    await thumbsHandler(req({ wdId: "bad id", windowsWdPath: fakeWinWd() }), res);
    assert.equal(state.status, 400);
  });

  it("rejects a missing windowsWdPath", async () => {
    const { state, res } = mockRes();
    await thumbsHandler(req({ wdId: WD_ID }), res);
    assert.equal(state.status, 400);
  });
});

describe("POST /api/work/released-thumbs — orchestration", () => {
  it("returns an empty list when there is no ReleasedVersion folder", async () => {
    mkdirSync(fakeWinWd(), { recursive: true });
    const { state, res } = mockRes();
    await thumbsHandler(req({ wdId: WD_ID, windowsWdPath: fakeWinWd() }), res);
    assert.equal(state.status, 200);
    assert.deepEqual(state.body?.thumbs, []);
  });

  it("skips generation (generated:false) when the thumb is already fresh", async () => {
    // Released pptx with an OLD mtime, thumb with a NEW mtime → fresh.
    const releasedDir = path.join(fakeWinWd(), "ReleasedVersion");
    mkdirSync(releasedDir, { recursive: true });
    const pptx = path.join(releasedDir, "GIT-00003 sample_20260620_v001.pptx");
    writeFileSync(pptx, "x");
    utimesSync(pptx, new Date(1000), new Date(1000));

    const thumbsDir = path.join(workspaceDir, "data/work", WD_ID, ".releasedthumbs");
    mkdirSync(thumbsDir, { recursive: true });
    const thumb = path.join(thumbsDir, "v001.png");
    writeFileSync(thumb, "png");
    utimesSync(thumb, new Date(5000), new Date(5000));

    const { state, res } = mockRes();
    await thumbsHandler(req({ wdId: WD_ID, windowsWdPath: fakeWinWd() }), res);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    const thumbs = state.body?.thumbs ?? [];
    assert.equal(thumbs.length, 1);
    const [entry] = thumbs;
    assert.equal(entry.version, "v001");
    assert.equal(entry.generated, false, "fresh thumb is not regenerated");
    assert.equal(entry.error, undefined);
    assert.equal(entry.path, path.join("data/work", WD_ID, ".releasedthumbs", "v001.png"));
  });

  it("prunes an orphan thumb whose version no longer exists in ReleasedVersion", async () => {
    // ReleasedVersion holds only v001 (fresh thumb). A stale v002.png thumb
    // lingers from a version a human has since removed/replaced → must be deleted.
    const releasedDir = path.join(fakeWinWd(), "ReleasedVersion");
    mkdirSync(releasedDir, { recursive: true });
    const pptx = path.join(releasedDir, "GIT-00003 sample_20260620_v001.pptx");
    writeFileSync(pptx, "x");
    utimesSync(pptx, new Date(1000), new Date(1000));

    const thumbsDir = path.join(workspaceDir, "data/work", WD_ID, ".releasedthumbs");
    mkdirSync(thumbsDir, { recursive: true });
    const freshThumb = path.join(thumbsDir, "v001.png");
    writeFileSync(freshThumb, "png");
    utimesSync(freshThumb, new Date(5000), new Date(5000));
    const orphanThumb = path.join(thumbsDir, "v002.png");
    writeFileSync(orphanThumb, "png");

    const { state, res } = mockRes();
    await thumbsHandler(req({ wdId: WD_ID, windowsWdPath: fakeWinWd() }), res);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.equal(existsSync(orphanThumb), false, "orphan v002.png is pruned");
    assert.equal(existsSync(freshThumb), true, "live v001.png is kept");
    const versions = (state.body?.thumbs ?? []).map((thumb) => thumb.version);
    assert.deepEqual(versions, ["v001"], "only the live version is returned");
  });

  it("does not touch non-version png files in the thumbs dir", async () => {
    const releasedDir = path.join(fakeWinWd(), "ReleasedVersion");
    mkdirSync(releasedDir, { recursive: true });
    const pptx = path.join(releasedDir, "GIT-00003 sample_20260620_v001.pptx");
    writeFileSync(pptx, "x");
    utimesSync(pptx, new Date(1000), new Date(1000));

    const thumbsDir = path.join(workspaceDir, "data/work", WD_ID, ".releasedthumbs");
    mkdirSync(thumbsDir, { recursive: true });
    const freshThumb = path.join(thumbsDir, "v001.png");
    writeFileSync(freshThumb, "png");
    utimesSync(freshThumb, new Date(5000), new Date(5000));
    const unrelated = path.join(thumbsDir, "notes.png");
    writeFileSync(unrelated, "png");

    const { state, res } = mockRes();
    await thumbsHandler(req({ wdId: WD_ID, windowsWdPath: fakeWinWd() }), res);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.equal(existsSync(unrelated), true, "non-version png is left untouched");
  });
});

// ── 3. ReleasedVersion ミラー同期（D: を正・WSL を一致）─────────────────
describe("diffReleasedMirror (pure)", () => {
  it("copies files present in D: but missing in WSL", async () => {
    const { diffReleasedMirror } = await import("../../server/api/routes/workFiles.js");
    const diff = diffReleasedMirror([{ name: "a.pptx", mtimeMs: 100 }], []);
    assert.deepEqual(diff.toCopy, ["a.pptx"]);
    assert.deepEqual(diff.toDelete, []);
  });

  it("copies only when D: is strictly newer (equal/older → skip)", async () => {
    const { diffReleasedMirror } = await import("../../server/api/routes/workFiles.js");
    assert.deepEqual(diffReleasedMirror([{ name: "a.pptx", mtimeMs: 200 }], [{ name: "a.pptx", mtimeMs: 100 }]).toCopy, ["a.pptx"], "newer → copy");
    assert.deepEqual(diffReleasedMirror([{ name: "a.pptx", mtimeMs: 100 }], [{ name: "a.pptx", mtimeMs: 100 }]).toCopy, [], "equal → skip");
    assert.deepEqual(diffReleasedMirror([{ name: "a.pptx", mtimeMs: 100 }], [{ name: "a.pptx", mtimeMs: 200 }]).toCopy, [], "older → skip");
  });

  it("deletes WSL files absent in D: (identical direction)", async () => {
    const { diffReleasedMirror } = await import("../../server/api/routes/workFiles.js");
    const diff = diffReleasedMirror(
      [{ name: "a.pptx", mtimeMs: 100 }],
      [
        { name: "a.pptx", mtimeMs: 100 },
        { name: "old.pptx", mtimeMs: 50 },
      ],
    );
    assert.deepEqual(diff.toCopy, []);
    assert.deepEqual(diff.toDelete, ["old.pptx"]);
  });
});

describe("shouldCopyHistory (pure) — HISTORY.md D:↔WSL 同期", () => {
  it("copies when source exists and dest is missing", async () => {
    const { shouldCopyHistory } = await import("../../server/api/routes/workFiles.js");
    assert.equal(shouldCopyHistory(100, null), true, "dest 欠落 → コピー");
  });
  it("copies only when source is strictly newer", async () => {
    const { shouldCopyHistory } = await import("../../server/api/routes/workFiles.js");
    assert.equal(shouldCopyHistory(200, 100), true, "新しい → コピー");
    assert.equal(shouldCopyHistory(100, 100), false, "同じ → スキップ");
    assert.equal(shouldCopyHistory(100, 200), false, "古い → スキップ");
  });
  it("never copies when source is missing", async () => {
    const { shouldCopyHistory } = await import("../../server/api/routes/workFiles.js");
    assert.equal(shouldCopyHistory(null, null), false, "src 無し → 何もしない");
    assert.equal(shouldCopyHistory(null, 100), false, "src 無し（dest 有り）→ 削除しない");
  });
});

describe("POST /api/work/released-thumbs — mirrors ReleasedVersion from D: (D: master)", () => {
  it("copies D:-only versions into WSL and deletes WSL extras", async () => {
    // D: (fake Windows) holds v003 + v004, both OLD-mtime so thumbs stay fresh
    // (no LibreOffice). WSL holds v004 + a stale v001 extra.
    const releasedDir = path.join(fakeWinWd(), "ReleasedVersion");
    mkdirSync(releasedDir, { recursive: true });
    for (const ver of ["v003", "v004"]) {
      const pptxPath = path.join(releasedDir, `GIT-00003 sample_20260620_${ver}.pptx`);
      writeFileSync(pptxPath, ver);
      utimesSync(pptxPath, new Date(1000), new Date(1000));
    }
    const wslReleased = path.join(workspaceDir, "data/work", WD_ID, "ReleasedVersion");
    mkdirSync(wslReleased, { recursive: true });
    writeFileSync(path.join(wslReleased, "GIT-00003 sample_20260620_v004.pptx"), "old4");
    writeFileSync(path.join(wslReleased, "GIT-00003 sample_20260620_v001.pptx"), "stale1");
    // Fresh thumbs for v003/v004 → generation skipped (soffice not invoked).
    const thumbsDir = path.join(workspaceDir, "data/work", WD_ID, ".releasedthumbs");
    mkdirSync(thumbsDir, { recursive: true });
    for (const ver of ["v003", "v004"]) {
      const thumbPath = path.join(thumbsDir, `${ver}.png`);
      writeFileSync(thumbPath, "png");
      utimesSync(thumbPath, new Date(5000), new Date(5000));
    }

    const { state, res } = mockRes();
    await thumbsHandler(req({ wdId: WD_ID, windowsWdPath: fakeWinWd() }), res);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.equal(existsSync(path.join(wslReleased, "GIT-00003 sample_20260620_v003.pptx")), true, "D:-only v003 copied to WSL");
    assert.equal(existsSync(path.join(wslReleased, "GIT-00003 sample_20260620_v004.pptx")), true, "v004 kept");
    assert.equal(existsSync(path.join(wslReleased, "GIT-00003 sample_20260620_v001.pptx")), false, "WSL extra v001 deleted");
  });

  it("preserves WSL when D: ReleasedVersion is empty (safety valve)", async () => {
    mkdirSync(path.join(fakeWinWd(), "ReleasedVersion"), { recursive: true });
    const wslReleased = path.join(workspaceDir, "data/work", WD_ID, "ReleasedVersion");
    mkdirSync(wslReleased, { recursive: true });
    const keep = path.join(wslReleased, "GIT-00003 sample_20260620_v004.pptx");
    writeFileSync(keep, "keep");

    const { state, res } = mockRes();
    await thumbsHandler(req({ wdId: WD_ID, windowsWdPath: fakeWinWd() }), res);
    assert.equal(state.status, 200);
    assert.equal(existsSync(keep), true, "WSL preserved when D: is empty");
  });
});

// ── 4. 素材フォルダは展開では同期しない（「同期」ボタンの責務）───────────────
// 展開プレビューが D: の素材を先に取り込んでしまうと、直後に押した「同期」が
// copied:0 を返し「素材は最新です（変更なし）」と誤報告する（実測ログで確認）。
// 素材の取り込みは register / sync-materials だけの責務。
// 素材ミラー自体の検証は test_workFilesSyncMaterials.ts が持つ。
describe("POST /api/work/released-thumbs — leaves source materials alone", () => {
  it("does not pull D: materials into WSL on expand", async () => {
    const win = fakeWinWd();
    mkdirSync(path.join(win, "ScreenShots"), { recursive: true });
    writeFileSync(path.join(win, "ScreenShots", "shot.png"), "png");
    writeFileSync(path.join(win, "DocumentLayouts.md"), "layout");
    // 登録済み WD（data/work/<wd>/ が実体化済み）＝展開プレビューが走る条件。
    const wslWd = path.join(workspaceDir, "data/work", WD_ID);
    mkdirSync(wslWd, { recursive: true });

    const { state, res } = mockRes();
    await thumbsHandler(req({ wdId: WD_ID, windowsWdPath: win }), res);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.equal(existsSync(path.join(wslWd, "ScreenShots", "shot.png")), false, "screenshot NOT copied on expand");
    assert.equal(existsSync(path.join(wslWd, "DocumentLayouts.md")), false, "layouts NOT copied on expand");
  });

  it("does not prune WSL material extras on expand", async () => {
    const win = fakeWinWd();
    mkdirSync(path.join(win, "ScreenShots"), { recursive: true });
    writeFileSync(path.join(win, "ScreenShots", "shot.png"), "png");
    const wslWd = path.join(workspaceDir, "data/work", WD_ID);
    mkdirSync(path.join(wslWd, "ScreenShots"), { recursive: true });
    const stale = path.join(wslWd, "ScreenShots", "stale.png");
    writeFileSync(stale, "old");

    const { state, res } = mockRes();
    await thumbsHandler(req({ wdId: WD_ID, windowsWdPath: win }), res);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.equal(existsSync(stale), true, "WSL extra kept on expand (mirroring is the sync button's job)");
  });
});
