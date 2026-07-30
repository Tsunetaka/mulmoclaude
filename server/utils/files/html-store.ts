import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { makePathValidator } from "./path-validator.js";

// The sole guard on html-store paths: `path.join` elsewhere doesn't normalize
// traversal, so callers must pre-check writes with this validator.
export const isHtmlPath = makePathValidator({ prefix: WORKSPACE_DIRS.htmls, ext: ".html" });
