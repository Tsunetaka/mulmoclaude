// Boundary tests for the fiscal-year arithmetic in
// src/plugins/accounting/fiscalYear.ts. Pure functions — no Vue / DOM.
// Drives every "current quarter / current year" date-range shortcut
// in the UI; a regression here would silently misroute the Ledger
// and Accounts views.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  currentFiscalYearRange,
  currentQuarterRange,
  fiscalYearEndMonth,
  fiscalYearEndMonthLabel,
  isFiscalYearEnd,
  previousFiscalYearRange,
  previousQuarterRange,
  resolveFiscalYearEnd,
} from "../src/shared/fiscalYear.ts";

describe("fiscalYearEndMonth", () => {
  it("returns the stored closing month as-is", () => {
    assert.equal(fiscalYearEndMonth(3), 3);
    assert.equal(fiscalYearEndMonth(8), 8);
    assert.equal(fiscalYearEndMonth(12), 12);
  });
});

describe("isFiscalYearEnd", () => {
  it("accepts integer months 1..12", () => {
    for (let month = 1; month <= 12; month += 1) assert.equal(isFiscalYearEnd(month), true);
  });
  it("rejects out-of-range, non-integer, and non-number values", () => {
    for (const value of [0, 13, -1, 8.5, "8", "Q1", null, undefined, NaN]) assert.equal(isFiscalYearEnd(value), false);
  });
});

describe("resolveFiscalYearEnd", () => {
  it("defaults absent / unrecognised to December (12)", () => {
    assert.equal(resolveFiscalYearEnd(undefined), 12);
    assert.equal(resolveFiscalYearEnd("nope"), 12);
    assert.equal(resolveFiscalYearEnd(99), 12);
  });
  it("passes through a valid month", () => {
    assert.equal(resolveFiscalYearEnd(8), 8);
  });
  it("migrates legacy Q1..Q4 tokens to their closing month", () => {
    assert.equal(resolveFiscalYearEnd("Q1"), 3);
    assert.equal(resolveFiscalYearEnd("Q2"), 6);
    assert.equal(resolveFiscalYearEnd("Q3"), 9);
    assert.equal(resolveFiscalYearEnd("Q4"), 12);
  });
});

describe("fiscalYearEndMonthLabel", () => {
  it("shows the month's last day in the given locale", () => {
    assert.equal(fiscalYearEndMonthLabel(8, "en-US"), "August 31");
    assert.equal(fiscalYearEndMonthLabel(12, "en-US"), "December 31");
    assert.equal(fiscalYearEndMonthLabel(8, "ja-JP"), "8月31日");
  });
});

describe("currentQuarterRange — December (12) calendar-year book", () => {
  it("May resolves to Apr–Jun", () => {
    const rng = currentQuarterRange(12, new Date(2026, 4, 3)); // May 3 2026
    assert.deepEqual(rng, { from: "2026-04-01", to: "2026-06-30" });
  });
  it("January resolves to Jan–Mar", () => {
    const rng = currentQuarterRange(12, new Date(2026, 0, 15));
    assert.deepEqual(rng, { from: "2026-01-01", to: "2026-03-31" });
  });
  it("Mar 31 still resolves to Q1 (boundary)", () => {
    const rng = currentQuarterRange(12, new Date(2026, 2, 31));
    assert.deepEqual(rng, { from: "2026-01-01", to: "2026-03-31" });
  });
  it("Apr 1 flips to Q2 (boundary)", () => {
    const rng = currentQuarterRange(12, new Date(2026, 3, 1));
    assert.deepEqual(rng, { from: "2026-04-01", to: "2026-06-30" });
  });
  it("Dec 31 resolves to Q4", () => {
    const rng = currentQuarterRange(12, new Date(2026, 11, 31));
    assert.deepEqual(rng, { from: "2026-10-01", to: "2026-12-31" });
  });
});

describe("currentQuarterRange — March-close (3) book", () => {
  it("May (FQ1, Apr–Jun)", () => {
    const rng = currentQuarterRange(3, new Date(2026, 4, 3));
    assert.deepEqual(rng, { from: "2026-04-01", to: "2026-06-30" });
  });
  it("Jan (FQ4, closing Jan–Mar)", () => {
    const rng = currentQuarterRange(3, new Date(2026, 0, 15));
    assert.deepEqual(rng, { from: "2026-01-01", to: "2026-03-31" });
  });
  it("Mar 31 still in FQ4 (boundary)", () => {
    const rng = currentQuarterRange(3, new Date(2026, 2, 31));
    assert.deepEqual(rng, { from: "2026-01-01", to: "2026-03-31" });
  });
  it("Apr 1 starts the new fiscal year (boundary)", () => {
    const rng = currentQuarterRange(3, new Date(2026, 3, 1));
    assert.deepEqual(rng, { from: "2026-04-01", to: "2026-06-30" });
  });
});

