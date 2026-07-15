// @mulmoclaude/core/collection/server — node-only collection engine.
//
// The host server imports from here (storage, validation, discovery, …);
// it is kept separate from the isomorphic `./collection` entry so the frontend
// bundle never pulls in node:fs. Configure the host binding once at startup:
//   import { configureCollectionHost } from "@mulmoclaude/core/collection/server";
//   configureCollectionHost({ workspaceRoot, log });

export {
  configureCollectionHost,
  getWorkspaceRoot,
  log,
  setCollectionChangePublisher,
  publishCollectionChange,
  type CollectionHost,
  type CollectionLogger,
  type CollectionChangePayload,
} from "./host";
export type { LoadedCollection } from "./discoveredCollection";
export * from "./paths";
export * from "./templatePath";
export * from "./io";
export * from "./validate";
export * from "./discovery";
export * from "./derive";
export * from "./dynamicIcon";
export * from "./spawn";
export * from "./delete";
export * from "./views";
