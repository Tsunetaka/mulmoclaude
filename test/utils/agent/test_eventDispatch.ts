import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addPendingGeneration, removePendingGeneration } from "../../../src/utils/agent/eventDispatch.js";
import { generationKey, type PendingGeneration, GENERATION_KINDS } from "@mulmobridge/protocol";
import type { SseGenerationStarted, SseGenerationFinished } from "../../../src/types/sse.js";
import { EVENT_TYPES } from "../../../src/types/events.js";

const kind = GENERATION_KINDS.beatImage;

const started = (filePath: string, key: string): SseGenerationStarted => ({
  type: EVENT_TYPES.generationStarted,
  kind,
  filePath,
  key,
});

const finished = (filePath: string, key: string): SseGenerationFinished => ({
  type: EVENT_TYPES.generationFinished,
  kind,
  filePath,
  key,
});

describe("addPendingGeneration", () => {
  it("stores the decomposed generation under its stable key", () => {
    const pending: Record<string, PendingGeneration> = {};
    addPendingGeneration(pending, started("a.png", "k1"));
    assert.deepEqual(pending[generationKey(kind, "a.png", "k1")], { kind, filePath: "a.png", key: "k1" });
  });

  it("keeps distinct generations side by side", () => {
    const pending: Record<string, PendingGeneration> = {};
    addPendingGeneration(pending, started("a.png", "k1"));
    addPendingGeneration(pending, started("b.png", "k2"));
    assert.equal(Object.keys(pending).length, 2);
  });

  it("overwrites the same key idempotently", () => {
    const pending: Record<string, PendingGeneration> = {};
    addPendingGeneration(pending, started("a.png", "k1"));
    addPendingGeneration(pending, started("a.png", "k1"));
    assert.equal(Object.keys(pending).length, 1);
  });
});

describe("removePendingGeneration", () => {
  it("removes the matching entry and reports the map is now empty", () => {
    const pending: Record<string, PendingGeneration> = {};
    addPendingGeneration(pending, started("a.png", "k1"));
    const isEmpty = removePendingGeneration(pending, finished("a.png", "k1"));
    assert.equal(isEmpty, true);
    assert.equal(Object.keys(pending).length, 0);
  });

  it("reports not-empty while other generations remain", () => {
    const pending: Record<string, PendingGeneration> = {};
    addPendingGeneration(pending, started("a.png", "k1"));
    addPendingGeneration(pending, started("b.png", "k2"));
    const isEmpty = removePendingGeneration(pending, finished("a.png", "k1"));
    assert.equal(isEmpty, false);
    assert.equal(Object.keys(pending).length, 1);
  });

  it("treats removing from an already-empty map as empty", () => {
    const pending: Record<string, PendingGeneration> = {};
    assert.equal(removePendingGeneration(pending, finished("a.png", "k1")), true);
  });

  it("reports not-empty when the removed key was absent but others exist", () => {
    const pending: Record<string, PendingGeneration> = {};
    addPendingGeneration(pending, started("a.png", "k1"));
    assert.equal(removePendingGeneration(pending, finished("missing.png", "kX")), false);
    assert.equal(Object.keys(pending).length, 1);
  });
});
