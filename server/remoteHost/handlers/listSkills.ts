// listSkills command handler (remote-host).
//
// Returns just the ids (names) of the discoverable Claude Code skills as a
// flat string[], mirroring the id column of GET /api/skills. Read-only:
// creating/editing skills stays desktop-only (like listShortcuts / listFeeds).
// Only ids travel — the phone asks for the detail it needs by other means, so
// there is no reason to carry descriptions/source over the channel.
//
// Collection skills are excluded: a skill dir that ships a `schema.json` is a
// collection (the same set `discoverCollections` finds under user/project
// scope), and the mobile remote serves those through listCollections. Listing
// them here too would double-list them, so we subtract the collection slugs.
import { discoverCollections } from "../../workspace/collections/index.js";
import { discoverSkills } from "../../workspace/skills/index.js";
import { workspacePath } from "../../workspace/workspace.js";
import type { CommandHandler, JsonObject } from "../commandChannel.js";

export interface ListSkillsDeps {
  discoverSkills: typeof discoverSkills;
  discoverCollections: typeof discoverCollections;
  workspaceRoot: string;
}

export const createListSkills =
  (deps: ListSkillsDeps): CommandHandler =>
  // Handler receives the command's params; listSkills takes none (the `__`
  // prefix marks it intentionally unused per the lint config).
  async (__params: JsonObject) => {
    const [skills, collections] = await Promise.all([
      deps.discoverSkills({ workspaceRoot: deps.workspaceRoot }),
      deps.discoverCollections({ workspaceRoot: deps.workspaceRoot }),
    ]);
    // Feeds aren't skills, so only the skill-backed (user/project) collections
    // can shadow a skill id — subtract those.
    const collectionSlugs = new Set(collections.filter((collection) => collection.source !== "feed").map((collection) => collection.slug));
    return { skills: skills.map((skill) => skill.name).filter((name) => !collectionSlugs.has(name)) };
  };

export const listSkills = createListSkills({ discoverSkills, discoverCollections, workspaceRoot: workspacePath });
