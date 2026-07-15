// HTTP-level test for `POST /api/files/open` (#1985).
//
// Mounts the real files router on an Express app and hits the
// endpoint with a real HTTP request via fetch (same pattern as
// `test/server/test_csrfGuard_http.ts`). The earlier iteration of
// this file unit-tested `openInHostOs` by mutating
// `process.platform` and `process.env.PATH` — Codex correctly
// flagged that as unreliable under `tsx --test` parallelism, since
// a concurrent test file could observe the mutated globals mid-run.
// This version routes entirely through HTTP; the platform branch
// is exercised implicitly by whichever host CI runs on.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

interface AppFixture {
  baseUrl: string;
  close: () => Promise<void>;
}

const REL_TEST_DIR = "mc-test-open-in-os";

describe("POST /api/files/open (#1985)", () => {
  let fixture: AppFixture;
  let relPath: string;
  let apiOpenRoute: string;

  before(async () => {
    // The workspace realpath is captured at module-load time inside
    // server/api/routes/files.ts. Create the workspace dir + the
    // test file BEFORE importing so the realpathSync call there
    // succeeds and points at the on-disk dir.
    const { workspacePath } = await import("../../server/workspace/workspace.js");
    mkdirSync(workspacePath, { recursive: true });
    const absDir = join(workspacePath, REL_TEST_DIR);
    mkdirSync(absDir, { recursive: true });
    const absFile = join(absDir, "sample.bin");
    writeFileSync(absFile, "not a real binary but has a body");
    relPath = `${REL_TEST_DIR}/sample.bin`;

    const filesRoutesModule = await import("../../server/api/routes/files.js");
    const apiRoutesModule = await import("../../src/config/apiRoutes.js");
    apiOpenRoute = apiRoutesModule.API_ROUTES.files.open;

    const app = express();
    app.use(express.json());
    app.use(filesRoutesModule.default);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as AddressInfo;
    fixture = {
      baseUrl: `http://127.0.0.1:${port}`,
      close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    };
  });

  after(async () => {
    const { workspacePath } = await import("../../server/workspace/workspace.js");
    rmSync(join(workspacePath, REL_TEST_DIR), { recursive: true, force: true });
    await fixture.close();
  });

  it("returns 400 when the body carries no path", async () => {
    const res = await fetch(`${fixture.baseUrl}${apiOpenRoute}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error ?? "", /path required/);
  });

  it("returns 400 when the path escapes the workspace", async () => {
    const res = await fetch(`${fixture.baseUrl}${apiOpenRoute}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "../../../etc/passwd" }),
    });
    assert.equal(res.status, 400);
  });

  it(
    "accepts a valid workspace path (200 on darwin, 200/500 on linux depending on xdg-open)",
    { skip: process.platform !== "darwin" && process.platform !== "linux" },
    async () => {
      // macOS `open <existing-file>` succeeds even for a binary payload.
      // Linux `xdg-open` may or may not be installed on the runner —
      // if missing, spawn fires an `error` event → route returns 500,
      // which is a legitimate outcome for that env.
      const res = await fetch(`${fixture.baseUrl}${apiOpenRoute}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: relPath }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      assert.ok(res.status === 200 || res.status === 500, `expected 200 or 500, got ${res.status}: ${JSON.stringify(body)}`);
      if (res.status === 200) assert.equal(body.ok, true);
      else assert.ok(typeof body.error === "string");
    },
  );

  it("accepts a valid path via the query string as well as the body (belt+suspenders)", { skip: process.platform !== "darwin" }, async () => {
    const url = `${fixture.baseUrl}${apiOpenRoute}?path=${encodeURIComponent(relPath)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}), // deliberately empty; server should use the query
    });
    assert.equal(res.status, 200);
  });
});
