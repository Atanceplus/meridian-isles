import { useState } from "react";
import { evaluateAchievement, recordsMet } from "../../records/achievements";
import { nowLocal } from "../../records/clock";
import { useApp, useView } from "../app/context";
import { AchievementBody } from "../components/AchievementCard";
import { fmtDate } from "../format";

/** Trophy Hall: every gate achievement, grouped by skill, with what your records show. */
export function Trophies() {
  const { registry } = useApp();
  const view = useView();
  const [open, setOpen] = useState<string | null>(null);
  const now = nowLocal();
  const done = new Map(view.bundle.achievements.map((a) => [a.achievementId, a]));
  const total = registry.achievements.length;

  return (
    <div className="page trophies">
      <header className="island-head">
        <div>
          <div className="eyebrow">Trophy Hall</div>
          <h1>
            {done.size} of {total} achievements
          </h1>
          <p className="muted">
            Each promotion has an achievement gate. You can complete one before the score arrives; it's kept and counts the moment the score gets there. Records-backed
            requirements are checked for you; the rest you attest to.
          </p>
        </div>
      </header>
      {view.ruleset.skillOrder.map((skillId) => {
        const skill = view.ruleset.skills[skillId]!;
        const progress = view.state.skills[skillId]!;
        const achievements = registry.achievements.filter((a) => a.skillId === skillId).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
        return (
          <section key={skillId} className="panel">
            <header className="panel-head">
              <h2>{skill.name}</h2>
              <span className="muted">Now {skill.ranks[progress.rank - 1]!.name}</span>
            </header>
            <div className="trophy-grid">
              {achievements.map((a) => {
                const completed = done.get(a.id);
                const reqs = completed ? null : evaluateAchievement(a.id, { bundle: view.bundle, registry, ruleset: view.ruleset, now });
                const ready = !completed && recordsMet(reqs);
                const status = completed ? "Complete" : ready ? "Ready to claim" : "In progress";
                return (
                  <div key={a.id} className={`trophy ${completed ? "done" : ready ? "ready" : ""}`}>
                    <button className="trophy-head" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
                      <span className="trophy-icon" aria-hidden>
                        {completed ? "🏆" : "🏅"}
                      </span>
                      <span>
                        <strong>{a.name}</strong>
                        <span className="muted small"> · unlocks {skill.ranks[(a.rank ?? 1) - 1]?.name}</span>
                        <span className="block muted small">{a.description}</span>
                      </span>
                      <span className="spacer" />
                      <span className={`badge ${completed ? "s-awarded" : ready ? "s-reduced" : ""}`}>
                        {status}
                        {completed ? ` ${fmtDate(completed.completedAt.slice(0, 10))}` : ""}
                      </span>
                    </button>
                    {open === a.id && <AchievementBody achievementId={a.id} />}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
