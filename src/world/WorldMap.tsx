import { Application, Container, Graphics, Rectangle, Sprite, Texture, TilingSprite } from "pixi.js";
import { useEffect, useRef } from "react";
import { ISLAND_IDS, LAYOUT, WORLD, drawIsland, type IslandArt } from "./art/islands";
import { drawCloud, drawOcean, drawWaves } from "./art/ocean";
import { PixelBuffer } from "./art/pixels";
import * as S from "./art/sprites";
import type { WorldState } from "./restoration";

/**
 * The live world: code-drawn pixel art composed and animated with PixiJS at
 * the world's native 480×270 and scaled up crisply by CSS. Labels and click
 * targets are HTML (see WorldView), so the map stays keyboard accessible.
 * This module is loaded on demand, keeping PixiJS out of the main bundle.
 */

export interface WorldMapProps {
  world: WorldState;
  /** Previous levels per island, for the restoration time-lapse. */
  restoredFrom: Record<string, number>;
  reducedMotion: boolean;
  hovered: string | null;
  onHover(islandId: string | null): void;
  onSelect(islandId: string): void;
}

export default function WorldMap(props: WorldMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const key = sceneKey(props.world);

  useEffect(() => {
    let app: Application | null = null;
    let cancelled = false;
    (async () => {
      const a = new Application();
      await a.init({ width: WORLD.w, height: WORLD.h, background: "#164e63", antialias: false, resolution: 1, autoDensity: false, preference: "webgl" });
      if (cancelled) {
        a.destroy(true, { children: true, texture: true });
        return;
      }
      app = a;
      a.canvas.className = "world-canvas";
      a.canvas.setAttribute("aria-hidden", "true");
      host.current?.appendChild(a.canvas);
      buildScene(a, live);
    })();
    return () => {
      cancelled = true;
      app?.destroy(true, { children: true, texture: true });
    };
    // Rebuild only when the world itself changes, not on hover.
  }, [key]);

  return <div ref={host} className="world-host" />;
}

function sceneKey(w: WorldState): string {
  return JSON.stringify([Object.values(w.islands).map((i) => [i.islandId, i.level, i.islets?.map((x) => x.level)]), w.landmarks.map((l) => l.id), w.decorations]);
}

function texture(buf: PixelBuffer): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = buf.w;
  canvas.height = buf.h;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(buf.data), buf.w, buf.h), 0, 0);
  const t = Texture.from(canvas);
  t.source.scaleMode = "nearest";
  return t;
}

function spriteTexture(sp: ReturnType<typeof S.boat>): Texture {
  const buf = new PixelBuffer(sp.w, sp.h);
  buf.stamp(sp, sp.w / 2, sp.h);
  return texture(buf);
}

interface IslandNode {
  id: string;
  art: IslandArt;
  sprite: Sprite;
  baseY: number;
  fade?: { from: Sprite; t: number };
}

