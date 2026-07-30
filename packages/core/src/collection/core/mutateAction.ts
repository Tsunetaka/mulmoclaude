// Pure helpers for `kind: "mutate"` actions (plan step ④ of
// plans/done/collection-ontology.md): the `$params.<name>` reference syntax
// used in a mutate action's `set` map. ONE parser shared by the schema
// refines (`schemaZ.ts` validates that every reference names a declared
// param) and the server executor (`server/mutate.ts` resolves them
// against the submitted form values) — the two must agree on what a
// reference is. Zod-free and I/O-free.

/** A `set` value starting with this prefix reads the named form param
 *  instead of being written literally. */
export const PARAM_REF_PREFIX = "$params.";

/** The param name a `set` value references, or null when the value is a
 *  literal (non-strings can never be references). A bare/empty prefix
 *  (`"$params."`) returns the empty string — the schema refine rejects
 *  it as an undeclared param, never silently treats it as a literal. */
export function paramRefName(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(PARAM_REF_PREFIX)) return null;
  return value.slice(PARAM_REF_PREFIX.length);
}

/** Resolve a mutate action's `set` map against the submitted params:
 *  literals pass through, `$params.<name>` reads the param value. An
 *  ABSENT referenced param omits the key entirely (merge semantics —
 *  the stored value survives), mirroring how the record form omits
 *  empty optionals rather than writing empty strings. */
export function resolveMutateSet(set: Record<string, string | number | boolean>, params: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(set)) {
    const ref = paramRefName(value);
    if (ref === null) {
      resolved[key] = value;
      continue;
    }
    const paramValue = params[ref];
    if (paramValue !== undefined && paramValue !== null && paramValue !== "") resolved[key] = paramValue;
  }
  return resolved;
}
