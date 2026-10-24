# Final Expense Mastery — Design Proposal (v0.2, for approval)

> Status: **design only — nothing implemented.**
> Legend: **[REQ]** = fixed requirement from your spec. **[PROPOSAL]** = my default; every proposal number lives in config and can change without code changes. **[DECIDED]** = settled by your answers to the v0.1 questions.

### Decisions log (v0.1 → v0.2)
| # | Question | Decision |
|---|---|---|
| 1 | Art source | **Pixel art is defined in code**: palette-indexed pixel grids and layered sprite parts, rendered to textures at runtime. No external art assets. |
| 2 | What counts as a sale | **A sale = application submitted.** The sale timestamp is the submission time, which is what the Lightspeed 30-minute window uses. |
| 3 | IP convention | **IP = Issue Paid**, the amount you receive from the sale of a policy, recorded exactly as you report it. |
| 4 | Multi-device | **Not needed now.** Later the site will be hosted, and saves will load by login. v1 stays local-only, but storage sits behind an adapter so a hosted, login-based backend can plug in later. |
| 5 | Practice baseline | **5–8 hours/week** of deliberate practice plus calling is confirmed. The §3.3–3.4 calibration stands. |

---

## 1. Product concept and art direction

### Concept
**Working title: *The Meridian Isles*** [PROPOSAL] — a personal archipelago where each island stands for one part of a Final Expense agent's craft. You start on a small, plain headquarters island surrounded by six troubled islands. Real practice repairs them. Major achievements send a landmark home to HQ, so after a year your headquarters shows your whole history.

Design principles:
1. **Honest tracker, not a slot machine.** All data is self-reported [REQ]. The game never claims to verify competence, and it never treats IP as money [REQ].
2. **Breadth over grinding.** Caps, diminishing returns and breadth gates mean the cheapest way to progress is the way that actually builds skill.
3. **Every number explains itself.** Each XP award has a "Why this XP?" breakdown showing base, weights, diminishing returns and anything blocked.
4. **Clicks, not walking.** Clicking a location opens it right away [REQ]. Your character stands there only as decoration.

### Art direction [PROPOSAL]
- **Style:** 2D pixel art in a three-quarter top-down view. 16×16 base tiles, drawn at a 320×180 logical resolution and scaled by whole numbers (crisp, no blur). Hard pixel edges, limited palettes and soft dithered shading.
- **World map:** Calm ocean with slow animated waves. HQ sits in the center; six islands surround it, each with its own silhouette. Dotted ferry routes link them as decoration.
- **Art pipeline [DECIDED]:** All sprites are code. Each sprite is a small grid of palette indexes (e.g., `"..aab.."` rows) plus a palette. A build step or startup step turns them into Pixi textures. Island scenes are made of named layers (terrain, buildings, foliage, weather, critters), each with variants per restoration state. Shared tile sets (water, sand, grass, rock, rubble) and a palette-swap system keep the work manageable and the style consistent. A dev-only "sprite gallery" page previews every sprite and state.
- **Restoration states:** Each island has 5 visual states (0 Ruined → 1 Stirring → 2 Rebuilding → 3 Thriving → 4 Legendary). Each state is a layered set of sprites (base terrain, buildings, foliage, weather, ambient creatures), so one change in state shows up in several places at once.
- **Typography:** A pixel display font (e.g., *Pixelify Sans*) only for titles and labels on the map. All forms, editors and dashboards use a highly readable sans (e.g., *Inter*) at normal sizes. Legibility beats style.
- **UI frame:** Pages slide in as "parchment / panel" overlays on the map, with pixel borders around a clean modern interior. The map stays visible and dimmed behind them.
- **Feedback:** A short particle burst and a tally sound when XP lands. A rank-up gets a full-screen banner. Restoration plays a time-lapse of the island changing. A capped skill shows a padlock seal on its radar axis.
- **Accessibility:** A reduced-motion setting (which also follows the OS `prefers-reduced-motion`) swaps animations for crossfades and freezes the waves. Sound is off by default. Color is never the only signal. Everything works with the keyboard.

| Island | Silhouette | Palette (ruined → restored) | Signature landmarks |
|---|---|---|---|
| **Headquarters** | Gentle round island with a terraced hill | Sand/grey → warm greens, white stone, teal roofs | Modest cabin → estate; plaza of returned landmarks |
| **Carrier Archipelago** | 8 small islets in a ring, each with a fort | Fogged slate → bright heraldic banner colors | One stronghold per carrier; fog lifts per carrier |
| **Script Foundry** | Volcanic cone with a forge in the caldera | Cold ash → glowing orange, brass | Anvil (editor), printing press (versions), bell tower |
| **Court of Objections** | Sheer cliff plateau with marble courthouse | Stormy purple-grey → gold-lit marble | Courthouse steps, scales statue, docket board |
| **Last Broadcast** | Flat cracked wasteland with a tall radio mast | Toxic olive, rust → green fields, blue sky | Radio station; the antenna lights up rank by rank |
| **Conversation Cove** | Crescent harbor, pier, little lanes | Empty grey docks → lanterns, market stalls | Tavern, lighthouse, café pier |
| **Velocity Circuit** | Long oval island shaped by a race track | Cracked asphalt → neon stripes, grandstands | Pit lane, timing tower, monorail station |

