import { useState } from "react";
import { useApp, useView } from "../app/context";
import { levelName, useWorld } from "../app/world";
import { IslandArt, IslandHero } from "../components/IslandArt";
import { QuickLog } from "../components/QuickLog";
import { href } from "../routes";
import { Archipelago } from "./Archipelago";
import { Broadcast } from "./Broadcast";
import { Court } from "./Court";
import { Cove } from "./Cove";
import { Foundry } from "./Foundry";
import { Velocity } from "./Velocity";

/** Every island has its own page; Headquarters lives at its own route. */
const ISLAND_PAGES: Record<string, () => JSX.Element> = {
  "fe:island.carrier-archipelago": Archipelago,
  "core:island.script-foundry": Foundry,
  "core:island.court-of-objections": Court,
  "core:island.last-broadcast": Broadcast,
  "core:island.conversation-cove": Cove,
  "core:island.velocity-circuit": Velocity,
};

const pageFor = (islandId: string, hq: boolean) => (hq ? href({ page: "hq" }) : href({ page: "islands", islandId }));

export function Islands({ islandId }: { islandId?: string }) {
  const Page = islandId ? ISLAND_PAGES[islandId] : undefined;
  if (islandId && Page) {
    return (
      <div className="page">
        <a className="link-btn" href={href({ page: "islands" })}>
          ← All islands
        </a>
        <IslandHero islandId={islandId} />
        <Page />
      </div>
    );
  }
  return <IslandDirectory />;
}

/** All islands at a glance, each drawn as it looks right now. */
function IslandDirectory() {
  const { registry } = useApp();
  const { state, ruleset } = useView();
  const world = useWorld();
  const [logIsland, setLogIsland] = useState<string | null>(null);
  // Headquarters first, then the rest in pack order.
  const islands = [...registry.islands].sort((a, b) => (a.restorationSource === "hq" ? -1 : b.restorationSource === "hq" ? 1 : 0));

  return (
    <div className="page islands">
      <div className="island-grid">
        {islands.map((island) => {
          const hq = island.restorationSource === "hq";
          const types = registry.activityTypes.filter((t) => t.islandId === island.id && t.quickLog);
          const level = world.islands[island.id]?.level ?? 0;
          return (
            <section key={island.id} className={`panel island-card island-${island.id.split(".")[1]}`}>
              <a className="island-card-art" href={pageFor(island.id, hq)} aria-label={`Open ${island.name}`}>
                <IslandArt islandId={island.id} />
              </a>
              <header>
                <div className="row">
                  <h2>
                    <a href={pageFor(island.id, hq)}>{island.name}</a>
                  </h2>
                  <span className="spacer" />
                  <span className={`badge lvl-${level}`}>{levelName(island.id, registry, world)}</span>
                </div>
                <p className="muted">{island.tagline}</p>
              </header>
              {island.skillIds.length > 0 && (
                <div className="island-skills">
                  {island.skillIds.map((sid) => (
                    <span key={sid} className="badge s-neutral">
                      {ruleset.skills[sid]!.name}: {ruleset.skills[sid]!.ranks[state.skills[sid]!.rank - 1]!.name}
                    </span>
                  ))}
                </div>
              )}
              {types.length > 0 && <p className="muted small">{types.map((t) => t.name).join(" · ")}</p>}
              <div className="row">
                <a className="btn primary" href={pageFor(island.id, hq)}>
                  Enter {island.name}
                </a>
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
