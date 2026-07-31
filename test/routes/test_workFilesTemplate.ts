// Unit tests for the template-apply wiring in
// server/api/routes/workFiles.ts — POST /api/work/:wd/:version/apply-template
// and GET /api/work/templates.
//
// The happy path spawns apply_template.py (needs python-pptx on the host)
// and gen_thumbs.py (needs LibreOffice), so the actual run is verified
// live. Here we cover the pure helpers and the guard paths that fire
// BEFORE any spawn: body validation, wd/version validation, the 404 when
// the requested template does not exist, and the 404 preflight when the
// target version has no structure.json.

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

describe("validateApplyTemplateBody (pure)", () => {
  it("accepts an empty body (template + theme both optional)", async () => {
    const { validateApplyTemplateBody } = await import("../../server/api/routes/workFiles.js");
    assert.equal(validateApplyTemplateBody({}), null);
  });

  it("accepts a valid template id and catalog theme", async () => {
    const { validateApplyTemplateBody } = await import("../../server/api/routes/workFiles.js");
    assert.equal(validateApplyTemplateBody({ template: "geoplan-cover" }), null);
    assert.equal(validateApplyTemplateBody({ template: "geoplan-cover", theme: "plain" }), null);
  });

  it("rejects an unsafe template id (path separators / traversal)", async () => {
    const { validateApplyTemplateBody } = await import("../../server/api/routes/workFiles.js");
    for (const bad of ["../secret", "a/b", "..", "", "x/../y", 3 as unknown as string]) {
      assert.notEqual(validateApplyTemplateBody({ template: bad }), null, JSON.stringify(bad));
    }
  });

  it("rejects an unknown theme", async () => {
    const { validateApplyTemplateBody } = await import("../../server/api/routes/workFiles.js");
    for (const bad of ["rainbow", "", 3 as unknown as string]) {
      assert.notEqual(validateApplyTemplateBody({ theme: bad }), null, JSON.stringify(bad));
    }
  });
});

describe("buildApplyTemplateArgs (pure)", () => {
  it("omits --template / --theme when not provided", async () => {
    const { buildApplyTemplateArgs } = await import("../../server/api/routes/workFiles.js");
    assert.deepEqual(buildApplyTemplateArgs("/t/apply_template.py", "/w/GIT-00001/v001"), ["/t/apply_template.py", "--version-dir", "/w/GIT-00001/v001"]);
  });

  it("appends --template and --theme when provided", async () => {
    const { buildApplyTemplateArgs } = await import("../../server/api/routes/workFiles.js");
    assert.deepEqual(buildApplyTemplateArgs("/t/apply_template.py", "/w/GIT-00001/v001", "geoplan-cover", "plain"), [
      "/t/apply_template.py",
      "--version-dir",
      "/w/GIT-00001/v001",
      "--template",
      "geoplan-cover",
      "--theme",
      "plain",
    ]);
  });

  it("appends --title when provided (trimmed)", async () => {
    const { buildApplyTemplateArgs } = await import("../../server/api/routes/workFiles.js");
    assert.deepEqual(buildApplyTemplateArgs("/t/apply_template.py", "/w/GIT-00001/v001", "geoplan-cover", "plain", "  たまに行う ローカルリポジトリの作成  "), [
      "/t/apply_template.py",
      "--version-dir",
      "/w/GIT-00001/v001",
      "--template",
      "geoplan-cover",
      "--theme",
      "plain",
      "--title",
      "たまに行う ローカルリポジトリの作成",
    ]);
  });

  it("omits --title when blank or whitespace-only", async () => {
    const { buildApplyTemplateArgs } = await import("../../server/api/routes/workFiles.js");
    assert.deepEqual(buildApplyTemplateArgs("/t/apply_template.py", "/w/GIT-00001/v001", undefined, undefined, "   "), [
      "/t/apply_template.py",
      "--version-dir",
      "/w/GIT-00001/v001",
    ]);
  });
});

let applyHandler: Handler;

before(async () => {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "mulmo-template-"));
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;
  const { workspacePath } = await import("../../server/workspace/workspace.js");
  mkdirSync(workspacePath, { recursive: true });
  const routeMod = await import("../../server/api/routes/workFiles.js");
  applyHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/apply-template", "post");
});

describe("POST /api/work/:wd/:version/apply-template — guards", () => {
  it("400 on a bad wd / version even with a valid body", async () => {
    const badWd = mockRes();
    await applyHandler(req({ wd: "bad id", version: "v001" }, {}), badWd.res);
    assert.equal(badWd.state.status, 400);

    const badVer = mockRes();
    await applyHandler(req({ wd: "GIT-00001", version: "ReleasedVersion" }, {}), badVer.res);
    assert.equal(badVer.state.status, 400);
  });

  it("400 on an unsafe template id / unknown theme", async () => {
    for (const body of [{ template: "../x" }, { theme: "rainbow" }]) {
      const { state, res } = mockRes();
      await applyHandler(req({ wd: "GIT-00001", version: "v001" }, body), res);
      assert.equal(state.status, 400, JSON.stringify(body));
    }
  });

  // The styles dir is empty in the tmp workspace, so any requested template
  // resolves to "not found" (404) before the structure.json preflight.
  it("404 when the requested template does not exist", async () => {
    const { state, res } = mockRes();
    await applyHandler(req({ wd: "GIT-00001", version: "v001" }, { template: "nope" }), res);
    assert.equal(state.status, 404);
  });

  // With no template requested, the template check is skipped and the
  // missing-structure.json preflight (404) fires. Happy path is verified live.
  it("404 when the target version has no structure.json", async () => {
    const { state, res } = mockRes();
    await applyHandler(req({ wd: "GIT-09998", version: "v001" }, {}), res);
    assert.equal(state.status, 404);
  });
});
