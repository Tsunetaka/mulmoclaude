import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCspViolationMessage, decideViolation } from "../../src/composables/useCspViolations";

describe("parseCspViolationMessage", () => {
  it("extracts the blocked origin + directive from a valid message", () => {
    const out = parseCspViolationMessage({
      type: "mc-csp-violation",
      blockedURI: "https://www.google.com/maps/embed?pb=xyz",
      violatedDirective: "frame-src",
    });
    assert.deepEqual(out, { host: "https://www.google.com", directive: "frame-src" });
  });

  it("takes only the directive name when the value carries a source list", () => {
    const out = parseCspViolationMessage({
      type: "mc-csp-violation",
      blockedURI: "https://maps.googleapis.com/x",
      effectiveDirective: "script-src 'unsafe-inline'",
    });
    assert.equal(out?.directive, "script-src");
    assert.equal(out?.host, "https://maps.googleapis.com");
  });

  it("returns null for non-violation messages", () => {
    assert.equal(parseCspViolationMessage({ type: "mc-open-item" }), null);
    assert.equal(parseCspViolationMessage(null), null);
    assert.equal(parseCspViolationMessage("nope"), null);
  });

  it("ignores inline/eval violations (not fixable by adding a host)", () => {
    assert.equal(parseCspViolationMessage({ type: "mc-csp-violation", blockedURI: "inline", violatedDirective: "script-src" }), null);
    assert.equal(parseCspViolationMessage({ type: "mc-csp-violation", blockedURI: "eval", violatedDirective: "script-src" }), null);
    assert.equal(parseCspViolationMessage({ type: "mc-csp-violation", blockedURI: "", violatedDirective: "script-src" }), null);
  });

  it("falls back to the raw URI as host when it isn't a parseable URL", () => {
    const out = parseCspViolationMessage({ type: "mc-csp-violation", blockedURI: "notaurl", violatedDirective: "img-src" });
    assert.equal(out?.host, "notaurl");
  });
});

describe("decideViolation (sender trust)", () => {
  const msg = { type: "mc-csp-violation", nonce: "good", blockedURI: "https://www.google.com/x", violatedDirective: "frame-src" };
  const isLive = (nonce: string) => nonce === "good";

  it("accepts an opaque-origin message carrying a live nonce", () => {
    assert.deepEqual(decideViolation("null", msg, isLive), { host: "https://www.google.com", directive: "frame-src" });
  });

  it("rejects a non-opaque origin (an allowed external iframe can't spoof)", () => {
    assert.equal(decideViolation("https://www.google.com", msg, isLive), null);
  });

  it("rejects an unknown / missing nonce (a nested hostile frame can't forge it)", () => {
    assert.equal(decideViolation("null", { ...msg, nonce: "forged" }, isLive), null);
    assert.equal(decideViolation("null", { ...msg, nonce: undefined }, isLive), null);
  });

  it("rejects non-violation messages even with the right origin+nonce", () => {
    assert.equal(decideViolation("null", { type: "mc-open-item", nonce: "good" }, isLive), null);
  });
});
