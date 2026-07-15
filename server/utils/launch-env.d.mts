// Type declarations for launch-env.mjs. See the .mjs file for rationale
// on why the launcher's `.env` loader lives in plain JS.

export interface ParsedEnvFile {
  exists: boolean;
  parsed: Record<string, string>;
}

export interface ParseEnvFileOptions {
  readFileSync?: (path: string, encoding: "utf8") => string;
  parse?: (src: string) => Record<string, string>;
}

export function parseEnvFile(filePath: string, options?: ParseEnvFileOptions): ParsedEnvFile;

export interface MergedLaunchEnv {
  env: Record<string, string | undefined>;
  loadedKeys: string[];
  skippedKeys: string[];
}

export function mergeLaunchEnv(baseEnv: Record<string, string | undefined>, parsed: Record<string, string>): MergedLaunchEnv;

export interface LaunchEnvLoadSummary {
  path: string;
  exists: boolean;
  loadedKeys: string[];
  skippedKeys: string[];
}

export function describeLaunchEnvLoad(summary: LaunchEnvLoadSummary, maxKeysShown?: number): string | null;
