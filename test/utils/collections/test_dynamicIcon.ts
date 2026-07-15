// Unit tests for the pure dynamic-icon resolver
// (packages/core/src/collection/core/dynamicIcon.ts) — the logic behind
// `CollectionSchema.dynamicIcon`. No fs, no server compute; see
// test/workspace/collections/test_derive.ts-style integration tests for
// the server-side `computeCollectionIcon` wrapper.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  selectDynamicRecord,
  resolveIcon,
  firstDateField,
  type CollectionSchema,
  type DynamicIconSource,
  type DynamicIconSpec,
} from "@mulmoclaude/core/collection";

describe("selectDynamicRecord", () => {
  const records = [
    { id: "a", date: "2026-01-01", condition: "sunny" },
    { id: "b", date: "2026-01-03", condition: "rain" },
    { id: "c", date: "2026-01-02", condition: "cloudy" },
  ];

  it("from: 'first' returns the first pool record (storage order)", () => {
    const source: DynamicIconSource = { collection: "weather", from: "first" };
    assert.deepEqual(selectDynamicRecord(records, source, undefined), records[0]);
  });

  it("from: 'when' behaves like 'first' — the first pool record", () => {
    const source: DynamicIconSource = { collection: "weather", from: "when" };
    assert.deepEqual(selectDynamicRecord(records, source, undefined), records[0]);
  });

  it("from: 'latest' (default) with orderBy picks the max value (localeCompare)", () => {
    const source: DynamicIconSource = { collection: "weather" };
    assert.deepEqual(selectDynamicRecord(records, source, "date"), records[1]);
  });

  it("from: 'latest' explicit behaves the same as the default", () => {
    const source: DynamicIconSource = { collection: "weather", from: "latest" };
    assert.deepEqual(selectDynamicRecord(records, source, "date"), records[1]);
  });

  it("from: 'latest' with no orderBy falls back to the last pool record", () => {
    const source: DynamicIconSource = { collection: "weather" };
    assert.deepEqual(selectDynamicRecord(records, source, undefined), records[2]);
  });

  it("from: 'latest' with orderBy keeps the first-seen record on a tie", () => {
    const tied = [
      { id: "x", date: "2026-01-01" },
      { id: "y", date: "2026-01-01" },
    ];
    const source: DynamicIconSource = { collection: "weather" };
    assert.deepEqual(selectDynamicRecord(tied, source, "date"), tied[0]);
  });

  it("source.where narrows the pool before from reduces it", () => {
    const source: DynamicIconSource = { collection: "weather", where: [{ field: "condition", op: "in", value: ["rain", "cloudy"] }] };
    // Latest (no orderBy) over the filtered pool [b, c] is the last one, c.
    assert.deepEqual(selectDynamicRecord(records, source, undefined), records[2]);
  });

  it("source.where filtering out every record resolves to null", () => {
    const source: DynamicIconSource = { collection: "weather", where: [{ field: "condition", op: "in", value: ["snow"] }] };
    assert.equal(selectDynamicRecord(records, source, "date"), null);
  });

  it("an empty records array resolves to null", () => {
    const source: DynamicIconSource = { collection: "weather" };
    assert.equal(selectDynamicRecord([], source, "date"), null);
  });

  it("source.where with valueFrom follows a value from recordsById (e.g. a _config singleton)", () => {
    const withOffice = [
      { id: "a", date: "2026-01-01", office: "osaka", condition: "sunny" },
      { id: "b", date: "2026-01-02", office: "tokyo", condition: "rain" },
    ];
    const source: DynamicIconSource = {
      collection: "weather",
      where: [{ field: "office", op: "eq", valueFrom: { record: "_config", field: "defaultCity" } }],
    };
    const recordsById = { _config: { defaultCity: "tokyo" } };
    assert.deepEqual(selectDynamicRecord(withOffice, source, "date", recordsById), withOffice[1]);
  });
});

describe("resolveIcon", () => {
  const spec: DynamicIconSpec = {
    source: { collection: "weather" },
    rules: [
      { where: [{ field: "condition", op: "eq", value: "rain" }], icon: "rainy" },
      { where: [{ field: "condition", op: "eq", value: "sunny" }], icon: "sunny" },
    ],
  };

  it("no source record ⇒ spec.fallback when set", () => {
    const withFallback: DynamicIconSpec = { ...spec, fallback: "partly_cloudy_day" };
    assert.equal(resolveIcon(null, withFallback, "static_icon"), "partly_cloudy_day");
  });

  it("no source record and no spec.fallback ⇒ the static icon", () => {
    assert.equal(resolveIcon(null, spec, "static_icon"), "static_icon");
  });

  it("first matching rule wins", () => {
    // Both rules could in principle match different fields; only the first
    // rule whose `where` matches is used.
    assert.equal(resolveIcon({ condition: "rain" }, spec, "static_icon"), "rainy");
    assert.equal(resolveIcon({ condition: "sunny" }, spec, "static_icon"), "sunny");
  });

  it("later rules are never reached once an earlier one matches", () => {
    const reordered: DynamicIconSpec = {
      source: spec.source,
      rules: [
        { where: [{ field: "condition", op: "in", value: ["rain", "sunny"] }], icon: "generic" },
        { where: [{ field: "condition", op: "eq", value: "sunny" }], icon: "sunny" },
      ],
    };
    assert.equal(resolveIcon({ condition: "sunny" }, reordered, "static_icon"), "generic");
  });

  it("no rule matches ⇒ spec.fallback when set", () => {
    const withFallback: DynamicIconSpec = { ...spec, fallback: "partly_cloudy_day" };
    assert.equal(resolveIcon({ condition: "fog" }, withFallback, "static_icon"), "partly_cloudy_day");
  });

  it("no rule matches and no spec.fallback ⇒ the static icon", () => {
    assert.equal(resolveIcon({ condition: "fog" }, spec, "static_icon"), "static_icon");
  });

  it("an empty rules list always falls back", () => {
    const empty: DynamicIconSpec = { source: spec.source, rules: [] };
    assert.equal(resolveIcon({ condition: "rain" }, empty, "static_icon"), "static_icon");
  });
});

describe("firstDateField", () => {
  function schemaWithFields(fields: CollectionSchema["fields"]): CollectionSchema {
    return { title: "t", icon: "i", dataPath: "data/t", primaryKey: "id", fields };
  }

  it("returns the first date/datetime field in declaration order", () => {
    const schema = schemaWithFields({
      id: { type: "string", label: "Id", primary: true },
      note: { type: "text", label: "Note" },
      forecastAt: { type: "datetime", label: "Forecast at" },
      date: { type: "date", label: "Date" },
    });
    assert.equal(firstDateField(schema), "forecastAt");
  });

  it("returns undefined when the schema has no date-like field", () => {
    const schema = schemaWithFields({
      id: { type: "string", label: "Id", primary: true },
      note: { type: "text", label: "Note" },
    });
    assert.equal(firstDateField(schema), undefined);
  });
});
