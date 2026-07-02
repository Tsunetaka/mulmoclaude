import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Pass 1 — the CJS-safe subsystems, dual ESM+CJS (no import.meta.url in these
// entries). One package, many subpath entries; each lands under dist/<subpath>/.
// Node built-ins are externalized; the @receptron/task-scheduler peer is provided
// by the host. The dts plugin emits declarations for ALL src (including the
// ESM-only workspace-setup built by vite.esm.config.ts), so this pass runs first
// and owns the dist cleanup.
export default defineConfig({
  plugins: [
    dts({
      include: ["src/**/*.ts"],
      outDir: "dist",
      compilerOptions: { rootDir: "src" },
    }),
  ],
  build: {
    lib: {
      entry: {
        "collection/index": "src/collection/index.ts",
        "collection/server/index": "src/collection/server/index.ts",
        "collection/paths": "src/collection/server/templatePath.ts",
        "collection/registry/index": "src/collection/registry/index.ts",
        "collection/registry/server/index": "src/collection/registry/server/index.ts",
        "wiki/index": "src/wiki/index.ts",
        "wiki/server/index": "src/wiki/server/index.ts",
        // Lightweight path helpers as their own entry (no js-yaml / engine)
        // so the hook sidecar can import `wikiSlugFromAbsPath` without
        // bundling the whole read-engine. Mirrors `collection/paths`.
        "wiki/paths": "src/wiki/server/paths.ts",
        "feeds/index": "src/feeds/index.ts",
        "feeds/server/index": "src/feeds/server/index.ts",
        "feeds/paths": "src/feeds/paths.ts",
        "collection-watchers/index": "src/collection-watchers/index.ts",
        "skill-bridge/index": "src/skill-bridge/index.ts",
        "file-change/index": "src/file-change/index.ts",
        "notifier/index": "src/notifier/index.ts",
        "scheduler/index": "src/scheduler/index.ts",
        "whisper/index": "src/whisper/index.ts",
        "whisper/client": "src/whisper/client.ts",
        "translation/client": "src/translation/client.ts",
      },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      external: [/^node:/, /^@receptron\//, "zod", "gui-chat-protocol", "fast-xml-parser", "js-yaml"],
      output: { exports: "named" },
    },
    minify: false,
    sourcemap: true,
  },
});
