import { PixelBuffer, shade, sprite, type Sprite } from "./pixels";

/** Small hand-drawn sprites. "." is transparent. */

const K = "#1b1f2a"; // shared dark outline

export const tree = (leaf = "#3f8f4f", light = "#6cc070", dark = "#2c6a3c"): Sprite =>
  sprite(["..ggg..", ".gGGgg.", "gGGgggd", "ggggggd", ".gggdd.", "..dtd..", "...t...", "...t..."], { g: leaf, G: light, d: dark, t: "#6b4a2b" });

export const pine = (leaf = "#2f7a52", dark = "#1f5a3c"): Sprite =>
  sprite(["...g...", "..ggd..", ".gggd..", "..ggd..", ".gggdd.", "gggggdd", "...t...", "...t..."], { g: leaf, d: dark, t: "#5a3b22" });

export const palm = (): Sprite =>
  sprite(["gg...gg", ".ggggg.", "..gtg..", "...t...", "...t...", "...t...", "..ttt.."], { g: "#58b05a", t: "#9a6b3c" });

export const deadTree = (): Sprite => sprite(["t...t", ".t.t.", "..t..", "..t..", "..t..", ".ttt."], { t: "#5b4a3c" });

export const bush = (c = "#4f9a52"): Sprite => sprite([".gg.", "gggd", ".dd."], { g: c, d: shade(c, -0.3) });

export const rock = (c = "#8a8f96"): Sprite => sprite([".rr.", "rrRr", "rrrd", ".dd."], { r: c, R: shade(c, 0.3), d: shade(c, -0.35) });

export const flowers = (c = "#f2c94c"): Sprite => sprite(["f.f", ".g.", "fg."], { f: c, g: "#3f8f4f" });

export const flag = (c = "#d94f4f"): Sprite => sprite(["pff", "pff", "p..", "p..", "p.."], { p: "#d9d4c7", f: c });

export const banner = (c = "#d94f4f", trim = "#f2c94c"): Sprite => sprite(["pbbb", "pbtb", "pbbb", "p.b.", "p...", "p..."], { p: "#cfc7b8", b: c, t: trim });

export const lantern = (): Sprite => sprite([".y.", "yYy", ".p.", ".p.", ".p."], { y: "#f2c94c", Y: "#fff3b0", p: "#3b3b46" });

export const boat = (sail = "#f4efe3", hull = "#8a5a33"): Sprite =>
  sprite(["..s...", "..ss..", "..sss.", "..p...", "hhhhhh", ".hhhh."], { s: sail, p: "#5a3b22", h: hull });

export const crate = (): Sprite => sprite(["ccc", "cdc", "ccc"], { c: "#a8794a", d: "#6b4a2b" });

export const column = (c = "#e8e2d4"): Sprite => sprite(["ccc", ".c.", ".c.", ".c.", ".c.", "ccc"], { c });

export const brokenColumn = (c = "#a9a39a"): Sprite => sprite([".c.", ".c.", "cc.", "ccc"], { c });

export const rubble = (c = "#8f877c"): Sprite => sprite(["..r.", ".rrr", "rrdr"], { r: c, d: shade(c, -0.3) });

export const car = (body = "#e2453c"): Sprite => sprite([".bb.", "bwwb", "bbbb", "k..k"], { b: body, w: "#bfe6ff", k: K });

export const character = (): Sprite =>
  sprite(["..hh..", ".hssh.", "..ss..", ".bbbb.", "s.bb.s", "..bb..", "..pp..", ".p..p."], { h: "#5a3b22", s: "#f0c8a0", b: "#2e86c1", p: "#2b2f3a" });

export const bird = (): Sprite => sprite(["w.w", ".w."], { w: "#f4efe3" });

export const anvil = (c = "#5d6470"): Sprite => sprite(["aaaaa", ".aaa.", "..a..", ".aaa."], { a: c });

export const scales = (c = "#c9963a"): Sprite => sprite(["c...c", "ccccc", "c.c.c", "..c..", "..c..", ".ccc."], { c });

/** A small building in 3/4 view: roof on top, front wall below with door and windows. */
export function building(
  buf: PixelBuffer,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { wall: string; roof: string; door?: string; window?: string; roofH?: number },
): void {
  const roofH = opts.roofH ?? Math.max(2, Math.round(h / 2));
  const wallTop = y - h;
  // roof
  buf.rect(x, wallTop - roofH, w, roofH, opts.roof);
  buf.rect(x, wallTop - roofH, w, 1, shade(opts.roof, 0.25));
  buf.rect(x, wallTop - 1, w, 1, shade(opts.roof, -0.3));
  // wall
  buf.rect(x, wallTop, w, h, opts.wall);
  buf.rect(x + w - 1, wallTop, 1, h, shade(opts.wall, -0.2));
  if (opts.door && w >= 3 && h >= 3) buf.rect(x + Math.floor(w / 2), y - 2, 1, 2, opts.door);
  if (opts.window && w >= 5 && h >= 3) {
    buf.set(x + 1, wallTop + 1, opts.window);
    buf.set(x + w - 2, wallTop + 1, opts.window);
  }
}

/** A tall, narrow tower with a pointed or flat top. */
export function tower(buf: PixelBuffer, x: number, y: number, w: number, h: number, wall: string, cap: string, pointed = true): void {
  buf.rect(x, y - h, w, h, wall);
  buf.rect(x + w - 1, y - h, 1, h, shade(wall, -0.25));
  if (pointed) {
    for (let i = 0; i < Math.ceil(w / 2) + 1; i++) buf.rect(x + i, y - h - 1 - i, Math.max(1, w - 2 * i), 1, cap);
  } else buf.rect(x - 1, y - h - 1, w + 2, 1, cap);
}

/** A half-dome sitting on (x, y) with radius r. */
export function dome(buf: PixelBuffer, x: number, y: number, r: number, c: string): void {
  for (let j = 0; j <= r; j++) {
    const half = Math.round(Math.sqrt(r * r - j * j));
    buf.rect(x - half, y - j, half * 2 + 1, 1, j === r ? shade(c, 0.3) : j > r * 0.6 ? shade(c, 0.15) : c);
  }
}
