// Unit tests for the section-edit (add / move / delete / rename) wiring in
// server/api/routes/workFiles.ts —
//   POST /api/work/:wd/:version/section-add
//   POST /api/work/:wd/:version/section-move
//   POST /api/work/:wd/:version/section-delete
//   POST /api/work/:wd/:version/section-rename
//
// The happy path spawns page_ops.py (WSL, python-pptx) and re-renders
// thumbnails, so the real structure edit is verified live. Here we cover the
// pure body validators and the guard paths that fire BEFORE any spawn: body
// validation and wd/version validation. Fixed (cover / Thank You) sections,
// reserved / duplicate names and non-empty deletes are enforced by page_ops.py
// (surfaced as an SSE ERROR), verified live.

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

// ── Pure validators ──────────────────────────────────────────────
describe("validateSectionAddBody (pure)", () => {
  it("accepts a well-formed add body (toIndex >= 1)", async () => {
    const { validateSectionAddBody } = await import("../../server/api/routes/workFiles.js");
    assert.deepEqual(validateSectionAddBody({ name: "概要", toIndex: 1 }), { name: "概要", toIndex: 1 });
    assert.deepEqual(validateSectionAddBody({ name: "補足", toIndex: 3 }), { name: "補足", toIndex: 3 });
  });

  it("rejects malformed add bodies (toIndex must be an integer >= 1)", async () => {
    const { validateSectionAddBody } = await import("../../server/api/routes/workFiles.js");
    for (const bad of [
      undefined,
      null,
      "x",
      {},
      { name: "", toIndex: 1 },
      { name: "概要", toIndex: 0 },
      { name: "概要", toIndex: -1 },
      { name: "概要", toIndex: 1.5 },
      { name: "概要" },
      { name: "a\nb", toIndex: 1 },
    ]) {
      assert.equal(validateSectionAddBody(bad as unknown), null, JSON.stringify(bad));
    }
  });
});

describe("validateSectionMoveBody (pure)", () => {
  it("accepts up / down", async () => {
    const { validateSectionMoveBody } = await import("../../server/api/routes/workFiles.js");
    assert.deepEqual(validateSectionMoveBody({ name: "本文", direction: "up" }), { name: "本文", direction: "up" });
    assert.deepEqual(validateSectionMoveBody({ name: "本文", direction: "down" }), { name: "本文", direction: "down" });
  });

  it("rejects malformed move bodies", async () => {
    const { validateSectionMoveBody } = await import("../../server/api/routes/workFiles.js");
    for (const bad of [
      undefined,
      null,
      "x",
      {},
      { name: "本文" },
      { name: "", direction: "up" },
      { name: "本文", direction: "left" },
      { name: "本文", direction: 1 },
      { name: "a\nb", direction: "up" },
    ]) {
      assert.equal(validateSectionMoveBody(bad as unknown), null, JSON.stringify(bad));
    }
  });
});

describe("validateSectionDeleteBody (pure)", () => {
  it("accepts a name", async () => {
    const { validateSectionDeleteBody } = await import("../../server/api/routes/workFiles.js");
    assert.deepEqual(validateSectionDeleteBody({ name: "概要" }), { name: "概要" });
  });

  it("rejects malformed delete bodies", async () => {
    const { validateSectionDeleteBody } = await import("../../server/api/routes/workFiles.js");
    for (const bad of [undefined, null, "x", {}, { name: "" }, { name: "a\nb" }, { name: 5 }]) {
      assert.equal(validateSectionDeleteBody(bad as unknown), null, JSON.stringify(bad));
    }
  });
});

describe("validateSectionRenameBody (pure)", () => {
  it("accepts name + toName", async () => {
    const { validateSectionRenameBody } = await import("../../server/api/routes/workFiles.js");
    assert.deepEqual(validateSectionRenameBody({ name: "概要", toName: "はじめに" }), { name: "概要", toName: "はじめに" });
  });

  it("rejects malformed rename bodies", async () => {
    const { validateSectionRenameBody } = await import("../../server/api/routes/workFiles.js");
    for (const bad of [
      undefined,
      null,
      "x",
      {},
      { name: "概要" },
      { toName: "はじめに" },
      { name: "", toName: "はじめに" },
      { name: "概要", toName: "" },
      { name: "概要", toName: "a\nb" },
    ]) {
      assert.equal(validateSectionRenameBody(bad as unknown), null, JSON.stringify(bad));
    }
  });
});

// ── Route guards (fire before any spawn) ─────────────────────────
let addHandler: Handler;
let moveHandler: Handler;
let deleteHandler: Handler;
let renameHandler: Handler;

before(async () => {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "mulmo-sectionedit-"));
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;
  const { workspacePath } = await import("../../server/workspace/workspace.js");
  mkdirSync(workspacePath, { recursive: true });
  const routeMod = await import("../../server/api/routes/workFiles.js");
  addHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/section-add", "post");
  moveHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/section-move", "post");
  deleteHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/section-delete", "post");
  renameHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/section-rename", "post");
});

describe("POST section-add — guards", () => {
  it("400 on a malformed body (before wd/version)", async () => {
    for (const body of [{}, { name: "概要", toIndex: 0 }, { name: "", toIndex: 1 }]) {
      const { state, res } = mockRes();
      await addHandler(req({ wd: "GIT-00001", version: "v001" }, body), res);
      assert.equal(state.status, 400, JSON.stringify(body));
    }
  });

  it("400 on a bad wd / version even with a valid body", async () => {
    const { state, res } = mockRes();
    await addHandler(req({ wd: "bad id", version: "v001" }, { name: "概要", toIndex: 1 }), res);
    assert.equal(state.status, 400);
  });
});

describe("POST section-move — guards", () => {
  it("400 on a malformed body", async () => {
    for (const body of [{}, { name: "本文" }, { name: "本文", direction: "left" }]) {
      const { state, res } = mockRes();
      await moveHandler(req({ wd: "GIT-00001", version: "v001" }, body), res);
      assert.equal(state.status, 400, JSON.stringify(body));
    }
  });

  it("400 on a bad wd / version even with a valid body", async () => {
    const { state, res } = mockRes();
    await moveHandler(req({ wd: "GIT-00001", version: "ReleasedVersion" }, { name: "本文", direction: "up" }), res);
    assert.equal(state.status, 400);
  });
});

describe("POST section-delete — guards", () => {
  it("400 on a malformed body", async () => {
    for (const body of [{}, { name: "" }]) {
      const { state, res } = mockRes();
      await deleteHandler(req({ wd: "GIT-00001", version: "v001" }, body), res);
      assert.equal(state.status, 400, JSON.stringify(body));
    }
  });

  it("400 on a bad wd / version even with a valid body", async () => {
    const { state, res } = mockRes();
    await deleteHandler(req({ wd: "bad id", version: "v001" }, { name: "概要" }), res);
    assert.equal(state.status, 400);
  });
});

describe("POST section-rename — guards", () => {
  it("400 on a malformed body", async () => {
    for (const body of [{}, { name: "概要" }, { name: "概要", toName: "" }]) {
      const { state, res } = mockRes();
      await renameHandler(req({ wd: "GIT-00001", version: "v001" }, body), res);
      assert.equal(state.status, 400, JSON.stringify(body));
    }
  });

  it("400 on a bad wd / version even with a valid body", async () => {
    const { state, res } = mockRes();
    await renameHandler(req({ wd: "GIT-00001", version: "bad ver" }, { name: "概要", toName: "はじめに" }), res);
    assert.equal(state.status, 400);
  });
});