---

## 2. Island / page plan

All islands are open from day one, with no forced route [REQ]. A small "suggested next step" hint is allowed but optional [PROPOSAL].

### Headquarters (home)
- **Skill Radar:** a pentagon radar with 5 axes, each showing score, rank and a cap seal. Click an axis to open the **Skill Sheet**: score, rank ladder, contribution breakdown by source, promotion requirements checklist, assessment history and blocked-XP log.
- **Production Office:** daily call reports and a dashboard (calls, hours, sales, IP by day/week/month; calls/hour, sales/hour, closing rate). IP always carries its currency and basis label [REQ].
- **Outfitter's Wharf:** the shop catalog and owned-upgrade inventory.
- **Trophy Hall:** achievements (complete / in progress / evidence stored, waiting for score) and the Lightspeed attempt tracker.
- **Restoration Atlas:** the state of every island, what the next state needs, and the HQ landmark plaza.
- **Archive House:** instances, export/import, starter maps and settings.
- **Inbox (later):** the approval queue for external submissions.
- **Quick Log:** a global "+ Log" button available from any screen, with the form for each activity type.

### Carrier Archipelago
- Each islet is a **carrier stronghold** (seeded labels: Americo, Mutual of Omaha, Instabrain, Chubb, American Amicable, Transamerica, Corebridge, Aetna [REQ]). Carriers can be renamed, added or archived, and each has an editable `kind` (carrier / platform / distributor / other) to describe its actual role [REQ].
- **Carrier page:** 3 carrier-wide categories (Background & History, Processes & Resources, Carrier Compensation) plus a product list.
- **Product page:** products start empty [REQ]. You enter name and details yourself. 6 product categories: Products & Differences, Eligibility & Underwriting, Medical Information Considered, Application Process & Navigation, Features & Limitations, Commissions & Bonuses (can be marked "not applicable").
- **Category card:** level (Uncharted → Surveyed → Charted → Fluent → Mastered), study minutes, self-assessment checklist, notes, resource links, and a "last reviewed" date with a "Mark reviewed" button.
- **Log study:** minutes + carrier + category (+ product) + short summary of what you learned.
- **Comparison Atlas** [PROPOSAL]: a side-by-side matrix of products across carriers, built from your own notes. Building it is part of a Product Knowledge achievement.
- No carrier facts ship with the app [REQ]. Every field shows "Not yet entered" until you fill it in.

### Script Foundry
- **Anvil (editor):** the script is split into named sections (Opener, Rapport, Qualifying, Health Qs, Presentation, Close, Rebuttals…). Autosave keeps revision history [REQ].
- **Printing Press (versions):** named versions with timestamps, side-by-side and inline diffs between any two versions, and a change note for each [REQ].
- **"Mark as meaningful improvement":** an explicit action that needs a change note of ≥ 40 characters plus a tag (clarity / compliance / tonality cue / objection prevention / flow / brevity). Only this earns XP, and it is rate-limited [REQ].
- **Rehearsal Hall:** log sessions by section with mode (silent read / read aloud / memorized / recorded + self-review), minutes, reps and an optional 1–5 self-rating on pace, clarity and warmth.
- **Two tracks** [REQ]: *Script Craft* (development) and *Rehearsal* (practice), each with its own level. Rehearsal pays more XP than editing [REQ].

### Court of Objections
- **Docket:** your library of objections ("I need to think about it," "Too expensive," "I already have coverage," …), seeded as editable examples. Each case has your response(s), notes and a link to its script section.
- **Hearings (practice):** pick cases, log reps by mode (written / spoken / recorded / role-play partner), self-rate fluency.
- **Gallery (listening):** log minutes spent listening to objection handling, with source and takeaways.
- **Case Files (real calls):** optionally tag real objections met on calls, with outcome (resolved / not resolved / call ended).

### Last Broadcast
- **Tonality drills:** drill type (pace, pitch variation, pausing, warmth, certainty, downtone close, mirroring), minutes or reps, self-rating.
- **Listening Post:** listening to skilled speakers, with minutes, source and three takeaways.
- **Tape Room:** self-review of your own calls, with a rubric (tonality, pacing, rapport, objection handling, control) plus reflection. Call review is the shared activity that feeds several skills at once.
- The radio's signal strength meter is the Tonality score.

### Conversation Cove
- **Rapport Library:** openers, transitions back to business, and stories, each as an editable card.
- **Practice:** reps by scenario (grieving widow, skeptical veteran, chatty retiree, rushed caller…) and transition type; minutes or reps; reflection.
- **Real-call rapport notes:** an optional per-day tag from the call report.

### Velocity Circuit
- **Time Trials:** timed full-script run-throughs, timed application navigation per carrier/product, timed quote runs. You log the duration. Personal bests are tracked per course.
- **Race Log:** daily efficiency charts (calls/hour, time-to-close when entered).
- **Lightspeed Garage:** the Lightspeed attempt tracker (see §3.6).

