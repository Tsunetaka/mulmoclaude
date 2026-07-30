// Compile a validated CollectionQuery (the structured aggregation DSL,
// `core/queryZ.ts`) into DuckDB SQL over `read_csv`. Safety model:
//   - column names / aliases → double-quoted identifiers (quoteIdent);
//   - every comparison VALUE → a prepared-statement parameter;
//   - the file path is bound by the EXECUTOR as the first parameter;
//   - the DSL itself can't name a table function, so no query can reach
//     any file other than the one the executor binds.
// Pure + exported for unit tests — no filesystem, no DuckDB here.

import type { CollectionQuery, CollectionQueryAggregate, CollectionQueryWhere } from "../core/queryZ";
import { DEFAULT_QUERY_ROWS } from "../core/queryZ";

/** Double-quote a SQL identifier (CSV column name / result alias). */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Single-quote a SQL string literal (a `types={...}` struct key). */
export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** The `read_csv` argument list shared by every CSV query: the (prepared)
 *  path plus a `types` pin forcing the key column to VARCHAR — without it
 *  DuckDB's sniffer turns `001` into BIGINT 1, so leading zeros vanish
 *  and distinct keys collapse. */
export function readCsvArgs(primaryKey: string): string {
  return `?, types={${quoteLiteral(primaryKey)}: 'VARCHAR'}`;
}

/** One aggregate's SQL expression. `sum`/`avg` TRY_CAST to DOUBLE so a
 *  column the sniffer kept as VARCHAR (mixed values) aggregates over its
 *  numeric cells instead of erroring; non-numeric cells become NULL and
 *  are skipped — standard BI tolerance. `min`/`max` stay native (they are
 *  meaningful on strings and dates too). */
function aggregateExpr(aggregate: CollectionQueryAggregate): string {
  const { op, column } = aggregate;
  if (op === "count") return column === undefined ? "count(*)" : `count(${quoteIdent(column)})`;
  if (op === "sum" || op === "avg") return `${op}(TRY_CAST(${quoteIdent(column ?? "")} AS DOUBLE))`;
  return `${op}(${quoteIdent(column ?? "")})`;
}

/** One where condition → SQL fragment + its bound parameters. String
 *  equality compares against `CAST(col AS VARCHAR)` so a sniffer-typed
 *  column still matches its textual value; numeric/boolean values compare
 *  natively (DuckDB coerces the column side). */
function whereFragment(cond: CollectionQueryWhere): { sql: string; params: unknown[] } {
  const column = quoteIdent(cond.field);
  const asText = `CAST(${column} AS VARCHAR)`;
  if (cond.op === "in") {
    const values = cond.value as (string | number | boolean)[];
    const textual = values.every((value) => typeof value === "string");
    const lhs = textual ? asText : column;
    return { sql: `${lhs} IN (${values.map(() => "?").join(", ")})`, params: values };
  }
  if (cond.op === "contains") return { sql: `contains(${asText}, ?)`, params: [String(cond.value)] };
  const operator = { eq: "=", ne: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[cond.op];
  const lhs = typeof cond.value === "string" && (cond.op === "eq" || cond.op === "ne") ? asText : column;
  return { sql: `${lhs} ${operator} ?`, params: [cond.value] };
}

/** Compile a validated query against `fromSql` (a table-function call
 *  whose FIRST placeholder is the source path — the executor binds it).
 *  Returns the SQL and the where-value parameters that follow the path.
 *  Callers MUST have run `CollectionQueryZ` first; this function trusts
 *  the shape (aliases already charset-checked, orderBy membership already
 *  enforced). */
function compileQuery(query: CollectionQuery, fromSql: string): { sql: string; params: unknown[] } {
  const groupBy = query.groupBy ?? [];
  const aggregates = Object.entries(query.aggregates ?? {});
  const selectList = [...groupBy.map(quoteIdent), ...aggregates.map(([alias, aggregate]) => `${aggregateExpr(aggregate)} AS ${quoteIdent(alias)}`)];
  const where = (query.where ?? []).map(whereFragment);
  const clauses = [`SELECT ${selectList.join(", ")}`, `FROM ${fromSql}`];
  if (where.length > 0) clauses.push(`WHERE ${where.map((fragment) => fragment.sql).join(" AND ")}`);
  if (groupBy.length > 0) clauses.push(`GROUP BY ${groupBy.map(quoteIdent).join(", ")}`);
  const orderBy = (query.orderBy ?? []).map((order) => quoteIdent(order.field) + (order.dir === "desc" ? " DESC" : " ASC"));
  if (orderBy.length > 0) clauses.push(`ORDER BY ${orderBy.join(", ")}`);
  clauses.push(`LIMIT ${query.limit ?? DEFAULT_QUERY_ROWS}`);
  return { sql: clauses.join(" "), params: where.flatMap((fragment) => fragment.params) };
}

/** Compile against a CSV file (the dataSource store's engine). */
export function compileCsvQuery(query: CollectionQuery, primaryKey: string): { sql: string; params: unknown[] } {
  return compileQuery(query, `read_csv(${readCsvArgs(primaryKey)})`);
}

/** Compile against a JSONL file of ENRICHED records — the file-backed
 *  collections' engine (see `jsonlQuery.ts`). No VARCHAR key pin needed:
 *  enriched record ids are already strings. `sample_size=-1` makes the
 *  schema inference scan EVERY line — with the default sample, a sparse
 *  optional/derived field first appearing past the sample would not be
 *  inferred as a column and the query would binder-error on it (Codex P2
 *  on #2165). The full scan costs nothing extra here: aggregation reads
 *  the whole file anyway. */
export function compileJsonlQuery(query: CollectionQuery): { sql: string; params: unknown[] } {
  return compileQuery(query, `read_json(?, format='newline_delimited', sample_size=-1)`);
}