describe("currentQuarterRange — June-close (6) book", () => {
  it("July starts FQ1 of the next FY (Jul–Sep)", () => {
    const rng = currentQuarterRange(6, new Date(2026, 6, 1));
    assert.deepEqual(rng, { from: "2026-07-01", to: "2026-09-30" });
  });
  it("January falls in FQ3 (Jan–Mar)", () => {
    const rng = currentQuarterRange(6, new Date(2026, 0, 15));
    assert.deepEqual(rng, { from: "2026-01-01", to: "2026-03-31" });
  });
  it("June 30 closes the fiscal year (boundary)", () => {
    const rng = currentQuarterRange(6, new Date(2026, 5, 30));
    assert.deepEqual(rng, { from: "2026-04-01", to: "2026-06-30" });
  });
});

describe("currentQuarterRange — August-close (8) book, a non-calendar-quarter close", () => {
  it("September starts FQ1 (Sep–Nov)", () => {
    const rng = currentQuarterRange(8, new Date(2025, 8, 10)); // Sep 10 2025
    assert.deepEqual(rng, { from: "2025-09-01", to: "2025-11-30" });
  });
  it("January falls in FQ2 (Dec–Feb)", () => {
    const rng = currentQuarterRange(8, new Date(2026, 0, 15));
    assert.deepEqual(rng, { from: "2025-12-01", to: "2026-02-28" });
  });
  it("Aug 31 closes the fiscal year — last quarter is Jun–Aug", () => {
    const rng = currentQuarterRange(8, new Date(2026, 7, 31));
    assert.deepEqual(rng, { from: "2026-06-01", to: "2026-08-31" });
  });
});

describe("previousQuarterRange", () => {
  it("December book in May returns Jan–Mar", () => {
    const rng = previousQuarterRange(12, new Date(2026, 4, 3));
    assert.deepEqual(rng, { from: "2026-01-01", to: "2026-03-31" });
  });
  it("December book in January wraps to prior-year Oct–Dec", () => {
    const rng = previousQuarterRange(12, new Date(2026, 0, 15));
    assert.deepEqual(rng, { from: "2025-10-01", to: "2025-12-31" });
  });
  it("March-close book in April wraps to prior FY's closing Jan–Mar", () => {
    const rng = previousQuarterRange(3, new Date(2026, 3, 5));
    assert.deepEqual(rng, { from: "2026-01-01", to: "2026-03-31" });
  });
});

describe("currentFiscalYearRange", () => {
  it("December book covers Jan 1 → Dec 31 of today's calendar year", () => {
    const rng = currentFiscalYearRange(12, new Date(2026, 4, 3));
    assert.deepEqual(rng, { from: "2026-01-01", to: "2026-12-31" });
  });
  it("March-close book covers Apr 1 → Mar 31 of the FY that contains today", () => {
    const rng = currentFiscalYearRange(3, new Date(2026, 4, 3));
    assert.deepEqual(rng, { from: "2026-04-01", to: "2027-03-31" });
  });
  it("March-close book in February covers the FY ending in March of today's year", () => {
    const rng = currentFiscalYearRange(3, new Date(2026, 1, 15));
    assert.deepEqual(rng, { from: "2025-04-01", to: "2026-03-31" });
  });
  it("June-close book covers Jul 1 → Jun 30 spanning two calendar years", () => {
    const rng = currentFiscalYearRange(6, new Date(2026, 4, 3));
    assert.deepEqual(rng, { from: "2025-07-01", to: "2026-06-30" });
  });
  it("August-close book in January covers Sep 1 → Aug 31", () => {
    const rng = currentFiscalYearRange(8, new Date(2026, 0, 15));
    assert.deepEqual(rng, { from: "2025-09-01", to: "2026-08-31" });
  });
});

describe("previousFiscalYearRange", () => {
  it("December book returns the prior calendar year", () => {
    const rng = previousFiscalYearRange(12, new Date(2026, 4, 3));
    assert.deepEqual(rng, { from: "2025-01-01", to: "2025-12-31" });
  });
  it("March-close book in May 2026 returns Apr 2025 → Mar 2026", () => {
    const rng = previousFiscalYearRange(3, new Date(2026, 4, 3));
    assert.deepEqual(rng, { from: "2025-04-01", to: "2026-03-31" });
  });
  it("June-close book in May 2026 returns Jul 2024 → Jun 2025", () => {
    const rng = previousFiscalYearRange(6, new Date(2026, 4, 3));
    assert.deepEqual(rng, { from: "2024-07-01", to: "2025-06-30" });
  });
});
