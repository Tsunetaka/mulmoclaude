// Unit tests for the remote-host attachment ingest. The Firebase Storage +
// attachment store deps are stubbed so the test asserts the flow — Storage path
// composition, save→delete ordering, the returned path-only Attachments, and the
// reject paths — not that real bytes move.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createIngestAttachments, type IngestDeps } from "../../server/remoteHost/handlers/ingestAttachments.js";

// Recording stub deps. `fetchObject` returns canned bytes + an image/jpeg type;
// `saveAttachment` hands back a deterministic relativePath; every call is logged
// so tests can assert path composition and ordering. `over` swaps in behaviours.
const makeDeps = (over: Partial<IngestDeps> = {}) => {
  const fetched: string[] = [];
  const saved: { base64: string; mimeType: string }[] = [];
  const deleted: string[] = [];
  const deps: IngestDeps = {
    uid: () => "user-1",
    fetchObject: async (storagePath) => {
      fetched.push(storagePath);
      return { base64: `bytes(${storagePath})`, contentType: "image/jpeg" };
    },
    saveAttachment: async (base64, mimeType) => {
      saved.push({ base64, mimeType });
      return { relativePath: `data/attachments/2026/07/${saved.length}.jpg`, mimeType };
    },
    deleteObject: async (storagePath) => {
      deleted.push(storagePath);
    },
    ...over,
  };
  return { deps, fetched, saved, deleted };
};

describe("createIngestAttachments", () => {
  it("no-ops on empty input — no uid lookup, no Storage calls", async () => {
    let uidCalls = 0;
    const { deps, fetched } = makeDeps({
      uid: () => {
        uidCalls++;
        return "user-1";
      },
    });
    assert.deepEqual(await createIngestAttachments(deps)([]), []);
    assert.equal(fetched.length, 0);
    assert.equal(uidCalls, 0);
  });

  it("builds users/{uid}/uploads/{id}, saves the bytes, returns path-only Attachments", async () => {
    const { deps, fetched, saved } = makeDeps();
    const result = await createIngestAttachments(deps)(["aaa", "bbb"]);
    assert.deepEqual(fetched, ["users/user-1/uploads/aaa", "users/user-1/uploads/bbb"]);
    assert.deepEqual(
      saved.map((rec) => rec.base64),
      ["bytes(users/user-1/uploads/aaa)", "bytes(users/user-1/uploads/bbb)"],
    );
    assert.deepEqual(result, [
      { path: "data/attachments/2026/07/1.jpg", mimeType: "image/jpeg" },
      { path: "data/attachments/2026/07/2.jpg", mimeType: "image/jpeg" },
    ]);
  });

  it("deletes each Storage object only AFTER its bytes are saved", async () => {
    const order: string[] = [];
    const { deps } = makeDeps({
      saveAttachment: async (_base64, mimeType) => {
        order.push("save");
        return { relativePath: "data/attachments/2026/07/x.jpg", mimeType };
      },
      deleteObject: async () => {
        order.push("delete");
      },
    });
    await createIngestAttachments(deps)(["aaa"]);
    assert.deepEqual(order, ["save", "delete"]);
  });

  it("keeps the ingested attachment when the Storage delete fails (best-effort cleanup)", async () => {
    const { deps, saved } = makeDeps({
      deleteObject: async () => {
        throw new Error("delete boom");
      },
    });
    const result = await createIngestAttachments(deps)(["aaa"]);
    // The file was saved, so the attachment is returned despite the failed
    // cleanup — a delete error must not drop an already-ingested file.
    assert.equal(saved.length, 1);
    assert.deepEqual(result, [{ path: "data/attachments/2026/07/1.jpg", mimeType: "image/jpeg" }]);
  });

  it("rejects when the host is not signed in, without touching Storage", async () => {
    const { deps, fetched } = makeDeps({ uid: () => null });
    await assert.rejects(async () => createIngestAttachments(deps)(["aaa"]), /not signed in/);
    assert.equal(fetched.length, 0);
  });

  it("rejects a malformed storage_id before touching Storage", async () => {
    const { deps, fetched } = makeDeps();
    await assert.rejects(async () => createIngestAttachments(deps)(["../evil"]), /invalid storage_id/);
    await assert.rejects(async () => createIngestAttachments(deps)(["a/b"]), /invalid storage_id/);
    assert.equal(fetched.length, 0);
  });

  it("propagates a download failure — rejects the batch, deletes nothing", async () => {
    const { deps, deleted } = makeDeps({
      fetchObject: async () => {
        throw new Error("storage 404");
      },
    });
    await assert.rejects(async () => createIngestAttachments(deps)(["aaa"]), /storage 404/);
    assert.equal(deleted.length, 0);
  });
});