---

## 3. Progression

### 3.1 Core model [PROPOSAL, satisfies REQ]
- **One canonical record per real action.** Each record goes through the progression engine **once**, at commit time, and produces an append-only **award ledger** of per-skill contributions. The same action entered through a different screen still creates a single record (per-day duplicate warnings plus idempotency keys), so nothing is counted twice [REQ].
- **Every contribution line has a status:** `awarded`, `reduced` (diminishing returns), `blocked:cap` (skill at promotion cap), or `blocked:limit` (weekly/daily limit). Blocked lines are kept so you can see them, but they **never** count later, not even retroactively [REQ].
- **Editing or deleting a past record** writes reversal and re-award ledger lines. It can never unlock XP that was blocked by a cap.
- **Backdating:** records can be dated up to 7 days in the past and still earn XP. Older records are stored and count toward production/history, but earn no XP [PROPOSAL; config].
- **Config versioning:** every ledger line stores the `rulesetVersion`. Changing calibration only affects later awards.
- **Reversals (settled in Phase 1):**
  - Deleting a record removes exactly what it added: its XP, limit usage, weekly credit, practice share and active-week activity.
  - A reversal **never demotes**: the score can't fall below the current rank's threshold, and XP the record had blocked stays unearned.
  - An edit is a reversal plus a replacement. The 7-day late-logging check still uses the original logging time, so fixing a typo later doesn't forfeit XP.
- **Personal bests (Phase 1):** a clean run faster than every earlier clean run on the same course (or carrier/product) earns the bonus. The first run only sets the mark.
- **Curriculum (settled in Phase 2):**
  - Each map has its own editable copy of the carriers (seeded labels, role "not set"). Products, details and knowledge start empty.
  - A category's level comes from credited study minutes (per-category daily limit) plus your written evidence: a summary of 20+ characters, an "I can explain…" checklist, reviews, resources, and "explained without notes".
  - The peak level is stored, so a lapsed review shows as *review due* instead of erasing progress.
  - A carrier's level is the lowest of its applicable carrier-wide categories and the categories of every active product. A carrier with no products stays Uncharted.
  - Changing a verified product's details returns it to draft.
- **Script Foundry (settled in Phase 2):**
  - Saves that come within 60 seconds of each other are merged into one revision. The original script, and any revision a version points at, are never overwritten.
  - A version can be marked as a meaningful improvement only once, with a note of 40+ characters, and only if it differs from the version before it (or from the original).
  - Withdrawing the mark reverses its XP.
  - Script-revision XP can't be logged or removed anywhere but the Foundry.
  - Craft levels count improvements (1 / 3 / 8 / 15 / 25). Rehearsal levels count credited rehearsal minutes (60 / 300 / 900 / 1,800 / 3,600).
  - The editor uses one plain text box per section instead of CodeMirror: simpler, and enough for prose.
- **Achievements (settled in Phase 3):**
  - Completion is self-assessed and also backed by records. Each gate achievement checks your logged data (drills, reviews, docket, trials, sales, carrier levels…), and a completion is refused while those checks fall short.
  - Requirements no record can show (e.g. a teach-back recording) are attested by you. The evidence at completion time is stored with the achievement.
  - Product Knowledge achievements use *peak* category levels: reaching a level is what counts.
- **Courses (Phase 3):**
  - A course's target time can be set once and is then frozen. Only clean runs logged on or after the day it was set count toward Off the Line and Pit Crew.
  - Pit Crew uses application courses, one per carrier.
- **Rebuttal Trials (Phase 3):** up to 15 random docket cases, each self-rated fluent or not. A trial is also logged as spoken objection practice (one rep per case), and that record can't be edited or removed separately.
- **Lightspeed tracker (Phase 3):**
  - An attempt holds up to 10 itemized sales from one window of 30 minutes or less, and a sale can belong to only one attempt.
  - Sales in an attempt can't be deleted or re-timed.
  - "No chargeback" can only be confirmed on or after the calendar-month checkpoint; a chargeback can be reported any time and makes that attempt ineligible, with its history kept.
  - A mistaken entry can be undone until Lightspeed is recorded.
  - When all ten are confirmed, the Lightspeed achievement is recorded automatically. Speed's rank-5 gate still separately requires the max score, 365 days and 44 active weeks.
- **World map (settled in Phase 4):**
  - All art is drawn by code into plain pixel buffers (`src/world/art`). That keeps it deterministic and testable in Node, and the contact sheet renders it without a browser. The browser turns the buffers into Pixi textures.
  - The world is 480×270 logical pixels, scaled up crisply by CSS.
  - Restoration levels:
    - Skill islands: rank − 1.
    - Foundry: the average of the Craft and Rehearsal tracks.
    - Archipelago: each islet from its carrier's *peak* level; the island overall from their average.
    - HQ tier: from the sum of all five ranks (5–7 Camp, 8–11 Cabin, 12–16 Homestead, 17–21 Manor, 22–25 Estate).
  - All of these are built from progress that never goes backwards, so the map never regresses.
  - Island labels are real links over the canvas, which keeps the map keyboard- and screen-reader-accessible.
  - Motion follows the system setting by default, with on/reduced overrides per browser. Reduced motion shows a still, complete picture and skips the time-lapse.
