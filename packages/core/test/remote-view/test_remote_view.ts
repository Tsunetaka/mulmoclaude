// Unit tests for the remote custom-view contract (@mulmoclaude/core/remote-view):
// CSP policy, srcdoc wrapping/escaping, pagination clamps + projection, and the
// parent-side postMessage handler. Pure logic — no DOM, no engine.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  REMOTE_VIEW_MESSAGES,
  REMOTE_VIEW_PROTOCOL,
  buildRemoteViewCsp,
  buildRemoteViewSrcdoc,
  clampLimit,
  clampOffset,
  handleRemoteViewMessage,
  normalizeFields,
  pageFromItems,
  projectItems,
} from "../../src/remote-view/index.js";

describe("buildRemoteViewCsp", () => {
  it("locks connect-src to 'none' (data comes over postMessage, never fetch)", () => {
    const csp = buildRemoteViewCsp();
    assert.match(csp, /connect-src 'none'/);
    assert.match(csp, /default-src 'none'/);
  });

  it("keeps the curated CDN allowlist for scripts/styles and https images/media", () => {
    const csp = buildRemoteViewCsp();
    assert.match(csp, /script-src 'unsafe-inline' [^;]*cdn\.jsdelivr\.net/);
    assert.match(csp, /img-src [^;]*https:/);
    assert.match(csp, /media-src https: data: blob:/);
  });
});

describe("buildRemoteViewSrcdoc", () => {
  it("injects the CSP meta + boot at the start of <head>, with no token/dataUrl", () => {
    const srcdoc = buildRemoteViewSrcdoc("<html><head><title>v</title></head><body></body></html>", { slug: "plan" });
    assert.match(srcdoc, /<head><meta http-equiv="Content-Security-Policy"/);
    assert.match(srcdoc, /window\.__MC_VIEW=\{"slug":"plan"/);
    assert.match(srcdoc, new RegExp(`"protocol":${REMOTE_VIEW_PROTOCOL}`));
    assert.doesNotMatch(srcdoc, /token|dataUrl/);
    // The boot lands BEFORE the view's own head content.
    assert.ok(srcdoc.indexOf("__MC_VIEW") < srcdoc.indexOf("<title>"));
  });

  it("wraps a headless fragment into a full document", () => {
    const srcdoc = buildRemoteViewSrcdoc("<p>hi</p>", { slug: "x" });
    assert.match(srcdoc, /^<!DOCTYPE html><html><head>/);
    assert.match(srcdoc, /<body><p>hi<\/p><\/body>/);
  });

  it("escapes `<` in the boot JSON so a hostile dict value can't break out", () => {
    const srcdoc = buildRemoteViewSrcdoc("<html><head></head></html>", {
      slug: "x",
      locale: "en",
      dict: { evil: "</script><script>alert(1)</script>" },
    });
    assert.doesNotMatch(srcdoc, /"evil":"<\/script>/);
    assert.match(srcdoc, /\\u003c\/script/);
  });
});

describe("clamps + projection", () => {
  it("clampOffset / clampLimit mirror the phase-2 record-handler semantics", () => {
    assert.equal(clampOffset(-5), 0);
    assert.equal(clampOffset("3"), 3);
    assert.equal(clampOffset(undefined), 0);
    assert.equal(clampLimit(100000), 200);
    assert.equal(clampLimit(0), 50);
    assert.equal(clampLimit("7"), 7);
  });

  it("normalizeFields keeps only non-empty strings", () => {
    assert.deepEqual(normalizeFields(["title", " ", 3, "start"]), ["title", "start"]);
    assert.equal(normalizeFields([]), undefined);
    assert.equal(normalizeFields("title"), undefined);
  });

  it("projectItems keeps the primary key and only the listed fields", () => {
    const projected = projectItems([{ id: "a", title: "T", secret: "s" }], ["title"], "id");
    assert.deepEqual(projected, [{ id: "a", title: "T" }]);
  });

  it("pageFromItems slices and reports the full total", () => {
    const items = Array.from({ length: 5 }, (_unused, index) => ({ id: `r${index}`, title: `t${index}` }));
    const page = pageFromItems(items, { offset: 1, limit: 2, fields: ["title"] }, "id");
    assert.deepEqual(page, {
      items: [
        { id: "r1", title: "t1" },
        { id: "r2", title: "t2" },
      ],
      total: 5,
      offset: 1,
      limit: 2,
    });
  });
});

describe("handleRemoteViewMessage", () => {
  const getItemsMsg = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: REMOTE_VIEW_MESSAGES.getItems,
    slug: "plan",
    requestId: "q1",
    ...extra,
  });

  it("answers a get-items request with a normalized page", async () => {
    const replies: Record<string, unknown>[] = [];
    const handled = await handleRemoteViewMessage(
      getItemsMsg({ offset: -3, limit: 100000, fields: ["title", 9] }),
      { slug: "plan", getPage: (request) => pageFromItems([{ id: "a", title: "T", x: 1 }], request, "id") },
      (message) => replies.push(message),
    );
    assert.equal(handled, true);
    assert.deepEqual(replies, [
      { type: REMOTE_VIEW_MESSAGES.items, requestId: "q1", ok: true, page: { items: [{ id: "a", title: "T" }], total: 1, offset: 0, limit: 200 } },
    ]);
  });

  it("replies ok:false with the error message when getPage throws", async () => {
    const replies: Record<string, unknown>[] = [];
    await handleRemoteViewMessage(
      getItemsMsg(),
      {
        slug: "plan",
        getPage: () => {
          throw new Error("channel down");
        },
      },
      (message) => replies.push(message),
    );
    assert.deepEqual(replies, [{ type: REMOTE_VIEW_MESSAGES.items, requestId: "q1", ok: false, error: "channel down" }]);
  });

  it("ignores foreign slugs, unknown types, and a missing requestId", async () => {
    const replies: unknown[] = [];
    const handlers = { slug: "plan", getPage: () => pageFromItems([], { offset: 0, limit: 50 }, "id") };
    const reply = (message: Record<string, unknown>): void => {
      replies.push(message);
    };
    assert.equal(await handleRemoteViewMessage(getItemsMsg({ slug: "other" }), handlers, reply), false);
    assert.equal(await handleRemoteViewMessage({ type: "mc-collection-changed", slug: "plan" }, handlers, reply), false);
    assert.equal(await handleRemoteViewMessage(getItemsMsg({ requestId: 7 }), handlers, reply), false);
    assert.equal(await handleRemoteViewMessage("nope", handlers, reply), false);
    assert.equal(replies.length, 0);
  });

  it("relays startChat (trimmed prompt, string-only role), swallowing empties", async () => {
    const chats: { prompt: string; role?: string }[] = [];
    const handlers = {
      slug: "plan",
      getPage: () => pageFromItems([], { offset: 0, limit: 50 }, "id"),
      onStartChat: (prompt: string, role?: string) => {
        chats.push({ prompt, role });
      },
    };
    const reply = (): void => {};
    assert.equal(await handleRemoteViewMessage({ type: REMOTE_VIEW_MESSAGES.startChat, slug: "plan", prompt: "  do it  ", role: 3 }, handlers, reply), true);
    assert.equal(await handleRemoteViewMessage({ type: REMOTE_VIEW_MESSAGES.startChat, slug: "plan", prompt: "   " }, handlers, reply), true);
    assert.deepEqual(chats, [{ prompt: "do it", role: undefined }]);
  });
});
