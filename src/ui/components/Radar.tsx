import type { ContentRegistry } from "../../content";
import type { ProgressState, Ruleset } from "../../domain";
import { gateMetExceptScore } from "../../domain";
import { fmtXp } from "../format";

const W = 620;
const H = 440;
const CX = W / 2;
const CY = 228;
const R = 140;

/**
 * The five-skill radar. Each axis runs from 0 to the skill's max score, so
 * five maxed skills draw a regular pentagon. Rings mark each skill's rank
 * thresholds; a padlock marks a skill held at a promotion cap.
 */
export function Radar({
  registry,
  ruleset,
  state,
  at,
  onSelect,
}: {
  registry: ContentRegistry;
  ruleset: Ruleset;
  state: ProgressState;
  at: string;
  onSelect(skillId: string): void;
}) {
  const skills = ruleset.skillOrder.map((id) => ruleset.skills[id]!);
  const n = skills.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const point = (i: number, f: number) => [CX + Math.cos(angle(i)) * R * f, CY + Math.sin(angle(i)) * R * f] as const;
  const poly = (fs: number[]) => fs.map((f, i) => point(i, f).join(",")).join(" ");

  const values = skills.map((s) => Math.min(1, state.skills[s.id]!.score / s.maxScore));
  // Draw at least a sliver so a brand-new map still shows a shape.
  const shown = values.map((v) => Math.max(v, 0.03));
  const rings = [1, 2, 3, 4].map((rankIdx) => skills.map((s) => s.ranks[rankIdx]!.threshold / s.maxScore));

  return (
    <svg className="radar" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Skill radar">
      {rings.map((ring, i) => (
        <polygon key={i} points={poly(ring)} className={i === 3 ? "radar-ring outer" : "radar-ring"} />
      ))}
      {skills.map((_, i) => {
        const [x, y] = point(i, 1);
        return <line key={i} x1={CX} y1={CY} x2={x} y2={y} className="radar-axis" />;
      })}
      <polygon points={poly(shown)} className="radar-shape" />
      {shown.map((f, i) => {
        const [x, y] = point(i, f);
        return <circle key={i} cx={x} cy={y} r={4} className="radar-dot" />;
      })}
      {skills.map((s, i) => {
        const progress = state.skills[s.id]!;
        const next = s.ranks[progress.rank];
        const capped = next !== undefined && progress.score >= next.threshold && !gateMetExceptScore(state, ruleset, s.id, progress.rank + 1, at);
        const [x, y] = point(i, 1.22);
        const anchor = Math.abs(x - CX) < 10 ? "middle" : x > CX ? "start" : "end";
        return (
          <g
            key={s.id}
            className="radar-label"
            role="button"
            tabIndex={0}
            onClick={() => onSelect(s.id)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(s.id)}
            aria-label={`${s.name}: ${registry.skillById[s.id]!.ranks[progress.rank - 1]!.name}, ${fmtXp(progress.score)} XP${capped ? ", capped" : ""}`}
          >
            <text x={x} y={y - 8} textAnchor={anchor} className="radar-name">
              {capped ? "🔒 " : ""}
              {s.name}
            </text>
            <text x={x} y={y + 10} textAnchor={anchor} className="radar-rank">
              {s.ranks[progress.rank - 1]!.name} · {fmtXp(progress.score)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
