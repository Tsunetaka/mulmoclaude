// Node-only wiki helpers — kept off the browser-safe
// `@mulmoclaude/core/wiki` surface. The workspace-injected read engine
// (resolve / index / page / log / graph / lint) plus the abs-path→slug
// resolver used by the host's write chokepoint and snapshot hook.

export { wikiSlugFromAbsPath, wikiDirs } from "./paths.js";
export { getPageIndex, __resetPageIndexCache, type PageIndex } from "./pageIndex.js";
export { parseFrontmatter, parseFrontmatterTags } from "./frontmatter.js";
export { pickFuzzyMatch, resolvePagePath, readWikiIndex, readWikiLog, readWikiPage, loadWikiGraph, collectLintIssues, type WikiPageRead } from "./engine.js";
