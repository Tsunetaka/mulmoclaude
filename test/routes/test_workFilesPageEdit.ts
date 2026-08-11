// Unit tests for the page-edit (delete / move / add) wiring in
// server/api/routes/workFiles.ts —
//   POST /api/work/:wd/:version/page-delete
//   POST /api/work/:wd/:version/page-move
//   POST /api/work/:wd/:version/page-add
//
// The happy path spawns page_ops.py (WSL, python-pptx) and re-renders
// thumbnails, so the real structure edit is verified live. Here we cover the
// pure body validators and the guard paths that fire BEFORE any spawn: body
// validation and wd/version validation. Cover (first section) / Thank You are
// enforced by page_ops.py (surfaced as an SSE ERROR), verified live.

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

function reqQuery(params: Record<string, string>, query: Record<string, unknown>): Request {
  return { params, query, body: {} } as unknown as Request;
}

// ── Pure validators ──────────────────────────────────────────────
describe("validatePageMoveBody (pure)", () => {
  it("accepts a well-formed move body", async () => {
    const { validatePageMoveBody } = await import("../../server/api/routes/workFiles.js");
    assert.deepEqual(validatePageMoveBody({ pageId: "p-1a2b3c4d", toSection: "本文", toIndex: 0 }), { pageId: "p-1a2b3c4d", toSection: "本文", toIndex: 0 });
    assert.deepEqual(validatePageMoveBody({ pageId: "p-00000000", toSection: "概要", toIndex: 5 }), { pageId: "p-00000000", toSection: "概要", toIndex: 5 });
  });

  it("rejects malformed move bodies", async () => {
    const { validatePageMoveBody } = await import("../../server/api/routes/workFiles.js");
    for (const bad of [
      undefined,
      null,
      "x",
      {},
      { pageId: "bad", toSection: "本文", toIndex: 0 },
      { pageId: "p-1a2b3c4d", toSection: "", toIndex: 0 },
      { pageId: "p-1a2b3c4d", toSection: "本文", toIndex: -1 },
      { pageId: "p-1a2b3c4d", toSection: "本文", toIndex: 1.5 },
      { pageId: "p-1a2b3c4d", toSection: "本文" },
      { pageId: "p-1a2b3c4d", toSection: "a\nb", toIndex: 0 },
    ]) {
      assert.equal(validatePageMoveBody(bad as unknown), null, JSON.stringify(bad));
    }
  });
});

describe("validatePageAddBody (pure)", () => {
  it("accepts a well-formed add body (template optional)", async () => {
    const { validatePageAddBody } = await import("../../server/api/routes/workFiles.js");
    // template 省略時はキー自体を返さない（exactOptionalPropertyTypes: `template: undefined` は入れない）。
    assert.deepEqual(validatePageAddBody({ section: "本文", toIndex: 3 }), { section: "本文", toIndex: 3 });
    assert.deepEqual(validatePageAddBody({ section: "概要", toIndex: 0, template: "geoplan-cover" }), {
      section: "概要",
      toIndex: 0,
      template: "geoplan-cover",
    });
  });

  it("rejects malformed add bodies", async () => {
    const { validatePageAddBody } = await import("../../server/api/routes/workFiles.js");
    for (const bad of [
      undefined,
      null,
      "x",
      {},
      { section: "", toIndex: 0 },
      { section: "本文", toIndex: -1 },
      { section: "本文", toIndex: 2.5 },
      { section: "本文" },
      { section: "本文", toIndex: 0, template: 123 },
      { section: "a\nb", toIndex: 0 },
    ]) {
      assert.equal(validatePageAddBody(bad as unknown), null, JSON.stringify(bad));
    }
  });
});

