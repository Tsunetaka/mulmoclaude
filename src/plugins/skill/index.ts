/**
 * Skill plugin (#1218) — internal-only, claims `toolName: "skill"` so
 * the canvas routes synthetic envelopes built by `makeSkillResult`
 * through `View.vue` instead of the default text-response renderer.
 *
 * Discovered automatically by `yarn plugins:codegen` (which scans
 * `src/plugins/<name>/index.ts` for an exported `REGISTRATION`).
 */

import type { ToolPlugin } from "gui-chat-protocol/vue";
import type { PluginRegistration } from "../../tools/types";
import type { SkillData, SkillArgs } from "./types";
import { pluginCore, TOOL_NAME } from "./plugin";
import View from "./View.vue";
import Preview from "./Preview.vue";

export const plugin: ToolPlugin<SkillData, unknown, SkillArgs> = {
  ...pluginCore,
  viewComponent: View,
  previewComponent: Preview,
};

export type { SkillData, SkillArgs } from "./types";

export { TOOL_DEFINITION, SYSTEM_PROMPT, executeSkill, pluginCore } from "./plugin";
export { TOOL_NAME };

export { View, Preview };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: plugin,
};
