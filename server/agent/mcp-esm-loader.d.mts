// Type declarations for the ESM resolver hook (`mcp-esm-loader.mjs`).
// Kept alongside the .mjs so it stays in step with any signature changes.

export interface ScopedSpecifierSplit {
  pkg: string;
  subpath: string;
}

export interface PackageManifest {
  exports?: string | Record<string, unknown> | null;
  main?: string;
  [key: string]: unknown;
}

export function splitScopedSpecifier(specifier: string): ScopedSpecifierSplit;

export function pickEntry(manifest: PackageManifest, subpath: string): string | null;

export function resolveFromFallback(pkg: string, subpath: string, fallbackRoot?: string): string | null;

/** Node ESM resolver hook. Contract matches Node's `--import`/`register`
 *  loader API: intercept the specifier, delegate to `nextResolve` first,
 *  and only rewrite when the primary resolution throws. */
export function resolve(
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => Promise<{ url: string; shortCircuit?: boolean; format?: string }>,
): Promise<{ url: string; shortCircuit?: boolean; format?: string }>;
