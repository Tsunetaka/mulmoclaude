// Unit tests for the new-deck (N3) wiring in
// server/api/routes/workFiles.ts — POST /api/work/:wd/:version/new-deck.
//
// The happy path spawns new_deck.py (needs python-pptx on the host) and
// gen_thumbs.py (needs LibreOffice), so the actual run is verified live.
// Here we cover the pure helpers and the guard paths that fire BEFORE
// any spawn: body validation, wd/version validation, and the 409
// preflight when the target version already has a structure.json.

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "fs/promises";
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

describe("validateNewDeckBody (pure)", () => {
  it("accepts a valid title + theme", async () => {
    const { validateNewDeckBody } = await import("../../server/api/routes/workFiles.js");
    assert.equal(validateNewDeckBody({ title: "AppSheet ガイド", theme: "cool" }), null);
  });

  it("rejects a missing / blank / oversized title", async () => {
    const { validateNewDeckBody } = await import("../../server/api/routes/workFiles.js");
    for (const bad of [{}, { title: "  ", theme: "cool" }, { title: "x".repeat(201), theme: "cool" }]) {
      assert.notEqual(validateNewDeckBody(bad as { title?: unknown; theme?: unknown }), null, JSON.stringify(bad));
    }
  });

  it("rejects an unknown theme and accepts all catalog ids", async () => {
    const { validateNewDeckBody, NEW_DECK_THEME_IDS } = await import("../../server/api/routes/workFiles.js");
    assert.notEqual(validateNewDeckBody({ title: "t", theme: "rainbow" }), null);
    for (const theme of NEW_DECK_THEME_IDS) assert.equal(validateNewDeckBody({ title: "t", theme }), null, theme);
  });
});

describe("buildNewDeckArgs (pure)", () => {
  it("builds the base CLI and trims the title", async () => {
    const { buildNewDeckArgs } = await import("../../server/api/routes/workFiles.js");
    const args = buildNewDeckArgs("/t/new_deck.py", "/w/GOOGLE-00001/v001", "GOOGLE-00001", "v001", { title: " タイトル ", theme: "warm" });
    assert.deepEqual(args, [
      "/t/new_deck.py",
      "--version-dir",
      "/w/GOOGLE-00001/v001",
      "--wd",
      "GOOGLE-00001",
      "--version",
      "v001",
      "--title",
      "タイトル",
      "--theme",
      "warm",
    ]);
  });

  it("adds --subtitle only when non-blank, --no-confidential only when false", async () => {
    const { buildNewDeckArgs } = await import("../../server/api/routes/workFiles.js");
    const withBoth = buildNewDeckArgs("s", "d", "GIT-00001", "v001", { title: "t", subtitle: "サブ", theme: "cool", confidential: false });
    assert.ok(withBoth.includes("--subtitle") && withBoth.includes("サブ") && withBoth.includes("--no-confidential"));

    const withNeither = buildNewDeckArgs("s", "d", "GIT-00001", "v001", { title: "t", subtitle: "  ", theme: "cool", confidential: true });
    assert.ok(!withNeither.includes("--subtitle") && !withNeither.includes("--no-confidential"));
  });
});

let newDeckHandler: Handler;
let workspaceRoot: string;

before(async () => {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "mulmo-newdeck-"));
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;
  const { workspacePath } = await import("../../server/workspace/workspace.js");
  workspaceRoot = workspacePath;
  mkdirSync(workspacePath, { recursive: true });
  const routeMod = await import("../../server/api/routes/workFiles.js");
  newDeckHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/new-deck", "post");
});

describe("POST /api/work/:wd/:version/new-deck — guards", () => {
  it("400 on a bad wd / version even with a valid body", async () => {
    const valid = { title: "タイトル", theme: "cool" };
    const badWd = mockRes();
    await newDeckHandler(req({ wd: "bad id", version: "v001" }, valid), badWd.res);
    assert.equal(badWd.state.status, 400);

    const badVer = mockRes();
    await newDeckHandler(req({ wd: "GOOGLE-00001", version: "ReleasedVersion" }, valid), badVer.res);
    assert.equal(badVer.state.status, 400);
  });

  it("400 on an invalid body (missing title / unknown theme)", async () => {
    for (const body of [{}, { title: "t", theme: "rainbow" }, { title: "", theme: "cool" }]) {
      const { state, res } = mockRes();
      await newDeckHandler(req({ wd: "GOOGLE-00001", version: "v001" }, body), res);
      assert.equal(state.status, 400, JSON.stringify(body));
    }
  });

  it("409 when the target version already has a structure.json", async () => {
    const pagesDir = path.join(workspaceRoot, "data/work", "GIT-09999", "v001", ".pages");
    await mkdir(pagesDir, { recursive: true });
    await writeFile(path.join(pagesDir, "structure.json"), "{}", "utf-8");
    const { state, res } = mockRes();
    await newDeckHandler(req({ wd: "GIT-09999", version: "v001" }, { title: "t", theme: "cool" }), res);
    assert.equal(state.status, 409);
  });
});
