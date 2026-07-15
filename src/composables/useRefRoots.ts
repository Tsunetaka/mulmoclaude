// Composable: reference-root nodes (workspace-external roots surfaced
// in the file tree). Owns its own state — shares nothing with the
// dir-children cache.

import { ref, type Ref } from "vue";
import type { TreeNode } from "../types/fileTree";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

export function useRefRoots(): {
  refRoots: Ref<TreeNode[]>;
  loadRefRoots: () => Promise<void>;
} {
  const refRoots = ref<TreeNode[]>([]);

  async function loadRefRoots(): Promise<void> {
    const result = await apiGet<TreeNode[]>(API_ROUTES.files.refRoots);
    if (result.ok && Array.isArray(result.data)) {
      refRoots.value = result.data;
    }
  }

  return { refRoots, loadRefRoots };
}
