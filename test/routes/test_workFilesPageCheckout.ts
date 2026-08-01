// Unit tests for the page-level checkout / checkin wiring in
// server/api/routes/workFiles.ts —
//   POST /api/work/:wd/:version/page-checkout
//   POST /api/work/:wd/:version/page-checkin
//
// The happy path spawns slide_struct.py (WSL, python) and rsyncs to the
// Windows (D:) side, so the actual round-trip is verified live. Here we
// cover the pure page-id validators and the guard paths that fire BEFORE
// any spawn: body validation, wd/version validation, and the 404 preflight
// when the target version has no structure.json.

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
describe("validateRequiredPageIds (pure)", () => {
  it("accepts a non-empty list of well-formed page ids", async () => {
    const { validateRequiredPageIds } = await import("../../server/api/routes/workFiles.js");
    assert.deepEqual(validateRequiredPageIds(["p-1a2b3c4d"]), ["p-1a2b3c4d"]);
    assert.deepEqual(validateRequiredPageIds(["p-00000000", "p-ffffffff"]), ["p-00000000", "p-ffffffff"]);
  });

  it("rejects empty, non-array, and malformed ids", async () => {
    const { validateRequiredPageIds } = await import("../../server/api/routes/workFiles.js");
    for (const bad of [[], undefined, "p-1a2b3c4d", ["p-1a2b3c4"], ["p-1A2B3C4D"], ["x-1a2b3c4d"], ["p-1a2b3c4d", 3]]) {
      assert.equal(validateRequiredPageIds(bad as unknown), null, JSON.stringify(bad));
    }
  });
});

describe("validateOptionalPageIds (pure)", () => {
  it("maps undefined and [] to an empty list (means 'all locked')", async () => {
    const { validateOptionalPageIds } = await import("../../server/api/routes/workFiles.js");
    assert.deepEqual(validateOptionalPageIds(undefined), []);
    assert.deepEqual(validateOptionalPageIds([]), []);
  });

  it("accepts a valid list and rejects malformed input", async () => {
    const { validateOptionalPageIds } = await import("../../server/api/routes/workFiles.js");
    assert.deepEqual(validateOptionalPageIds(["p-deadbeef"]), ["p-deadbeef"]);
    for (const bad of ["p-deadbeef", ["nope"], ["p-1a2b3c4d", null]]) {
      assert.equal(validateOptionalPageIds(bad as unknown), null, JSON.stringify(bad));
    }
  });
});

// ── Route guards (fire before any spawn) ─────────────────────────
let checkoutHandler: Handler;
let checkinHandler: Handler;

before(async () => {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "mulmo-pageco-"));
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;
  const { workspacePath } = await import("../../server/workspace/workspace.js");
  mkdirSync(workspacePath, { recursive: true });
  const routeMod = await import("../../server/api/routes/workFiles.js");
  checkoutHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/page-checkout", "post");
  checkinHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/page-checkin", "post");
});

describe("POST /api/work/:wd/:version/page-checkout — guards", () => {
  it("400 on a missing / malformed pageIds body (before wd/version)", async () => {
    for (const body of [{}, { pageIds: [] }, { pageIds: ["bad"] }, { pageIds: "p-1a2b3c4d" }]) {
      const { state, res } = mockRes();
      await checkoutHandler(req({ wd: "GIT-00001", version: "v001" }, body), res);
      assert.equal(state.status, 400, JSON.stringify(body));
    }
  });

  it("400 on a bad wd / version even with a valid body", async () => {
    const valid = { pageIds: ["p-1a2b3c4d"] };
    const badWd = mockRes();
    await checkoutHandler(req({ wd: "bad id", version: "v001" }, valid), badWd.res);
    assert.equal(badWd.state.status, 400);
    const badVer = mockRes();
    await checkoutHandler(req({ wd: "GIT-00001", version: "ReleasedVersion" }, valid), badVer.res);
    assert.equal(badVer.state.status, 400);
  });

  // 404 preflight fires before any spawn; the happy path (structure.json
  // present → slide_struct.py checkout + rsync push) is verified live.
  it("404 when the target version has no structure.json", async () => {
    const { state, res } = mockRes();
    await checkoutHandler(req({ wd: "GIT-09997", version: "v001" }, { pageIds: ["p-1a2b3c4d"] }), res);
    assert.equal(state.status, 404);
  });
});

describe("POST /api/work/:wd/:version/page-checkin — guards", () => {
  it("400 on malformed apply / discard arrays", async () => {
    for (const body of [{ apply: ["bad"] }, { discard: "p-1a2b3c4d" }, { apply: ["p-1a2b3c4d", 1] }]) {
      const { state, res } = mockRes();
      await checkinHandler(req({ wd: "GIT-00001", version: "v001" }, body), res);
      assert.equal(state.status, 400, JSON.stringify(body));
    }
  });

  it("400 on a bad wd / version", async () => {
    const { state, res } = mockRes();
    await checkinHandler(req({ wd: "bad id", version: "v001" }, {}), res);
    assert.equal(state.status, 400);
  });

  it("404 when the target version has no structure.json (empty body = all locked)", async () => {
    const { state, res } = mockRes();
    await checkinHandler(req({ wd: "GIT-09996", version: "v001" }, {}), res);
    assert.equal(state.status, 404);
  });
});
