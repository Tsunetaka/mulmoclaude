// @mulmoclaude/core/collection/registry — isomorphic surface of the collection
// registry: the Discover catalog contract (entry / summary / list / import
// response shapes) plus the pure index parser. Browser-safe — the node engine
// (fetch, fs, host DI) lives on @mulmoclaude/core/collection/registry/server.

export { parseRegistryIndex, type RegistryEntry, type RegistryIndex, type ParseResult } from "./registryIndex.js";
export { OFFICIAL_REGISTRY_NAME, type RegistryConfigEntry, type RegistrySummary, type RegistryListResponse, type RegistryImportResponse } from "./types.js";
