// Unit tests for the N1 "subfolder-limited delete" route in
// server/api/routes/workFiles.ts — DELETE /api/work/:wd/:version.
//
// Two layers:
//   1. Pure guards (isValidWorkWdId / isValidWorkVersion /
//      isContainedChild) — no fs, table-driven.
//   2. Route handler over a sandboxed workspace (HOME redirected to a
//      tmp dir before the module loads, mirroring test_filesCreateRoute).
//      Deletion is WSL-only: the target version subfolder is removed under
//      data/work/<wd>/ while every sibling, ReleasedVersion/, the WD_ID
//      root, AND the Windows (D:) side are left untouched. A branch/child
//      version blocks deletion (409) so a parent can't orphan its branch.

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, existsSync, writeFileSync } from "fs";
import { mkdtemp, rm, readdir } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type { Request, Response } from "express";

type RouteModule = typeof import("../../server/api/routes/workFiles.js");

type Handler = (req: Request, res: Response) => Promise<void> | void;

interface StackFrame {
  route?: {
    path: string;
    stack: { method: string; handle: Handler }[];
  };
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
  ok?: boolean;
  error?: string;
  locked?: boolean;
  wsl?: { path: string; deleted: boolean };
  windows?: { path: string | null; deleted: boolean };
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

function req(params: Record<string, string>, query: Record<string, string> = {}): Request {
  return { params, query } as unknown as Request;
}

// ── 1. Pure guards ────────────────────────────────────────────────
describe("workFiles delete guards (pure)", () => {
  it("isValidWorkWdId accepts WD-IDs, rejects junk and traversal", async () => {
    const { isValidWorkWdId } = await import("../../server/api/routes/workFiles.js");
    for (const ok of ["GIT-00003", "GOOGLE-1", "AB-99999"]) assert.ok(isValidWorkWdId(ok), ok);
    for (const bad of ["", "git-1", "GIT-", "..", "GIT-1/x", "GIT 1", "GIT-1 title"]) assert.equal(isValidWorkWdId(bad), false, bad);
  });

  it("isValidWorkVersion accepts version names + branch suffixes, rejects the rest", async () => {
    const { isValidWorkVersion } = await import("../../server/api/routes/workFiles.js");
    for (const ok of ["v001", "v1", "v001-002", "v003-001-007"]) assert.ok(isValidWorkVersion(ok), ok);
    for (const bad of ["", "001", "ReleasedVersion", "..", "v1/x", "v1.", ".pages", "v-1"]) assert.equal(isValidWorkVersion(bad), false, bad);
  });

  it("isContainedChild only matches a direct child of the named parent", async () => {
    const { isContainedChild } = await import("../../server/api/routes/workFiles.js");
    assert.ok(isContainedChild("/work/GIT-1/v001", "/work/GIT-1", "v001"));
    assert.ok(isContainedChild("/work/GIT-1/v001/", "/work/GIT-1", "v001"), "trailing slash normalised");
    assert.equal(isContainedChild("/work/GIT-1", "/work/GIT-1", "GIT-1"), false, "parent itself is not a child");
    assert.equal(isContainedChild("/work/GIT-1/v001/.pages", "/work/GIT-1", "v001"), false, "grandchild");
    assert.equal(isContainedChild("/work/GIT-1/v002", "/work/GIT-1", "v001"), false, "name mismatch");
    assert.equal(isContainedChild("/work/OTHER/v001", "/work/GIT-1", "v001"), false, "different parent");
  });
});

// ── 2. Route handler over a sandboxed workspace ───────────────────
let tmpRoot: string;
let workspaceDir: string;
let fakeWinRoot: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let deleteHandler: Handler;

const WD_ID = "GIT-00003";
const VERSION = "v002";

before(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), "mulmo-work-delete-"));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;
  const { workspacePath } = await import("../../server/workspace/workspace.js");
  workspaceDir = workspacePath;
  mkdirSync(workspaceDir, { recursive: true });
  const routeMod = await import("../../server/api/routes/workFiles.js");
  deleteHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version", "delete");
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

// Build a WD_ID with two version subfolders, a ReleasedVersion/, and a
// neutral WD-root marker file, plus a fake (already WSL-form) Windows base
// that mirrors the version subfolders (to assert D: is never touched).
function seedWd(opts: { lockedPage?: boolean } = {}): void {
  const wdPath = wdDir();
  fakeWinRoot = path.join(tmpRoot, "fakewin", WD_ID);
  for (const ver of [VERSION, "v001"]) {
    for (const sub of [".pages", ".pagecanvas", ".thumbcache", ".checkedoutpages"]) {
      mkdirSync(path.join(wdPath, ver, sub), { recursive: true });
      mkdirSync(path.join(fakeWinRoot, ver, sub), { recursive: true });
    }
  }
  mkdirSync(path.join(wdPath, "ReleasedVersion"), { recursive: true });
  writeFileSync(path.join(wdPath, "ReleasedVersion", "GIT-00003 sample_20260629_v002.pptx"), "x");
  writeFileSync(path.join(wdPath, ".wd-marker"), "marker\n");
  const struct = { pages: { "p-aaaa1111": { checked_out: Boolean(opts.lockedPage) } } };
  writeFileSync(path.join(wdPath, VERSION, ".pages", "structure.json"), JSON.stringify(struct));
}

beforeEach(async () => {
  await rm(path.join(workspaceDir, "data"), { recursive: true, force: true });
});

