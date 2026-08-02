// presentAssetPicker's validation + execute (server-safe, no Vue).
// The handler is trivial: it only normalizes the requested tab / query and
// returns them as the ToolResult `data`. The slide editor (MulmoPoint) watches
// for this result to open its native modal; outside the editor the generic
// chat card renders the same gallery. Either way the user's pick is sent back
// to the agent as a follow-up text message.
import type { ToolResult, ToolContext } from "gui-chat-protocol";
import type { AssetPickerData } from "./definition";

export { TOOL_NAME } from "./definition";
export { default as TOOL_DEFINITION } from "./definition";

interface AssetPickerArgs {
  tab?: unknown;
  query?: unknown;
}

export const executeAssetPicker = async (_context: ToolContext, args: AssetPickerArgs): Promise<ToolResult<AssetPickerData, AssetPickerData>> => {
  const tab: AssetPickerData["tab"] = args?.tab === "images" ? "images" : "icons";
  const query = typeof args?.query === "string" ? args.query : "";
  const data: AssetPickerData = { tab, query };
  const querySuffix = query ? `, query="${query}"` : "";
  return {
    message: `Asset picker opened (${tab}${querySuffix}).`,
    data,
    jsonData: data,
    instructions:
      "The asset picker has been shown to the user. Wait — do NOT place anything yet. The user will reply with the chosen asset's id, label, compressed file path, and a placement hint. Once they do (and tell you the target coordinates / size), insert that asset into the current page with python-pptx.",
  };
};
