import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { postInference } from "../../src/whisper/sidecar.ts";

// `postInference` reads a real wav path and POSTs it, so we hand it a throwaway
// file and stub `globalThis.fetch` to inspect the request and shape the reply.
const originalFetch = globalThis.fetch;
const wavBytes = new Uint8Array([1, 2, 3, 4, 5]);
let dir: string;
let wavPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "whisper-post-"));
  wavPath = path.join(dir, "audio.wav");
  writeFileSync(wavPath, wavBytes);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(dir, { recursive: true, force: true });
});

describe("postInference", () => {
  it("posts the wav as multipart form-data and returns the transcript", async () => {
    let url = "";
    let method: string | undefined;
    let responseFormat: unknown;
    let language: unknown;
    let fileType = "";
    let fileBytes: number[] = [];
    globalThis.fetch = async (input, init) => {
      url = String(input);
      method = init?.method;
      const form = init?.body;
      if (form instanceof FormData) {
        responseFormat = form.get("response_format");
        language = form.get("language");
        const file = form.get("file");
        if (file instanceof Blob) {
          fileType = file.type;
          fileBytes = [...new Uint8Array(await file.arrayBuffer())];
        }
      }
      return new Response(JSON.stringify({ text: "hello world" }), { status: 200 });
    };

    const text = await postInference(8080, wavPath, "ja");

    assert.equal(text, "hello world");
    assert.equal(url, "http://127.0.0.1:8080/inference");
    assert.equal(method, "POST");
    assert.equal(responseFormat, "json");
    assert.equal(language, "ja");
    assert.equal(fileType, "audio/wav");
    assert.deepEqual(fileBytes, [...wavBytes]);
  });

  it("defaults an empty language to auto", async () => {
    let language: unknown;
    globalThis.fetch = async (_input, init) => {
      const form = init?.body;
      if (form instanceof FormData) language = form.get("language");
      return new Response(JSON.stringify({ text: "" }), { status: 200 });
    };

    await postInference(1234, wavPath, "");

    assert.equal(language, "auto");
  });

  it("throws a labelled error on a non-ok HTTP status", async () => {
    globalThis.fetch = async () => new Response("nope", { status: 503 });
    await assert.rejects(() => postInference(8080, wavPath, ""), /whisper-server returned HTTP 503/);
  });

  it("wraps a fetch/network failure", async () => {
    globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    await assert.rejects(() => postInference(8080, wavPath, ""), /whisper-server request failed: ECONNREFUSED/);
  });
});
