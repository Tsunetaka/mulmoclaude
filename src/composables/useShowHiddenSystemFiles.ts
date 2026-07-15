// Composable: "show system files" toggle for the Files Explorer,
// persisted to localStorage. Default false — the Files pane hides
// agent-internal top-level dirs (`conversations/`, `feeds/`, etc.)
// until the user opts in. See #1896.

import { ref } from "vue";

const STORAGE_KEY = "filesView.showHiddenSystem";

function readStored(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function useShowHiddenSystemFiles() {
  const showHiddenSystem = ref<boolean>(readStored());

  function setShowHiddenSystem(next: boolean): void {
    showHiddenSystem.value = next;
    localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
  }

  return { showHiddenSystem, setShowHiddenSystem };
}
