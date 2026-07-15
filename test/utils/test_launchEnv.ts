// Tests for `server/utils/launch-env.mjs` — the launcher's `.env`
// loader that lets `npx mulmoclaude` users keep secrets in the launch
// dir instead of the isolated ~/mulmoclaude workspace. (#2081.)

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseEnvFile, mergeLaunchEnv, describeLaunchEnvLoad } from "../../server/utils/launch-env.mjs";

describe("launch-env parseEnvFile", () => {
  it("returns exists:false for a missing file (never throws)", () => {
    const result = parseEnvFile("/no/such/dir/.env");
    assert.deepEqual(result, { exists: false, parsed: {} });
  });

  it("returns exists:false when readFileSync throws (e.g. EACCES)", () => {
    const result = parseEnvFile("/x/.env", {
      readFileSync: () => {
        throw new Error("EACCES");
      },
    });
    assert.equal(result.exists, false);
    assert.deepEqual(result.parsed, {});
  });

  it("parses an existing file's contents", () => {
    const result = parseEnvFile("/x/.env", {
      readFileSync: () => "GEMINI_API_KEY=abc\nFOO=bar\n",
    });
    assert.equal(result.exists, true);
    assert.deepEqual(result.parsed, { GEMINI_API_KEY: "abc", FOO: "bar" });
  });

  it("honours an injected parse seam", () => {
    const result = parseEnvFile("/x/.env", {
      readFileSync: () => "raw",
      parse: (src) => ({ SRC: src }),
    });
    assert.deepEqual(result.parsed, { SRC: "raw" });
  });
});

describe("launch-env mergeLaunchEnv", () => {
  it("applies new keys from the file", () => {
    const { env, loadedKeys, skippedKeys } = mergeLaunchEnv({ PATH: "/usr/bin" }, { GEMINI_API_KEY: "abc" });
    assert.equal(env.GEMINI_API_KEY, "abc");
    assert.equal(env.PATH, "/usr/bin");
    assert.deepEqual(loadedKeys, ["GEMINI_API_KEY"]);
    assert.deepEqual(skippedKeys, []);
  });

  it("lets an exported shell var win over the file", () => {
    const { env, loadedKeys, skippedKeys } = mergeLaunchEnv({ GEMINI_API_KEY: "shell" }, { GEMINI_API_KEY: "file" });
    assert.equal(env.GEMINI_API_KEY, "shell");
    assert.deepEqual(loadedKeys, []);
    assert.deepEqual(skippedKeys, ["GEMINI_API_KEY"]);
  });

  it("treats a base key whose value is undefined as absent", () => {
    const { env, loadedKeys } = mergeLaunchEnv({ GEMINI_API_KEY: undefined }, { GEMINI_API_KEY: "file" });
    assert.equal(env.GEMINI_API_KEY, "file");
    assert.deepEqual(loadedKeys, ["GEMINI_API_KEY"]);
  });

  it("handles an empty parsed object", () => {
    const base = { PATH: "/usr/bin" };
    const { env, loadedKeys, skippedKeys } = mergeLaunchEnv(base, {});
    assert.deepEqual(env, base);
    assert.deepEqual(loadedKeys, []);
    assert.deepEqual(skippedKeys, []);
  });

  it("does not mutate the base env", () => {
    const base = { PATH: "/usr/bin" };
    mergeLaunchEnv(base, { FOO: "bar" });
    assert.deepEqual(base, { PATH: "/usr/bin" });
    assert.equal("FOO" in base, false);
  });

  it("partitions mixed new / shell-defined keys", () => {
    const { loadedKeys, skippedKeys } = mergeLaunchEnv({ A: "shell" }, { A: "file", B: "file" });
    assert.deepEqual(loadedKeys, ["B"]);
    assert.deepEqual(skippedKeys, ["A"]);
  });
});

describe("launch-env describeLaunchEnvLoad", () => {
  it("returns null when the file does not exist", () => {
    assert.equal(describeLaunchEnvLoad({ path: "/x/.env", exists: false, loadedKeys: [], skippedKeys: [] }), null);
  });

  it("returns null when the file exists but contributed nothing and shadowed nothing", () => {
    assert.equal(describeLaunchEnvLoad({ path: "/x/.env", exists: true, loadedKeys: [], skippedKeys: [] }), null);
  });

  it("reports the loaded key names (values never appear)", () => {
    const msg = describeLaunchEnvLoad({ path: "/x/.env", exists: true, loadedKeys: ["GEMINI_API_KEY"], skippedKeys: [] });
    assert.equal(msg, "Loaded 1 var(s) from /x/.env: GEMINI_API_KEY");
  });

  it("notes how many keys the shell kept", () => {
    const msg = describeLaunchEnvLoad({ path: "/x/.env", exists: true, loadedKeys: ["A"], skippedKeys: ["B", "C"] });
    assert.equal(msg, "Loaded 1 var(s) from /x/.env: A (2 kept from shell env)");
  });

  it("explains a file whose every key was already set in the shell", () => {
    const msg = describeLaunchEnvLoad({ path: "/x/.env", exists: true, loadedKeys: [], skippedKeys: ["A", "B"] });
    assert.equal(msg, "Found /x/.env, but all 2 var(s) were already set in the shell env");
  });

  it("caps a long key list with an ellipsis", () => {
    const loadedKeys = ["A", "B", "C", "D"];
    const msg = describeLaunchEnvLoad({ path: "/x/.env", exists: true, loadedKeys, skippedKeys: [] }, 2);
    assert.equal(msg, "Loaded 4 var(s) from /x/.env: A, B, …");
  });
});
