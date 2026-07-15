// Unit tests for the offline-queue pure helpers (isExpired / byCreatedAt):
//   - a command with no expiresAt never expires (pre-offline-queue behaviour)
//   - isExpired flips exactly at the deadline (>= now)
//   - byCreatedAt orders oldest enqueue first, treating a missing createdAt as
//     oldest so a pre-offline-queue command is never starved on a drain
//
// Both helpers are pure (no Firebase), so this needs no firestore fake.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { byCreatedAt, isExpired, type Command } from "../../src/remote-host/index.js";

const base: Command = { method: "startChat", params: {}, status: "queued", result: null, error: null, createdBy: "remote" };

describe("isExpired", () => {
  it("is false when expiresAt is absent (a pre-offline-queue command never expires)", () => {
    assert.equal(isExpired(base, 1_000), false);
  });

  it("is false before the deadline", () => {
    assert.equal(isExpired({ ...base, expiresAt: 2_000 }, 1_999), false);
  });

  it("is true at and after the deadline", () => {
    assert.equal(isExpired({ ...base, expiresAt: 2_000 }, 2_000), true);
    assert.equal(isExpired({ ...base, expiresAt: 2_000 }, 2_001), true);
  });
});

describe("byCreatedAt", () => {
  it("orders oldest enqueue first", () => {
    const later = { ...base, createdAt: 30 };
    const earliest = { ...base, createdAt: 10 };
    const middle = { ...base, createdAt: 20 };
    assert.deepEqual(
      [later, earliest, middle].sort(byCreatedAt).map((cmd) => cmd.createdAt),
      [10, 20, 30],
    );
  });

  it("treats a missing createdAt as oldest so it is never starved", () => {
    const withStamp = { ...base, createdAt: 5 };
    const without = { ...base };
    assert.deepEqual(
      [withStamp, without].sort(byCreatedAt).map((cmd) => cmd.createdAt),
      [undefined, 5],
    );
  });
});
