import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "presentAssetPicker",
  apiNamespace: "assetPicker",
  apiRoutes: {
    /** POST /api/assetPicker — open the icon / image asset picker for the user. */
    dispatch: { method: "POST", path: "" },
  },
  mcpDispatch: "dispatch",
});
