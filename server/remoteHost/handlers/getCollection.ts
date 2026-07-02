// getCollection command handler (remote-host phase 2).
//
// Returns one collection's detail + a PAGE of its records, mirroring
// GET /api/collections/:slug (loadCollection + listItems + toDetail), running
// in-process on the host (bypasses the HTTP view-token layer). Pagination is
// mandatory — see collectionPage.ts for the 1 MiB Firestore-document rationale.
//
// Factory (createGetCollection) keeps the mapping unit-testable with the engine
// stubbed; the default export wires the real engine functions.
import { listItems, loadCollection, toDetail } from "../../workspace/collections/index.js";
import type { CommandHandler, JsonObject } from "../commandChannel.js";
import { clampLimit, clampOffset, deriveItems, pageResult } from "./collectionPage.js";

export interface GetCollectionDeps {
  loadCollection: typeof loadCollection;
  listItems: typeof listItems;
  toDetail: typeof toDetail;
}

export const createGetCollection =
  (deps: GetCollectionDeps): CommandHandler =>
  async (params: JsonObject) => {
    const slug = String(params.slug ?? "");
    const offset = clampOffset(params.offset);
    const limit = clampLimit(params.limit);
    const collection = await deps.loadCollection(slug);
    if (!collection) throw new Error(`collection '${slug}' not found`);
    const all = deriveItems(collection.schema, await deps.listItems(collection.dataDir));
    return pageResult(deps.toDetail(collection), all, offset, limit);
  };

export const getCollection = createGetCollection({ loadCollection, listItems, toDetail });
