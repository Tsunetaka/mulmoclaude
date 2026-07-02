// Unit tests for the fork-from route in server/api/routes/workFiles.ts —
// POST /api/work/:wd/:version/fork-from (editing-derived new version, §4-4).
//
// Two layers:
//   1. buildForkedStructure — pure structure.json patch (version + source +
//      timestamps replaced, sections/pages preserved verbatim).
//   2. Route handler preflight guards over a sandboxed workspace (HOME
//      redirected before the module loads, mirroring test_workFilesDelete).
//      Only the JSON-error branches (returned before the SSE stream starts)
//      are exercised here; the happy path spawns gen_thumbs (LibreOffice) and
//      is validated live on the WSL host.

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "fs";
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

// ── 1. buildForkedStructure (pure) ────────────────────────────────
describe("buildForkedStructure (pure)", () => {
  it("replaces version/source/timestamps and preserves sections + pages", async () => {
    const { buildForkedStructure } = await import("../../server/api/routes/workFiles.js");
    const source = {
      schema_version: 1,
      wd: "GIT-00003",
      version: "v002",
      source: { kind: "released", from: "v001" },
      created_at: "2026-07-01T00:00:00+09:00",
      updated_at: "2026-07-01T00:00:00+09:00",
      sections: [{ name: "タイトル", page_ids: ["p-aaaa1111"] }],
      pages: { "p-aaaa1111": { file: "p-aaaa1111.pptx", checked_out: false } },
    };
    const out = buildForkedStructure(source, "GIT-00003", "v002-001", "v002", "2026-07-02T10:00:00+09:00");
    assert.equal(out.version, "v002-001");
    assert.deepEqual(out.source, { kind: "editing", from: "v002" });
    assert.equal(out.created_at, "2026-07-02T10:00:00+09:00");
    assert.equal(out.updated_at, "2026-07-02T10:00:00+09:00");
    assert.deepEqual(out.sections, source.sections);
    assert.deepEqual(out.pages, source.pages);
    assert.equal(out.wd, "GIT-00003");
  });
});

// ── 1b. buildForkedManifest (pure) ────────────────────────────────
describe("buildForkedManifest (pure)", () => {
  it("replaces only version and preserves render info (thumb/canvas/dirty)", async () => {
    const { buildForkedManifest } = await import("../../server/api/routes/workFiles.js");
    const source = {
      schema_version: 1,
      version: "v004",
      generated_at: "2026-07-01T00:00:00+09:00",
      pages: {
        "p-aaaa1111": { page_no: 1, title: "表紙", thumb: "p-aaaa1111_md.png", canvas: "p-aaaa1111.png", dirty: false, content_hash: "abc" },
      },
    };
    const out = buildForkedManifest(source, "v005");
    assert.equal(out.version, "v005");
    assert.deepEqual(out.pages, source.pages); // レンダ情報は温存（dirty=false のまま引き継ぐ）
    assert.equal(out.generated_at, "2026-07-01T00:00:00+09:00");
  });
});

// ── 2. Route handler preflight guards ─────────────────────────────
let tmpRoot: string;
let workspaceDir: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let forkHandler: Handler;

const WD_ID = "GIT-00003";

before(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), "mulmo-work-fork-"));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;
  const { workspacePath } = await import("../../server/workspace/workspace.js");
  workspaceDir = workspacePath;
  mkdirSync(workspaceDir, { recursive: true });
  const routeMod = await import("../../server/api/routes/workFiles.js");
  forkHandler = extractRouteHandler(routeMod, "/api/work/:wd/:version/fork-from", "post");
});

after(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  await rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(path.join(workspaceDir, "data"), { recursive: true, force: true });
});

interface ResState {
  status: number;
  body: { error?: string } | undefined;
  streamed: boolean;
}
function mockRes(): { state: ResState; res: Response } {
  const state: ResState = { status: 200, body: undefined, streamed: false };
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
      state.streamed = true;
    },
    write() {
      return true;
    },
    end() {},
  };
  return { state, res: res as unknown as Response };
}

function forkReq(params: Record<string, string>, body: Record<string, unknown>): Request {
  return { params, body } as unknown as Request;
}

// Seed a source version with an (optionally locked) structure.json.
function seedSource(sourceVersion: string, opts: { locked?: boolean } = {}): void {
  const pagesDir = path.join(workspaceDir, "data/work", WD_ID, sourceVersion, ".pages");
  mkdirSync(pagesDir, { recursive: true });
  const struct = { version: sourceVersion, pages: { "p-aaaa1111": { file: "p-aaaa1111.pptx", checked_out: Boolean(opts.locked) } } };
  writeFileSync(path.join(pagesDir, "structure.json"), JSON.stringify(struct));
}

describe("POST /api/work/:wd/:version/fork-from — validation", () => {
  it("rejects an invalid wd", async () => {
    const { state, res } = mockRes();
    await forkHandler(forkReq({ wd: "bad id", version: "v003" }, { sourceVersion: "v002" }), res);
    assert.equal(state.status, 400);
    assert.equal(state.streamed, false);
  });

  it("rejects an invalid target version", async () => {
    const { state, res } = mockRes();
    await forkHandler(forkReq({ wd: WD_ID, version: "ReleasedVersion" }, { sourceVersion: "v002" }), res);
    assert.equal(state.status, 400);
  });

  it("rejects a missing / invalid sourceVersion", async () => {
    for (const sourceVersion of [undefined, "", "..", "Released"]) {
      const { state, res } = mockRes();
      await forkHandler(forkReq({ wd: WD_ID, version: "v003" }, { sourceVersion }), res);
      assert.equal(state.status, 400, String(sourceVersion));
    }
  });

  it("rejects forking onto the same version", async () => {
    const { state, res } = mockRes();
    await forkHandler(forkReq({ wd: WD_ID, version: "v002" }, { sourceVersion: "v002" }), res);
    assert.equal(state.status, 400);
  });

  it("returns 400 when the source structure.json is missing", async () => {
    const { state, res } = mockRes();
    await forkHandler(forkReq({ wd: WD_ID, version: "v003" }, { sourceVersion: "v002" }), res);
    assert.equal(state.status, 400);
    assert.match(state.body?.error ?? "", /structure\.json/);
  });

  it("returns 409 when the target version already exists", async () => {
    seedSource("v002");
    mkdirSync(path.join(workspaceDir, "data/work", WD_ID, "v002-001", ".pages"), { recursive: true });
    const { state, res } = mockRes();
    await forkHandler(forkReq({ wd: WD_ID, version: "v002-001" }, { sourceVersion: "v002" }), res);
    assert.equal(state.status, 409);
  });

  it("returns 409 when the source has checked-out (locked) pages", async () => {
    seedSource("v002", { locked: true });
    const { state, res } = mockRes();
    await forkHandler(forkReq({ wd: WD_ID, version: "v002-001" }, { sourceVersion: "v002" }), res);
    assert.equal(state.status, 409);
  });
});
