import { useEffect, useState } from "react";
import type { AwardLine } from "../../domain";
import { useApp } from "../app/context";
import { STATUS_LABEL, fmtSigned, fmtXp, netBySkill, rankName, skillName } from "../format";

const AUTO_DISMISS_MS = 8000;

export function OutcomePanel() {
  const { outcome } = useApp();
  return outcome ? <Outcome key={outcome.id} /> : null;
}

/**
 * Shown after a command: what each skill gained, any promotions, and "Why this XP?".
 * Closes itself after a few seconds unless you open the details, hover it, or it announces a promotion.
 */
function Outcome() {
  const { outcome, dismissOutcome, registry } = useApp();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const sticky = open || hover || (outcome?.promotions.length ?? 0) > 0;

  useEffect(() => {
    if (sticky) return;
    const t = setTimeout(dismissOutcome, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [sticky, dismissOutcome]);

  if (!outcome) return null;

  const net = netBySkill(outcome.lines);
  const blocked = outcome.lines.filter((l) => l.status === "blocked:cap");

  return (
    <aside className="outcome panel" role="status" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <header className="row">
        <strong>{outcome.title}</strong>
        <span className="spacer" />
        <button className="icon-btn" onClick={dismissOutcome} aria-label="Dismiss">
          ×
        </button>
      </header>

      {outcome.promotions.map((p, i) => (
        <div key={i} className="promotion">
          ⭐ {skillName(registry, p.skillId)} promoted to <strong>{rankName(registry, p.skillId, p.toRank)}</strong>
        </div>
      ))}

      {net.size > 0 && (
        <ul className="gains">
          {[...net.entries()].map(([skillId, amount]) => (
            <li key={skillId} className={amount < 0 ? "neg" : ""}>
              <span>{skillName(registry, skillId)}</span>
              <strong>{fmtSigned(amount)} XP</strong>
            </li>
          ))}
        </ul>
      )}
      {blocked.length > 0 && (
        <p className="warn-text">
          🔒 {fmtXp(blocked.reduce((a, l) => a + l.amount, 0))} XP blocked by a promotion cap. Open the skill to see what's needed.
        </p>
      )}
      {outcome.lines.length > 0 && outcome.lines.every((l) => l.status === "ineligible:backdated") && (
        <p className="warn-text">Logged too long after it happened to earn XP. It's still saved in your history.</p>
      )}

      {outcome.lines.length > 0 && (
        <button className="link-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Hide details" : "Why this XP?"}
        </button>
      )}
      {open && <LineDetails lines={outcome.lines} />}
    </aside>
  );
}

/** Gains and removals are signed; XP that was never earned is shown as such, not as a gain. */
function lineAmount(l: AwardLine): string {
  if (l.status.startsWith("blocked") || l.status.startsWith("ineligible")) return `${fmtXp(l.amount)} not earned`;
  return fmtSigned(l.amount);
}

export function LineDetails({ lines }: { lines: AwardLine[] }) {
  const { registry } = useApp();
  return (
    <ul className="line-details">
      {lines.map((l, i) => (
        <li key={i}>
          <div className="row">
            <span className={`badge s-${l.status.replace(":", "-")}`}>{STATUS_LABEL[l.status]}</span>
            <span>{skillName(registry, l.skillId)}</span>
            <span className="spacer" />
            <strong>{lineAmount(l)}</strong>
          </div>
          <ul className="muted">
            {l.explanation.map((e, j) => (
              <li key={j}>{e}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