describe("DELETE /api/work/:wd/:version — validation", () => {
  it("rejects an invalid wd", async () => {
    const { state, res } = mockRes();
    await deleteHandler(req({ wd: "bad id", version: VERSION }), res);
    assert.equal(state.status, 400);
  });

  it("rejects an invalid version (e.g. ReleasedVersion / traversal)", async () => {
    for (const version of ["ReleasedVersion", "..", "v1/x"]) {
      const { state, res } = mockRes();
      await deleteHandler(req({ wd: WD_ID, version }), res);
      assert.equal(state.status, 400, version);
    }
  });
});

describe("DELETE /api/work/:wd/:version — subfolder-limited deletion", () => {
  it("removes only the target WSL version subfolder, leaving Windows (D:) untouched", async () => {
    seedWd();
    const { state, res } = mockRes();
    await deleteHandler(req({ wd: WD_ID, version: VERSION }), res);

    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.equal(state.body?.ok, true);
    assert.equal(state.body?.wsl?.deleted, true);
    assert.equal(state.body?.windows, undefined, "no Windows side in the result — D: is never touched");

    // Target gone on the WSL side …
    assert.equal(existsSync(path.join(wdDir(), VERSION)), false, "WSL version dir removed");
    // … the Windows (D:) copy of the same version SURVIVES (D: is never touched) …
    assert.ok(existsSync(path.join(fakeWinRoot, VERSION)), "Windows version dir untouched");
    // … and the sibling version, ReleasedVersion/, WD_ID root, and the
    // root marker file all survive (no global --delete).
    assert.ok(existsSync(path.join(wdDir(), "v001")), "sibling WSL version kept");
    assert.ok(existsSync(path.join(fakeWinRoot, "v001")), "sibling Windows version kept");
    assert.ok(existsSync(path.join(wdDir(), "ReleasedVersion")), "ReleasedVersion kept");
    assert.ok(existsSync(path.join(wdDir(), ".wd-marker")), "WD-root marker kept");
    const remaining = await readdir(wdDir());
    assert.ok(!remaining.includes(VERSION), "WD_ID root no longer lists the deleted version");
  });

  it("refuses (409) when a branch (descendant) version exists, leaving the folder intact", async () => {
    // v006 has a child v006-001 → deleting v006 would orphan the branch.
    const wdPath = wdDir();
    for (const ver of ["v006", "v006-001"]) {
      mkdirSync(path.join(wdPath, ver, ".pages"), { recursive: true });
      writeFileSync(path.join(wdPath, ver, ".pages", "structure.json"), JSON.stringify({ pages: {} }));
    }
    const { state, res } = mockRes();
    await deleteHandler(req({ wd: WD_ID, version: "v006" }), res);
    assert.equal(state.status, 409, JSON.stringify(state.body));
    assert.ok(existsSync(path.join(wdPath, "v006")), "parent version preserved on 409");
    // The leaf branch itself has no descendant → it CAN be deleted.
    const leaf = mockRes();
    await deleteHandler(req({ wd: WD_ID, version: "v006-001" }), leaf.res);
    assert.equal(leaf.state.status, 200, JSON.stringify(leaf.state.body));
    assert.equal(existsSync(path.join(wdPath, "v006-001")), false, "leaf branch removed");
  });

  it("is idempotent — deleting an already-gone version succeeds with deleted:false", async () => {
    seedWd();
    const first = mockRes();
    await deleteHandler(req({ wd: WD_ID, version: VERSION }), first.res);
    assert.equal(first.state.status, 200);

    const second = mockRes();
    await deleteHandler(req({ wd: WD_ID, version: VERSION }), second.res);
    assert.equal(second.state.status, 200);
    assert.equal(second.state.body?.wsl?.deleted, false, "already gone");
  });

  it("refuses (409) when a page is still checked out, leaving the folder intact", async () => {
    seedWd({ lockedPage: true });
    const { state, res } = mockRes();
    await deleteHandler(req({ wd: WD_ID, version: VERSION }), res);
    assert.equal(state.status, 409);
    assert.equal(state.body?.locked, true, "409 carries locked:true so the UI can offer force");
    assert.ok(existsSync(path.join(wdDir(), VERSION)), "version dir preserved on 409");
    assert.ok(existsSync(path.join(fakeWinRoot, VERSION)), "Windows version dir preserved on 409");
  });

  it("with ?force=1 deletes a locked version regardless (confirm+force per §5-F)", async () => {
    seedWd({ lockedPage: true });
    const { state, res } = mockRes();
    await deleteHandler(req({ wd: WD_ID, version: VERSION }, { force: "1" }), res);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.equal(state.body?.wsl?.deleted, true);
    assert.equal(existsSync(path.join(wdDir(), VERSION)), false, "locked version force-deleted on WSL");
    assert.ok(existsSync(path.join(fakeWinRoot, VERSION)), "Windows (D:) copy still untouched even with force");
  });

  it("removes the WSL side without consulting Windows (D: never touched)", async () => {
    const wdPath = wdDir();
    mkdirSync(path.join(wdPath, VERSION, ".pages"), { recursive: true });
    const { state, res } = mockRes();
    await deleteHandler(req({ wd: WD_ID, version: VERSION }), res);
    assert.equal(state.status, 200);
    assert.equal(state.body?.wsl?.deleted, true);
    assert.equal(state.body?.windows, undefined, "result has no Windows side");
    assert.equal(existsSync(path.join(wdPath, VERSION)), false);
  });
});
