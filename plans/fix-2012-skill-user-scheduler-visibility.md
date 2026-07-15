# fix(#2012): skill & user scheduled tasks — list visibility, manual run, history

Issue: #2012 — SKILL.md `schedule:` frontmatter registers a task but it never appears on
`/automations` (no list entry, no manual run, no history). Investigation also found user
tasks lack run history, and `daily HH:MM` is silently UTC.

## Background: two registration paths (the root of the confusion)

| | user task (Automations UI) | skill schedule (SKILL.md `schedule:`) |
|---|---|---|
| store | `config/scheduler/tasks.json` | SKILL.md frontmatter |
| task-manager id | `user.<uuid>` | `skill.<name>` |
| list | ✅ (route `loadUserTasks()`) | ❌ (no source) |
| manual run | ✅ (route → startChat) | ❌ (404) |
| history/state | ❌ | ❌ |

Only **system** tasks (journal/chat-index/feed-refresh) run through the adapter's
`executeAndLog` → they alone get `data/scheduler/logs` history + `state.json` state.
skill/user tasks register straight on the task-manager with `run: startChat(...)` — no
state, no log.

## Fixes

### A. List visibility (skills)
- `server/workspace/skills/scheduler.ts`: track full skill task defs (not just ids) and
  export `getScheduledSkills(): {id,name,description,schedule}[]`.
- `server/api/routes/schedulerTasks.ts` list handler: append skill tasks as
  `origin:"skill"`. Client (`TasksTab.vue`) already renders the `origin:"skill"` badge
  (all 8 locales have `originSkill`) — dead code today, becomes live.

### B. History + state parity (skill + user)
- `packages/core/src/scheduler/adapter.ts` (additive, backward-compatible):
  - export `getSchedulerTaskState(id): TaskExecutionState` — read state for any id.
  - export `recordExternalRun({id,name,schedule,scheduledFor,trigger,ok,errorMessage})`
    — append a log entry + update state (lastRunAt/lastRunResult/totalRuns/nextScheduledAt).
    Extract the shared persistence from `safePersist` so system + external share one path.
- skill/user run wrappers (`scheduler.ts`, `user-tasks.ts`) call `recordExternalRun`
  after firing `startChat`, so scheduled fires are logged + stateful.
- list handler attaches `state` to user tasks via `getSchedulerTaskState("user."+id)` and to
  skill tasks via `getSchedulerTaskState(skillTaskId)`.
- Note: skill/user `run` is fire-and-forget (`startChat` spawns an async chat); the log
  records the *fire* (started / failed-to-start), not the async chat's final outcome.

### C. Manual run (skill + user)
- `schedulerTasks.ts` run handler: handle `skill.*` ids — resolve the skill, fire
  `/<skill-name>` via `startChat(origin:"skill")`, and `recordExternalRun(trigger:"manual")`.
  Keep user-task run; record its run too. Client already shows Run for user; add Run for
  skill (drop the `origin==='user'` gate on the run button; keep edit/delete user-only).

### D. Docs
- Document `schedule:` `HH:MM` is UTC + a JST example, in the SKILL.md scheduling docs and
  `packages/core/assets/helps/error-recovery.md` (agent-visible).

## Out of scope / follow-up
- Live file-watch of SKILL.md schedule changes (still restart/refresh-triggered).
- Timezone-aware daily schedules (kept UTC; only documented).

## Tests
- `server`: list includes skill origin; run handles `skill.*`.
- `packages/core`: `recordExternalRun` writes log + state; `getSchedulerTaskState`.
- client: Run button shows for skill+user; skill badge renders.
