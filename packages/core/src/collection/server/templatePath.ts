// Moved to `../core/templatePath` — the isomorphic schema validator
// (`../core/schemaZ`) needs these predicates and must stay node-free, and
// this module was already dependency-free by design. Re-exported here so
// the existing `collection/server` importers (skill-bridge, the server
// barrel's `export *`) keep resolving unchanged.
export * from "../core/templatePath";
