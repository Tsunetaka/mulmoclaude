// Thin glue for the collection export: resolve the collection from the live workspace
// (its skill dir + data dir + schema), derive meta from SKILL.md front-matter / any
// existing meta.json, then hand off to the testable writeCollectionExport. Kept
// separate so the file-writing core stays import-light + unit-testable.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadCollection } from "../../server/index.js";
import { isRecord } from "../guards.js";
import { parseSkillDescription } from "./skillDescription.js";
import { writeCollectionExport, type ExportMeta, type ExportResult } from "./exportCollection.js";

const STATUS_NOT_FOUND = 404;

async function readJsonObject(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf-8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function performExport(
  slug: string,
  opts: { author: string; license: string; includeSeed: boolean },
  workspaceRoot: string,
): Promise<ExportResult> {
  const collection = await loadCollection(slug);
  if (!collection) return { ok: false, status: STATUS_NOT_FOUND, error: `collection not found: ${slug}` };
  const skillMd = await readFile(path.join(collection.skillDir, "SKILL.md"), "utf-8").catch(() => "");
  const existingMeta = await readJsonObject(path.join(collection.skillDir, "meta.json"));
  const meta: ExportMeta = {
    author: opts.author,
    slug,
    version: typeof existingMeta?.version === "string" ? existingMeta.version : "1.0.0",
    title: collection.schema.title,
    description: parseSkillDescription(skillMd),
    tags: [],
    license: opts.license,
  };
  return writeCollectionExport({ workspaceRoot, skillDir: collection.skillDir, dataDir: collection.dataDir, meta, includeSeed: opts.includeSeed });
}
