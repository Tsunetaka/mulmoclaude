// State-parameterized pure renderers for collection surfaces, extracted from
// useCollectionRendering.ts. Unlike the leaf formatters in
// `useCollectionRendering.helpers.ts`, these take the resolved cache values
// and locale as EXPLICIT arguments (never a reactive ref), so the composable
// can wire them with thin closures while they stay unit-testable in isolation.
// NO vue / DOM / I/O / reactive state here — every function is pure.

import { deriveAll, embedTargetId } from "@mulmoclaude/core/collection";
import type {
  CollectionItem,
  CollectionSchema,
  CollectionFieldSpec as FieldSpec,
  EmbedCache,
  EmbedRow,
  EmbedView,
  RefCache,
  RefOption,
  RefRecordCache,
} from "@mulmoclaude/core/collection";
import { buildEmbedOptions, detailText, formatCell, formatMoney, resolveCurrency, sortedRefOptions } from "./useCollectionRendering.helpers";

export function lookupRefDisplay(refCache: RefCache, targetSlug: string, itemSlug: string): string {
  const map = refCache[targetSlug];
  return (map && map[itemSlug]) || itemSlug;
}

export function refOptionsFor(refCache: RefCache, targetSlug: string): RefOption[] {
  const map = refCache[targetSlug];
  return map ? sortedRefOptions(map) : [];
}

/** Dropdown options for an `embed` field's per-record picker (`idField`):
 *  every record in the target collection, labelled by its name/title (or
 *  primary key). Built from `embedCache` so it works for embed targets
 *  that aren't also `ref` targets (the profile collection, say). */
export function embedOptionsFor(embedCache: EmbedCache, targetSlug: string): RefOption[] {
  const data = embedCache[targetSlug];
  return data ? buildEmbedOptions(data.schema, data.items) : [];
}

export function resolveEmbed(
  field: FieldSpec,
  record: CollectionItem | null,
  embedCache: EmbedCache,
): { schema: CollectionSchema | null; item: CollectionItem | null } {
  if (field.type !== "embed" || !field.to) return { schema: null, item: null };
  const targetId = embedTargetId(field, record);
  const data = targetId ? embedCache[field.to] : undefined;
  if (!data) return { schema: null, item: null };
  const item = data.items.find((entry) => String(entry[data.schema.primaryKey] ?? "") === targetId) ?? null;
  return { schema: data.schema, item };
}

export function formatEmbedValue(field: FieldSpec, value: unknown, record: CollectionItem | null, locale: string): string {
  if (field.type === "money") return formatMoney(value, resolveCurrency(field, record), locale);
  return detailText(value);
}

/** Build the read-only embed view-models for one record. A function of the
 *  open record (not a bare computed) because a per-record `idField` embed
 *  resolves a different target per row. `schema` is the OPEN collection's
 *  schema (null when no collection is loaded → no views). */
export function buildEmbedViews(
  schema: CollectionSchema | null,
  embedCache: EmbedCache,
  record: CollectionItem | null,
  locale: string,
): Record<string, EmbedView> {
  const out: Record<string, EmbedView> = {};
  if (!schema) return out;
  for (const [key, field] of Object.entries(schema.fields)) {
    if (field.type !== "embed") continue;
    const { schema: targetSchema, item } = resolveEmbed(field, record, embedCache);
    const rows: EmbedRow[] = [];
    if (targetSchema && item) {
      for (const [subKey, subField] of Object.entries(targetSchema.fields)) {
        const value = item[subKey];
        // Skip empty fields — the embed is a read-only summary, so
        // unfilled optionals would just be "—" noise.
        if (value === undefined || value === null || value === "") continue;
        rows.push({ key: subKey, label: subField.label, type: subField.type, value, display: formatEmbedValue(subField, value, item, locale) });
      }
    }
    out[key] = { found: Boolean(item), rows, targetSlug: field.to ?? "", recordId: embedTargetId(field, record) };
  }
  return out;
}

export function renderSubCell(subField: FieldSpec, value: unknown, record: CollectionItem | null, refCache: RefCache, locale: string): string {
  if (subField.type === "money") return formatMoney(value, resolveCurrency(subField, record), locale);
  if (subField.type === "ref" && subField.to && typeof value === "string" && value.length > 0) return lookupRefDisplay(refCache, subField.to, value);
  return formatCell(value, subField.type);
}

// The derive loop itself lives in `@mulmoclaude/core/collection` (deriveAll),
// shared with the server's manageCollection enrichment so both sides compute
// identical values. These wrappers bind it to the open collection's schema +
// the loaded ref records.

export function evaluateDerived(
  field: FieldSpec,
  fieldKey: string,
  item: CollectionItem,
  schema: CollectionSchema | null,
  refRecords: RefRecordCache,
): number | null {
  if (!field.formula || !schema) return null;
  const enriched = deriveAll(schema, item, refRecords);
  const result = enriched[fieldKey];
  return typeof result === "number" && Number.isFinite(result) ? result : null;
}

export function renderDerived(field: FieldSpec, computedValue: unknown, record: CollectionItem | null, locale: string): string {
  if (computedValue === null || computedValue === undefined) return "—";
  if (field.display === "money") return formatMoney(computedValue, resolveCurrency(field, record), locale);
  return formatCell(computedValue, field.display ?? "number");
}
