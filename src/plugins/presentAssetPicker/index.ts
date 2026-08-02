import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import toolDefinition, { TOOL_NAME, type AssetPickerData, type AssetPickerEndpoints } from "./definition";
import { makeRouteExecute } from "../execute";
import { wrapWithScope } from "../scope";
import View from "./View.vue";

const presentAssetPickerPlugin: ToolPlugin<AssetPickerData> = {
  toolDefinition,

  execute: makeRouteExecute<AssetPickerEndpoints, AssetPickerData>("assetPicker", "dispatch", TOOL_NAME),

  isEnabled: () => true,
  generatingMessage: "Opening asset picker…",
  viewComponent: wrapWithScope("assetPicker", View),
};
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: presentAssetPickerPlugin,
};
