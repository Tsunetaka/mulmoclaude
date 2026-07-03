// Unit tests for the theme re-apply (Phase2) wiring in
// server/api/routes/workFiles.ts — POST /api/work/:wd/:version/theme.
//
// The happy path spawns apply_theme.py (needs python-pptx on the host)
// and gen_thumbs.py (needs LibreOffice), so the actual run is verified
// live. Here we cover the pure helpers and the guard paths that fire
// BEFORE any spawn: body validation, wd/version validation, and the 404
// preflight when the target version has no structure.json.

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "fs/promises";
import { mkdirSync } from "fs";
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

function mockRes() {
  const state: { status: number; body: { error?: string } | undefined; ended: boolean } = { status: 200, body: undefined, ended: false };
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(payload: { error?: string }) {
      state.body = payload;
      return res;
    },
    setHeader() {
      return res;
    },
    flushHeaders() {
      return res;
    },
    write() {
      return true;
    },
    end() {
      state.ended = true;
      return res;
    },
  };
  return { state, res: res as unknown as Response };
}

function req(params: Record<string, string>, body: unknown): Request {
  return { params, body } as unknown as Request;
}

describe("validateThemeBody (pure)", () => {
  it("accepts all catalog theme ids", async () => {
    const { validateThemeBody, NEW_DECK_THEME_IDS } = await import("../../server/api/routes/workFiles.js");
    for (const theme of NEW_DECK_THEME_IDS) assert.equal(validateThemeBody({ theme }), null, theme);
  });

  it("rejects a missing / unknown theme", async () => {
    const { validateThemeBody } = await import("../../server/api/routes/workFiles.js");
    for (const bad of [{}, { theme: "" }, { theme: "rainbow" }, { theme: 3 as unknown as string }]) {
      assert.notEqual(validateThemeBody(bad as { theme?: unknown }), null, JSON.stringify(bad));
    }
  });
});

describe("buildApplyThemeArgs (pure)", () => {
  it("builds the apply_theme.py CLI", async () => {
    const { buildApplyThemeArgs } = await import("../../server/api/routes/workFiles.js");
    const args = buildApplyThemeArgs("/t/apply_theme.py", "/w/GOOGLE-00001/v001", "warm");
    assert.deepEqual(args, ["/t/apply_theme.py", "--version-dir", "/w/GOOGLE-00001/v001", "--theme", "warm"]);
  });
});

let themeHandler: Handler;

before(async () => {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "mulmo-theme-"));
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;
  const { workspacePath } = await import("../../server/workspace/workspace.js");
  mkdirSync(workspacePath, { recursive: true });
  const routeMod = await import("../../server/api/routes/workFiles.js");
  themeHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/theme", "post");
});

describe("POST /api/work/:wd/:version/theme — guards", () => {
  it("400 on a bad wd / version even with a valid body", async () => {
    const valid = { theme: "cool" };
    const badWd = mockRes();
    await themeHandler(req({ wd: "bad id", version: "v001" }, valid), badWd.res);
    assert.equal(badWd.state.status, 400);

    const badVer = mockRes();
    await themeHandler(req({ wd: "GOOGLE-00001", version: "ReleasedVersion" }, valid), badVer.res);
    assert.equal(badVer.state.status, 400);
  });

  it("400 on an invalid body (missing / unknown theme)", async () => {
    for (const body of [{}, { theme: "rainbow" }]) {
      const { state, res } = mockRes();
      await themeHandler(req({ wd: "GOOGLE-00001", version: "v001" }, body), res);
      assert.equal(state.status, 400, JSON.stringify(body));
    }
  });

  // 404 preflight fires before any spawn; the happy path (structure.json
  // present → apply_theme.py + gen_thumbs) is verified live to keep this
  // suite hermetic (no python/LibreOffice processes).
  it("404 when the target version has no structure.json", async () => {
    const { state, res } = mockRes();
    await themeHandler(req({ wd: "GIT-09998", version: "v001" }, { theme: "cool" }), res);
    assert.equal(state.status, 404);
  });
});
