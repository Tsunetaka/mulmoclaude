// Wire @mulmoclaude/core/google to MulmoClaude's logger. Imported for side
// effect near the top of server/index.ts so the binding is set before any
// Google engine call runs (same pattern as workspace/collections/configure.ts).
import { configureGoogleHost } from "@mulmoclaude/core/google";
import { log } from "../../system/logger/index.js";

configureGoogleHost({ log });
