// Persistence for the Google OAuth tokens (refresh + access) at
// `~/.config/mulmo/google-token.json`, mode 600. Google omits
// `refresh_token` from refresh responses, so merges must preserve the one we
// already hold — losing it forces the user through the browser consent again.
import { constants as fsConstants, copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Credentials } from "google-auth-library";
import { readJsonOrNull, writeJsonAtomicWithMode } from "./fsJson.js";
import { googleTokenPath, legacyGoogleTokenPath } from "./paths.js";

const TOKEN_FILE_MODE = 0o600;

/** Which client minted the grant: `local` = the user's own client JSON in
 *  `~/.secrets/`, `broker` = the mulmoserver broker. Renewal must use the same
 *  path, since only that client's secret can refresh its tokens. Absent on
 *  tokens written before the broker existed — those are all `local`. */
export type IssuedVia = "local" | "broker";

export interface StoredGoogleTokens extends Credentials {
  issuedVia?: IssuedVia;
}

export function mergeGoogleTokens(existing: StoredGoogleTokens | null, incoming: StoredGoogleTokens): StoredGoogleTokens {
  const merged = { ...existing, ...incoming };
  if (!incoming.refresh_token && existing?.refresh_token) merged.refresh_token = existing.refresh_token;
  // A broker refresh response carries no marker; keep the one from the link.
  if (!incoming.issuedVia && existing?.issuedVia) merged.issuedVia = existing.issuedVia;
  return merged;
}

const fileExists = async (filePath: string): Promise<boolean> =>
  await stat(filePath).then(
    () => true,
    () => false,
  );

// Tokens written before 0.20.1 live under the mulmoclaude-branded dir; move
// them once. COPYFILE_EXCL makes the create atomic-and-non-clobbering — an
// exists+rename sequence could overwrite a token a concurrent process wrote
// to the new path in between (TOCTOU). The legacy file is deleted only after
// a successful copy; on EEXIST (new path won a race, or both files already
// exist) it is left for any older install still reading it. copyFile
// preserves the 600 mode.
async function migrateLegacyTokenFile(home?: string): Promise<void> {
  const current = googleTokenPath(home);
  const legacy = legacyGoogleTokenPath(home);
  if (!(await fileExists(legacy))) return;
  await mkdir(path.dirname(current), { recursive: true });
  try {
    await copyFile(legacy, current, fsConstants.COPYFILE_EXCL);
  } catch {
    return;
  }
  await rm(legacy, { force: true });
}

export async function loadGoogleTokens(home?: string): Promise<StoredGoogleTokens | null> {
  await migrateLegacyTokenFile(home).catch(() => undefined);
  const current = await readJsonOrNull<StoredGoogleTokens>(googleTokenPath(home));
  if (current) return current;
  // Migration is best-effort — a valid legacy token must still count as
  // linked even when the move failed (permissions, read-only fs, …).
  return await readJsonOrNull<StoredGoogleTokens>(legacyGoogleTokenPath(home));
}

export async function saveGoogleTokens(incoming: StoredGoogleTokens, home?: string): Promise<StoredGoogleTokens> {
  const merged = mergeGoogleTokens(await loadGoogleTokens(home), incoming);
  await writeJsonAtomicWithMode(googleTokenPath(home), merged, TOKEN_FILE_MODE);
  return merged;
}

export async function deleteGoogleTokens(home?: string): Promise<void> {
  await rm(googleTokenPath(home), { force: true });
}
