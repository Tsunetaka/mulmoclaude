// Loads the Google OAuth **desktop-app** client credentials a user may have
// downloaded from the Cloud Console into `~/.secrets/client_secret_*.json`.
// Files are discovered by prefix so nobody has to rename Google's long default
// filename.
//
// Only `{"installed": …}` (desktop) files count. A `{"web": …}` client cannot
// drive the loopback consent this engine runs — and one legitimately sits in
// the same directory for anyone who also deploys the broker — so web clients
// are skipped rather than treated as a competing choice.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "./util.js";
import { googleSecretsDir } from "./paths.js";

export interface InstalledClientSecret {
  client_id: string;
  client_secret: string;
}

// Empty strings must not count: they would satisfy a `typeof` check, get
// picked as the client, and fail at Google with an opaque invalid_client.
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value !== "";

const isInstalledClientSecret = (value: unknown): value is { installed: InstalledClientSecret } => {
  if (!isRecord(value) || !isRecord(value.installed)) return false;
  return isNonEmptyString(value.installed.client_id) && isNonEmptyString(value.installed.client_secret);
};

const isClientSecretFileName = (name: string): boolean => name.startsWith("client_secret_") && name.endsWith(".json");

const readIfDesktopClient = async (filePath: string): Promise<string | null> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf-8"));
    return isInstalledClientSecret(parsed) ? filePath : null;
  } catch {
    // Unreadable or malformed: not a usable desktop client, and refusing the
    // whole directory over one stray file would be worse than ignoring it.
    return null;
  }
};

/** Absolute paths of every desktop-app client JSON in `~/.secrets/`. */
async function listDesktopClientSecretFiles(home?: string): Promise<string[]> {
  const dir = googleSecretsDir(home);
  const entries = await readdir(dir).catch((): string[] => []);
  const candidates = entries.filter(isClientSecretFileName).sort();
  const checked = await Promise.all(candidates.map((name) => readIfDesktopClient(join(dir, name))));
  return checked.filter((path): path is string => path !== null);
}

/** `missing` is the ordinary case — the broker supplies the client, so no user
 *  action is needed. `ambiguous` (2+ desktop clients) still needs a human:
 *  a stored refresh token pairs with exactly one client_id, so picking for
 *  them could silently break the link. */
export type ClientSecretPresence = "found" | "missing" | "ambiguous";

export async function clientSecretPresence(home?: string): Promise<ClientSecretPresence> {
  const matches = await listDesktopClientSecretFiles(home);
  if (matches.length === 0) return "missing";
  return matches.length === 1 ? "found" : "ambiguous";
}

export async function findClientSecretPath(home?: string): Promise<string> {
  const dir = googleSecretsDir(home);
  const matches = await listDesktopClientSecretFiles(home);
  const [first, ...rest] = matches;
  if (!first) {
    throw new Error(`no desktop-app client_secret_*.json found in ${dir} — this host links through the sign-in service instead`);
  }
  if (rest.length > 0) {
    const names = matches.map((path) => path.slice(dir.length + 1)).join(", ");
    throw new Error(`multiple desktop-app client_secret_*.json files found in ${dir} (${names}) — keep exactly one`);
  }
  return first;
}

export async function loadClientSecret(home?: string): Promise<InstalledClientSecret> {
  const filePath = await findClientSecretPath(home);
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf-8"));
  if (!isInstalledClientSecret(parsed)) {
    throw new Error(`${filePath} is not a desktop-app OAuth client secret (missing "installed" with client_id / client_secret)`);
  }
  return { client_id: parsed.installed.client_id, client_secret: parsed.installed.client_secret };
}
