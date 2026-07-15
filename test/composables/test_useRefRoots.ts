import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { useRefRoots } from "../../src/composables/useRefRoots.ts";
import type { TreeNode } from "../../src/types/fileTree.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function dirRoot(name: string): TreeNode {
  return { name, path: name, type: "dir" };
}

describe("useRefRoots", () => {
  it("populates refRoots from an ok array response", async () => {
    globalThis.fetch = async () => jsonResponse(200, [dirRoot("one"), dirRoot("two")]);
    const { refRoots, loadRefRoots } = useRefRoots();
    await loadRefRoots();
    assert.deepEqual(refRoots.value, [dirRoot("one"), dirRoot("two")]);
  });

  it("leaves the current list untouched on a non-ok response", async () => {
    globalThis.fetch = async () => jsonResponse(200, [dirRoot("kept")]);
    const { refRoots, loadRefRoots } = useRefRoots();
    await loadRefRoots();

    globalThis.fetch = async () => jsonResponse(500, { error: "boom" });
    await loadRefRoots();
    assert.deepEqual(refRoots.value, [dirRoot("kept")]);
  });

  it("leaves the current list untouched when an ok response is not an array", async () => {
    globalThis.fetch = async () => jsonResponse(200, [dirRoot("kept")]);
    const { refRoots, loadRefRoots } = useRefRoots();
    await loadRefRoots();

    globalThis.fetch = async () => jsonResponse(200, { not: "an array" });
    await loadRefRoots();
    assert.deepEqual(refRoots.value, [dirRoot("kept")]);
  });
});
