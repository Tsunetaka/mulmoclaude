# MulmoClaude — Product Hunt Launch Strategy (v2 — "The Assistant You Nurture")

> **Canonical launch plan.** This file is the single source of truth for the Product Hunt launch. It supersedes the Collections-centered v1 of this file (June 2026, in git history) — the positioning has changed, not just the date. **Source of truth for the vision:** `../mulmo-p/mulmoclaude/vision/the-assistant-you-nurture_ja.txt`. The center is no longer a mechanism (Collections / "AI-native database"); it is a relationship: **an AI assistant that knows everything about you cannot be bought — the only way to get one is to grow it yourself, and MulmoClaude is the field you grow it in.** Collections, the wiki, the scheduler, and the bridges are now *how the nurturing happens* — evidence, not the headline. The "AI-native database" category bet and the Karpathy/DSL-as-harness lead are retired from PH surfaces (the harness thesis survives for HN comments and the blog only). The HN launch already ran with little traction (`plans/done/launch-hn.md`); **PH stands alone.**

**Owner:** Satoshi (strategy + maker post), Engineering (demo assets + activation path), Community (day-of ops)
**Target launch:** **Tuesday, August 4, 2026 — 12:01 AM PT kickoff** (today is 2026-07-13; this gives ~3 weeks of asset build. Slip to August 11 if the activation path (§10.5) isn't ready — do not launch without it.)
**Install / CTA (verified):** `npx mulmoclaude` — the published one-command launcher. *(`npx create-mulmoclaude` does not exist; never ship it.)*

---

## 0. Positioning — the assistant you grow; harvest first, seed second (read this first)

**The vision in one paragraph (from the vision doc):** everyone imagines an AI assistant that knows everything about them and supports their work and life around the clock. That assistant is not for sale anywhere. The device (glasses, phone, watch) is only a doorway; the model (GPT, Claude) is only the engine. What makes an assistant valuable is **how much it knows about you** — your conversations, calendar, contacts, notes, and the apps you use. Every major AI company knows this, which is why they are all racing to accumulate your memory — and that is exactly why something this important should not be entrusted to one company. **The only assistant worth having is one you grow yourself, on your own machine.** MulmoClaude is the field (畑): empty at install, cultivated by conversation.

**On every 3-second surface — headline, hero-video cold open, tweet #1 — prove the claim "you can't buy this" by SHOWING a grown assistant doing something no fresh chatbot could, then reveal how cheap the seed was:**

> A three-week-old assistant answers *"what did I spend on client dinners this quarter, and which restaurant should I book for Friday?"* — composing across an invoice tracker and a restaurant list **it built itself when its owner asked**, weeks apart, in plain conversation. Smash-cut back to Day 1: an empty folder, one sentence — *"build me an invoice tracker"* — and the app appears.

That is the hook, and it has **two beats in a fixed order: harvest → seed.** The harvest (a personal assistant that visibly *knows you*) is the thing money can't buy — it earns the stop-scroll. The seed (you got there just by asking; no code, no setup per app) is what makes it feel attainable — it earns the try. Reversing the order ("look, it builds apps!") re-enters the crowded app-builder category we are deliberately leaving. **On any moving surface (hero video, 15s loop), land both beats inside the first 15 seconds.** Never open with abstractions ("memory architecture," "schema," "DSL," "harness," "local-first") — show a grown assistant; the theory comes after.

**The one thing at the center: the assistant, and the fact that you grow it.** Everything else radiates from that:

- **It grows by conversation.** Ask for an app — a restaurant list, an invoice tracker, a vocabulary trainer — and it appears, no code, no plugin, no awareness of code at all. (Programmers call letting AI write code "vibe coding"; here you don't even see the code.) Each app is a small, one-person tool that was economically unthinkable to build before AI drove software cost to ~zero.
- **Everything it learns stays.** Conversations become a cross-linked wiki; structured data lives in the apps it built; nothing evaporates between sessions. A week in, it answers from *your* accumulated context. A month in, it composes across it.
- **It's with you everywhere.** Log in with the same ID from your phone and your PC and you reach the same assistant — the relay server only forwards messages and stores no data or apps. Later: glasses, headsets. The assistant's home is your machine; the devices are doorways.
- **It works while you sleep.** Scheduled sources, morning briefings, due-date nudges — the field keeps growing between visits.
- **It cannot be taken from you.** Plain Markdown/JSON in one local folder, git-friendly, open source (MIT). The anti-lock-in argument is not feature #4 anymore — it is the founding rationale, stated early and plainly.

**The honest tension this framing creates (name it, don't hide it):** PH rewards instant gratification; nurturing pays off over weeks. An "empty field at install" is the truth and the anti-demo. **Resolution, in order:** (1) the demo shows the *grown* state, time-lapsed — never the empty field alone; (2) the activation path (§10.5) is a tour of a mature, 30-day-old assistant, not a blank install; (3) onboarding promises a **"first seed in 5 minutes"** — one ask, one app, one thing remembered — so Day 1 has its own payoff.

**Audience tension #2 — consumer vision, dev channels.** The vision speaks to everyone ("no programming knowledge needed"), but day-one voters are Claude power users and self-hosters. **Resolution:** the anti-lock-in half of the vision is *native* to engineers — "every AI company is racing to own your memory; yours should live on your disk" lands harder on HN/r/selfhosted than any feature. To engineers, frame it as: *"self-host the memory layer every AI company wants to rent you — and let the agent grow its own tools inside it."* The consumer surface stays warm ("grow your own"); the dev surface leads with sovereignty. Phase-2 audiences (productivity, knowledge workers, enterprise) arrive later. **JP is no longer phase-2** — the vision doc is a Japanese narration script and Satoshi's JP audience is strong; JP gets its own first-class beat (§8).

**2026 reality check:** app generation, rich output, mobile AI, sandboxing are **commoditized** — never lead with any of them. Even "ask → app appears" is now table stakes as a *demo* (Lovable/Bolt/V0 do a version of it); what they cannot say is *"and three weeks later it's part of an assistant that knows you."* Always attach the growth clause.

---

## 1. Taglines & category

### Product Hunt listing fields

- **Name / headline (≤60) — FINAL:** `MulmoClaude — The assistant you can't buy. Grow yours.` *(55 chars)*
- **Tagline (≤60) — FINAL:** `It learns you, builds your apps, and lives on your machine.` *(59 chars)*

*Pairing logic:* the **headline** states the vision's thesis as a provocation — *"you can't buy it"* stops the scroll (every reader assumes AI assistants are exactly the thing you CAN buy), and *"grow yours"* is the resolution and the invitation in two words. The **tagline** then makes "grow" concrete in three verbs: *learns you* (memory), *builds your apps* (extend by asking), *lives on your machine* (ownership / anti-lock-in). The arc is **provocation → resolution → the three concrete things it means.**

**Why the headline leads with the negation.** "Personal AI assistant" is the most crowded phrase of 2026 — Siri, Alexa, Copilot, Meta AI all claim it, and a viewer who sees only "AI assistant" scrolls. The negation *"you can't buy"* is simultaneously true (no vendor sells an assistant pre-loaded with *your* life), differentiating (it disqualifies every incumbent in four words), and an argument (it implies the memory-race critique without stating it). "Grow yours" then names the only path — which happens to be our product.

**Headline — locked for the listing. Alternates kept only for social A/B (the PH name is one field):**

| | Headline | Note |
|---|---|---|
| **Chosen** | `The assistant you can't buy. Grow yours.` | Provocation + resolution; the vision's ¶1 in eight words |
| alt | `Grow an AI assistant that's actually yours` | Warmer; loses the stop-scroll negation |
| alt | `Your AI assistant should live on your machine` | Sovereignty-first; best for HN/r/selfhosted, colder on PH |
| alt | `Ask for an app. It becomes memory.` | v1 headline — the app-gen control; kept for A/B only |

**Tagline — locked. Alternates for social A/B:**

| | Tagline | Note |
|---|---|---|
| **Chosen** | `It learns you, builds your apps, and lives on your machine.` | Three verbs = the three pillars, concrete |
| alt | `Memory, apps, and data that grow with every conversation.` | Growth-forward; softer on ownership |
| alt | `An open-source field where your AI assistant grows.` | The 畑 metaphor, literal; may read twee in English |
| alt | `Every AI company wants to own your memory. Keep it.` | The sovereignty knife; use on X/HN, not PH |

### The positioning bet — "the assistant you grow," not "AI app builder" and not "AI assistant"

Both adjacent categories are knife fights: **"AI app builder"** (Lovable, Bolt, V0, Replit) and **"AI assistant"** (Siri, Alexa, Copilot, ChatGPT). The uncontested ground is the *conjunction* the vision identifies: **an assistant whose value comes from accumulated personal context, grown by its owner, on hardware its owner controls.** No incumbent can follow — their business model *is* the accumulation happening on their servers.

> The value of an AI assistant is not the model's IQ — models are rented engines, the same for everyone. The value is **how much it knows about you**, and that is precisely the asset you should never build inside someone else's walled garden. Growing it at home is the product.

**How to deploy it:**
- **PH / consumer surfaces:** warm phrasing — *grow, nurture, yours, it knows you.* The critique of the memory race appears once, in the maker post, as motivation — not as a crusade.
- **HN / dev / self-hosted surfaces:** lead with sovereignty — *"self-host the memory layer,"* the memory-race critique in full, files as plain text, relay-stores-nothing. The DSL-as-harness thesis (`docs/papers/dsl-as-harness.md`) lives here, in comments and the blog — never on PH.
- **Don't overclaim:** we are not shipping AGI-your-butler. The claim is narrow and true — *a home for an assistant that accumulates memory, data, and self-built apps as plain files you own, reachable from any device.*

### Supporting taglines (A/B for social + hero imagery)

1. *Day 1: an empty folder. Day 30: an assistant that knows your clients, your deadlines, your restaurants. You grew it.*
2. *"Build me an invoice tracker." It builds one — and remembers every invoice after. No code. Not even vibe coding.*
3. *A restaurant list, an invoice tracker, a vocabulary trainer — apps for one person, built by asking. Impossible economics until now.*
4. *Same assistant from your phone and your laptop. The relay carries messages; your data never leaves home.* **(bridges, reframed as "one assistant, many doorways".)**
5. *Every AI company is racing to remember you. The winner shouldn't be a company.* **(sovereignty line — HN, X-dev.)*
6. *`~/mulmoclaude/` — your assistant's whole life, in plain files, in one folder, in your `git log`.* **(geek-targeted: HN, X-dev, terminal-native.)**

### Category

Primary **Artificial Intelligence** · Secondary **Open Source** · Tertiary **Developer Tools**. *(Changed from v1, which led with Developer Tools: the pitch is no longer a dev tool — it's a personal assistant — but day-one voters are still developers, so we keep Dev Tools third and reach engineers through channels (HN, r/ClaudeAI, r/selfhosted) rather than PH category. Skip Productivity and Privacy — the anti-lock-in message rides inside AI/Open Source; a Privacy tag attracts a compliance-minded audience we can't serve yet.)*

---

## 2. The one-sentence pitch

**MulmoClaude is an open-source home on your own computer where you grow a personal AI assistant — it builds the apps you ask for in plain conversation (no code), remembers everything in a wiki and in those apps' own data, works on a schedule while you're away, and is reachable from your phone through a relay that stores nothing — all of it plain files in one folder that no company can take from you.**

Clauses in the order a viewer asks them: *What is it? → How does it grow? → Does it persist? → Can I reach it? → Whose is it?* The center of every clause is the assistant; each product mechanism appears only as the answer to one of those questions.

### The anti-wrapper line (use whenever "is it just a ChatGPT clone?" appears)

> **This doesn't call the Claude API. It runs Claude Code directly — your auth, your tools, your files, your environment. The host contains zero domain code; every app is something you or the assistant grew.**

Repeat verbatim in the maker post, any HN relaunch, and tweet #1.

---

## 3. Why this wins on Product Hunt

| Hunt instinct | MulmoClaude's answer |
| --- | --- |
| "Another AI assistant?" | The ones you're thinking of are rented — they live on someone's servers and know only what that vendor lets them keep. **This one you grow at home, and it knows what YOU'VE fed it — which is everything.** |
| "Another AI app builder?" | App-gen is the *seed*, not the product. Lovable/Bolt build you an app and wave goodbye. Here the app joins an assistant that reads it back tomorrow — **the app becomes part of something that knows you.** |
| "Isn't ChatGPT Memory the same?" | ChatGPT's memory is a curated bullet list on OpenAI's servers. This is your entire working context — apps, data, a cross-linked wiki — as plain files on your disk. **And every major AI company racing to add memory is the argument for keeping yours home.** |
| "Another AI chat wrapper?" | No — the anti-wrapper line (§2), verbatim. It runs the Claude Code CLI directly. |
| "What's the moat?" | **Accumulation.** A 30-day-old assistant is worth more than a fresh one, and the delta lives in your folder, not our cloud. Painful to leave — but because it's plain text, *leaving is trivially possible*, which is exactly why you can trust the accumulation. |
| "Why care tomorrow?" | Tomorrow is the whole point: it **works while you sleep** (scheduled briefings, due-date nudges) and every day it knows you a little better. |

---

## 4. Key messages (4, rank-ordered)

A PH viewer remembers **one** idea in ~10 seconds: **you can't buy this assistant — you grow it.** Everything else supports it.

**1. The assistant you grow.** — *Devices are doorways; models are engines. What makes an assistant valuable is how much it knows about you — and that can't be bought, only accumulated.*
Install MulmoClaude and you get an empty field on your own machine. Talk to it: it builds the apps you need, files what it learns into a cross-linked wiki, and keeps every record in plain files. A week in, it answers from your context; a month in, it composes across it — *"which client dinner should I expense, and where should I book Friday?"* answered from an invoice tracker and a restaurant list it built itself, weeks apart. **No vendor can sell you this, because the value is your accumulated life, not their software. This is the center — lead every PH surface with it.**
- *The memory race, named once:* OpenAI, Anthropic, Meta, Google are all bolting memory onto their assistants — because they know the same thing we do. That race is why the accumulation should happen on your disk, not theirs.
- *The divide:* the gap in the AI era won't be who rents the smartest model (everyone rents the same ones) — it's who has grown an assistant that actually understands them.

**2. It grows by conversation — apps included.** — *"Build me an invoice tracker" → a real app appears, no code, and it's part of the assistant from then on.*
Need a tool? Ask. A restaurant list, an invoice tracker, a vocabulary trainer — fields, computed totals, action buttons appear from one sentence; the host renders table / kanban / calendar views for free. Programmers call letting AI write code "vibe coding" — here you never see code at all. One-person apps were economically absurd until AI pushed the cost of software to ~zero; MulmoClaude is that new economics, on your desk.
- *The growth clause — always attached:* the app isn't a throwaway artifact (that's the app-builder category); it's a new organ of the assistant. It reads the app's data back tomorrow. Records reference each other; derived values update across apps (`value = shares × ticker.price` — change one quote, the whole portfolio revalues, no sync code).
- *vs Lovable / Bolt / V0:* they generate and hand off. Here generation is a growth event in a persistent assistant.
- *vs Airtable / Notion / Retool:* no-code, but an engineer designs the environment and no agent lives inside. Here you describe what you want and the assistant both builds and *operates* it.
- *Engineer framing:* you stop writing a plugin per feature — you describe a schema, the agent runs inside it.

**3. One assistant, every doorway — and it works while you sleep.** — *Your phone and your PC log into the same assistant. The relay carries messages; your data never leaves home.*
Log in with the same ID from your phone and reach the assistant living on your PC — from the train, from the sofa. The relay server forwards and stores nothing: no data, no apps, no memory in anyone's cloud. Meanwhile the field grows on schedule: register a source → a morning briefing is waiting; declare a recurring obligation → a nudge before each due date, rolling to the next cycle. Someday: glasses, headsets — more doorways to the same home.
- *vs device-resident assistants (Siri, Alexa, glasses):* the doorway isn't the assistant. Swap devices freely; the assistant stays whole.
- *vs one-shot agents (Devin, Codex, bare Claude Code):* they stop when you close the lid. This one has a calendar.

**4. Impossible to lock in.** — *Plain Markdown/JSON in `~/mulmoclaude/`. Git-friendly. Open source, MIT. Leaving is trivially easy — which is why staying is safe.*
Every conversation, wiki page, app schema, and record is a plain-text file in one folder. `git push` is the backup; any editor opens it; it'll read fine in 10 years. Open source means no company — including us — can wall it off. This isn't a feature; it's the reason the project exists (§0): an assistant this important must not be a rental.
- Sandbox (Docker, auto-detected) folds in here — Claude sees only the workspace; SSH keys, `.env`, home dir invisible. It's *how* "your machine, your data" stays honest.

### Visual hooks (demo bangers, not messages)

- **The harvest.** A 30-day-old assistant answers a compound personal question from two apps it built itself. The single most differentiated thing we can show — no app builder and no chatbot can replicate the shot. Use as the cold open everywhere.
- **The seed.** *"Build me an invoice tracker"* → a real app materializes in seconds. Familiar magic (that's fine — it's the on-ramp, and we always cut FROM the harvest TO the seed, never the reverse).
- **The doorway.** Send a message from a phone on the street; watch the answer draw on the laptop at home — same assistant, and a caption: *"the relay stores nothing."*
- **One quote → whole portfolio revalues** (`value = shares × ticker.price`). Depth proof that the apps are real, kept for 0:20+.

### Kept in reserve (table stakes — FAQ fuel, never the lead)

App generation as a standalone trick, multi-modal output (charts/forms/3D/narrated video — surface when asked "what can it show?"), Docker sandbox (absorbed into msg #4), Telegram/Slack/Discord/LINE bridges (absorbed into msg #3 as "doorways"), roles / skills / parallel sessions (comment-thread fuel), the DSL-as-harness thesis (HN comments + blog only).

---

## 5. Product Hunt listing copy

### Description (≤260 chars)

> The AI assistant that knows everything about you isn't for sale — you grow it. MulmoClaude is its home on your machine: it builds apps you ask for (no code), remembers everything, and stays yours — plain files, open source. `npx mulmoclaude`

*(~244 chars. Provocation → resolution → the three pillars → install.)*

### Topics

Artificial Intelligence (primary) · Open Source · Developer Tools *(order changed from v1 — see §1 Category.)*

### Maker's first comment (pinned — goes up within 90 seconds)

```
Hi Product Hunt 👋

I'm Satoshi Nakajima. I spent thirteen and a half years at Microsoft
working on operating systems (lead architect on early Windows
releases). For the past year I've been chasing one question — and it's
not "what's the best AI assistant?" It's: **why can't you buy the one
you actually want?**

Everyone imagines the same assistant: it knows your work, your
schedule, your clients, your habits, and it's there 24/7. Nobody sells
that — because its value isn't the model (we all rent the same
engines) or the device (a phone is a doorway, not a resident). Its
value is *how much it knows about you*. Which is exactly why every AI
company is now racing to bolt "memory" onto their chatbots: whoever
accumulates your context wins.

I think letting that accumulation happen on some company's servers is
a mistake you only get to make once. So I built the alternative:

**MulmoClaude is a home on your own computer where you grow your
assistant yourself.** It's empty when you install it — like a field
before planting. Then:

**1. It grows by conversation.** Need a tool? Ask. "Build me an
invoice tracker" and a real app appears — fields, computed totals, an
action button — no code, no plugin. A restaurant list, a vocabulary
trainer, a portfolio: each is a tiny schema the assistant authors and
then *operates*. My holdings carry `value = shares × ticker.price`
into my quotes data — update one quote, everything revalues. I didn't
code that; I asked for it. (Programmers call AI-written code "vibe
coding" — here you never see code at all.)

**2. Everything it learns stays — and compounds.** The apps it builds
become its structured memory; a cross-linked wiki grows from every
chat as the unstructured half. Ask something three weeks later and it
answers from YOUR context — composing across apps it built on
different days. That's the thing no vendor can sell you, because the
valuable part is your accumulated life, not their software.

**3. It's yours in the strongest sense.** Everything — apps, records,
wiki, history — is plain Markdown/JSON in ~/mulmoclaude/. Git-friendly,
readable in any editor, readable in ten years. Open source, MIT.
Leaving would be trivially easy, which is exactly why you can trust
staying. And you can reach the same assistant from your phone: the
relay server only forwards messages — it stores no data, no apps,
nothing.

Two details that matter:
- **Not a wrapper.** It doesn't call the Claude API — it runs the
  actual Claude Code CLI: your auth, your filesystem, your skills,
  your MCP servers. That's why it can do what it does.
- **Sandboxed by default.** Claude runs in a Docker container that
  only sees your workspace. SSH keys, .env, home dir — invisible.
  Auto-detected, no config.

Install: `npx mulmoclaude` (needs Node 20+ and the Claude Code CLI
authenticated). Your field will be empty for about five minutes —
then you plant the first seed, and it never forgets it.

The gap that's opening right now isn't between people with AI and
people without. Everyone will rent the same models. It's between
people who've grown an assistant that understands them and people
still typing into a blank chatbot. Start growing yours today — I'd
love your honest feedback.

— Satoshi
```

### Gallery captions (one per screenshot — 6 shots, no orphans)

1. **Hook — the harvest (msg #1)** — "Day 30: ask one question, get an answer composed from apps your assistant built itself — weeks apart, from plain conversation. You can't buy this. You grew it."
2. **The seed (msg #2)** — "Day 1: 'build me an invoice tracker.' A real app appears — fields, computed totals, an action button. No code. Not even vibe coding."
3. **It compounds (msg #1/#2)** — "Every app becomes memory; a cross-linked wiki grows from every chat. Fresh chatbots start from zero. Yours starts from everything you've grown."
4. **Works while you sleep (msg #3)** — "Register a source → a morning briefing is waiting. Declare a recurring obligation → it nudges you before each due date and rolls to the next cycle."
5. **Every doorway, one home (msg #3)** — "Phone on the train, laptop at home — same assistant, same memory. The relay carries messages and stores nothing."
6. **Impossible to lock in (msg #4)** — "Your assistant's whole life is plain text in `~/mulmoclaude/`. Git-friendly, MIT, sandboxed in Docker. Runs the Claude Code CLI directly — not a wrapper."

---

## 6. Demo video plan

Three videos, different channels. **Always record silent first; add one narration pass; ship captions. Zero spinner time — pre-render, splice, never wait.** New structural rule for v2: **every video is a time-lapse** — the nurture story is inherently temporal, so date overlays ("Day 1," "Day 9," "Day 30") are the connective tissue of every cut. Pre-seed a real workspace with ~30 days of plausible growth; never fake file contents (viewers freeze-frame).

### Video A — 60s hero (PH gallery + X)

- **Goal:** one upvote per viewer. No feature-listing.
- **One money window — the first 15 seconds ARE the headline.** The headline claims *you can't buy this* and *you can grow it* — so the opener must prove both, in that order: **harvest first, seed second.** If a viewer watches only 15 seconds they must think "that assistant genuinely knows that person" AND "…and it started from one sentence." Opening with the seed (app-gen) re-enters the app-builder category; opening with the harvest and never showing the seed makes it look like months of manual setup. Both beats, harvest→seed, inside 0:15.
- **0:00–0:15 — THE loop (the shot the whole video lives or dies on):**
  - 0:00–0:08 — overlay *"Day 30."* One chat message: *"what did I spend on client dinners this quarter — and book somewhere for Friday."* The assistant answers with a computed total from the invoice tracker and picks from the restaurant list, both visible as real app surfaces. Caption: *"You can't buy an assistant that knows you."*
  - 0:08–0:15 — smash-cut overlay *"Day 1."* An empty folder; the user types *"build me an invoice tracker"*; the app materializes (fields, live total, action button). Caption: *"You grow one."*
- 0:15–0:25 — growth montage, date overlays advancing: wiki backlinks appearing after a chat (Day 3) → a second app born from a sentence (Day 9) → one quote edited, whole portfolio revalues (Day 14). Caption: *"Every conversation makes it more yours."*
- 0:25–0:35 — the doorway: a phone (on the street, or LINE/Telegram UI) sends a task; the laptop canvas updates. Caption: *"Same assistant from every device. The relay stores nothing."*
- 0:35–0:45 — while-you-sleep + ownership: a scheduled morning briefing waiting at 7am; Finder opens `~/mulmoclaude/` showing plain Markdown + `schema.json`; a `git push` scrolls by. Caption: *"It works while you sleep. All of it, plain files, yours."*
- 0:45–0:52 — anti-wrapper frame: *"Not an API wrapper. Claude Code, directly. Open source, MIT."*
- 0:52–1:00 — Logo + `npx mulmoclaude` + github URL + closing caption: *"Plant the first seed today."* *(Swap first line to "tour a grown assistant in your browser" if the hosted demo (§10.5) ships.)*
- **Notes:** 1080p, 24fps, monospace captions, date overlays in one consistent style, one lo-fi track at 40% cut at 0:52. The **0:00–0:15 harvest→seed cut is THE shot** — rehearse cold, shoot several takes, pick the crispest; the rest is B-roll by comparison. The Day-30 answer must render with zero spinner (pre-seed the workspace; splice if needed).

### Video B — 3-min deep-dive (YouTube + landing)

- **Arc:** *Why can't you buy it? → How does it grow? → Show me 30 days → Can I reach it anywhere? → Can I trust it?*
- 0:00–0:25 — Satoshi voice, talking-head inset: "I was an OS architect at Microsoft. The assistant everyone wants isn't for sale — because its value is how much it knows about *you*, and every AI company wants that accumulation on THEIR servers. I built the version where it happens on yours."
- 0:25–1:10 — **Growing, day by day:** Day 1 install (empty field, honestly shown for 3 seconds) → first ask → invoice tracker appears → "the first seed takes five minutes." Day 3: a chat about a client leaves wiki backlinks behind. Day 9: restaurant list born from one sentence.
- 1:10–1:50 — **The compounding:** Day 14 — a `ref` links invoices to clients; a `derived` field revalues the portfolio when one quote changes; flip the same app between table/kanban/calendar. Call out: *no code anywhere; the assistant authors and operates its own tools.*
- 1:50–2:20 — **The harvest + the doorway:** Day 30 — the compound question answered across apps; then the same assistant answering from a phone, with the relay-stores-nothing line on screen.
- 2:20–2:45 — Trust: Docker sandbox banner; Claude *unable* to read a file outside the workspace; `~/mulmoclaude/` in a plain editor; anti-wrapper line on screen.
- 2:45–3:00 — "The gap won't be who rents the smartest model — it's who's grown an assistant that understands them." `npx mulmoclaude` + github.

### Video C — 15s loop (IG / LinkedIn / PH gallery motion, muted)

Three variants: **(a)** the headline loop — *Day 30 harvest → Day 1 seed → "Grow yours"* (this IS the PH cut; it must prove both halves of the headline), **(b)** phone→laptop doorway round-trip, **(c)** one quote → portfolio revalues. Use (a) for PH; post the others launch day.

### Filming checklist (all videos)

Pre-seed one canonical "30-day workspace" and reuse it across all three videos (consistency survives freeze-framing); clean visual state; 1920×1080 min, H.264 8 Mbps; pre-compose all prompts in a file and paste (no live typing); dry-run on the exact network Claude will hit (latency is the #1 demo killer); cut any render wait >8s; date overlays from one template.

---

## 7. Launch-week timeline (T = August 4, 2026)

### T-21 to T-8 (now → ~July 27) — Asset build

- [ ] **Decide & build the activation path (§10.5) — this is the critical path; nothing else matters if it slips.**
- [ ] **Build the canonical 30-day demo workspace** (invoice tracker + restaurant list + portfolio + wiki with real backlinks + a scheduled briefing) — every video, screenshot, and the hosted tour reuses it
- [ ] Hero video, 3-min video, 3× 15s loops, 6 screenshots
- [ ] **Ship the "first seed in 5 minutes" onboarding** — post-install, the assistant proactively offers to build a first app and remember one fact; without it the empty field kills Day-1 retention
- [ ] Verify `npx mulmoclaude` boots clean on fresh macOS, Windows (WSL + PowerShell), Ubuntu — fix any first-run friction; confirm the Claude Code CLI auth pre-flight is friendly
- [ ] Register/refresh PH account, link to X, warm up with 2 comments on other launches
- [ ] Line up **4 hunters/commenters**; brief them with a 5-min Loom
- [ ] Draft all tweets, Reddit posts, optional Show HN relaunch copy, JP maker post + Note article
- [ ] **Record the baseline** (current GitHub stars, npm weekly downloads, X following) so §11 metrics are measurable

### T-4 (~July 31) — Warm-up

- [ ] Publish the thesis blog post: *"The assistant you can't buy — why personal AI memory must live on your machine."* Source from the vision doc; the memory-race argument in full; the DSL-as-harness material (`docs/papers/dsl-as-harness.md`) as a technical appendix, not the lead. The intellectual anchor for HN comments.
- [ ] **Produce the JP video from the vision narration script** (`the-assistant-you-nurture_ja.txt` is already a 12-paragraph narration — it IS the JP script; render via MulmoScript/MulmoCast for a dogfooding story) and draft the Note post around it
- [ ] Stage the PH listing in Maker Studio (do **not** publish)
- [ ] DM ~10 Claude power users for a launch-morning try + honest feedback

### T-0 (August 4) — Launch day (all times PT)

- **00:01** — Publish on PH; first comment within 90s
- **00:05** — X thread (7 tweets: harvest→seed hook → 4 messages → anti-wrapper → CTA). Pin it.
- **00:10** — Mastodon + Bluesky cross-post (adapted)
- **01:00** — *(optional)* fresh "Show HN: MulmoClaude — grow a personal AI assistant on your own machine." Only if the prior HN run is stale enough to re-submit; the sovereignty angle is genuinely new vs the old framing.
- **06:00** — Reddit: r/selfhosted first (the anti-lock-in framing is native there — a build log, "why I self-host my AI assistant's memory"), then r/ClaudeAI (value-first build log). PH link one line at the bottom of each.
- **09:00 / 12:00 / 15:00 / 18:00** — Reply to **every** PH comment within 30 min. Non-negotiable.
- **17:00** — Mid-day check: if not top-10, post the phone→laptop doorway clip and tag @ProductHunt
- **21:00** — Thank-you post regardless of placement; name top commenters
- **JP (first-class this time):** JP launch tweet + Note post + JP video at **09:00 JST (= 17:00 PT the prior day, Aug 3)** to catch the APAC window and feed early votes into the PH morning

### T+1 to T+7 — Compound

Newsletter sends (dev.to, Hacker Newsletter, TLDR Dev); a "day after — what we learned" post; pitch the Changelog / Latent Space / Anthropic community call; **LinkedIn at T+3** (phase-2 productivity audience — skip on day one); **T+7: a "my assistant at day 7" thread** — the nurture framing uniquely supports a follow-up beat no app-builder launch gets (show YOUR field growing since launch day).

---

## 8. Channel-by-channel playbook

### X / Twitter — launch thread (7 tweets)

1. **[Hook — the harvest→seed GIF: Day 30 answer → Day 1 empty folder → app appears]** *"Day 30: my AI assistant answered a question by composing across two apps it built itself — from my own data. Day 1: an empty folder and one sentence. You can't buy an assistant that knows you. You grow one. Live on Product Hunt today. 🧵"*
2. **[msg #1 — the thesis]** *The value of an AI assistant isn't the model — we all rent the same engines. It's how much it knows about YOU. That's why every AI company is bolting on "memory." And it's why yours should accumulate on your disk, not their servers. [folder gif]*
3. **[msg #2 — it grows by talking]** *"Build me an invoice tracker" → a real app appears. No code — not even vibe coding. Each app joins the assistant's memory: update one stock quote, the whole portfolio revalues. A restaurant list, a vocab trainer, a CRM — one-person apps, finally economical. [seed gif]*
4. **[msg #3 — doorways]** *Your phone and laptop log into the SAME assistant. The relay server forwards messages and stores nothing — no data, no apps, nothing in anyone's cloud. Fire a task from the train; the answer is on your laptop at home. [doorway gif]*
5. **[msg #4 — ownership]** *Your assistant's entire life — apps, records, wiki, history — is plain Markdown/JSON in `~/mulmoclaude/`. `git push` is the backup. Open source, MIT. Leaving is trivially easy, which is exactly why staying is safe. [files gif]*
6. **[Anti-wrapper]** *Not an API wrapper. It runs the Claude Code CLI directly — your auth, your tools, your files — and the host contains zero domain code. That's why it can do what it does.*
7. **[CTA]** *The gap of the AI era: people who grew an assistant that understands them vs people typing into blank chatbots. Start today: `npx mulmoclaude` — open source, MIT. One upvote costs nothing and means everything: [link]* *(swap first clause for the hosted tour URL if §10.5 ships.)*

### Hacker News *(only if relaunching)*

**Title:** `Show HN: MulmoClaude – grow a personal AI assistant on your own machine`
**Opening:** *"Every AI company is racing to add 'memory' because they know an assistant's value is how much it knows about you. I think that accumulation belongs on your disk. MulmoClaude is an open-source home where an assistant grows by conversation — it builds its own apps from schemas when you ask (no code), files what it learns into a cross-linked wiki, and everything is plain Markdown/JSON in one folder."* Then the technical meat HN wants: runs the Claude Code CLI directly (not the API), relay-stores-nothing architecture for mobile access, Docker sandbox, and — for the comments — the DSL-as-harness thesis (`docs/papers/dsl-as-harness.md`): a schema is a harness the user authors and the agent executes. The prior HN run got little traction — only relaunch with the sovereignty angle, which is genuinely new; do not re-run the platform/shell framing.

### Reddit (r/selfhosted, r/ClaudeAI, r/LocalLLaMA)

**r/selfhosted is now the primary Reddit beat** (moved up from v1): *"I self-host my AI assistant's memory — here's why and how."* The anti-lock-in argument is that community's native tongue; the relay-stores-nothing design and plain-files store are exactly what they audit for. r/ClaudeAI gets the build-log angle (*"I gave Claude Code a home and it's been growing for a month"*). Value-first, PH link one line at the bottom.

### Japanese community (Note, X-JP) — first-class, not phase-2

*(JP edition of this plan — including the JP maker post and JP tweet thread — lives in [`launch-product-hunt-ja.md`](launch-product-hunt-ja.md); this English file remains canonical.)*

The vision doc **is** the JP narration script — 12 paragraphs, already in launch-ready voice. Produce the JP video directly from it (via MulmoScript/MulmoCast — the dogfooding story is itself a tweet). Note article = the script in prose + the video embedded. JP maker-post translation follows the §5 comment but may run closer to the vision text verbatim (it's the origin document). JP beat fires **09:00 JST Aug 3 evening PT** to feed the PH morning (§7).

---

## 9. Hunters & community seed list

- **Hunter:** someone with 5k+ PH followers in the Claude/LLM space; self-hunt if none (Satoshi's network is strong enough).
- **Seed voters:** ~50 people who starred the repo or engaged with MulmoChat — DM a Monday-evening reminder.
- **Commenter priming:** 4–6 people leaving substantive comments at hours 1/3/6/9 (PH weights comment velocity + diversity, not just upvotes). Brief them on the framing: comments should mention what THEY grew ("mine tracks my reading list") — testimony of nurturing beats generic praise.

---

## 10. Risks & mitigations

| Risk | Prob | Mitigation |
| --- | --- | --- |
| **Cold start — "empty field" is the anti-demo** | **High** | Never show the empty state except as the Day-1 beat of a time-lapse. All assets lead with the grown (Day-30) workspace. Ship "first seed in 5 minutes" onboarding so real installs get a Day-1 payoff. |
| **Activation gap — setup too heavy for PH day** | **High** | **Commit to an activation path by T-10 (§10.5).** `npx mulmoclaude` alone (Node + Claude CLI auth + Docker) ≈ 50% drop-off. **Do not launch without one.** |
| "Another AI assistant" scroll-past | Medium | The headline's negation ("you can't buy") + the harvest shot in the first 3 seconds. Never open on a chat UI that looks like ChatGPT. |
| "It's just a wrapper" | Medium | Lead with the anti-wrapper line verbatim; zero-host-code proof. |
| Claude Code CLI auth fails on first run | Medium | In-app pre-flight check + friendly error page linking to Claude Code docs. |
| Nurture framing reads "consumer" to dev voters | Medium | Sovereignty framing on dev surfaces (§0): "self-host the memory layer every AI company wants to rent you." r/selfhosted first. |
| Privacy skeptics probe the relay | Medium | Have the relay architecture doc ready to link; the "stores nothing, forwards only" claim must be verifiable in the open-source code before launch day. |
| Demo latency from live Claude calls | Medium | Pre-record, splice, never show >3s of spinner. |
| Cognitive overload (too many features) | Medium | Hold the 4 rank-ordered messages; rest in reserve. Don't let screenshots creep the list back. |
| Anthropic ships memory/GUI the same week | Low-Med | It *confirms* the thesis — "even Anthropic agrees memory is the game; here's the version you own." Pre-draft the response. |
| MIT + Docker read as "hacker tool" | Low | Reframe: sandbox = *"the care something living in your home deserves"*; MIT = *"fork it, ship it, it's yours."* |

### 10.5 The activation problem — solve this or lose the day

Still the single biggest gap, and the nurture framing raises the stakes: the product's payoff is inherently *cumulative*, so a blank first-run experience contradicts the entire pitch. Even with `npx mulmoclaude`, the path is Node + Claude CLI auth + Docker — 5–10 min, developer-only, zero mobile. PH rewards instant gratification; without a zero-install taste of a GROWN assistant, upvotes spike mid-morning and momentum dies by afternoon.

**Three options, ranked (A reworked for v2):**

**A (strongly recommended — NOT yet built): hosted tour of a 30-day-old assistant.** The canonical demo workspace (§7), hosted read-only: visitors walk through ~10 prepared sessions in browser — the Day-30 harvest answer first, then the Day-1 seed replay, the portfolio revalue, a wiki with real backlinks, a scheduler catch-up, the phone round-trip as a replay. Click-through + canvas replay — no typing, auth, key, or Docker. This is stronger under v2 than v1: the tour *is* the proof that nurturing pays, which no install-first experience can show on day one. Budget ~3 eng-days + hosting; reserve a subdomain + VM at T-10. If shipped, every CTA becomes *"tour a grown assistant in your browser."*

**B (minimum viable): `--demo` replay mode.** `npx mulmoclaude --demo` boots into the pre-grown workspace with recorded sessions in ~30s — no Claude auth, no keys. Halves drop-off; loses the mobile/zero-install audience.

**C (last resort): scripted screenshot walkthrough on the landing page.** The Day 1 → Day 30 story as a scrolling page. No interactivity, but preserves the time-lapse feeling for skimmers.

**Decision owed by T-10 (July 25): commit to A; fall back to B before touching C. Slip the launch date before launching without one of these.**

---

## 11. Success metrics

**Record the baseline at T-8** (current stars / weekly npm downloads / X following) — every target below is measured as a delta from that line.

- **Day of:** PH **Top 5** (Top 10 floor); GitHub **+500 stars/24h**; activation-path sessions **3,000 unique** (if A/B ships, else N/A); installs (npx launches as proxy) **500** with the tour absorbing casual traffic, **~1,500** if install is the only path; **50+ substantive PH comments**.
- **Week of:** **+1,500 stars cumulative**; (if relaunched) HN front page >2h; **2M+ X impressions**; JP: Note post >10k views + JP video >20k plays (Satoshi's JP audience is a real asset now that JP is first-class); **3+ inbound podcast/interview requests**.
- **Month of:** **2,000 WAU**; **Day-7 retention of installs >25%** (the nurture-specific metric — did the field survive a week?); **5 community-shared "what I grew" posts** (collections/roles/wiki screenshots — the testimony flywheel); one mention by an Anthropic engineer or a major AI commentator (aspirational, trackable).

---

## 12. The two bets

**Bet 1 — prove the headline in the first 15 seconds (earns the upvote).** The headline is *"The assistant you can't buy. Grow yours."* — so the hero video's **0:00–0:15** must show both halves back to back, **harvest first**: a Day-30 assistant answers a compound personal question from apps it built itself → smash-cut to Day 1, an empty folder and one sentence, and the first app appears. Harvest proves "can't buy"; seed proves "you can grow it." Open with the seed alone and we're "another app builder"; show harvest without seed and it looks like months of setup. Both beats, that order, inside 15 seconds — most viewers won't reach 0:40.

**Bet 2 — the activation path (earns the try).** A zero-install way to *experience a grown assistant* (§10.5 A/B/C) plus a "first seed in 5 minutes" onboarding for real installs. Without these, Bet 1's upvote never converts — and the nurture pitch makes a blank first-run actively self-refuting. **Decision owed by T-10 (July 25). This is the unstarted critical-path item — assign an owner now.**

Everything else — bridges, sandbox, roles, multi-modal output, parallel sessions, the harness thesis — is confirmation for a viewer who already believes. Cut anything that doesn't serve a bet.

---

## 13. The story underneath

For HN, long-form, and anyone asking where this goes — the vision doc's argument, plus the leg it stands on:

**Leg one — the assistant is not the device, and not the model.** Glasses, phones, and speakers are doorways; GPT and Claude are engines. Strip both away and what remains — the actual assistant — is the accumulated understanding of one person: their conversations, schedule, contacts, obligations, notes, and tools. Every major AI company has realized this, which is why "memory" features are appearing everywhere at once: the race is not for the smartest model but for the deepest accumulation. And an asset that valuable, that compounding, that *hard to move once it's grown*, is precisely the one you should never build inside someone else's walls.

**Leg two — every AI agent today is homeless.** No persistent filesystem, no schedule, no compounding memory: summoned, work, gone — a function call, not an assistant. MulmoClaude gives the agent a home: `~/mulmoclaude/`. A workshop where new tools grow from conversation (collections), a bookshelf (the wiki), filing cabinets (documents), a calendar (the scheduler), and doorways (the phone bridges, through a relay that keeps nothing). Because it has a home it accumulates; because it accumulates it understands; because it understands it earns trust and autonomy. Memory → compounding → trust → delegation.

The economics underneath: AI has pushed the cost of software toward zero, which makes one-person apps — a restaurant list, an invoice tracker, a vocabulary trainer — viable for the first time in computing history. The user describing what they want *is* the specification, and the assistant is both builder and runtime. (For the technically inclined: the schema the assistant authors is a harness — a small, legible surface the agent operates within. The engineer-facing development of this idea lives in [`docs/papers/dsl-as-harness.md`](../docs/papers/dsl-as-harness.md) and [`docs/papers/collections-architecture.md`](../docs/papers/collections-architecture.md) — comment-thread and blog material, never the PH lead.)

If the launch goes well, we're not celebrating a product — we're naming the divide of the AI era: not who rents the smartest model, but who has grown an assistant that actually understands them. And we're handing people the field.

---

*Canonical PH launch plan (v2, re-anchored on `the-assistant-you-nurture` vision, 2026-07-13). Revise after the asset dry-run at T-7. **Activation-path decision owed at T-10 = July 25 (§10.5) — the critical-path item.** v1 (Collections-centered, June 2026) is in git history; retired earlier drafts: `plans/obsolete/launch-ph-listing.md`, `plans/obsolete/launch-product-hunt-ja.md`. HN run: `plans/done/launch-hn.md`.*
