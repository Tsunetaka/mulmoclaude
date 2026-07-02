// Read endpoints for the curated collection registries (Discover tab). Backs
// `GET /api/collections-registry` by server-fetching every configured registry's
// published index.json (official receptron/mulmoclaude-collections plus any
// user-added entries from `config/collections-registries.json`) and returning
// merged entries. The host never exposes upstream URLs to the client; it proxies
// + caches each one.
//
// The registry import/export engine lives in @mulmoclaude/core/collection/registry,
// wired to this workspace through the shared `configureCollectionHost` binding (see
// server/workspace/collections/configure.ts). This route is thin host glue.

import { Router, Request, Response } from "express";

import type { RegistryEntry, RegistryListResponse, RegistryImportResponse } from "@mulmoclaude/core/collection/registry";
import { listRegistry, previewCollection, importRegistry, performExport } from "@mulmoclaude/core/collection/registry/server";

import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { badRequest } from "../../utils/httpError.js";
import { workspacePath } from "../../workspace/workspace.js";

const router = Router();

interface ErrorResponse {
  error: string;
}

router.get(API_ROUTES.collectionsRegistry.list, async (_req: Request, res: Response<RegistryListResponse | ErrorResponse>) => {
  res.json(await listRegistry());
});

interface RegistryPreviewResponse {
  entry: RegistryEntry;
  schema: Record<string, unknown>;
  meta: Record<string, unknown>;
}

router.get(API_ROUTES.collectionsRegistry.preview, async (req: Request, res: Response<RegistryPreviewResponse | ErrorResponse>) => {
  const author = typeof req.query.author === "string" ? req.query.author : "";
  const slug = typeof req.query.slug === "string" ? req.query.slug : "";
  const registry = typeof req.query.registry === "string" && req.query.registry ? req.query.registry : null;
  if (!author || !slug) {
    badRequest(res, "author and slug query params are required");
    return;
  }
  const result = await previewCollection(author, slug, registry);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ entry: result.entry, schema: result.schema, meta: result.meta });
});

interface ImportBody {
  author?: unknown;
  slug?: unknown;
  registry?: unknown;
}

router.post(API_ROUTES.collectionsRegistry.import, async (req: Request<object, unknown, ImportBody>, res: Response<RegistryImportResponse | ErrorResponse>) => {
  const author = typeof req.body.author === "string" ? req.body.author : "";
  const slug = typeof req.body.slug === "string" ? req.body.slug : "";
  const registry = typeof req.body.registry === "string" && req.body.registry ? req.body.registry : null;
  if (!author || !slug) {
    badRequest(res, "author and slug are required");
    return;
  }
  const result = await importRegistry(author, slug, workspacePath, registry);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result.response);
});

interface ExportBody {
  slug?: unknown;
  author?: unknown;
  license?: unknown;
  includeSeed?: unknown;
}

interface ExportResponse {
  outputPath: string;
  fileCount: number;
  seedCount: number;
  seedSkipped: number;
  warnings: string[];
}

router.post(API_ROUTES.collectionsRegistry.export, async (req: Request<object, unknown, ExportBody>, res: Response<ExportResponse | ErrorResponse>) => {
  const slug = typeof req.body.slug === "string" ? req.body.slug : "";
  const author = typeof req.body.author === "string" ? req.body.author : "";
  if (!slug || !author) {
    badRequest(res, "slug and author are required");
    return;
  }
  const license = typeof req.body.license === "string" && req.body.license ? req.body.license : "MIT";
  const includeSeed = req.body.includeSeed === true;
  const result = await performExport(slug, { author, license, includeSeed }, workspacePath);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({
    outputPath: result.outputPath,
    fileCount: result.fileCount,
    seedCount: result.seedCount,
    seedSkipped: result.seedSkipped,
    warnings: result.warnings,
  });
});

export default router;
