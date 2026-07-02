// Download an artifacts/html page as a self-contained zip from the host
// UI (file explorer preview). Mirrors usePdfDownload: POST the workspace
// path to /api/share/pack, receive a binary zip, run the
// blob-to-download dance. Failure sets `packFailed` so the caller can
// render a localized message — the raw server body is never surfaced.

import { ref, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { apiFetchRaw } from "../utils/api";
import { saveBlob, filenameFromDisposition } from "../utils/blobDownload";

export interface UseSharePackHandle {
  packing: Ref<boolean>;
  packFailed: Ref<boolean>;
  downloadZip: (htmlPath: string) => Promise<void>;
  /** Clear the failed flag — call on navigation so a stale error banner
   *  doesn't carry over to the next file. */
  reset: () => void;
}

function fallbackName(htmlPath: string): string {
  const base =
    htmlPath
      .split("/")
      .pop()
      ?.replace(/\.html?$/i, "") || "share";
  return `${base}.zip`;
}

export function useSharePack(): UseSharePackHandle {
  const packing = ref(false);
  const packFailed = ref(false);

  async function downloadZip(htmlPath: string): Promise<void> {
    packFailed.value = false;
    packing.value = true;
    try {
      const response = await apiFetchRaw(API_ROUTES.share.pack, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: htmlPath }),
      });
      if (!response.ok) {
        packFailed.value = true;
        return;
      }
      saveBlob(await response.blob(), filenameFromDisposition(response.headers.get("content-disposition"), fallbackName(htmlPath)));
    } catch {
      packFailed.value = true;
    } finally {
      packing.value = false;
    }
  }

  function reset(): void {
    packFailed.value = false;
  }

  return { packing, packFailed, downloadZip, reset };
}
