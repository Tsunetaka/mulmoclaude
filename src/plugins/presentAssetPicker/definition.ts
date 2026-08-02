import type { ToolDefinition } from "gui-chat-protocol";
import { META } from "./meta";
import type { ResolvedRoute } from "../meta-types";

export const TOOL_NAME = META.toolName;
export type AssetPickerEndpoints = { readonly [K in keyof typeof META.apiRoutes]: ResolvedRoute };

/** Payload the tool carries in its ToolResult `data` — which tab / query the
 *  picker should open with. The slide editor watches for this result to open
 *  its modal; the generic chat card renders the same gallery. */
export interface AssetPickerData {
  tab: "icons" | "images";
  query: string;
}

const toolDefinition: ToolDefinition = {
  type: "function",
  name: META.toolName,
  description:
    "Open a visual picker of the local slide asset library (icons and background / right-panel images) so the user can pick one to place on a slide.",
  prompt: `Use ${TOOL_NAME} during slide editing (MulmoPoint / edit-slide) when the user wants to paste, insert, or place an icon or image on a slide but hasn't named a specific asset — e.g. "このアイコンを貼って", "いい感じの画像を入れて", "アイコンを選ばせて". It opens a thumbnail gallery of the reusable assets under data/work/icons/ and data/work/images/ so the user can browse and pick visually. After the user picks, they reply with the chosen asset's id, label, compressed file path, and a placement hint — then YOU insert it into the current page with python-pptx (the user will tell you the target coordinates / size). Pass tab="icons" (default) or tab="images" to preselect the section, and an optional query to prefilter by keyword. Do NOT call this when the user has already named an exact asset id (just place it directly). This tool does not modify any slide by itself — it only returns the user's choice.`,
  parameters: {
    type: "object",
    properties: {
      tab: {
        type: "string",
        enum: ["icons", "images"],
        description: 'Which section to preselect: "icons" (default) or "images".',
      },
      query: {
        type: "string",
        description: "Optional keyword to prefilter the gallery (matches label / description / tags).",
      },
    },
    required: [],
  },
};

export default toolDefinition;
