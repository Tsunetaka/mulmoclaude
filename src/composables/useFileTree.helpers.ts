/** Ancestor directory paths of a workspace-relative file, ordered
 *  shallowest-first and EXCLUDING the file's own leaf. Returns `[]` for
 *  a root-level file (or empty input) since it has no directory to load.
 *  Leading and duplicate slashes are dropped as empty segments. */
export function computeAncestorDirs(filePath: string): string[] {
  const parts = filePath.split("/").filter(Boolean);
  if (parts.length <= 1) return [];
  const ancestors: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    ancestors.push(parts.slice(0, i).join("/"));
  }
  return ancestors;
}

/** Copy-on-write set: returns a NEW Map with `key` set to `value`. The
 *  new identity is required — a `ref<Map>` only re-renders when the Map
 *  reference changes, so mutating in place would be a silent reactivity
 *  regression. */
export function withEntry<K, V>(map: Map<K, V>, key: K, value: V): Map<K, V> {
  const next = new Map(map);
  next.set(key, value);
  return next;
}

/** Copy-on-write delete: returns a NEW Map without `key`. New identity
 *  required for the same reactivity reason as `withEntry`. */
export function withoutEntry<K, V>(map: Map<K, V>, key: K): Map<K, V> {
  const next = new Map(map);
  next.delete(key);
  return next;
}