describe("validateSetTitleBody (pure)", () => {
  it("accepts a well-formed set-title body (empty title allowed)", async () => {
    const { validateSetTitleBody } = await import("../../server/api/routes/workFiles.js");
    assert.deepEqual(validateSetTitleBody({ pageId: "p-1a2b3c4d", title: "新しいタイトル" }), { pageId: "p-1a2b3c4d", title: "新しいタイトル" });
    assert.deepEqual(validateSetTitleBody({ pageId: "p-00000000", title: "" }), { pageId: "p-00000000", title: "" });
  });

  it("rejects malformed set-title bodies", async () => {
    const { validateSetTitleBody } = await import("../../server/api/routes/workFiles.js");
    for (const bad of [
      undefined,
      null,
      "x",
      {},
      { pageId: "bad", title: "x" },
      { pageId: "p-1a2b3c4d" },
      { pageId: "p-1a2b3c4d", title: 123 },
      { pageId: "p-1a2b3c4d", title: "a\nb" },
      { pageId: "p-1a2b3c4d", title: "x".repeat(501) },
    ]) {
      assert.equal(validateSetTitleBody(bad as unknown), null, JSON.stringify(bad));
    }
  });
});

describe("parseTitleOutput (pure)", () => {
  it("extracts the JSON-encoded title from a TITLE: line", async () => {
    const { parseTitleOutput } = await import("../../server/api/routes/workFiles.js");
    assert.equal(parseTitleOutput('TITLE:"Step 1：確認する"'), "Step 1：確認する");
    assert.equal(parseTitleOutput('前置き\nTITLE:""\n後置き'), "");
  });

  it("returns empty string when no TITLE: line or invalid JSON", async () => {
    const { parseTitleOutput } = await import("../../server/api/routes/workFiles.js");
    assert.equal(parseTitleOutput("no marker here"), "");
    assert.equal(parseTitleOutput("TITLE:not-json"), "");
    assert.equal(parseTitleOutput("TITLE:123"), ""); // non-string JSON → ""
  });
});

describe("validateSetTextboxBody (pure)", () => {
  it("accepts a well-formed set-textbox body (empty / multiline text allowed)", async () => {
    const { validateSetTextboxBody } = await import("../../server/api/routes/workFiles.js");
    assert.deepEqual(validateSetTextboxBody({ pageId: "p-1a2b3c4d", shapeId: 5, text: "本文\n2 行目" }), {
      pageId: "p-1a2b3c4d",
      shapeId: 5,
      text: "本文\n2 行目",
    });
    assert.deepEqual(validateSetTextboxBody({ pageId: "p-00000000", shapeId: 0, text: "" }), { pageId: "p-00000000", shapeId: 0, text: "" });
  });

  it("rejects malformed set-textbox bodies", async () => {
    const { validateSetTextboxBody } = await import("../../server/api/routes/workFiles.js");
    for (const bad of [
      undefined,
      null,
      "x",
      {},
      { pageId: "bad", shapeId: 5, text: "x" },
      { pageId: "p-1a2b3c4d", text: "x" },
      { pageId: "p-1a2b3c4d", shapeId: -1, text: "x" },
      { pageId: "p-1a2b3c4d", shapeId: 1.5, text: "x" },
      { pageId: "p-1a2b3c4d", shapeId: "5", text: "x" },
      { pageId: "p-1a2b3c4d", shapeId: 5, text: 123 },
      { pageId: "p-1a2b3c4d", shapeId: 5, text: "x".repeat(5001) },
    ]) {
      assert.equal(validateSetTextboxBody(bad as unknown), null, JSON.stringify(bad));
    }
  });
});