- **Saves and starter maps (settled in Phase 5):**
  - The personal save format is now version 2. Older files are migrated step by step, and missing tables are treated as empty.
  - The checksum is checked before migrating. A mismatch is a warning, not a refusal, because progress is re-verified by replaying the event log. If the saved snapshot disagrees with its own log, the rebuilt progress is used.
  - Import always writes a *new* map with fresh ids for every row, remapped everywhere they're referenced, so the same file can be imported twice without collisions. "Replace" deletes the old map only after the import has succeeded, and the new map keeps the old one's name.
  - Starter maps carry carriers, products, knowledge summaries/checklists/resources, docket, courses, Rapport Library, script and settings.
  - Starter maps never carry activities, reports, sales, achievements, progress, purchases, reviews, verification or course targets. Personal notes are included only if you opt in, and checklists import unticked.
- **Outfitter's Wharf (Phase 5):**
  - The catalog lists *kinds* of purchase (leads, CRM, dialer, training, equipment, business service), never vendors or products.
  - Costs are as reported and never reconciled.
  - Each owned category places one cosmetic decoration on HQ's south shore.
- **Integrations (settled in Phase 6):**
  - Submission categories: daily call reports and itemized sales. Each source has a permission per category, starting at *no access*. *Apply automatically* must be confirmed explicitly, and it's dropped back to *submit for approval* whenever a map is imported onto another device.
  - Every delivery is recorded, including refused ones, for the audit trail.
  - Delivery is idempotent by (source, external id) plus a payload hash. The same payload is "duplicate", and a different payload under an accepted id is refused. Refused deliveries can be retried, e.g. after you grant access.
  - Approval writes through the ordinary report and sale commands with `source` metadata. An already-applied sale returns itself, and reports upsert by date, so a replayed approval can't double count. Records that look like ones you already have are flagged as warnings before approval.
  - The audit log records the acting source for writes made on its behalf.
  - Credentials live in a separate IndexedDB database (`meridian-isles-secrets`) that no export reads.
  - The save format is now version 3.
- **Daily reports (Phase 1):** one report per date. Only a change in *hours* touches XP; calls, sales and Issue Paid can be updated any time without affecting progress.

### 3.2 Skills, scores, ranks [REQ structure; PROPOSAL values]
Each skill's score runs 0 → 10,000. The radar axis shows score / 10,000, so five maxed skills draw a regular pentagon [REQ]. XP earned after reaching max goes into a cosmetic **Legacy** counter.

| Rank | Score threshold | Tonality | Product Knowledge | Objection Handling | Small Talk | Speed [REQ] |
|---|---|---|---|---|---|---|
| 1 | 0 | Static | Castaway | Defendant | Wallflower | Snail |
| 2 | 1,000 | Signal | Deckhand | Paralegal | Friendly Face | Jackrabbit |
| 3 | 3,000 | Clear Channel | Navigator | Counsel | Storyteller | Cheetah |
| 4 | 6,000 | Prime Time | Cartographer | Barrister | Confidant | Bullet Train |
| 5 | 10,000 | Golden Frequency | Admiral | Chief Justice | Hearthkeeper | Lightspeed |

**Hard cap rule [REQ]:** When score reaches the threshold of rank N+1 and that rank's **gate** is incomplete, the score freezes at the threshold. Everything that would have gone into this skill is logged as `blocked:cap`. Activities still record, and they still pay into other skills that aren't capped. Once the gate is complete, promotion happens immediately and earning resumes from that moment.

**A gate =** a gate achievement + (for higher ranks) elapsed time + active weeks + breadth. Gate achievements can be finished early, and their evidence is stored until the score catches up [REQ].

### 3.3 Activity contribution weights [PROPOSAL]

