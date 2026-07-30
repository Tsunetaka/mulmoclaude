// Pure version-numbering helpers for the edit-slide "start editing" flow (§4-2).
//
// A WD's *sibling set* is every version that exists for it: the released
// versions (parsed from `ReleasedVersion/*.pptx` filenames) plus the editing
// subfolders (`v001`, `v002-001`, …). New version numbers are chosen from that
// set so that a released and an editing version never collide (spec §0/§1):
//
//   - increment → bump the LAST segment to (max of same-prefix siblings) + 1.
//     `v013` with siblings {v013, v001} → `v014`; `v002-001` → `v002-002`.
//   - branch    → append a new `-BBB` level: (max existing `base-*`) + 1, else
//     `-001`. `v001` → `v001-001`; with v001-001,v001-002 present → `v001-003`.
//   - continue  → keep the number as-is. Allowed for editing-derived versions
//     only; a ReleasedVersion-derived edit MUST re-number (§4-2).
//
// versionSegments (`v002-001` → [2, 1]) is shared from slideDeck.ts.

import { versionSegments, isVersionName } from "./slideDeck";

export type VersionOp = "increment" | "branch" | "continue";
export type VersionKind = "released" | "editing";

/** Format a numeric segment array back to a version name (`[2, 1]` → `v002-001`). */
export function formatVersion(segments: number[]): string {
  const [base, ...branches] = segments;
  const branchStr = branches.map((seg) => `-${String(seg).padStart(3, "0")}`).join("");
  return `v${String(base).padStart(3, "0")}${branchStr}`;
}

/** True when `segs` matches `prefix` in every leading position. */
function sharesPrefix(segs: number[], prefix: number[]): boolean {
  return prefix.every((val, idx) => segs[idx] === val);
}

/** Highest value at position `pos` across siblings that share `prefix` and have
 *  exactly `depth` segments. Returns 0 when none match (so +1 starts at 1). */
function maxAtDepth(siblings: string[], prefix: number[], depth: number, pos: number): number {
  let max = 0;
  for (const name of siblings) {
    if (!isVersionName(name)) continue;
    const segs = versionSegments(name);
    if (segs.length !== depth || !sharesPrefix(segs, prefix)) continue;
    if (segs[pos] > max) max = segs[pos];
  }
  return max;
}

/**
 * Increment: bump the last segment to the max of same-prefix, same-depth
 * siblings + 1. `base` itself is always considered, so the result is strictly
 * greater than `base`'s last segment even if `base` is absent from `siblings`.
 */
export function nextIncrement(base: string, siblings: string[]): string {
  const segs = versionSegments(base);
  const prefix = segs.slice(0, -1);
  const lastPos = segs.length - 1;
  const siblingMax = maxAtDepth(siblings, prefix, segs.length, lastPos);
  const max = Math.max(siblingMax, segs[lastPos]);
  return formatVersion([...prefix, max + 1]);
}

/**
 * Branch: append a new `-BBB` level. The new level is (max existing `base-*`
 * branch) + 1, or `001` when `base` has no branches yet.
 */
export function nextBranch(base: string, siblings: string[]): string {
  const segs = versionSegments(base);
  const childDepth = segs.length + 1;
  const childMax = maxAtDepth(siblings, segs, childDepth, segs.length);
  return formatVersion([...segs, childMax + 1]);
}

/** Operations allowed when starting an edit from a version of the given kind.
 *  ReleasedVersion-derived edits may not keep the number (§4-2). */
export function allowedOps(kind: VersionKind): VersionOp[] {
  return kind === "released" ? ["increment", "branch"] : ["increment", "branch", "continue"];
}

/**
 * True when some OTHER version in `all` is a descendant (branch) of `target` —
 * i.e. `target`'s segments are a STRICT prefix of theirs. Used to block a
 * delete that would orphan a branch: `v006` is blocked while `v006-001` exists,
 * and `v006-001` is blocked while `v006-001-001` exists. A same-named sibling
 * (e.g. a released `v004` next to an editing `v004`) is NOT a descendant, so it
 * never blocks. Non-version names in `all` are ignored.
 */
export function hasDescendantVersion(target: string, all: string[]): boolean {
  if (!isVersionName(target)) return false;
  const targetSegs = versionSegments(target);
  return all.some((name) => {
    if (name === target || !isVersionName(name)) return false;
    const segs = versionSegments(name);
    return segs.length > targetSegs.length && sharesPrefix(segs, targetSegs);
  });
}

// Released pptx filenames: `<name>_vNNN.pptx` or `<name>_YYYYMMDD_vNNN.pptx`.
const RELEASED_WITH_DATE = /_(\d{8})_v(\d+)\.pptx$/i;
const RELEASED_NO_DATE = /_v(\d+)\.pptx$/i;

/** Extract the version name (`v013`) from a released pptx filename, or null. */
export function releasedVersionFromFilename(filename: string): string | null {
  const withDate = filename.match(RELEASED_WITH_DATE);
  if (withDate) return `v${String(parseInt(withDate[2], 10)).padStart(3, "0")}`;
  const noDate = filename.match(RELEASED_NO_DATE);
  if (noDate) return `v${String(parseInt(noDate[1], 10)).padStart(3, "0")}`;
  return null;
}
