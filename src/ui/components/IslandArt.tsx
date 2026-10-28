import { useEffect, useRef } from "react";
import { drawIsland } from "../../world/art/islands";
import { drawOcean } from "../../world/art/ocean";
import { PixelBuffer } from "../../world/art/pixels";
import * as S from "../../world/art/sprites";
import { useApp } from "../app/context";
import { levelName, restorationHint, useWorld } from "../app/world";

const PAD = 8;

function paint(canvas: HTMLCanvasElement | null, buf: PixelBuffer): void {
  if (!canvas) return;
  canvas.width = buf.w;
  canvas.height = buf.h;
  canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(buf.data), buf.w, buf.h), 0, 0);
}

/**
 * One island at its current restoration level, drawn by the same code as the
 * world map and scaled up crisply. `floating` puts the island on its own layer
 * so it can bob on the water (CSS; stilled by reduced motion).
 */
export function IslandArt({ islandId, floating = false, className = "" }: { islandId: string; floating?: boolean; className?: string }) {
  const { registry } = useApp();
  const world = useWorld();
  const sea = useRef<HTMLCanvasElement>(null);
  const land = useRef<HTMLCanvasElement>(null);
  const r = world.islands[islandId];
  const key = JSON.stringify([r?.level, r?.islets?.map((i) => i.level), world.landmarks.map((l) => l.id), world.decorations]);

  useEffect(() => {
    const art = drawIsland(islandId, { level: r?.level ?? 0, islets: r?.islets, landmarks: world.landmarks, decorations: world.decorations });
    const w = art.buf.w + PAD * 2;
    const h = art.buf.h + PAD * 2;
    const island = new PixelBuffer(w, h);
    island.blit(art.buf, PAD, PAD);
    if (art.anchors.character) island.stamp(S.character(), PAD + art.anchors.character[0], PAD + art.anchors.character[1]);
    paint(sea.current, drawOcean(w, h));
    paint(land.current, island);
    // Redraw only when what the island shows changes.
  }, [islandId, key]);

  const label = `${registry.islandById[islandId]?.name ?? "Island"}: ${levelName(islandId, registry, world)}`;
  return (
    <div className={`island-art ${floating ? "floating" : ""} ${className}`} role="img" aria-label={label}>
      <canvas ref={sea} />
      <canvas ref={land} className="island-art-land" />
    </div>
  );
}

/** The large island at the top of its page, with its restoration level and what restores it. */
export function IslandHero({ islandId }: { islandId: string }) {
  const { registry } = useApp();
  const world = useWorld();
  const level = world.islands[islandId]?.level ?? 0;
  return (
    <section className="island-hero">
      <IslandArt islandId={islandId} floating />
      <div className="island-hero-caption">
        <span className={`badge lvl-${level}`}>{levelName(islandId, registry, world)}</span>
        <div className="hero-steps" aria-label={`Restoration ${level + 1} of 5`}>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={i <= level ? "on" : ""} />
          ))}
        </div>
        <span className="muted small">{restorationHint(islandId, registry, world)}</span>
      </div>
    </section>
  );
}
