/**
 * Text Response Plugin - Vue Implementation
 */

import type { ToolPlugin } from "gui-chat-protocol/vue";
import type { PluginRegistration } from "../../tools/types";
import type { TextResponseData, TextResponseArgs } from "./types";
import { pluginCore, TOOL_NAME } from "./plugin";
import { samples } from "./samples";
import View from "./View.vue";
import Preview from "./Preview.vue";

export const plugin: ToolPlugin<TextResponseData, unknown, TextResponseArgs> = {
  ...pluginCore,
  viewComponent: View,
  previewComponent: Preview,
  samples,
};

export type { TextResponseData, TextResponseArgs } from "./types";

export { TOOL_DEFINITION, SYSTEM_PROMPT, executeTextResponse, pluginCore } from "./plugin";
export { TOOL_NAME };

export { samples } from "./samples";

export { View, Preview };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: plugin,
};
