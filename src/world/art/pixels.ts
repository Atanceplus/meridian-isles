/**
 * A tiny RGBA pixel buffer and the drawing primitives the world art is built
 * from. It has no DOM dependency, so art renders the same in tests (and the
 * contact-sheet script) as in the browser, where it becomes a texture.
 */

export type RGBA = readonly [number, number, number, number];

const cache = new Map<string, RGBA>();

/** "#rgb", "#rrggbb" or "#rrggbbaa" → RGBA. */
export function rgba(color: string): RGBA {
  let c = cache.get(color);
  if (c) return c;
  let h = color.replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  c = [n(0), n(2), n(4), h.length === 8 ? n(6) : 255] as const;
  cache.set(color, c);
  return c;
}

/** Blend two colors, t = 0 → a, t = 1 → b. Result is snapped to the nearest color step so palettes stay "pixel". */
export function mix(a: string, b: string, t: number): string {
  const x = rgba(a);
  const y = rgba(b);
  const k = Math.max(0, Math.min(1, t));
  const ch = (i: number) => Math.round((x[i]! + (y[i]! - x[i]!) * k) / 4) * 4;
  return `#${[0, 1, 2].map((i) => Math.min(255, ch(i)).toString(16).padStart(2, "0")).join("")}`;
}

export function shade(color: string, amount: number): string {
  return amount >= 0 ? mix(color, "#ffffff", amount) : mix(color, "#000000", -amount);
}

export class PixelBuffer {
  readonly data: Uint8ClampedArray;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): RGBA | null {
    if (!this.inBounds(x, y)) return null;
    const i = (y * this.w + x) * 4;
    return [this.data[i]!, this.data[i + 1]!, this.data[i + 2]!, this.data[i + 3]!];
  }

  isEmpty(x: number, y: number): boolean {
    return !this.inBounds(x, y) || this.data[(y * this.w + x) * 4 + 3] === 0;
  }

  /** Paint one pixel; partially transparent colors are blended over what's there. */
  set(x: number, y: number, color: string): void {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.inBounds(x, y)) return;
    const [r, g, b, a] = rgba(color);
    const i = (y * this.w + x) * 4;
    if (a === 255 || this.data[i + 3] === 0) {
      this.data[i] = r;
      this.data[i + 1] = g;
      this.data[i + 2] = b;
      this.data[i + 3] = a;
      return;
    }
    const t = a / 255;
    this.data[i] = this.data[i]! * (1 - t) + r * t;
    this.data[i + 1] = this.data[i + 1]! * (1 - t) + g * t;
    this.data[i + 2] = this.data[i + 2]! * (1 - t) + b * t;
    this.data[i + 3] = Math.max(this.data[i + 3]!, a);
  }

  rect(x: number, y: number, w: number, h: number, color: string): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, color);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, color: string): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, color);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, color: string): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= steps; s++) this.set(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, color);
  }

  /** Draw a sprite with its bottom-center at (x, y), the way objects stand on the ground. */
  stamp(sprite: Sprite, x: number, y: number, flip = false): void {
    const ox = Math.round(x - sprite.w / 2);
    const oy = Math.round(y - sprite.h);
    for (let j = 0; j < sprite.h; j++) {
      for (let i = 0; i < sprite.w; i++) {
        const c = sprite.pixels[j * sprite.w + (flip ? sprite.w - 1 - i : i)];
        if (c) this.set(ox + i, oy + j, c);
      }
    }
  }

  /** Copy another buffer onto this one at (x, y). */
  blit(src: PixelBuffer, x: number, y: number): void {
    for (let j = 0; j < src.h; j++) {
      for (let i = 0; i < src.w; i++) {
        const p = src.get(i, j)!;
        if (p[3] === 0) continue;
        this.set(x + i, y + j, `#${[p[0], p[1], p[2], p[3]].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
      }
    }
  }
}

export interface Sprite {
  w: number;
  h: number;
  pixels: (string | null)[];
}

/** A sprite from rows of characters; "." is transparent, every other character maps through `palette`. */
export function sprite(rows: string[], palette: Record<string, string>): Sprite {
  const w = Math.max(...rows.map((r) => r.length));
  const pixels: (string | null)[] = [];
  for (const row of rows) {
    for (let i = 0; i < w; i++) {
      const ch = row[i] ?? ".";
      pixels.push(ch === "." ? null : (palette[ch] ?? null));
    }
  }
  return { w, h: rows.length, pixels };
}

/** Deterministic random numbers (mulberry32), so the same map always draws the same way. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 0..1 noise for a grid position. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
