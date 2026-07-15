import { ref, watch, type Ref } from "vue";
import { apiPost } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

// UI state + trigger for the OS-file-action buttons on the
// binary-file fallback in FileContentRenderer ("Open in OS" and
// "Show in folder"). Extracted so the state machine (busy / error /
// auto-reset on path change) is unit-testable without mounting the
// full component.
//
// - `selectedPath` is watched: when it changes, error + busy reset
//   so an error from file A doesn't linger while viewing file B.
// - `fallbackErrorMessage` is used when the server returns `ok:
//   false` without an `error` string.

interface FileOsAction {
  busy: Ref<boolean>;
  error: Ref<string | null>;
  run: () => Promise<void>;
}

function useFileOsAction(selectedPath: Ref<string | null>, route: string, fallbackErrorMessage: () => string): FileOsAction {
  const busy = ref(false);
  const error = ref<string | null>(null);

  watch(selectedPath, () => {
    busy.value = false;
    error.value = null;
  });

  async function run(): Promise<void> {
    const path = selectedPath.value;
    if (!path) return;
    busy.value = true;
    error.value = null;
    try {
      const url = `${route}?path=${encodeURIComponent(path)}`;
      const result = await apiPost<{ ok: boolean }>(url, { path });
      if (!result.ok) error.value = result.error || fallbackErrorMessage();
    } finally {
      busy.value = false;
    }
  }

  return { busy, error, run };
}

export interface UseOpenInOsResult {
  busy: Ref<boolean>;
  error: Ref<string | null>;
  open: () => Promise<void>;
}

export function useOpenInOs(selectedPath: Ref<string | null>, fallbackErrorMessage: () => string): UseOpenInOsResult {
  const { busy, error, run } = useFileOsAction(selectedPath, API_ROUTES.files.open, fallbackErrorMessage);
  return { busy, error, open: run };
}

export interface UseRevealInOsResult {
  busy: Ref<boolean>;
  error: Ref<string | null>;
  reveal: () => Promise<void>;
}

export function useRevealInOs(selectedPath: Ref<string | null>, fallbackErrorMessage: () => string): UseRevealInOsResult {
  const { busy, error, run } = useFileOsAction(selectedPath, API_ROUTES.files.reveal, fallbackErrorMessage);
  return { busy, error, reveal: run };
}
