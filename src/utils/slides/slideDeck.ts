// Pure helpers for the new 3-tier edit-slide data model (post-N6).
//
// A working directory (WD) holds one or more *version* subfolders
// (`v001`, `v002-001`, …). Each version folder carries:
//   - `.pages/structure.json`   — source of truth: section order,
//     page-id order, per-page lock (`checked_out`).
//   - `.thumbcache/manifest.json` — display cache: per-page title,
//     thumbnail / canvas filenames, dirty + frozen flags. Keyed by the
//     same stable page id (`p-<8hex>`) as structure.
//
// SlideEditorView merges the two into a `DeckModel` and renders by id.
// The merge + version discovery are pure so they can be unit-tested
// without a browser.

// ── structure.json (`.pages/`) — source of truth ─────────────────────────────

export interface StructurePage {
  file: string;
  checked_out: boolean;
  checkout_by: string | null;
  checkout_at: string | null;
}

export interface StructureSection {
  name: string;
  page_ids: string[];
}

export interface SlideStructure {
  schema_version: number;
  wd: string;
  version: string;
  source?: { kind: string; from: string };
  sections: StructureSection[];
  pages: Record<string, StructurePage>;
}

// ── manifest.json (`.thumbcache/`) — display cache (derived) ──────────────────

export interface ManifestPage {
  page_no: number;
  section: string;
  title: string;
  thumb: string | null;
  thumb_sm: string | null;
  canvas: string | null;
  content_hash: string;
  dirty: boolean;
  frozen: boolean;
}

export interface SlideManifest {
  schema_version: number;
  version: string;
  generated_at: string;
  structure_rev?: string;
  pages: Record<string, ManifestPage>;
}

// ── merged view model ─────────────────────────────────────────────────────────

export interface DeckPage {
  id: string;
  pageNo: number; // 1-based position in the flat structure order
  title: string;
  section: string;
  thumb: string | null; // filename within `.thumbcache/`
  canvas: string | null; // filename within `.pagecanvas/`
  dirty: boolean;
  frozen: boolean;
  checkedOut: boolean;
  checkoutBy: string | null;
}

export interface DeckSection {
  name: string;
  pages: DeckPage[];
}

export interface DeckModel {
  version: string;
  totalPages: number;
  sections: DeckSection[];
  pages: DeckPage[]; // flat, in structure (section) order
}

/** A minimal `/api/files/dir` child entry shape. */
export interface DirEntry {
  name: string;
  type: "file" | "dir";
}

// Version folder names: `v001`, `v012`, `v002-001`, `v003-001-002`, …
// Validated segment-wise (not one regex) to avoid a nested-quantifier
// ReDoS pattern — each sub-regex is anchored and linear.
const BASE_SEGMENT = /^v\d{3}$/;
const BRANCH_SEGMENT = /^\d+$/;

/** True when `name` is a version folder name (`v001`, `v002-001`, …). */
export function isVersionName(name: string): boolean {
  const segments = name.split("-");
  if (!BASE_SEGMENT.test(segments[0])) return false;
  return segments.slice(1).every((seg) => BRANCH_SEGMENT.test(seg));
}

/** Numeric segment array for a version name (`v002-001` → [2, 1]). */
export function versionSegments(name: string): number[] {
  return name
    .slice(1)
    .split("-")
    .map((seg) => parseInt(seg, 10));
}

/** Descending comparator: newer (higher, then more-specific branch) first. */
function compareVersionDesc(versionA: string, versionB: string): number {
  const segsA = versionSegments(versionA);
  const segsB = versionSegments(versionB);
  const len = Math.max(segsA.length, segsB.length);
  for (let i = 0; i < len; i++) {
    const diff = (segsB[i] ?? -1) - (segsA[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Version subfolders under a WD, newest first. */
export function parseVersionDirs(entries: readonly DirEntry[]): string[] {
  return entries
    .filter((entry) => entry.type === "dir" && isVersionName(entry.name))
    .map((entry) => entry.name)
    .sort(compareVersionDesc);
}

// Full-shape defaults so the merge coalesces once (keeps `makeDeckPage`
// under the cognitive-complexity ceiling instead of `?? ` per field).
const EMPTY_MANIFEST_PAGE: ManifestPage = {
  page_no: 0,
  section: "",
  title: "",
  thumb: null,
  thumb_sm: null,
  canvas: null,
  content_hash: "",
  dirty: false,
  frozen: false,
};
const EMPTY_STRUCT_PAGE: StructurePage = { file: "", checked_out: false, checkout_by: null, checkout_at: null };

function makeDeckPage(pageId: string, pageNo: number, structure: SlideStructure, manifest: SlideManifest | null): DeckPage {
  const structPage = structure.pages[pageId] ?? EMPTY_STRUCT_PAGE;
  const manifestPage = manifest?.pages[pageId] ?? EMPTY_MANIFEST_PAGE;
  return {
    id: pageId,
    pageNo,
    title: manifestPage.title,
    section: manifestPage.section,
    thumb: manifestPage.thumb,
    canvas: manifestPage.canvas,
    dirty: manifestPage.dirty,
    frozen: manifestPage.frozen,
    checkedOut: structPage.checked_out,
    checkoutBy: structPage.checkout_by,
  };
}

/** Page ids present in `structure.pages` but not referenced by any section. */
function collectOrphanIds(structure: SlideStructure): string[] {
  const covered = new Set<string>();
  for (const sec of structure.sections) {
    for (const pageId of sec.page_ids) covered.add(pageId);
  }
  return Object.keys(structure.pages).filter((pageId) => !covered.has(pageId));
}

/**
 * Merge structure (order + lock, authoritative) with manifest (title /
 * thumb / canvas / flags, cache) into an id-keyed `DeckModel`. Page
 * numbers follow the flat structure order — manifest `page_no` is not
 * trusted so a re-order needs no manifest rewrite. Orphaned pages are
 * appended in a trailing "未分類" section so nothing vanishes.
 */
export function buildDeck(structure: SlideStructure, manifest: SlideManifest | null): DeckModel {
  let pageNo = 0;
  const sections: DeckSection[] = structure.sections.map((sec) => ({
    name: sec.name,
    pages: sec.page_ids.map((pageId) => makeDeckPage(pageId, ++pageNo, structure, manifest)),
  }));

  const orphans = collectOrphanIds(structure);
  if (orphans.length > 0) {
    sections.push({ name: "未分類", pages: orphans.map((pageId) => makeDeckPage(pageId, ++pageNo, structure, manifest)) });
  }

  const pages = sections.flatMap((sec) => sec.pages);
  return { version: structure.version, totalPages: pages.length, sections, pages };
}