| Activity (island) | Inputs | Base XP | Skill split | Daily limit for this activity (full → 50% → 0) |
|---|---|---|---|---|
| Daily call report (HQ) | date, calls, hours, sales, IP | 12 / hour worked | Speed 40, Tonality 20, Objection 20, Small Talk 20 | 6 h → 8 h → beyond |
| Itemized sale (HQ) | time, carrier, product, IP | 0 (production + evidence only) | — | — |
| Carrier/product study (Archipelago) | minutes, carrier, category, product?, summary | 2 / min | Product Knowledge 100 (+ category XP) | 60 → 120 min per category |
| App navigation practice (Archipelago/Velocity) | carrier, product, duration, completed? | 15 / run + 10 for a personal best | Speed 50, Product Knowledge 50 | 6 → 10 runs |
| Script rehearsal (Foundry) | section(s), mode, minutes, reps, self-rating | 3 / min (recorded+review ×1.25) | Speed 50, Tonality 50 | 45 → 90 min |
| Meaningful script revision (Foundry) | explicit mark, note ≥ 40 chars, tag | 25 flat | Speed 50, Tonality 50 | 2/day, 4/week, then 0 |
| Tonality drill (Broadcast) | drill type, minutes/reps, self-rating | 3 / min | Tonality 100 | 40 → 80 min |
| Listening to skilled speakers (Broadcast) | minutes, source, 3 takeaways | 1.5 / min | Tonality 60, Small Talk 20, Objection 20 | 45 → 90 min |
| Objection listening (Court) | minutes, source, takeaways | 1.5 / min | Objection 100 | 45 → 90 min |
| Objection response practice (Court) | case(s), reps, mode, fluency rating | 4 / rep | Objection 80, Tonality 20 | 10 reps per case; 60 total → 100 |
| Own-call review (Broadcast) | call length, rubric, reflection (required) | 3 / min reviewed | Tonality 30, Objection 30, Small Talk 20, Speed 20 | 45 → 90 min |
| Small talk / transition practice (Cove) | scenario, transition type, reps/min, reflection | 3 / min or 4 / rep | Small Talk 80, Tonality 20 | 30 → 60 min |
| Time trial (Velocity) | course, duration, completed cleanly? | 15 / run + 10 for a personal best | Speed 100 (script trials: Speed 70, Tonality 30) | 5 → 8 runs |
| Shop purchase | — | **0** [REQ] | cosmetic only | — |

**Weekly limit per skill** (applied after the daily limits): full credit up to *W*, 50% from *W* to 1.5*W*, nothing above that.

**Limit rules (settled in Phase 0):**
- Every logged unit counts toward every limit, even when another limit has already zeroed it. For example, a third revision on Monday earns nothing and still uses one of the week's four.
- When several limits apply to one record, they multiply, so the strictest limit wins.
- Active weeks and breadth are measured on *practice*: what you did after daily and weekly limits, before caps. A capped skill keeps building active weeks and breadth, so a cap can never block the very requirement that would lift it.

### 3.4 One-year calibration [PROPOSAL; REQ for ≥1 skill at one year]

Assumption: about 5–8 hours/week of deliberate practice plus your normal calling. A single marathon session runs into the daily limits; a single heavy week runs into the weekly limit. Time passing alone earns nothing, because every gate also needs XP and an achievement.

**Active week (per skill):** a week counts if that skill earned XP on **≥ 3 distinct days**, with **≥ 60 minutes** of contributing activity and **≥ 2 distinct activity types** [PROPOSAL]. Weeks start Monday (configurable).

**Journey start** = date of your first logged activity in the instance. Elapsed-time gates count from then.

| Skill | Weekly full-credit *W* | Fastest possible to 10,000 | Rank 5 elapsed gate | Rank 5 active weeks | Rank 4 gate (time / weeks) | Rank 3 gate | Target |
|---|---|---|---|---|---|---|---|
| **Speed** | 250 | ~34 weeks | **365 days** | **44** | 180 d / 22 | 60 d / 8 | **1 year** |
| **Product Knowledge** | 250 | ~34 weeks | **365 days** | **44** | 180 d / 22 | 60 d / 8 | **1 year** |
| Tonality | 300 | ~28 weeks | 240 days | 30 | 120 d / 14 | 45 d / 6 | ~8 months |
| Objection Handling | 300 | ~28 weeks | 240 days | 30 | 120 d / 14 | 45 d / 6 | ~8 months |
| Small Talk | 400 | ~21 weeks | 150 days | 18 | 75 d / 10 | 30 d / 4 | ~5 months |

The ~44 active weeks across 52 calendar weeks leaves room for vacations and bad weeks. Both one-year skills still need their XP ceiling *and* their hard capstone achievement.

**Breadth gate (all skills, rank 4+):** at least 3 different activity types must each supply ≥ 10% of the skill's earned XP, and no single type may supply more than 60% [PROPOSAL].

### 3.5 Gate achievements (self-assessed; evidence stored) [PROPOSAL]

| Skill | → Rank 2 | → Rank 3 | → Rank 4 | → Rank 5 |
|---|---|---|---|---|
| **Speed** | *Off the Line*: timed full-script run under your target time (set once, then frozen) | *Pit Crew*: app navigation under target on 3 different carriers | *Express Service*: 5 real sales within one continuous 60-min window | **Lightspeed** (§3.6) |
| **Product Knowledge** | *First Charts*: carrier-wide categories at Surveyed for 2 carriers | *Navigator's Log*: 4 carriers with **every** applicable category ≥ Surveyed, plus 1 product fully Charted | *Cartographer's Atlas*: 6 carriers all-categories ≥ Charted, 3 ≥ Fluent, Comparison Atlas filled for ≥ 6 carriers | *Admiralty*: all active carriers all-categories ≥ Fluent, 4 carriers Mastered, every category reviewed within the last 120 days, and a recorded 10-minute "teach-back" on 3 carriers |
| **Tonality** | *First Signal*: 3 recorded rehearsals self-reviewed with rubric | *Tuned In*: 20 drills across ≥ 4 drill types; recorded full script rated ≥ 3/5 on every rubric item | *Prime Time*: 10 call reviews with tonality notes across ≥ 6 different weeks | *Golden Frequency*: 3 real calls in 3 different weeks self-scored ≥ 4/5 on every tonality rubric item |
| **Objection** | *Docket Opened*: ≥ 10 cases each with a written response | *Counsel Sworn*: every docket case practiced ≥ 10 spoken reps | *Barrister*: 25 real objections logged across ≥ 8 case types | *Chief Justice*: 3 randomized "Rebuttal Trials" (app draws 15 cases, you self-rate) on separate weeks at ≥ 90% fluent |
| **Small Talk** | *Open Door*: Rapport Library with ≥ 15 cards | *Storyteller*: 50 practice reps across ≥ 5 scenarios | *Confidant*: 20 real-call rapport notes | *Hearthkeeper*: 5 call reviews self-scored ≥ 4/5 on rapport and transition-back-to-business |

