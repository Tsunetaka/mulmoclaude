// HTTP-level test for `POST /api/files/reveal` (#1985 follow-up).
//
// Mirrors test_filesRoute_open.ts: mounts the real files router and
// hits the endpoint over real HTTP so the platform branch of
// `revealInHostOs` is exercised implicitly by whichever host runs CI.
// The path-validation + response contract are shared with /open via
// `handleOsFileAction`, so this file focuses on the reveal route
// wiring rather than re-testing every validation branch.

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

const REL_TEST_DIR = "mc-test-reveal-in-os";

describe("POST /api/files/reveal (#1985)", () => {
  let fixture: AppFixture;
  let relPath: string;
  let apiRevealRoute: string;

  before(async () => {
    const { workspacePath } = await import("../../server/workspace/workspace.js");
    mkdirSync(workspacePath, { recursive: true });
    const absDir = join(workspacePath, REL_TEST_DIR);
    mkdirSync(absDir, { recursive: true });
    const absFile = join(absDir, "sample.bin");
    writeFileSync(absFile, "not a real binary but has a body");
    relPath = `${REL_TEST_DIR}/sample.bin`;

    const filesRoutesModule = await import("../../server/api/routes/files.js");
    const apiRoutesModule = await import("../../src/config/apiRoutes.js");
    apiRevealRoute = apiRoutesModule.API_ROUTES.files.reveal;

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
    const res = await fetch(`${fixture.baseUrl}${apiRevealRoute}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error ?? "", /path required/);
  });

  it("returns 400 when the path escapes the workspace", async () => {
    const res = await fetch(`${fixture.baseUrl}${apiRevealRoute}`, {
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
      // macOS `open -R <existing-file>` succeeds. Linux `xdg-open <dir>`
      // may or may not be installed on the runner — if missing, spawn
      // fires an `error` event → route returns 500, a legitimate
      // outcome for that env.
      const res = await fetch(`${fixture.baseUrl}${apiRevealRoute}`, {
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
    const url = `${fixture.baseUrl}${apiRevealRoute}?path=${encodeURIComponent(relPath)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
  });
});
