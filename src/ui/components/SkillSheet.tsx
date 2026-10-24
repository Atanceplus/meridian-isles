import { countActiveWeeks, gateConditions, weekKey, type GateCondition } from "../../domain";
import { nowLocal } from "../../records/clock";
import { useApp, useView } from "../app/context";
import { fmtDateTime, fmtPercent, fmtXp, rankName } from "../format";
import { AchievementBody } from "./AchievementCard";
import { Modal } from "./Modal";

/** Everything about one skill: rank ladder, promotion requirements, contributions and history. */
export function SkillSheet({ skillId, onClose }: { skillId: string; onClose(): void }) {
  const { registry } = useApp();
  const { ruleset, state, bundle } = useView();
  const skill = ruleset.skills[skillId]!;
  const progress = state.skills[skillId]!;
  const now = nowLocal();
  const nextRank = progress.rank < 5 ? progress.rank + 1 : null;
  const conditions = nextRank ? gateConditions(state, ruleset, skillId, nextRank, now) : [];
  const next = nextRank ? skill.ranks[nextRank - 1]! : null;
  const capped = next !== null && progress.score >= next.threshold && conditions.some((c) => c.kind !== "score" && !c.met);
  const prevThreshold = skill.ranks[progress.rank - 1]!.threshold;
  const toNext = next ? Math.min(1, (progress.score - prevThreshold) / (next.threshold - prevThreshold)) : 1;

  // Contribution breakdown from the ledger: XP that actually changed the score, by activity type.
  const byType = new Map<string, number>();
  for (const line of bundle.ledger) {
    if (line.skillId !== skillId) continue;
    if (line.status === "awarded" || line.status === "reduced" || line.status === "reversed") {
      byType.set(line.typeId, (byType.get(line.typeId) ?? 0) + line.amount);
    }
  }
  const practiceTotal = Object.values(progress.practiceByType).reduce((a, b) => a + b, 0);
  const contributors = [...new Set([...byType.keys(), ...Object.keys(progress.practiceByType)])]
    .map((typeId) => ({
      typeId,
      name: registry.activityTypeById[typeId]?.name ?? typeId,
      earned: byType.get(typeId) ?? 0,
      share: practiceTotal > 0 ? (progress.practiceByType[typeId] ?? 0) / practiceTotal : 0,
    }))
    .filter((c) => c.earned !== 0 || c.share > 0)
    .sort((a, b) => b.earned - a.earned);

  const thisWeek = weekKey(now, ruleset.general.weekStartsOn);
  const weeklyUsed = state.weeklySkillCredit[`${skillId}|${thisWeek}`] ?? 0;
  const activeWeeks = countActiveWeeks(progress, skill.activeWeek);

  const history = [
    ...progress.promotions.map((p) => ({ at: p.at, text: `Promoted to ${rankName(registry, skillId, p.toRank)}` })),
    ...bundle.achievements
      .filter((a) => registry.achievementById[a.achievementId]?.skillId === skillId)
      .map((a) => ({ at: a.completedAt, text: `Completed ${registry.achievementById[a.achievementId]!.name}${a.evidenceNote ? ` — “${a.evidenceNote}”` : ""}` })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <Modal title={skill.name} onClose={onClose} wide>
      <div className="sheet">
        <section className="sheet-head">
          <div>
            <div className="eyebrow">Rank {progress.rank} of 5</div>
            <div className="rank-title">{skill.ranks[progress.rank - 1]!.name}</div>
            <p className="muted">{skill.description}</p>
          </div>
          <div className="score-block">
            <div className="score-big">{fmtXp(progress.score)}</div>
            <div className="muted">of {fmtXp(skill.maxScore)} XP</div>
            {progress.legacy > 0 && <div className="muted">+{fmtXp(progress.legacy)} Legacy</div>}
          </div>
        </section>

        {next && (
          <div className="progress-line" aria-label={`Progress to ${next.name}`}>
            <div className="bar">
              <span style={{ width: `${toNext * 100}%` }} className={capped ? "capped" : ""} />
            </div>
            <span className="muted">
              {fmtXp(progress.score)} / {fmtXp(next.threshold)} toward {next.name}
            </span>
          </div>
        )}

        {capped && (
          <div className="callout warn">
            <strong>🔒 Capped at {fmtXp(next!.threshold)}.</strong> {skill.name} isn't earning XP until the {next!.name} requirements below are
            complete. Activity still counts toward other skills, active weeks and breadth. Blocked XP is never added back later.
          </div>
        )}

        {next && (
          <section>
            <h3>To reach {next.name}</h3>
            <ul className="checklist">
              {conditions.map((c, i) => (
                <ConditionItem key={i} condition={c} />
              ))}
            </ul>
          </section>
        )}
        {!next && <div className="callout good">{skill.name} is at its highest rank. Further XP goes to Legacy.</div>}

        <section className="two-col">
          <div>
            <h3>Where the score came from</h3>
            {contributors.length === 0 ? (
              <p className="muted">Nothing yet. Log an activity that trains {skill.name}.</p>
            ) : (
              <table className="compact">
                <thead>
                  <tr>
                    <th>Activity</th>
                    <th className="num">XP</th>
                    <th className="num" title="Share of practice (after limits), used for breadth">Practice share</th>
                  </tr>
                </thead>
                <tbody>
                  {contributors.map((c) => (
                    <tr key={c.typeId}>
                      <td>{c.name}</td>
                      <td className="num">{fmtXp(c.earned)}</td>
                      <td className="num">{fmtPercent(c.share)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <h3>Limits and effort</h3>
            <dl className="facts">
              <dt>This week</dt>
              <dd>
                {fmtXp(weeklyUsed)} XP credited · full credit up to {fmtXp(skill.weeklyLimit.fullUpTo)}, half up to {fmtXp(skill.weeklyLimit.reducedUpTo)}
              </dd>
              <dt>Active weeks</dt>
              <dd>
                {activeWeeks} · a week counts with activity on {skill.activeWeek.minDays}+ days, {skill.activeWeek.minMinutes}+ minutes, and{" "}
                {skill.activeWeek.minActivityTypes}+ activity types
              </dd>
              <dt>Journey started</dt>
              <dd>{state.journeyStart ?? "Not yet"}</dd>
              <dt>Blocked by caps</dt>
              <dd>{fmtXp(progress.blockedByCap)} XP</dd>
              <dt>Over daily/weekly limits</dt>
              <dd>{fmtXp(progress.blockedByLimit)} XP</dd>
            </dl>
          </div>
        </section>

        <section>
          <h3>Rank ladder</h3>
          <ol className="ladder">
            {skill.ranks.map((r, i) => (
              <li key={r.name} className={i + 1 === progress.rank ? "current" : i + 1 < progress.rank ? "done" : ""}>
                <strong>{r.name}</strong>
                <span>{fmtXp(r.threshold)} XP</span>
                {r.gate.minElapsedDays > 0 && (
                  <span>
                    {r.gate.minElapsedDays} days · {r.gate.minActiveWeeks} active weeks
                  </span>
                )}
                {r.gate.breadth && <span>breadth</span>}
                {r.gate.achievementIds.map((id) => (
                  <span key={id}>🏅 {registry.achievementById[id]?.name}</span>
                ))}
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h3>History</h3>
          {history.length === 0 ? (
            <p className="muted">No promotions or completed achievements yet.</p>
          ) : (
            <ul className="history">
              {history.map((h, i) => (
                <li key={i}>
                  <span className="muted">{fmtDateTime(h.at)}</span> {h.text}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}

function ConditionItem({ condition: c }: { condition: GateCondition }) {
  const { registry } = useApp();
  const mark = <span className={`check ${c.met ? "met" : ""}`}>{c.met ? "✓" : "○"}</span>;
  switch (c.kind) {
    case "score":
      return (
        <li>
          {mark} Score {fmtXp(c.current)} / {fmtXp(c.required)}
        </li>
      );
    case "elapsedDays":
      return (
        <li>
          {mark} {c.current} / {c.required} days since your journey began
        </li>
      );
    case "activeWeeks":
      return (
        <li>
          {mark} {c.current} / {c.required} active weeks
        </li>
      );
    case "breadth":
      return (
        <li>
          {mark} Breadth: {c.qualifyingTypes} of {c.requiredTypes} activity types at 10%+ of practice; largest share {fmtPercent(c.largestShare)} (max{" "}
          {fmtPercent(c.maxShareSingle)})
        </li>
      );
    case "achievement": {
      const def = registry.achievementById[c.achievementId]!;
      return (
        <li className="achievement-item">
          {mark} <strong>🏅 {def.name}</strong> <span className="muted">— {def.description}</span>
          {!c.met && <AchievementBody achievementId={c.achievementId} />}
        </li>
      );
    }
  }
}
