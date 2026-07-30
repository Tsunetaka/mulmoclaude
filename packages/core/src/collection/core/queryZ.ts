// The aggregation-query DSL for `dataSource` collections (v2 of
// plans/done/feat-collection-csv-duckdb-source.md). A structured JSON query —
// NEVER raw SQL — because SQL-the-language isn't scoped to the data file
// (`read_csv`/`read_text`/`COPY TO` reach the whole filesystem) and the
// query authors (custom views, the agent) are influenceable by untrusted
// content. The DSL is safe by construction: column names / aliases become
// quoted identifiers, every VALUE rides as a prepared-statement parameter,
// and the shape can't express file access at all. Compiled to SQL
// server-side (`collection/server/csvQuery.ts`).
//
// Isomorphic: custom views build these objects in the browser; the server
// validates with the same zod schema before compiling.

import { z } from "zod";

/** Result-column aliases double as SQL identifiers and JSON keys — keep
 *  them to a conservative identifier charset so neither side needs
 *  escaping gymnastics. */
const SAFE_ALIAS_PATTERN = /^[A-Za-z_]\w{0,63}$/;

/** Hard ceiling on returned rows; `limit` clamps below it. A group-by on
 *  a near-unique column would otherwise return one row per source row —
 *  the exact materialization the aggregate path exists to avoid. */
export const MAX_QUERY_ROWS = 10000;
/** Default row cap when the query declares no `limit`. */
export const DEFAULT_QUERY_ROWS = 1000;
/** Cap on aggregate expressions per query — a record shape has no
 *  intrinsic size limit, and thousands of expressions would make one
 *  full-file scan arbitrarily wide. */
export const MAX_QUERY_AGGREGATES = 32;

/** One aggregate column: `count` (rows; `column` optional to count
 *  non-null cells) or `sum`/`avg`/`min`/`max` over a named CSV column. */
export const QueryAggregateZ = z
  .object({
    op: z.enum(["count", "sum", "avg", "min", "max"]),
    column: z.string().min(1).optional(),
  })
  .refine((aggregate) => aggregate.op === "count" || aggregate.column !== undefined, {
    message: "`column` is required for every aggregate op except `count`",
    path: ["column"],
  });

/** One filter condition. Same op vocabulary as the schema-level `where`
 *  (`core/where.ts`) so authors learn one set; values may be typed
 *  (number / boolean) since CSV columns are. `in` requires an array
 *  value, every other op a scalar. */
export const QueryWhereZ = z
  .object({
    field: z.string().min(1),
    op: z.enum(["eq", "ne", "in", "gt", "gte", "lt", "lte", "contains"]),
    value: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z
        .array(z.union([z.string(), z.number(), z.boolean()]))
        .min(1)
        .max(100),
    ]),
  })
  .refine((cond) => (cond.op === "in") === Array.isArray(cond.value), {
    message: "`in` requires an array value (the allowed set); every other op requires a scalar value",
    path: ["value"],
  });

export const QueryOrderZ = z.object({
  /** A `groupBy` column or an aggregate alias — membership enforced by
   *  the whole-query refine below. */
  field: z.string().min(1),
  dir: z.enum(["asc", "desc"]).optional(),
});

/** The whole query. At least one of `groupBy` / `aggregates` must be
 *  present: bare `groupBy` is a DISTINCT listing, bare `aggregates` a
 *  whole-file scalar row, together a grouped aggregation. */
export const CollectionQueryZ = z
  .object({
    // Case-insensitively unique: DuckDB treats `category` and `Category`
    // as the SAME identifier, groups once, and auto-renames the duplicate
    // SELECT column (`Category_1`) — silently breaking the result-key
    // contract. Same rule as the alias refine below.
    groupBy: z
      .array(z.string().min(1))
      .max(8)
      .refine((columns) => new Set(columns.map((column) => column.toLowerCase())).size === columns.length, {
        message: "`groupBy` columns must be unique (case-insensitively — SQL identifiers ignore case)",
      })
      .optional(),
    aggregates: z
      .record(z.string().regex(SAFE_ALIAS_PATTERN, "aggregate aliases must be simple identifiers (letters/digits/underscore)"), QueryAggregateZ)
      .optional(),
    where: z.array(QueryWhereZ).max(16).optional(),
    orderBy: z.array(QueryOrderZ).max(4).optional(),
    limit: z.number().int().min(1).max(MAX_QUERY_ROWS).optional(),
  })
  .refine((query) => (query.groupBy?.length ?? 0) > 0 || Object.keys(query.aggregates ?? {}).length > 0, {
    message: "declare at least one of `groupBy` (columns to bucket by) or `aggregates` (values to compute)",
    path: ["groupBy"],
  })
  .refine((query) => Object.keys(query.aggregates ?? {}).length <= MAX_QUERY_AGGREGATES, {
    message: `\`aggregates\` supports at most ${MAX_QUERY_AGGREGATES} entries`,
    path: ["aggregates"],
  })
  // An alias shadowing a groupBy column would make the SELECT list (and
  // the result object) ambiguous. CASE-INSENSITIVE: DuckDB treats
  // identifiers that differ only by case as the same name (quoting does
  // not opt out), so `Total` vs `total` collide there even though they
  // are distinct JSON keys here — reject both same-case and cross-case
  // collisions, including between two aliases.
  .refine(
    (query) => {
      const groupLower = new Set((query.groupBy ?? []).map((column) => column.toLowerCase()));
      const seen = new Set<string>();
      return Object.keys(query.aggregates ?? {}).every((alias) => {
        const lower = alias.toLowerCase();
        if (groupLower.has(lower) || seen.has(lower)) return false;
        seen.add(lower);
        return true;
      });
    },
    {
      message: "aggregate aliases must be unique and must not collide with `groupBy` column names (case-insensitively — SQL identifiers ignore case)",
      path: ["aggregates"],
    },
  )
  // `orderBy` can only sort what the result actually contains.
  .refine(
    (query) => {
      const sortable = new Set([...(query.groupBy ?? []), ...Object.keys(query.aggregates ?? {})]);
      return (query.orderBy ?? []).every((order) => sortable.has(order.field));
    },
    {
      message: "every `orderBy.field` must be a `groupBy` column or an aggregate alias",
      path: ["orderBy"],
    },
  );

export type CollectionQueryAggregate = z.infer<typeof QueryAggregateZ>;
export type CollectionQueryWhere = z.infer<typeof QueryWhereZ>;
export type CollectionQueryOrder = z.infer<typeof QueryOrderZ>;
export type CollectionQuery = z.infer<typeof CollectionQueryZ>;
