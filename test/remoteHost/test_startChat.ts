// Unit tests for the startChat remote-host handler: message composition (the
// collection slash-command prefix, with/without itemId), coercion/validation,
// feed refusal, and the spawn wiring. The host spawner + collection engine are
// stubbed so the test asserts what message is spawned — not that a real chat
// subprocess launches.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { composeMessage, createStartChat, type StartChatDeps } from "../../server/remoteHost/handlers/startChat.js";

type SpawnArgs = Parameters<StartChatDeps["spawn"]>[0];
type Loaded = Awaited<ReturnType<StartChatDeps["loadCollection"]>>;

const collection = { source: "user" } as unknown as Loaded;
const feed = { source: "feed" } as unknown as Loaded;

// Build stub deps. `loadResult` is what `loadCollection` resolves to: a normal
// collection (default) ⇒ the chat proceeds; `feed` ⇒ refused; `null` ⇒ unknown
// slug, rejected. `calls` captures the spawn arguments.
const makeDeps = (result: Awaited<ReturnType<StartChatDeps["spawn"]>>, loadResult: Loaded = collection) => {
  const calls: SpawnArgs[] = [];
  const spawn = (async (args: SpawnArgs) => {
    calls.push(args);
    return result;
  }) as StartChatDeps["spawn"];
  const loadCollection = (async () => loadResult) as StartChatDeps["loadCollection"];
  return { deps: { spawn, loadCollection } as StartChatDeps, calls };
};

describe("composeMessage", () => {
  it("prefixes the collection slash command for a whole-collection chat", () => {
    assert.equal(composeMessage("clients", "", "who is overdue?"), "/clients who is overdue?");
  });

  it("scopes to a record with id= when an itemId is given", () => {
    assert.equal(composeMessage("clients", "acme", "draft a follow-up"), "/clients id=acme draft a follow-up");
  });
});

describe("createStartChat", () => {
  it("spawns a visible chat with the composed message and returns the chatId", async () => {
    const { deps, calls } = makeDeps({ ok: true, chatId: "chat-1" });
    const result = await createStartChat(deps)({ slug: "clients", itemId: "acme", message: "  hello  " });
    assert.deepEqual(result, { started: true, chatId: "chat-1" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].message, "/clients id=acme hello");
    assert.equal(calls[0].hidden, false);
  });

  it("omits id= when itemId is absent or null", async () => {
    const { deps, calls } = makeDeps({ ok: true, chatId: "chat-2" });
    await createStartChat(deps)({ slug: "clients", message: "hi" });
    assert.equal(calls[0].message, "/clients hi");
  });

  it("refuses feeds (no /<slug> command) without spawning", async () => {
    const { deps, calls } = makeDeps({ ok: true, chatId: "chat-feed" }, feed);
    await assert.rejects(async () => createStartChat(deps)({ slug: "news", message: "summarize" }), /not available for feeds/);
    assert.equal(calls.length, 0);
  });

  it("rejects an unknown slug (loadCollection returns null) without spawning", async () => {
    const { deps, calls } = makeDeps({ ok: true, chatId: "chat-missing" }, null);
    await assert.rejects(async () => createStartChat(deps)({ slug: "ghost", message: "hi" }), /collection 'ghost' not found/);
    assert.equal(calls.length, 0);
  });

  it("throws when slug is missing", async () => {
    const { deps } = makeDeps({ ok: true, chatId: "chat-3" });
    await assert.rejects(async () => createStartChat(deps)({ message: "hi" }), /slug must be a non-empty/);
  });

  it("rejects a whitespace-only or whitespace-containing slug (malformed prefix)", async () => {
    const { deps } = makeDeps({ ok: true, chatId: "chat-3b" });
    await assert.rejects(async () => createStartChat(deps)({ slug: "   ", message: "hi" }), /slug must be a non-empty/);
    await assert.rejects(async () => createStartChat(deps)({ slug: "a b", message: "hi" }), /slug must be a non-empty/);
  });

  it("rejects a non-string slug", async () => {
    const { deps } = makeDeps({ ok: true, chatId: "chat-3c" });
    await assert.rejects(async () => createStartChat(deps)({ slug: 123, message: "hi" }), /slug must be a non-empty/);
  });

  it("rejects an itemId that is present but whitespace-containing", async () => {
    const { deps } = makeDeps({ ok: true, chatId: "chat-3d" });
    await assert.rejects(async () => createStartChat(deps)({ slug: "clients", itemId: "a b", message: "hi" }), /itemId must be a non-empty/);
  });

  it("throws when message is blank", async () => {
    const { deps } = makeDeps({ ok: true, chatId: "chat-4" });
    await assert.rejects(async () => createStartChat(deps)({ slug: "clients", message: "   " }), /message is required/);
  });

  it("surfaces a spawn failure as a thrown error", async () => {
    const { deps } = makeDeps({ ok: false, error: "too many background sessions" });
    await assert.rejects(async () => createStartChat(deps)({ slug: "clients", message: "hi" }), /too many background sessions/);
  });
});
