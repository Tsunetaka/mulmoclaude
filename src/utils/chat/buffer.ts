const BUFFER_JOINER = "\n";

// Messages queued while the agent runs are merged back into the input
// draft once the run finishes, oldest-first with the live draft last, so
// the user can edit the combined text and send it as one turn.
export function mergeBufferedIntoDraft(buffered: string[], draft: string): string {
  return [...buffered, draft]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(BUFFER_JOINER);
}
