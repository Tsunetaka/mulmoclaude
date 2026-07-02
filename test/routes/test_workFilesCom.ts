// Unit tests for the COM split/combine wiring in
// server/api/routes/workFiles.ts — POST /api/work/:wd/:version/{split,combine}.
//
// The COM tools (split_pages.py / combine_pages.py) require Windows +
// PowerPoint, so the actual run is verified manually. Here we cover the
// request guards that fire BEFORE any spawn: the pure pptx-filename
// validator and the 400 paths for bad wd / version / filename.

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
    // SSE surface — only reached on the valid path, which these tests avoid.
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

describe("isSafePptxFilename (pure)", () => {
  it("accepts a plain pptx filename (incl. spaces / Japanese)", async () => {
    const { isSafePptxFilename } = await import("../../server/api/routes/workFiles.js");
    for (const ok of ["GIT-00003 サンプル_20260629_v002.pptx", "deck.pptx", "a.PPTX"]) assert.ok(isSafePptxFilename(ok), ok);
  });

  it("rejects traversal, separators, dotfiles, and non-pptx", async () => {
    const { isSafePptxFilename } = await import("../../server/api/routes/workFiles.js");
    for (const bad of ["", "../x.pptx", "a/b.pptx", "a\\b.pptx", ".hidden.pptx", "deck.ppt", "deck.pptx.exe", "no-ext"]) {
      assert.equal(isSafePptxFilename(bad), false, bad);
    }
  });
});

let splitHandler: Handler;
let combineHandler: Handler;
let canvasHandler: Handler;

before(async () => {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "mulmo-com-"));
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;
  const { workspacePath } = await import("../../server/workspace/workspace.js");
  mkdirSync(workspacePath, { recursive: true });
  const routeMod = await import("../../server/api/routes/workFiles.js");
  splitHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/split", "post");
  combineHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/combine", "post");
  canvasHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/canvas-refresh", "post");
  // tmpRoot is left on disk for the (short) test process lifetime — these
  // guard tests never spawn or write, so there is nothing to clean up.
});

describe("POST /api/work/:wd/:version/split — guards", () => {
  it("400 on a missing / unsafe sourceFilename", async () => {
    for (const body of [{}, { sourceFilename: "../evil.pptx" }, { sourceFilename: "deck.ppt" }]) {
      const { state, res } = mockRes();
      await splitHandler(req({ wd: "GIT-00003", version: "v002" }, body), res);
      assert.equal(state.status, 400, JSON.stringify(body));
    }
  });

  it("400 on a bad wd / version even with a valid filename", async () => {
    const valid = { sourceFilename: "deck.pptx" };
    const bad = mockRes();
    await splitHandler(req({ wd: "bad id", version: "v002" }, valid), bad.res);
    assert.equal(bad.state.status, 400);

    const badVer = mockRes();
    await splitHandler(req({ wd: "GIT-00003", version: "ReleasedVersion" }, valid), badVer.res);
    assert.equal(badVer.state.status, 400);
  });
});

describe("POST /api/work/:wd/:version/combine — guards", () => {
  it("400 on a missing / unsafe outFilename", async () => {
    for (const body of [{}, { outFilename: "a/b.pptx" }, { outFilename: ".x.pptx" }]) {
      const { state, res } = mockRes();
      await combineHandler(req({ wd: "GIT-00003", version: "v002" }, body), res);
      assert.equal(state.status, 400, JSON.stringify(body));
    }
  });

  it("400 on a bad version even with a valid filename", async () => {
    const { state, res } = mockRes();
    await combineHandler(req({ wd: "GIT-00003", version: "v1/x" }, { outFilename: "deck.pptx" }), res);
    assert.equal(state.status, 400);
  });
});

describe("POST /api/work/:wd/:version/canvas-refresh — guards", () => {
  it("400 on a bad wd / version (no filename needed)", async () => {
    const badWd = mockRes();
    await canvasHandler(req({ wd: "bad id", version: "v001" }, {}), badWd.res);
    assert.equal(badWd.state.status, 400);

    const badVer = mockRes();
    await canvasHandler(req({ wd: "GIT-00003", version: ".." }, { full: true }), badVer.res);
    assert.equal(badVer.state.status, 400);
  });
});
