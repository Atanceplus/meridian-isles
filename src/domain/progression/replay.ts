import type { Ruleset } from "../ruleset";
import { advanceTime, applyActivity, completeAchievement, reverseActivity } from "./engine";
import { createInitialState, type ActivityRecord, type ProgressState } from "./state";

export type ReplayableEvent =
  | { kind: "activity"; record: ActivityRecord }
  | { kind: "reversal"; recordId: string }
  | { kind: "achievement"; achievementId: string }
  | { kind: "time" };

/**
 * Rebuild progress by re-applying the event log in order. Used to verify an
 * imported save: if the rebuilt state differs from the saved snapshot, the file
 * was edited or the rules changed since it was made.
 */
export function replayEvents(events: { seq: number; at: string; event: ReplayableEvent }[], ruleset: Ruleset): ProgressState {
  let state = createInitialState(ruleset);
  for (const { at, event } of [...events].sort((a, b) => a.seq - b.seq)) {
    switch (event.kind) {
      case "activity":
        state = applyActivity(state, event.record, ruleset).state;
        break;
      case "reversal":
        state = reverseActivity(state, event.recordId, at, ruleset).state;
        break;
      case "achievement":
        state = completeAchievement(state, event.achievementId, at, ruleset).state;
        break;
      case "time":
        state = advanceTime(state, at, ruleset).state;
        break;
    }
  }
  return state;
}
