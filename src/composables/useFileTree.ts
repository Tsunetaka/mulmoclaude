// Composable: workspace file tree state + lazy loading.
// Extracted from FilesView.vue (#507 step 1).
// Composes the dir-children cache, the ref-roots list, and the
// expanded-dirs state into the single surface FilesView consumes.

import { useExpandedDirs } from "./useExpandedDirs";
import { computeAncestorDirs } from "./useFileTree.helpers";
import { useDirChildrenCache } from "./useDirChildrenCache";
import { useRefRoots } from "./useRefRoots";

export function useFileTree() {
  const { expand } = useExpandedDirs();
  const cache = useDirChildrenCache();
  const { refRoots, loadRefRoots } = useRefRoots();

  async function ensureAncestorsLoaded(filePath: string): Promise<void> {
    for (const dir of computeAncestorDirs(filePath)) {
      expand(dir);
      await cache.loadDirChildren(dir);
    }
  }

  return {
    rootNode: cache.rootNode,
    refRoots,
    childrenByPath: cache.childrenByPath,
    treeError: cache.treeError,
    loadDirChildren: cache.loadDirChildren,
    ensureAncestorsLoaded,
    reloadRoot: cache.reloadRoot,
    reloadDirChildren: cache.reloadDirChildren,
    loadRefRoots,
  };
}
