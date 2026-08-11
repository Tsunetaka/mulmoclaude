// Unit tests for the explicit WD register / unregister routes in
// server/api/routes/workFiles.ts:
//   POST /api/work/register    — materialise data/work/<wd>/ on WSL (+mirror from D:)
//   POST /api/work/unregister  — delete the whole data/work/<wd>/ (D: untouched),
//                                refused (409) while an editing version still exists.
//   POST /api/work/released-thumbs — must be a no-op (no WSL writes) for an
//                                UNregistered WD (the "don't auto-create WD" guarantee).
//
// Sandboxed workspace: HOME is redirected to a tmp dir before the module
// loads, mirroring test_workFilesDelete.

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

interface ResultBody {
  registered?: boolean;
  unregistered?: boolean;
  deleted?: boolean;
  error?: string;
  thumbs?: { version: string }[];
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
let registerHandler: Handler;
let unregisterHandler: Handler;
let releasedThumbsHandler: Handler;

const WD_ID = "GIT-00042";

before(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), "mulmo-work-register-"));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;
  const { workspacePath } = await import("../../server/workspace/workspace.js");
  workspaceDir = workspacePath;
  mkdirSync(workspaceDir, { recursive: true });
  const routeMod = await import("../../server/api/routes/workFiles.js");
  registerHandler = extractRouteHandler(routeMod, "/api/work/register", "post");
  unregisterHandler = extractRouteHandler(routeMod, "/api/work/unregister", "post");
  releasedThumbsHandler = extractRouteHandler(routeMod, "/api/work/released-thumbs", "post");
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

// Seed an editing version subfolder (a version dir with .pages/structure.json).
function seedEditingVersion(version: string): void {
  const pagesDir = path.join(wdDir(), version, ".pages");
  mkdirSync(pagesDir, { recursive: true });
  writeFileSync(path.join(pagesDir, "structure.json"), JSON.stringify({ pages: {} }));
}

describe("POST /api/work/register — validation", () => {
  it("rejects an invalid wdId", async () => {
    const { state, res } = mockRes();
    await registerHandler(postReq({ wdId: "bad id", windowsWdPath: fakeWinWd }), res);
    assert.equal(state.status, 400);
  });

  it("rejects a missing windowsWdPath", async () => {
    const { state, res } = mockRes();
    await registerHandler(postReq({ wdId: WD_ID }), res);
    assert.equal(state.status, 400);
  });
});

describe("POST /api/work/register — materialises the WD", () => {
  it("creates data/work/<wd>/ even when there is nothing to mirror", async () => {
    assert.equal(existsSync(wdDir()), false, "precondition: WD dir absent");
    const { state, res } = mockRes();
    await registerHandler(postReq({ wdId: WD_ID, windowsWdPath: fakeWinWd }), res);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.equal(state.body?.registered, true);
    assert.ok(existsSync(wdDir()), "WD dir created on WSL");
    assert.deepEqual(state.body?.thumbs, [], "no released thumbs for an empty WD");
  });
});

describe("POST /api/work/register — mirrors D: source materials", () => {
  // 素材の取り込みは「登録」と「同期」だけの責務（展開プレビューは触らない）。
  // 「登録」から素材ミラーが落ちると、初回登録で素材が空のまま編集を始めてしまう。
  it("pulls D: materials into the freshly registered WD", async () => {
    mkdirSync(path.join(fakeWinWd, "ScreenShots"), { recursive: true });
    writeFileSync(path.join(fakeWinWd, "ScreenShots", "shot.png"), "png");
    writeFileSync(path.join(fakeWinWd, "DocumentLayouts.md"), "layout");

    const { state, res } = mockRes();
    await registerHandler(postReq({ wdId: WD_ID, windowsWdPath: fakeWinWd }), res);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.ok(existsSync(path.join(wdDir(), "ScreenShots", "shot.png")), "screenshot mirrored on register");
    assert.ok(existsSync(path.join(wdDir(), "DocumentLayouts.md")), "layouts mirrored on register");
  });
});

describe("POST /api/work/released-thumbs — never auto-creates an unregistered WD", () => {
  it("returns an empty list and writes nothing when the WD is not registered", async () => {
    assert.equal(existsSync(wdDir()), false, "precondition: WD dir absent");
    const { state, res } = mockRes();
    await releasedThumbsHandler(postReq({ wdId: WD_ID, windowsWdPath: fakeWinWd }), res);
    assert.equal(state.status, 200);
    assert.deepEqual(state.body?.thumbs, []);
    assert.equal(existsSync(wdDir()), false, "WD dir must still be absent (no mirror on expand)");
  });
});

describe("POST /api/work/unregister", () => {
  it("rejects an invalid wdId (400)", async () => {
    const { state, res } = mockRes();
    await unregisterHandler(postReq({ wdId: "bad id" }), res);
    assert.equal(state.status, 400);
  });

  it("refuses (409) while an editing version exists, leaving the WD intact", async () => {
    seedEditingVersion("v002");
    const { state, res } = mockRes();
    await unregisterHandler(postReq({ wdId: WD_ID }), res);
    assert.equal(state.status, 409);
    assert.ok(existsSync(wdDir()), "WD dir preserved on 409");
  });

  it("deletes the whole WD dir when only released versions remain", async () => {
    // Registered WD with a ReleasedVersion pptx but no editing version.
    mkdirSync(path.join(wdDir(), "ReleasedVersion"), { recursive: true });
    writeFileSync(path.join(wdDir(), "ReleasedVersion", "GIT-00042 sample_20260730_v001.pptx"), "x");
    const { state, res } = mockRes();
    await unregisterHandler(postReq({ wdId: WD_ID }), res);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.equal(state.body?.unregistered, true);
    assert.equal(state.body?.deleted, true);
    assert.equal(existsSync(wdDir()), false, "WD dir removed");
  });

  it("is idempotent — unregistering an already-gone WD succeeds with deleted:false", async () => {
    const { state, res } = mockRes();
    await unregisterHandler(postReq({ wdId: WD_ID }), res);
    assert.equal(state.status, 200);
    assert.equal(state.body?.deleted, false);
  });
});
