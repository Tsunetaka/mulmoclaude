// Read-side YAML frontmatter parsing for the wiki engine. Mirrors the
// host's `server/utils/markdown/frontmatter.ts` parser (value-preserving
// FAILSAFE_SCHEMA) so MulmoClaude and MulmoTerminal read `tags:` (and
// any other field) identically. Only the READ path lives here — the
// serialize/merge write side stays host-side until a host needs it.

import { FAILSAFE_SCHEMA, load as yamlLoad } from "js-yaml";

const FRONTMATTER_OPEN = /^---\r?\n/;
// `(?:^|\r?\n)` lets the closing fence sit at the very start of
// `afterOpen` — needed for the empty-envelope case `---\n---\n`.
const FRONTMATTER_CLOSE = /(?:^|\r?\n)---\s*(?:\r?\n|$)/;

/** Parse `---\n…\n---\n` frontmatter. Never throws; malformed YAML in a
 *  well-formed envelope yields `{ meta: {}, hasHeader: false }`. */
export function parseFrontmatter(raw: string): { meta: Record<string, unknown>; hasHeader: boolean } {
  if (!FRONTMATTER_OPEN.test(raw)) return { meta: {}, hasHeader: false };
  const afterOpen = raw.replace(FRONTMATTER_OPEN, "");
  const closeMatch = FRONTMATTER_CLOSE.exec(afterOpen);
  if (!closeMatch || closeMatch.index === undefined) return { meta: {}, hasHeader: false };
  const meta = safeYamlLoad(afterOpen.slice(0, closeMatch.index));
  if (meta === null) return { meta: {}, hasHeader: false };
  return { meta, hasHeader: true };
}

function safeYamlLoad(text: string): Record<string, unknown> | null {
  // js-yaml throws on empty/whitespace-only input; an empty header
  // (`---\n---\n`) means "no metadata", not "malformed".
  if (text.trim() === "") return {};
  try {
    // FAILSAFE_SCHEMA keeps every scalar a string (no YAML-1.1 date
    // coercion, no numeric-string truncation) — matches the host.
    const loaded = yamlLoad(text, { schema: FAILSAFE_SCHEMA });
    if (loaded === null || loaded === undefined) return {};
    if (typeof loaded !== "object" || Array.isArray(loaded)) return null;
    return loaded as Record<string, unknown>;
  } catch {
    return null;
  }
}

function cleanTagToken(token: string): string {
  return token
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/^#/, "")
    .toLowerCase();
}

/** Narrow `tags:` reader. Handles flow (`tags: [a, b]`) and block-list
 *  style; anything unparseable returns `[]` (best-effort, never throws). */
export function parseFrontmatterTags(content: string): string[] {
  const parsed = parseFrontmatter(content);
  if (!parsed.hasHeader) return [];
  const tagsValue = parsed.meta.tags;
  if (!Array.isArray(tagsValue)) return [];
  return tagsValue
    .filter((item): item is string => typeof item === "string")
    .map(cleanTagToken)
    .filter((token) => token.length > 0);
}
