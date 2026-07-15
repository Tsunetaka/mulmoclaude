// Client-held copy of the user's CSP extension (`config/csp.json`, #1989).
// Populated once at app startup from GET /api/config and read synchronously
// when a sandboxed view's srcdoc / preview CSP is built (custom views,
// file-preview fallback). A module-level ref keeps it available to the
// non-Vue `uiHost` collection binding without prop-drilling.
//
// The server already validates the config, but we re-run `sanitizeCspExtra`
// here as defense-in-depth so a compromised/misbehaving response can never
// widen the sandbox beyond plain https hosts.

import { ref, readonly } from "vue";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { sanitizeCspExtra, type CspExtraHosts } from "../utils/html/previewCsp";

const cspExtraState = ref<CspExtraHosts>({});

export const cspExtra = readonly(cspExtraState);

export async function loadCspExtra(): Promise<void> {
  try {
    const response = await apiGet<{ csp?: CspExtraHosts }>(API_ROUTES.config.base);
    if (response.ok) cspExtraState.value = sanitizeCspExtra(response.data.csp ?? {});
  } catch {
    // Best-effort: on a failed fetch keep the last-known extra rather than
    // reject — callers fire this with `void` from watchers / view opens.
  }
}