function buildScene(app: Application, live: { current: WorldMapProps }): void {
  const props = live.current;
  const motion = () => !live.current.reducedMotion;
  const stage = app.stage;

  stage.addChild(new Sprite(texture(drawOcean(WORLD.w, WORLD.h))));
  const waves = new TilingSprite({ texture: texture(drawWaves(160, 90, 4)), width: WORLD.w, height: WORLD.h });
  waves.alpha = 0.55;
  stage.addChild(waves);

  // Islands, back to front.
  const islands: IslandNode[] = [];
  const islandLayer = new Container();
  stage.addChild(islandLayer);
  const ids = Object.keys(LAYOUT).sort((a, b) => LAYOUT[a]!.y - LAYOUT[b]!.y);
  for (const id of ids) {
    const r = props.world.islands[id];
    if (!r) continue;
    const { x, y } = LAYOUT[id]!;
    const art = drawIsland(id, { level: r.level, islets: r.islets, landmarks: props.world.landmarks, decorations: props.world.decorations });
    const sprite = new Sprite(texture(art.buf));
    sprite.position.set(x, y);
    const node: IslandNode = { id, art, sprite, baseY: y };
    const from = props.restoredFrom[id];
    if (from !== undefined && from < r.level && motion()) {
      // Restoration time-lapse: start from the old look and cross-fade to the new one.
      const old = new Sprite(texture(drawIsland(id, { level: from as typeof r.level, islets: r.islets?.map((i) => ({ ...i, level: Math.min(i.level, from) as typeof i.level })), landmarks: [] }).buf));
      old.position.set(x, y);
      sprite.alpha = 0;
      islandLayer.addChild(old);
      node.fade = { from: old, t: 0 };
    }
    islandLayer.addChild(sprite);
    islands.push(node);
  }

  // Boats bob on their anchors.
  const boatTex = spriteTexture(S.boat());
  const boats: { s: Sprite; y: number; phase: number }[] = [];
  for (const n of islands) {
    for (const [bx, by] of n.art.anchors.boats ?? []) {
      const s = new Sprite(boatTex);
      s.anchor.set(0.5, 1);
      s.position.set(LAYOUT[n.id]!.x + bx, LAYOUT[n.id]!.y + by);
      boats.push({ s, y: s.y, phase: bx });
      stage.addChild(s);
    }
  }

  // The character stands at HQ.
  const hq = islands.find((n) => n.id === ISLAND_IDS.hq);
  const character = new Sprite(spriteTexture(S.character()));
  character.anchor.set(0.5, 1);
  if (hq?.art.anchors.character) character.position.set(LAYOUT[hq.id]!.x + hq.art.anchors.character[0], LAYOUT[hq.id]!.y + hq.art.anchors.character[1]);
  stage.addChild(character);
  const characterY = character.y;

  const fx = new Graphics();
  stage.addChild(fx);

  // Clouds drift over everything.
  const clouds = [0, 1, 2].map((i) => {
    const s = new Sprite(texture(drawCloud(i + 1)));
    s.position.set((i * 173) % WORLD.w, 20 + i * 80);
    s.alpha = 0.55;
    stage.addChild(s);
    return s;
  });

  const smoke: { x: number; y: number; life: number }[] = [];
  let time = 0;
  let flash = 0;

  const frame = (dt: number) => {
    time += dt;
    const hovered = live.current.hovered;

    waves.tilePosition.x = -time * 0.004;
    waves.tilePosition.y = Math.sin(time / 2400) * 2;
    waves.alpha = 0.45 + Math.sin(time / 1300) * 0.12;

    for (const n of islands) {
      // Hovered islands lift by one pixel.
      n.sprite.y = n.baseY - (hovered === n.id ? 1 : 0);
      if (n.fade) {
        n.fade.t += dt / 1800;
        n.sprite.alpha = Math.min(1, n.fade.t);
        n.fade.from.alpha = 1 - n.sprite.alpha;
        if (n.fade.t >= 1) {
          n.fade.from.destroy();
          delete n.fade;
        }
      }
    }
    for (const b of boats) b.s.y = b.y + Math.round(Math.sin(time / 600 + b.phase));
    character.y = characterY - (Math.floor(time / 500) % 2);
    for (const [i, c] of clouds.entries()) {
      c.x += dt * (0.003 + i * 0.001);
      if (c.x > WORLD.w) c.x = -40;
    }

    fx.clear();
    for (const n of islands) {
      const ox = LAYOUT[n.id]!.x;
      const oy = LAYOUT[n.id]!.y;
      const a = n.art.anchors;

      if (a.smoke && Math.random() < dt / 180) smoke.push({ x: ox + a.smoke[0] + (Math.random() * 4 - 2), y: oy + a.smoke[1], life: 0 });

      for (const l of a.lights ?? []) {
        const on = !l.blink || Math.floor((time + l.at[0] * 37) / 700) % 2 === 0;
        if (on) fx.rect(ox + l.at[0], oy + l.at[1], 1, 1).fill(l.color);
        if (on && !l.blink) fx.rect(ox + l.at[0] - 1, oy + l.at[1] - 1, 3, 3).fill({ color: l.color, alpha: 0.25 + Math.sin(time / 300 + l.at[0]) * 0.08 });
      }

      if (a.track) {
        const angle = time / 1400;
        const cx = ox + a.track.cx + Math.cos(angle) * a.track.rx * 0.94;
        const cy = oy + a.track.cy + Math.sin(angle) * a.track.ry * 0.94;
        fx.rect(Math.round(cx) - 1, Math.round(cy) - 1, 3, 2).fill("#e2453c");
        fx.rect(Math.round(cx), Math.round(cy) - 1, 1, 1).fill("#bfe6ff");
      }

      for (const f of a.fog ?? []) {
        const pulse = 0.55 + Math.sin(time / 1800 + f.cx) * 0.1;
        fx.ellipse(ox + f.cx, oy + f.cy, f.rx, f.ry).fill({ color: "#c8cdd4", alpha: pulse * 0.6 });
        fx.ellipse(ox + f.cx + 3, oy + f.cy - 2, f.rx * 0.6, f.ry * 0.6).fill({ color: "#e4e7ea", alpha: pulse * 0.45 });
      }

      if (a.storm) {
        const cx = ox + a.label[0];
        const cy = oy + 14;
        fx.ellipse(cx - 10, cy, 14, 5).fill({ color: "#3a3550", alpha: 0.75 });
        fx.ellipse(cx + 8, cy + 1, 16, 6).fill({ color: "#2e2a42", alpha: 0.75 });
        if (motion() && flash <= 0 && Math.random() < dt / 6000) flash = 120;
        if (flash > 0) {
          fx.rect(cx - 2, cy + 5, 1, 4).fill("#fff7c2");
          fx.rect(cx - 1, cy + 9, 1, 4).fill("#fff7c2");
          fx.rect(ox, oy, n.art.buf.w, n.art.buf.h).fill({ color: "#ffffff", alpha: 0.08 });
        }
      }
    }
    if (flash > 0) flash -= dt;

    for (const p of smoke) {
      p.life += dt;
      p.y -= dt * 0.006;
      p.x += Math.sin((p.life + p.y) / 400) * 0.03;
    }
    for (let i = smoke.length - 1; i >= 0; i--) if (smoke[i]!.life > 3500) smoke.splice(i, 1);
    for (const p of smoke) {
      const k = p.life / 3500;
      fx.rect(Math.round(p.x), Math.round(p.y), k < 0.3 ? 1 : 2, k < 0.3 ? 1 : 2).fill({ color: k < 0.15 ? "#ffb347" : "#b8b2ac", alpha: 0.8 * (1 - k) });
    }

    // Hover outline under the label point.
    if (hovered && LAYOUT[hovered]) {
      const l = LAYOUT[hovered]!;
      fx.rect(l.x + 2, l.y + l.h - 2, l.w - 4, 1).fill({ color: "#ffffff", alpha: 0.35 });
    }
  };

  // Pointer: an island is hit where its art has a painted pixel (topmost first).
  const at = (e: MouseEvent): string | null => {
    const r = app.canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * WORLD.w);
    const y = Math.floor(((e.clientY - r.top) / r.height) * WORLD.h);
    for (const n of [...islands].reverse()) {
      const l = LAYOUT[n.id]!;
      if (!n.art.buf.isEmpty(x - l.x, y - l.y)) return n.id;
    }
    return null;
  };
  app.canvas.addEventListener("pointermove", (e) => {
    const id = at(e);
    app.canvas.style.cursor = id ? "pointer" : "default";
    if (id !== live.current.hovered) live.current.onHover(id);
  });
  app.canvas.addEventListener("pointerleave", () => live.current.onHover(null));
  app.canvas.addEventListener("click", (e) => {
    const id = at(e);
    if (id) live.current.onSelect(id);
  });

  // Draw once so reduced motion still shows a complete (static) picture.
  frame(16);
  app.render();
  if (import.meta.env.DEV) {
    // Dev-only: lets tooling grab the rendered world even when the window isn't painting.
    (window as unknown as { __meridianWorld?: unknown }).__meridianWorld = {
      pixels: () => app.renderer.extract.pixels({ target: app.stage, frame: new Rectangle(0, 0, WORLD.w, WORLD.h) }),
      tick: (ms: number) => {
        frame(ms);
        app.render();
      },
    };
  }
  app.ticker.add((t) => {
    if (!motion()) {
      // Finish any time-lapse instantly and hold still.
      for (const n of islands) if (n.fade) frame(2000);
      frame(0);
      return;
    }
    frame(Math.min(t.deltaMS, 50));
  });
}
