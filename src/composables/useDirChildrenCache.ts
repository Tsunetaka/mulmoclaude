// Composable: lazy-loaded dir-children cache for the workspace file
// tree. Owns the root node, the per-path children map, the tree error,
// and the two-tier generation guards that keep stale responses from
// overwriting fresh state (#1608).

import { ref } from "vue";
import type { TreeNode } from "../types/fileTree";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { withEntry, withoutEntry } from "./useFileTree.helpers";

export function useDirChildrenCache() {
  const rootNode = ref<TreeNode | null>(null);
  const childrenByPath = ref<Map<string, TreeNode[] | null>>(new Map());
  const treeError = ref<string | null>(null);

  // Root-level generation counter — incremented on reloadRoot so
  // in-flight requests from a prior generation don't write stale data.
  let generation = 0;

  // Per-folder generation counter — incremented every time the cache
  // entry for that folder is invalidated (cold start or reloadDir-
  // Children). A response that returns after the entry has been
  // re-invalidated is from a stale earlier request and must NOT be
  // applied, or it would overwrite the fresh children list. Closes
  // the race CodeRabbit flagged on #1608.
  const folderGeneration = new Map<string, number>();

  function bumpFolderGen(path: string): number {
    const next = (folderGeneration.get(path) ?? 0) + 1;
    folderGeneration.set(path, next);
    return next;
  }

  async function loadDirChildren(path: string): Promise<void> {
    if (childrenByPath.value.has(path)) return;

    const gen = generation;
    const folderGen = bumpFolderGen(path);
    childrenByPath.value = withEntry(childrenByPath.value, path, null);

    const result = await apiGet<TreeNode>(API_ROUTES.files.dir, { path });
    // Bail if reloadRoot was called while we were awaiting, or if
    // this folder was re-invalidated (reloadDirChildren) since we
    // started — a fresher request superseded us.
    if (gen !== generation) return;
    if (folderGeneration.get(path) !== folderGen) return;
    if (!result.ok) {
      childrenByPath.value = withoutEntry(childrenByPath.value, path);
      treeError.value = result.error || `dir: ${result.status}`;
      return;
    }
    const node = result.data;
    childrenByPath.value = withEntry(childrenByPath.value, path, node.children ?? []);
    if (path === "") rootNode.value = { ...node, children: [] };
  }

  async function reloadRoot(): Promise<void> {
    generation++;
    rootNode.value = null;
    childrenByPath.value = new Map();
    treeError.value = null;
    await loadDirChildren("");
  }

  /** Drop a single folder's children from the cache and re-fetch.
   *  Used after a file-create / -delete from the same View so the
   *  user sees the change land without a full root reload. Bumps the
   *  per-folder generation so any in-flight request for the same
   *  path is discarded when it lands. */
  async function reloadDirChildren(path: string): Promise<void> {
    bumpFolderGen(path);
    childrenByPath.value = withoutEntry(childrenByPath.value, path);
    await loadDirChildren(path);
  }

  return {
    rootNode,
    childrenByPath,
    treeError,
    loadDirChildren,
    reloadRoot,
    reloadDirChildren,
  };
}
