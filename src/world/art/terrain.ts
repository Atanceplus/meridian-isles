import { PixelBuffer, hash2, mix } from "./pixels";

/**
 * Landmasses in a three-quarter view: grass top, sandy rim, a cliff band below
 * the southern edge, and a ring of shallow water. Island canvases are otherwise
 * transparent, so the animated ocean shows through.
 */

export interface LandStyle {
  grass: string;
  grassDark: string;
  grassLight: string;
  sand: string;
  cliff: string;
  cliffDark: string;
  shallow: string;
}

/** Blend two styles: t = 0 ruined, t = 1 fully restored. */
export function lerpStyle(a: LandStyle, b: LandStyle, t: number): LandStyle {
  const out = {} as LandStyle;
  for (const k of Object.keys(a) as (keyof LandStyle)[]) out[k] = mix(a[k], b[k], t);
  return out;
}

export type Shape = (x: number, y: number) => boolean;

/** An irregular ellipse: the radius wobbles with a few seeded sine waves. */
export function blob(cx: number, cy: number, rx: number, ry: number, seed: number, wobble = 0.08): Shape {
  const p = [hash2(seed, 1) * 6.28, hash2(seed, 2) * 6.28, hash2(seed, 3) * 6.28];
  return (x, y) => {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    const a = Math.atan2(dy, dx);
    const r = 1 + wobble * (Math.sin(2 * a + p[0]!) + 0.6 * Math.sin(3 * a + p[1]!) + 0.35 * Math.sin(5 * a + p[2]!));
    return dx * dx + dy * dy <= r * r;
  };
}

export function union(...shapes: Shape[]): Shape {
  return (x, y) => shapes.some((s) => s(x, y));
}

export function minus(a: Shape, b: Shape): Shape {
  return (x, y) => a(x, y) && !b(x, y);
}

export function drawLand(buf: PixelBuffer, inside: Shape, style: LandStyle, opts: { cliff?: number; seed?: number; shallow?: number } = {}): void {
  const cliffH = opts.cliff ?? 3;
  const seed = opts.seed ?? 1;
  const ring = opts.shallow ?? 2;
  const land = (x: number, y: number) => x >= 0 && y >= 0 && x < buf.w && y < buf.h && inside(x, y);
  const cliffAt = (x: number, y: number) => {
    if (land(x, y)) return 0;
    for (let k = 1; k <= cliffH; k++) if (land(x, y - k)) return k;
    return 0;
  };

  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      if (land(x, y)) {
        const edge = !land(x - 1, y) || !land(x + 1, y) || !land(x, y - 1) || !land(x, y + 1);
        const nearEdge = !land(x - 2, y) || !land(x + 2, y) || !land(x, y - 2) || !land(x, y + 2);
        const n = hash2(x, y, seed);
        if (edge) buf.set(x, y, style.sand);
        else if (nearEdge && n < 0.5) buf.set(x, y, mix(style.sand, style.grass, 0.5));
        else if (!land(x - 2, y - 2)) buf.set(x, y, style.grassLight);
        else {
          // Soft 4×4 patches of tone, with only a sprinkle of single-pixel detail.
          const patch = hash2(x >> 2, (y + ((x >> 2) & 1) * 2) >> 2, seed + 3);
          const base = patch < 0.28 ? mix(style.grass, style.grassDark, 0.45) : patch > 0.82 ? mix(style.grass, style.grassLight, 0.35) : style.grass;
          buf.set(x, y, n < 0.035 ? style.grassDark : n > 0.985 ? style.grassLight : base);
        }
        continue;
      }
      const k = cliffAt(x, y);
      if (k > 0) {
        buf.set(x, y, k === cliffH || hash2(x, y, seed + 7) < 0.15 ? style.cliffDark : style.cliff);
        continue;
      }
      // Shallow water ring, dithered at its outer edge.
      for (let d = 1; d <= ring; d++) {
        if (land(x - d, y) || land(x + d, y) || land(x, y - d) || land(x, y + d) || cliffAt(x, y - d) || cliffAt(x - d, y) || cliffAt(x + d, y)) {
          if (d < ring || (x + y) % 2 === 0) buf.set(x, y, style.shallow);
          break;
        }
      }
    }
  }
}

/** Scatter points inside a shape, keeping them `margin` pixels from its edge. */
export function scatter(inside: Shape, w: number, h: number, count: number, seed: number, margin = 3): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < count * 30 && out.length < count; i++) {
    const x = Math.floor(hash2(i, 11, seed) * w);
    const y = Math.floor(hash2(i, 17, seed) * h);
    if (!inside(x, y)) continue;
    if (!inside(x - margin, y) || !inside(x + margin, y) || !inside(x, y - margin) || !inside(x, y + margin)) continue;
    if (out.some(([px, py]) => Math.abs(px - x) < 4 && Math.abs(py - y) < 3)) continue;
    out.push([x, y]);
  }
  return out.sort((a, b) => a[1] - b[1]);
}
