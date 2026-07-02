// Isomorphic contract shared by the registry engine, the host routes, and the
// collection plugin's Discover UI. No I/O — types + a reserved-name constant.

import type { RegistryEntry } from "./registryIndex.js";

export interface RegistryConfigEntry {
  /** Short label shown on Discover cards + used as the routing key. */
  name: string;
  /** Absolute HTTPS URL of the registry's index.json. */
  indexUrl: string;
  /** Absolute HTTPS base for per-collection files (no trailing slash). */
  rawBaseUrl: string;
}

/** Reserved name for the official registry. The client always synthesizes one
 *  entry under this name; user config that re-uses it is rejected. */
export const OFFICIAL_REGISTRY_NAME = "official";

/** Per-registry summary in the merged Discover response. */
export interface RegistrySummary {
  name: string;
  /** `ok` = fresh, `stale` = served from cache because the upstream failed,
   *  `failed` = no cache to fall back to (the entries contribution is 0). */
  status: "ok" | "stale" | "failed";
  generatedAt: string | null;
  error: string | null;
  entryCount: number;
}

/** `GET …collectionsRegistry.list` — the Discover catalog merged across every
 *  configured registry. */
export interface RegistryListResponse {
  registries: RegistrySummary[];
  /** Convenience flag: true iff any single registry's contribution was stale. */
  stale: boolean;
  collections: RegistryEntry[];
}

/** `POST …collectionsRegistry.import` — install result. */
export interface RegistryImportResponse {
  localSlug: string;
  updated: boolean;
  seedWritten: number;
  seedSkipped: boolean;
}
