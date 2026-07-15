import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { useFileTree } from "../../src/composables/useFileTree.ts";
import type { TreeNode } from "../../src/types/fileTree.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function pathOf(input: Parameters<typeof fetch>[0]): string {
  const raw = typeof input === "string" ? input : input.toString();
  return new URL(raw, "http://localhost").searchParams.get("path") ?? "";
}

// The FilesView consumer destructures these exact nine keys — the split
// must keep the returned surface byte-for-byte identical.
const EXPECTED_KEYS = [
  "rootNode",
  "refRoots",
  "childrenByPath",
  "treeError",
  "loadDirChildren",
  "ensureAncestorsLoaded",
  "reloadRoot",
  "reloadDirChildren",
  "loadRefRoots",
].sort();

describe("useFileTree", () => {
  it("exposes the stable public interface key set", () => {
    const keys = Object.keys(useFileTree()).sort();
    assert.deepEqual(keys, EXPECTED_KEYS);
  });

  it("ensureAncestorsLoaded loads each ancestor dir shallowest-first", async () => {
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
      const path = pathOf(input);
      requested.push(path);
      const node: TreeNode = { name: path, path, type: "dir", children: [] };
      return jsonResponse(200, node);
    };
    const { ensureAncestorsLoaded } = useFileTree();
    await ensureAncestorsLoaded("a/b/c/d.md");
    assert.deepEqual(requested, ["a", "a/b", "a/b/c"]);
  });
});