describe("parseTextboxesOutput (pure)", () => {
  it("extracts editable + boxes from a TEXTBOXES: line", async () => {
    const { parseTextboxesOutput } = await import("../../server/api/routes/workFiles.js");
    const line = 'TEXTBOXES:{"pageId":"p-1a2b3c4d","editable":true,"boxes":[{"id":5,"rect":[0.1,0.2,0.3,0.4],"text":"本文"}]}';
    assert.deepEqual(parseTextboxesOutput(line), { editable: true, boxes: [{ id: 5, rect: [0.1, 0.2, 0.3, 0.4], text: "本文" }] });
    assert.deepEqual(parseTextboxesOutput('前置き\nTEXTBOXES:{"editable":false,"boxes":[]}'), { editable: false, boxes: [] });
  });

  it("drops malformed boxes and falls back to editable:false when no marker / invalid JSON", async () => {
    const { parseTextboxesOutput } = await import("../../server/api/routes/workFiles.js");
    assert.deepEqual(parseTextboxesOutput("no marker"), { editable: false, boxes: [] });
    assert.deepEqual(parseTextboxesOutput("TEXTBOXES:not-json"), { editable: false, boxes: [] });
    // 不正な box（rect 欠損 / id 非整数 / text 非文字列）は落とし、妥当なものだけ残す
    const mixed =
      'TEXTBOXES:{"editable":true,"boxes":[{"id":1,"rect":[0,0,1,1],"text":"ok"},{"id":2,"rect":[0,0,1]},{"id":1.5,"rect":[0,0,1,1],"text":"x"},{"id":3,"rect":[0,0,1,1],"text":9}]}';
    assert.deepEqual(parseTextboxesOutput(mixed), { editable: true, boxes: [{ id: 1, rect: [0, 0, 1, 1], text: "ok" }] });
  });
});

// ── Route guards (fire before any spawn) ─────────────────────────
let deleteHandler: Handler;
let moveHandler: Handler;
let addHandler: Handler;
let setTitleHandler: Handler;
let getTitleHandler: Handler;
let getTextboxesHandler: Handler;
let setTextboxHandler: Handler;

before(async () => {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "mulmo-pageedit-"));
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;
  const { workspacePath } = await import("../../server/workspace/workspace.js");
  mkdirSync(workspacePath, { recursive: true });
  const routeMod = await import("../../server/api/routes/workFiles.js");
  deleteHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/page-delete", "post");
  moveHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/page-move", "post");
  addHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/page-add", "post");
  setTitleHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/page-set-title", "post");
  getTitleHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/page-title", "get");
  getTextboxesHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/page-textboxes", "get");
  setTextboxHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/page-set-textbox", "post");
});

describe("POST page-delete — guards", () => {
  it("400 on a missing / malformed pageIds body (before wd/version)", async () => {
    for (const body of [{}, { pageIds: [] }, { pageIds: ["bad"] }, { pageIds: "p-1a2b3c4d" }]) {
      const { state, res } = mockRes();
      await deleteHandler(req({ wd: "GIT-00001", version: "v001" }, body), res);
      assert.equal(state.status, 400, JSON.stringify(body));
    }
  });

  it("400 on a bad wd / version even with a valid body", async () => {
    const valid = { pageIds: ["p-1a2b3c4d"] };
    const badWd = mockRes();
    await deleteHandler(req({ wd: "bad id", version: "v001" }, valid), badWd.res);
    assert.equal(badWd.state.status, 400);
    const badVer = mockRes();
    await deleteHandler(req({ wd: "GIT-00001", version: "ReleasedVersion" }, valid), badVer.res);
    assert.equal(badVer.state.status, 400);
  });
});

describe("POST page-move — guards", () => {
  it("400 on a malformed move body", async () => {
    for (const body of [{}, { pageId: "bad", toSection: "本文", toIndex: 0 }, { pageId: "p-1a2b3c4d", toSection: "本文", toIndex: -1 }]) {
      const { state, res } = mockRes();
      await moveHandler(req({ wd: "GIT-00001", version: "v001" }, body), res);
      assert.equal(state.status, 400, JSON.stringify(body));
    }
  });

  it("400 on a bad wd / version even with a valid body", async () => {
    const { state, res } = mockRes();
    await moveHandler(req({ wd: "bad id", version: "v001" }, { pageId: "p-1a2b3c4d", toSection: "本文", toIndex: 0 }), res);
    assert.equal(state.status, 400);
  });
});