**Carrier category levels** (inside the Archipelago, separate from the Product Knowledge score):

| Level | Study minutes in this category | Plus |
|---|---|---|
| Surveyed | 30 | summary note written |
| Charted | 120 | self-check checklist (3–5 "I can explain…" items you write) |
| Fluent | 300 | checklist all ticked + reviewed in the last 90 days |
| Mastered | 540 | explain it without notes (self-attested) + resource references attached |

Study minutes per category per day are capped (60 full, 60–120 at half), so one heavily studied subject cannot complete a carrier. A carrier's level is the **lowest** level among its applicable categories [REQ satisfied].

### 3.6 Lightspeed attempt tracker [REQ]

**Attempt record:** window start, window end, 10 distinct sale records, status.

- **Window rule:** `end − start ≤ 30:00` and every sale timestamp falls inside `[start, end]`. Sales from different windows can never be combined [REQ]. Each sale belongs to at most one *active* attempt.
- **Sale record [DECIDED]:** a sale is an **application submitted**. `submittedAt` is the sale timestamp and must fall inside the window. Other fields: carrier, product, Issue Paid amount (as reported, can be filled in later), optional private policy reference, and a computed **retention checkpoint = anchor + 3 calendar months**.
- **Checkpoint anchor [PROPOSAL]:** defaults to the submission date (the sale itself). It can be switched in config to a later date you enter (issue or first-draft date) if your chargeback exposure runs from there.
- **Calendar-month rule** [REQ]: add 3 to the month and keep the day. If that day doesn't exist in the target month, use the **last day of that month** (Nov 30 → Feb 28/29; Aug 31 → Nov 30; Jan 31 → Apr 30). No 90-day substitution [REQ].
- **Per-sale checkpoint state:** `pending` (before the date) → `awaiting confirmation` (date passed, nothing confirmed; shown on HQ as a to-do; **never assumed OK** [REQ]) → `confirmed: no chargeback` or `chargeback reported`.
- **Attempt status:** `collecting` → `waiting on checkpoints` → `failed` (any chargeback; history kept [REQ]) or `evidence complete` (all 10 confirmed).
- **Achievement complete** only when evidence is complete **and** Speed score has reached 10,000 **and** the Rank 5 sustained-effort gate (365 days, 44 active weeks, breadth) is met [REQ]. Evidence completed early is held, and the tracker shows which conditions are still open.
- **Configurable rules:** `failurePolicy: "attemptIneligible"` (default) [REQ]; `allowSubstitutionFromSameWindow: false` (default; when on, an 11th sale from the *same* window can replace a failed one, which still respects the window rule).

### 3.7 Daily call reporting & reconciliation [REQ]
- **Daily report:** date, calls, hours, **applications submitted** (sales), **Issue Paid (IP)** amount, currency (default USD).
- **IP [DECIDED]:** labeled **"Issue Paid (IP)"**, defined in-app as "the amount you receive from the sale of a policy, as you report it." It is stored and shown exactly as entered and never annualized or recalculated. It is **not** treated as a bank balance or as cash on hand: no reconciliation with bank or Capital One, and no spending view. Those remain future features [REQ].
- **Timing [PROPOSAL]:** Issue Paid is often known after the submission day. A daily report's IP can therefore be entered or updated later, and each change is kept in the audit history. Production charts can group IP either by the day the sale was submitted (default) or by the day the IP was recorded.
- **Reconciliation per date:** the daily report is the authoritative total. Itemized sales are a subset.
  - records = totals → ✅ *Matched*
  - records < totals → ◐ *Partially itemized* (fine)
  - records > totals → ⚠ *Conflict*, with a prompt to raise the daily totals or fix the records
  - records but no daily report → totals *derived from records*, labeled as such
  - Production views **never** add records and totals together [REQ].

