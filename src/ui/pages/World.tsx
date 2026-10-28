import { Suspense, lazy, useEffect, useState } from "react";
import { LAYOUT, WORLD, ISLAND_IDS } from "../../world/art/islands";
import { HQ_TIER_NAMES, restoredSince } from "../../world/restoration";
import { useApp } from "../app/context";
import { levelName, restorationHint, useWorld } from "../app/world";
import { href } from "../routes";

const WorldMap = lazy(() => import("../../world/WorldMap"));

type Motion = "system" | "on" | "off";
const MOTION_KEY = "meridian.motion";

/** Where the label for each island sits, as a fraction of the world (above the island's art). */
const LABEL_OFFSET: Record<string, [number, number]> = {
  [ISLAND_IDS.hq]: [62, 0],
  [ISLAND_IDS.archipelago]: [78, 0],
  [ISLAND_IDS.foundry]: [52, 0],
  [ISLAND_IDS.court]: [50, 0],
  [ISLAND_IDS.broadcast]: [62, 4],
  [ISLAND_IDS.cove]: [62, 0],
  [ISLAND_IDS.velocity]: [54, 0],
};

/** The world map: every island at its restoration level, one click from its page. */
export function World() {
  const { registry, currentId } = useApp();
  const world = useWorld();
  const [hovered, setHovered] = useState<string | null>(null);
  const [motion, setMotion] = useState<Motion>(() => (read(MOTION_KEY) as Motion | null) ?? "system");
  const systemReduced = usePrefersReducedMotion();
  const reduced = motion === "off" || (motion === "system" && systemReduced);

  // Restoration since the last visit: compare with the levels stored per map, then remember the new ones.
  const seenKey = `meridian.world.${currentId}`;
  const [previous] = useState<Record<string, number> | null>(() => parse(read(seenKey)));
  const restored = restoredSince(previous, world);
  useEffect(() => {
    write(seenKey, JSON.stringify(Object.fromEntries(Object.values(world.islands).map((i) => [i.islandId, i.level]))));
  }, [seenKey, world]);

  const go = (islandId: string) => {
    window.location.hash = islandId === ISLAND_IDS.hq ? href({ page: "hq" }) : href({ page: "islands", islandId });
  };
  const name = (id: string) => registry.islandById[id]?.name ?? id;
  const stateName = (id: string) => levelName(id, registry, world);

  return (
    <div className="page world">
      {restored.length > 0 && (
        <div className="callout good restored" role="status">
          Restored since your last visit: {restored.map((r) => `${name(r.islandId)} → ${stateName(r.islandId)}`).join(" · ")}
        </div>
      )}
      <div className="world-frame" style={{ aspectRatio: `${WORLD.w} / ${WORLD.h}` }}>
        <Suspense fallback={<div className="world-loading muted">Raising the islands…</div>}>
          <WorldMap world={world} restoredFrom={Object.fromEntries(restored.map((r) => [r.islandId, r.from]))} reducedMotion={reduced} hovered={hovered} onHover={setHovered} onSelect={go} />
        </Suspense>
        {Object.keys(LAYOUT).map((id) => {
          const l = LAYOUT[id]!;
          const [ox, oy] = LABEL_OFFSET[id] ?? [l.w / 2, 0];
          return (
            <a
              key={id}
              href={id === ISLAND_IDS.hq ? href({ page: "hq" }) : href({ page: "islands", islandId: id })}
              className={`world-label ${hovered === id ? "on" : ""}`}
              style={{ left: `${((l.x + ox) / WORLD.w) * 100}%`, top: `${((l.y + oy) / WORLD.h) * 100}%` }}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(id)}
              onBlur={() => setHovered(null)}
            >
              <strong>{name(id)}</strong>
              <span>{stateName(id)}</span>
            </a>
          );
        })}
      </div>

      <div className="world-bar row">
        <span className="muted small">
          HQ: <strong>{HQ_TIER_NAMES[world.hqTier]}</strong> (rank total {world.rankSum}/25) · Landmarks: {world.landmarks.length ? world.landmarks.map((l) => l.name).join(", ") : "none yet — each Rank 4 and Rank 5 promotion sends one home"}
        </span>
        <span className="spacer" />
        <label className="small">
          Motion{" "}
          <select
            value={motion}
            onChange={(e) => {
              const v = e.target.value as Motion;
              setMotion(v);
              write(MOTION_KEY, v);
            }}
          >
            <option value="system">Follow system{systemReduced ? " (reduced)" : ""}</option>
            <option value="on">On</option>
            <option value="off">Reduced</option>
          </select>
        </label>
      </div>

      <ul className="world-legend">
        {Object.keys(LAYOUT).map((id) => {
          const r = world.islands[id];
          return (
            <li key={id}>
              <a href={id === ISLAND_IDS.hq ? href({ page: "hq" }) : href({ page: "islands", islandId: id })}>{name(id)}</a>
              <span className={`badge lvl-${r?.level ?? 0}`}>{stateName(id)}</span>
              <span className="muted small">{restorationHint(id, registry, world)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function usePrefersReducedMotion(): boolean {
  const query = typeof window !== "undefined" ? window.matchMedia?.("(prefers-reduced-motion: reduce)") : undefined;
  const [reduced, setReduced] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const on = () => setReduced(query.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, [query]);
  return reduced;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Unavailable storage only disables these conveniences.
  }
}

function parse(text: string | null): Record<string, number> | null {
  try {
    return text ? (JSON.parse(text) as Record<string, number>) : null;
  } catch {
    return null;
  }
}
