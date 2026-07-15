// Top-level workspace directories that the Files Explorer surfaces by
// default. Everything else at the root (`conversations/`, `feeds/`,
// `.git/`, `.github/`, ad-hoc automation buckets, …) is treated as
// "system" and stays hidden until the user flips the "show system
// files" toggle. See #1896.
//
// The whitelist covers the buckets MulmoClaude WRITES USER-FACING
// CONTENT into:
//   - data/       — wiki, calendar, contacts, attachments, feed records, ...
//   - artifacts/  — charts, documents, html, svg, images, spreadsheets, ...
//   - config/     — settings.json, mcp.json, roles/, helps/, marp themes
// The filter is applied only at the root — once a whitelisted dir is
// shown, everything beneath it is visible without further filtering.
// That way a plugin that lands `data/foo-plugin/` shows up naturally
// without needing a code change here.

export const VISIBLE_TOP_LEVEL_DIRS: readonly string[] = ["data", "artifacts", "config"];

export function isVisibleTopLevel(name: string): boolean {
  return VISIBLE_TOP_LEVEL_DIRS.includes(name);
}