### 3.8 Island restoration [PROPOSAL]
- Each island's restoration state comes from its skill rank (Broadcast ← Tonality, Court ← Objection, Cove ← Small Talk, Velocity ← Speed). Script Foundry ← the average of the Craft and Rehearsal track levels. Each Archipelago islet ← that carrier's level.
- Restoration **never goes backwards**. Out-of-date reviews show as a light "overgrowth" overlay meaning *review due*, not destruction.
- **HQ growth:** HQ tier = sum of the five ranks (5–25), giving 5 building tiers. Each Rank 4 and Rank 5 promotion sends a **landmark** to the HQ plaza (e.g., Lightspeed → monorail station; Chief Justice → bronze scales; Golden Frequency → rooftop antenna; Admiral → harbor fort with carrier banners; Hearthkeeper → lighthouse café). Owned upgrades add cosmetic decorations at the Wharf only [REQ].

---

## 4. Data model [PROPOSAL]

Three layers: **Content** (packs, read-only definitions) → **Curriculum** (your per-instance editable copy) → **Records** (your history). The progression state is derived from records and is never edited by hand.

```ts
// ---------- Content packs (versioned, shippable) ----------
ContentPack { id: "core" | "final-expense" | ...; version; requires: PackRef[];
  skills: SkillDef[]; activityTypes: ActivityTypeDef[]; achievements: AchievementDef[];
  islands: IslandDef[]; seeds: { carriers, categories, objectionCases, rapportCards, scriptTemplate } }
SkillDef { id; name; ranks: RankDef[5]; weeklyLimit; activeWeekRule }
RankDef { index; name; threshold; gate: { achievementId?; minElapsedDays?; minActiveWeeks?; breadth? } }
ActivityTypeDef { id; islandId; inputSchema (zod); xpFormula; skillWeights: Record<SkillId, number>;
  dailyLimit; tags }            // e.g. "fe:study.carrierCategory"
AchievementDef { id; skillId?; kind: "checklist" | "count" | "rubric" | "lightspeed" | ...; criteria }

// ---------- Instance ----------
Instance { id; name; createdAt; journeyStart?; packRefs; configOverrides; rulesetVersion; schemaVersion }

// ---------- Curriculum (editable, exportable in starter maps) ----------
Carrier { id; label; kind: "carrier"|"platform"|"distributor"|"other"; archived; notes }
Product { id; carrierId; name; details?; status: "empty"|"draft"|"verified"; verifiedAt? }
KnowledgeCategory { id; scope: "carrier"|"product"; carrierId; productId?; defId;
  applicable: boolean; notes; resources: ResourceRef[]; lastReviewedAt?; checklist: CheckItem[] }
ObjectionCase, RapportCard, TrainingCourse(time-trial courses with target times)

// ---------- Records (personal history) ----------
Activity { id; typeId; occurredAt; recordedAt; inputs; reflection?; source: SourceMeta; idempotencyKey }
DailyReport { id; date; calls; hours; applicationsSubmitted; issuePaid?; currency; source }
Sale { id; submittedAt; carrierId?; productId?; issuePaid?; currency; policyRef?;
  anchorDate /* defaults to submittedAt */; checkpoints: RetentionCheckpoint[]; source }
RetentionCheckpoint { dueDate; status: "pending"|"awaiting"|"confirmedOk"|"chargeback"; confirmedAt? }
LightspeedAttempt { id; windowStart; windowEnd; saleIds[10]; status; history[] }
Script { id; title; sections[] }  ScriptRevision { id; scriptId; createdAt; content; parentId }
ScriptVersion { id; revisionId; name; note; meaningful?: { tag; note; markedAt } }
AchievementProgress { achievementId; evidence[]; evidenceCompleteAt?; completedAt? }
OwnedUpgrade { id; catalogItemId?; name; category; purchasedAt; reportedCost; currency;
  description; capabilities; quantity?; remaining?; subscription?: { status; renewsAt? }; notes }

// ---------- Progression (derived + ledger) ----------
AwardLine { id; recordId; skillId; amount; status: "awarded"|"reduced"|"blocked:cap"|"blocked:limit";
  explanation; rulesetVersion; at }
CategoryXpLine { ... same idea for carrier categories }
Promotion { skillId; fromRank; toRank; at }
ProgressSnapshot { cached fold of ledger: skill scores, ranks, active weeks, restoration }  // rebuildable

// ---------- Integrations (scaffold now, live later) ----------
IntegrationSource { id; name: "Grokbot"|...; permissions: Record<RecordCategory, "none"|"submit"|"autoAccept"> }
Submission { id; sourceId; externalId; payloadHash; receivedAt; payload;
  status: "pending"|"approved"|"rejected"|"duplicate"; resultingRecordIds[] }
AuditEvent { id; at; actor: "user"|sourceId; action; target; before?; after? }
// Secrets (tokens/keys) live in a separate local store — never part of any export.
```

**Commands, not direct writes.** Every change goes through one command service (`logActivity`, `submitDailyReport`, `markMeaningfulRevision`, `confirmCheckpoint`, `approveSubmission`, …). Manual entry and future integrations call the same commands, so progress is awarded in exactly one place. Approved submissions carry `source` metadata. Duplicates are caught by `(sourceId, externalId)` and `payloadHash` before anything is applied [REQ].

