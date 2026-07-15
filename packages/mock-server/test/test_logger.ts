import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createLogger } from "../src/logger.ts";

describe("createLogger", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mock-log-test-"));
  let tmpFile: string | undefined;

  afterEach(() => {
    if (tmpFile && fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
    tmpFile = undefined;
  });

  // Clean up the temp directory after all tests
  process.on("exit", () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("info() writes to log file when logFile is set", () => {
    tmpFile = path.join(tmpDir, `info-${Date.now()}.log`);
    const log = createLogger(false, tmpFile);
    log.info("test message");
    const content = fs.readFileSync(tmpFile, "utf-8");
    assert.ok(content.includes("test message"));
    assert.ok(content.includes("[mock]"));
  });

  it("verbose() writes to log file even when verbose is false", () => {
    tmpFile = path.join(tmpDir, `verbose-${Date.now()}.log`);
    const log = createLogger(false, tmpFile);
    log.verbose("detail info");
    const content = fs.readFileSync(tmpFile, "utf-8");
    assert.ok(content.includes("detail info"));
  });

  it("raw() writes to log file", () => {
    tmpFile = path.join(tmpDir, `raw-${Date.now()}.log`);
    const log = createLogger(false, tmpFile);
    log.raw("banner line");
    const content = fs.readFileSync(tmpFile, "utf-8");
    assert.ok(content.includes("banner line"));
  });

  it("works without logFile (no crash)", () => {
    const log = createLogger(false);
    assert.doesNotThrow(() => {
      log.info("no file");
      log.verbose("no file verbose");
      log.raw("no file raw");
    });
  });
});
