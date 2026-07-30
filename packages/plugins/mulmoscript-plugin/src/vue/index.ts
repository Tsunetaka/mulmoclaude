import "../style.css";

import type { ToolPlugin } from "gui-chat-protocol/vue";
import type { MulmoScriptData, SaveMulmoScriptArgs } from "../core/types";
import { pluginCore } from "../core/plugin";
import View from "./View.vue";
import Preview from "./Preview.vue";

export const plugin: ToolPlugin<MulmoScriptData, MulmoScriptData, SaveMulmoScriptArgs> = {
  ...pluginCore,
  viewComponent: View,
  previewComponent: Preview,
};

export type { MulmoScriptData, MulmoScriptExecuteContext, SaveMulmoScriptArgs } from "../core/types";
export type { MulmoScriptDispatchArgs, MulmoScriptDispatchResult, MulmoScriptGenerationEvent, DispatchEnvelope, DispatchFailure } from "../core/contract";
export { GENERATION_EVENT } from "../core/contract";
export { TOOL_NAME, TOOL_DEFINITION } from "../core/definition";
export { MULMOSCRIPT_HOST_ADAPTER_KEY, useHostAdapter, type MulmoScriptHostAdapter } from "./hostAdapter";
export { useMulmoScriptTransport, type MulmoScriptTransport, type TransportResult } from "./transport";
export { View, Preview };

export default { plugin };