**Save formats:**
- **Personal save** `*.meridian-save.json`: `{ format: "meridian-save", schemaVersion, packRefs, exportedAt, instance, curriculum, records, ledger, checksum }`. Excludes secrets [REQ].
- **Starter map** `*.meridian-starter.json`: `{ format: "meridian-starter", schemaVersion, packRefs, config, curriculum }`, with no records, ledger or personal notes (personal notes optional, off by default) [REQ].
- **Import:** parse → detect format → run ordered migrations `vN → vN+1` → validate with zod → **preview** (name, counts, date range, pack versions, warnings) → create a **new instance** by default. Overwrite is a separate, explicit, confirmed option [REQ]. Invalid files show a clear, field-level error and change nothing.

---

## 5. Technical stack [PROPOSAL]

| Concern | Choice | Why |
|---|---|---|
| Language/build | **TypeScript + Vite** | Fast, typed, deploys as a static site |
| UI (forms, editors, dashboards) | **React 18** | Best ecosystem for heavy form/editor UI |
| World rendering | **PixiJS v8** in a React-hosted canvas | A fast 2D WebGL renderer with pixel-perfect scaling. We need no physics or pathfinding, so Phaser's extra machinery would only get in the way of the React UI |
| Persistence | **Dexie (IndexedDB)** behind a `StorageAdapter` interface | Local, offline, transactional, handles large histories. The adapter lets a future hosted, login-based backend replace or sync with it without touching domain or UI code [DECIDED] |
| Validation & migrations | **zod** | One schema for content packs, forms, imports and saves |
| Dates | **date-fns** | `addMonths` already clamps to end of month; ISO weeks |
| Charts | Custom SVG radar + **Recharts** for dashboards | The radar needs bespoke pixel styling; dashboards are standard |
| Script editor & diff | **CodeMirror 6** + **jsdiff** | Section-aware editing, side-by-side and inline diff |
| State | **Zustand** (UI state); engine is pure functions | Keeps progression logic testable, outside React |
| Tests | **Vitest** (engine, migrations, calendar math) + Playwright smoke tests | The progression rules are the riskiest code |
| Hosting | Static host (Cloudflare Pages / Netlify / GitHub Pages free tier); PWA later | No accounts or paid services needed [REQ] |

**Source layout (enforces the separation [REQ]):**
```
src/content/        packs (core, final-expense), pack schemas & loader
src/domain/         types, progression engine (pure), calendar math, reconciliation
src/records/        command service, repositories, audit log
src/persistence/    Dexie db, export/import, migrations, secrets store
src/world/          Pixi scenes, sprite layers, restoration rendering
src/ui/             React pages per island, shared components
src/integrations/   adapter interface, inbox, permission checks (mock adapter only in v1)
```

**Expansion packs:** a new product line (e.g., Medicare Supplement) is a new content pack that adds categories, activity types, achievements, seeds, and optionally an island, under namespaced IDs (`ms:*`). The engine and UI read from the pack registry, so adding a pack needs no rewrites [REQ].

---

## 6. Phased implementation plan

| Phase | Scope | Done when |
|---|---|---|
| **0. Foundation** | Vite/React/TS scaffold, zod pack schemas, core + Final Expense packs, progression engine (weights, daily/weekly limits, caps, gates, active weeks, calendar months) with thorough unit tests | Engine passes tests for cap blocking, no retroactive XP, breadth, end-of-month math |
| **1. Playable core** | Instances (create/name/switch), Dexie persistence, command service + ledger, Quick Log for every activity type, HQ radar + Skill Sheets with "Why this XP?", **daily call report + production dashboard + reconciliation**, basic personal export | You can use it daily and keep a backup |
| **2. Archipelago & Foundry** | Carrier/product/category editor, study logging, category levels, Comparison Atlas; script editor, revisions, versions, diff, meaningful-improvement flow, rehearsal logs | Product Knowledge and script tracks fully playable |
| **3. Court, Broadcast, Cove, Velocity** | Docket, drills, listening, call review rubric, rapport library, time trials with personal bests, all gate achievements, Trophy Hall, **Lightspeed tracker** with checkpoint confirmations | All 5 skills reachable end-to-end |
| **4. Map & art** | Pixi world map, 7 islands × 5 restoration states, HQ tiers + landmark plaza, animations, restoration time-lapse, reduced motion, optional sound | The world feels like a game |
| **5. Shop & sharing** | Catalog + owned upgrades + cosmetic decorations; full import with preview, migrations, starter map export | Saves survive version upgrades; starter maps are shareable |
| **6. Integration scaffold** | Inbox, per-category permissions, idempotent submissions, audit log, a mock "Grokbot" adapter that submits JSON | A fake bot can submit; nothing changes until you approve |

Phases 0–3 can show placeholder island art so the daily-use loop exists early; Phase 4 swaps in the real art.

---

## 7. Unresolved questions

All v0.1 questions are resolved (see the Decisions log at the top). There are no open questions that block Phase 0.

**Future hosted mode (not in v1, design notes only):** user accounts and logins. Each account owns its instances, and the server stores the same versioned save format the local export already uses. Integration secrets stay server-side and out of saves. Personal export/import and starter maps stay available.
