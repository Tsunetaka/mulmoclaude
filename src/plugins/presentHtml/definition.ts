import { META } from "./meta";
import type { ResolvedRoute } from "../meta-types";
import { TOOL_DEFINITION } from "@mulmoclaude/html-plugin";

// presentHtml's tool schema, validation, and artifacts persistence now live in
// the shared @mulmoclaude/html-plugin package (single source of truth, also
// consumable by MulmoTerminal). This built-in is a thin host adapter: it keeps
// MulmoClaude's host-specific routing META and scoped-runtime wrapping while
// sourcing the schema/logic from the package. The Vue View stays host-side until
// phase 2 (see plans/done/feat-presenthtml-mulmoterminal.md).
export const TOOL_NAME = META.toolName;

/** Resolved-URL view of the html plugin's routes (create / update). Plugin code
 *  reads `endpoints.<route>.{method, url}` to drive `apiCall`. Auto-derived from META. */
export type HtmlEndpoints = { readonly [K in keyof typeof META.apiRoutes]: ResolvedRoute };

export { TOOL_DEFINITION };
export default TOOL_DEFINITION;
