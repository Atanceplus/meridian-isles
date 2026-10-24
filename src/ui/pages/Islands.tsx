import { useState } from "react";
import { useApp, useView } from "../app/context";
import { QuickLog } from "../components/QuickLog";
import { href } from "../routes";
import { Archipelago } from "./Archipelago";
import { Broadcast } from "./Broadcast";
import { Court } from "./Court";
import { Cove } from "./Cove";
import { Foundry } from "./Foundry";
import { Velocity } from "./Velocity";

/** Every island has its own page; the directory lists them until the Phase 4 world map. */
const ISLAND_PAGES: Record<string, () => JSX.Element> = {
  "fe:island.carrier-archipelago": Archipelago,
  "core:island.script-foundry": Foundry,
  "core:island.court-of-objections": Court,
  "core:island.last-broadcast": Broadcast,
  "core:island.conversation-cove": Cove,
  "core:island.velocity-circuit": Velocity,
};

export function Islands({ islandId }: { islandId?: string }) {
  const Page = islandId ? ISLAND_PAGES[islandId] : undefined;
  if (Page) {
    return (
      <div className="page">
        <a className="link-btn" href={href({ page: "islands" })}>
          ← All islands
        </a>
        <Page />
      </div>
    );
  }
  return <IslandDirectory islandId={islandId} />;
}

/** Island directory. The pixel-art world map replaces this in Phase 4. */
function IslandDirectory({ islandId }: { islandId?: string }) {
  const { registry } = useApp();
  const { state, ruleset } = useView();
  const [logIsland, setLogIsland] = useState<string | null>(null);
  const islands = registry.islands.filter((i) => i.restorationSource !== "hq" && (!islandId || i.id === islandId));

  return (
    <div className="page islands">
      {islandId && (
        <a className="link-btn" href={href({ page: "islands" })}>
          ← All islands
        </a>
      )}
      <div className="island-grid">
        {islands.map((island) => {
          const types = registry.activityTypes.filter((t) => t.islandId === island.id && t.quickLog);
          return (
            <section key={island.id} className={`panel island-card island-${island.id.split(".")[1]}`}>
              <header>
                <h2>
                  <a href={href({ page: "islands", islandId: island.id })}>{island.name}</a>
                </h2>
                <p className="muted">{island.tagline}</p>
              </header>
              <div className="island-skills">
                {island.skillIds.map((sid) => (
                  <span key={sid} className="badge s-neutral">
                    {ruleset.skills[sid]!.name}: {ruleset.skills[sid]!.ranks[state.skills[sid]!.rank - 1]!.name}
                  </span>
                ))}
              </div>
              <ul className="island-activities">
                {types.map((t) => (
                  <li key={t.id}>
                    <strong>{t.name}</strong> <span className="muted">— {t.description}</span>
                  </li>
                ))}
                {types.length === 0 && <li className="muted">This island's tools arrive in a later phase.</li>}
              </ul>
              <div className="row">
                {ISLAND_PAGES[island.id] && (
                  <a className="btn primary" href={href({ page: "islands", islandId: island.id })}>
                    Enter {island.name}
                  </a>
                )}
                {types.length > 0 && (
                  <button className="btn" onClick={() => setLogIsland(island.id)}>
                    Log here
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {logIsland && <QuickLog islandId={logIsland} onClose={() => setLogIsland(null)} />}
    </div>
  );
}
