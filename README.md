# Meridian Isles

A browser-based progression world for mastering Final Expense life insurance sales. See [docs/DESIGN.md](docs/DESIGN.md) for the approved design.

**Status:** Phase 1 is complete and playable day to day:
- independent maps (instances) saved in IndexedDB;
- Quick Log for every activity;
- the HQ radar and skill sheets with self-assessed achievements;
- daily call reports with itemized sales and reconciliation;
- a personal backup export.

**Phase 2** added two island pages:
- **Carrier Archipelago:** editable carriers and products, category levels with checklists and reviews, study logging and the Comparison Atlas.
- **Script Foundry:** a section editor with autosaved revision history, named versions, word-level comparison, the meaningful-improvement flow, the Craft and Rehearsal tracks and the Rehearsal Hall.

**Phase 3** added the remaining islands, all reachable from the Islands page:
- **Court of Objections:** an editable docket, Rebuttal Trials, a listening gallery and real-call case files.
- **Last Broadcast:** drills, the Listening Post and the Tape Room's rubric averages.
- **Conversation Cove:** the Rapport Library, scenario practice and real-call notes.
- **Velocity Circuit:** courses with frozen target times, personal bests, a race log and the Lightspeed Garage.

It also added the **Trophy Hall**, which checks every gate achievement against your records.

**Phase 4** made the world map the home screen. It's code-drawn pixel art composed with PixiJS:
- 7 islands, each with 5 restoration states.
- 5 HQ tiers and 10 landmarks, one sent home by each Rank 4 and Rank 5 promotion.
- Animated sea, clouds, smoke, lights, fog, boats and a racing car.
- A restoration time-lapse when an island improves, plus a motion setting (follow system / on / reduced).

To review the art without a browser, render a contact sheet of every island in every state:

```bash
npm run art:sheet -- contact-sheet.png 3
```

**Phase 5** added:
- **Outfitter's Wharf** (linked from Headquarters): record purchases you made elsewhere, track remaining inventory and subscriptions. Purchases decorate HQ's waterfront and never grant XP.
- **Import** in the Archive House, for personal backups and starter maps. It always shows a preview first, migrates old save formats, checks the file's checksum, and verifies progress by replaying the event log. An import goes to a new map by default; replacing an existing map requires typing its name.
- **Starter maps:** shareable curriculum and settings, with no personal history.

**Phase 6** added the integration scaffold:
- **Inbox** in the top navigation, with a count of waiting submissions.
- **Sources** with per-category permissions: no access, submit for approval, or apply automatically (which needs an explicit confirmation).
- **Idempotent delivery:** a repeated delivery is recognized as the same submission, a changed payload under a used id is refused, and refused deliveries can be retried. Submissions that look like records you already have are flagged before you approve.
- **Credentials** are kept in a separate browser database that's never exported.
- **Audit log** (linked from the Inbox and the Archive House).
- **Simulated Grokbot** for trying all of the above without a live connection.

All six planned phases are complete. Live connections (Grokbot, bank, API, MCP) and a hosted, login-based backend are future work.

## Commands

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (Vitest)
npm run typecheck
npm run build      # static build in dist/
```

## Layout

| Path | Contents |
|---|---|
| `src/content/` | Pack schemas (zod), registry/validation, bundled packs (`core`, `fe`) |
| `src/domain/` | Pure logic: calendar math, diminishing-returns tiers, ruleset + overrides, progression engine, gates, carrier levels, Lightspeed evaluation |
| `src/records/` | Command service (the only way records change), form → record mapping, production reconciliation |
| `src/persistence/` | Row types, `StorageAdapter` interface, IndexedDB (Dexie) and in-memory adapters, personal save export |
| `src/ui/` | React UI: HQ, Production Office, Islands, Archive House, Quick Log, skill sheets |
| `src/test/` | Test helpers |

| `src/world/` | Restoration model, pixel-art drawing (`art/`), and the PixiJS map (`WorldMap.tsx`, loaded on demand) |
| `scripts/` | Dev tools (contact-sheet renderer) |

| `src/integrations/` | Submission contracts (payload schemas, envelope, adapter interface) and the simulated Grokbot |