describe("POST page-add — guards", () => {
  it("400 on a malformed add body", async () => {
    for (const body of [{}, { section: "", toIndex: 0 }, { section: "本文", toIndex: -1 }]) {
      const { state, res } = mockRes();
      await addHandler(req({ wd: "GIT-00001", version: "v001" }, body), res);
      assert.equal(state.status, 400, JSON.stringify(body));
    }
  });

  it("400 on a bad wd / version even with a valid body", async () => {
    const { state, res } = mockRes();
    await addHandler(req({ wd: "GIT-00001", version: "bad ver" }, { section: "本文", toIndex: 0 }), res);
    assert.equal(state.status, 400);
  });
});

describe("POST page-set-title — guards", () => {
  it("400 on a malformed set-title body", async () => {
    for (const body of [{}, { pageId: "bad", title: "x" }, { pageId: "p-1a2b3c4d", title: "a\nb" }, { pageId: "p-1a2b3c4d", title: "x".repeat(501) }]) {
      const { state, res } = mockRes();
      await setTitleHandler(req({ wd: "GIT-00001", version: "v001" }, body), res);
      assert.equal(state.status, 400, JSON.stringify(body));
    }
  });

  it("400 on a bad wd / version even with a valid body (empty title OK)", async () => {
    const { state, res } = mockRes();
    await setTitleHandler(req({ wd: "bad id", version: "v001" }, { pageId: "p-1a2b3c4d", title: "" }), res);
    assert.equal(state.status, 400);
  });
});

describe("GET page-title — guards", () => {
  it("400 on a missing / malformed pageId query", async () => {
    for (const query of [{}, { pageId: "bad" }, { pageId: ["p-1a2b3c4d"] }]) {
      const { state, res } = mockRes();
      await getTitleHandler(reqQuery({ wd: "GIT-00001", version: "v001" }, query), res);
      assert.equal(state.status, 400, JSON.stringify(query));
    }
  });

  it("400 on a bad wd / version even with a valid pageId", async () => {
    const { state, res } = mockRes();
    await getTitleHandler(reqQuery({ wd: "bad id", version: "v001" }, { pageId: "p-1a2b3c4d" }), res);
    assert.equal(state.status, 400);
  });
});

describe("GET page-textboxes — guards", () => {
  it("400 on a missing / malformed pageId query", async () => {
    for (const query of [{}, { pageId: "bad" }, { pageId: ["p-1a2b3c4d"] }]) {
      const { state, res } = mockRes();
      await getTextboxesHandler(reqQuery({ wd: "GIT-00001", version: "v001" }, query), res);
      assert.equal(state.status, 400, JSON.stringify(query));
    }
  });

  it("400 on a bad wd / version even with a valid pageId", async () => {
    const { state, res } = mockRes();
    await getTextboxesHandler(reqQuery({ wd: "bad id", version: "v001" }, { pageId: "p-1a2b3c4d" }), res);
    assert.equal(state.status, 400);
  });
});

describe("POST page-set-textbox — guards", () => {
  it("400 on a malformed set-textbox body", async () => {
    for (const body of [
      {},
      { pageId: "bad", shapeId: 5, text: "x" },
      { pageId: "p-1a2b3c4d", shapeId: -1, text: "x" },
      { pageId: "p-1a2b3c4d", shapeId: 5, text: "x".repeat(5001) },
    ]) {
      const { state, res } = mockRes();
      await setTextboxHandler(req({ wd: "GIT-00001", version: "v001" }, body), res);
      assert.equal(state.status, 400, JSON.stringify(body));
    }
  });

  it("400 on a bad wd / version even with a valid body (empty text OK)", async () => {
    const { state, res } = mockRes();
    await setTextboxHandler(req({ wd: "bad id", version: "v001" }, { pageId: "p-1a2b3c4d", shapeId: 0, text: "" }), res);
    assert.equal(state.status, 400);
  });
});
