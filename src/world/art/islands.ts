import type { UpgradeCategory } from "../../persistence/types";
import type { Landmark, RestorationLevel } from "../restoration";
import { PixelBuffer, hash2, mix, shade } from "./pixels";
import * as S from "./sprites";
import { blob, drawLand, lerpStyle, minus, scatter, union, type LandStyle, type Shape } from "./terrain";

/**
 * Island art, one function per island. Each draws into its own transparent
 * buffer for a restoration level 0–4 and reports anchors where the live map
 * adds animation (smoke, blinking lights, a car on the track, fog, boats).
 */

export const WORLD = { w: 480, h: 270 } as const;

export const ISLAND_IDS = {
  hq: "core:island.hq",
  archipelago: "fe:island.carrier-archipelago",
  foundry: "core:island.script-foundry",
  court: "core:island.court-of-objections",
  broadcast: "core:island.last-broadcast",
  cove: "core:island.conversation-cove",
  velocity: "core:island.velocity-circuit",
} as const;

/** Where each island's canvas sits on the 480×270 world. */
export const LAYOUT: Record<string, { x: number; y: number; w: number; h: number }> = {
  [ISLAND_IDS.hq]: { x: 178, y: 86, w: 124, h: 100 },
  [ISLAND_IDS.archipelago]: { x: 8, y: 6, w: 156, h: 104 },
  [ISLAND_IDS.foundry]: { x: 352, y: 4, w: 104, h: 92 },
  [ISLAND_IDS.court]: { x: 372, y: 108, w: 100, h: 90 },
  [ISLAND_IDS.broadcast]: { x: 276, y: 194, w: 124, h: 72 },
  [ISLAND_IDS.cove]: { x: 70, y: 184, w: 124, h: 84 },
  [ISLAND_IDS.velocity]: { x: 6, y: 116, w: 108, h: 66 },
};

export interface Anchors {
  /** Point above the island where its label sits (local coordinates). */
  label: [number, number];
  smoke?: [number, number];
  lights?: { at: [number, number]; color: string; blink: boolean }[];
  track?: { cx: number; cy: number; rx: number; ry: number };
  fog?: { cx: number; cy: number; rx: number; ry: number }[];
  boats?: [number, number][];
  character?: [number, number];
  storm?: boolean;
  /** Hit-test shape in local coordinates. */
  hit: Shape;
}

export interface IslandArt {
  buf: PixelBuffer;
  anchors: Anchors;
}

export interface DrawInput {
  level: RestorationLevel;
  islets?: { key: string; label: string; level: RestorationLevel }[];
  landmarks?: Landmark[];
  decorations?: UpgradeCategory[];
}

export function drawIsland(islandId: string, input: DrawInput): IslandArt {
  const draw = DRAWERS[islandId];
  if (!draw) throw new Error(`No art for island "${islandId}"`);
  const { w, h } = LAYOUT[islandId]!;
  const buf = new PixelBuffer(w, h);
  return { buf, anchors: draw(buf, input) };
}

// ---------- Palettes: ruined → restored ----------

const GREEN: LandStyle = { grass: "#4f9a4f", grassDark: "#3c7c42", grassLight: "#79c46a", sand: "#e8d79c", cliff: "#8a6a4a", cliffDark: "#5e4632", shallow: "#7fd0d8aa" };
const DRY: LandStyle = { grass: "#9a9468", grassDark: "#7e7a56", grassLight: "#b5ae80", sand: "#cfc3a0", cliff: "#7a6a58", cliffDark: "#54493d", shallow: "#7aa6acaa" };
const ASH: LandStyle = { grass: "#5e5a58", grassDark: "#4a4644", grassLight: "#77716e", sand: "#8c847c", cliff: "#4c4644", cliffDark: "#332f2e", shallow: "#6f8c92aa" };
const STORM: LandStyle = { grass: "#6a6478", grassDark: "#57516a", grassLight: "#837c92", sand: "#a39fae", cliff: "#5c566a", cliffDark: "#3e3a4a", shallow: "#6c7f98aa" };
const MARBLE: LandStyle = { grass: "#5aa65a", grassDark: "#468a4a", grassLight: "#86cc72", sand: "#efe6c8", cliff: "#cfc6b4", cliffDark: "#a39a88", shallow: "#86d6dcaa" };
const WASTE: LandStyle = { grass: "#8a8a3a", grassDark: "#6e6a2c", grassLight: "#a8a050", sand: "#a8784a", cliff: "#7a5232", cliffDark: "#523622", shallow: "#7a9a7aaa" };
const GREY_DOCK: LandStyle = { grass: "#7e8a86", grassDark: "#69746f", grassLight: "#97a29d", sand: "#b6b2a6", cliff: "#6e6a62", cliffDark: "#4c4944", shallow: "#7899a4aa" };
const ASPHALT: LandStyle = { grass: "#7d7f74", grassDark: "#686a60", grassLight: "#94968a", sand: "#b8b09a", cliff: "#6a6458", cliffDark: "#4a463e", shallow: "#7899a4aa" };

const style = (ruined: LandStyle, restored: LandStyle, level: number) => lerpStyle(ruined, restored, level / 4);

// ---------- Headquarters ----------

/** Plaza slots for landmarks, in the order of LANDMARKS. */
const HQ_SLOTS: Record<string, [number, number]> = {
  antenna: [30, 40],
  "radio-tower": [96, 38],
  "harbor-fort": [18, 62],
  flagship: [110, 84],
  scales: [44, 64],
  dome: [82, 30],
  lighthouse: [104, 58],
  hearth: [74, 70],
  monorail: [26, 74],
  spire: [60, 24],
};

function drawHq(buf: PixelBuffer, { level, landmarks = [], decorations = [] }: DrawInput): Anchors {
  const shape = blob(62, 54, 50, 32, 101, 0.07);
  drawLand(buf, shape, style(DRY, GREEN, Math.max(level, 1)), { cliff: 4, seed: 101 });
  const cx = 62;
  const ground = 54;
  const lights: Anchors["lights"] = [];

  for (const [x, y] of scatter(shape, buf.w, buf.h, 6 + level * 3, 102, 5)) {
    if (Math.abs(x - cx) < 20 && Math.abs(y - ground) < 10) continue;
    buf.stamp(level >= 2 && hash2(x, y) > 0.5 ? S.tree() : level >= 1 ? S.bush() : S.rock(), x, y);
  }

  // Path to the dock on the south shore.
  if (level >= 1) {
    const path = mix("#c9b27a", "#d8cfb4", level / 4);
    for (let y = ground; y < 84; y++) buf.rect(cx - 1 + Math.round(Math.sin(y / 5)), y, 3, 1, path);
    buf.rect(cx - 2, 84, 5, 6, "#8a5a33");
    buf.rect(cx - 2, 84, 5, 1, "#a8794a");
  }
  if (level >= 4) buf.ellipse(cx, ground + 4, 22, 7, "#d8cfb4");

  switch (level) {
    case 0:
      // Camp: a tent and a fire.
      buf.rect(cx - 6, ground - 6, 12, 1, "#c96f3c");
      for (let i = 0; i < 6; i++) buf.rect(cx - 6 + i, ground - 6 + i, 12 - 2 * i, 1, i % 2 ? "#b05a2e" : "#d9814a");
      buf.set(cx + 10, ground - 1, "#6b4a2b");
      buf.set(cx + 11, ground - 1, "#6b4a2b");
      lights.push({ at: [cx + 10, ground - 2], color: "#ffb347", blink: true });
      break;
    case 1:
      S.building(buf, cx - 6, ground, 12, 6, { wall: "#b8865a", roof: "#7a4a2e", door: "#4a2e1c", window: "#f2e3a0" });
      break;
    case 2:
      S.building(buf, cx - 9, ground, 18, 8, { wall: "#e6dcc6", roof: "#2f7f8a", door: "#5a3b22", window: "#9fd8ff" });
      S.building(buf, cx + 10, ground, 7, 5, { wall: "#d8cdb4", roof: "#2f7f8a" });
      break;
    case 3:
      S.building(buf, cx - 13, ground, 26, 10, { wall: "#f1ead8", roof: "#1f8a8a", door: "#5a3b22", window: "#9fd8ff", roofH: 6 });
      S.building(buf, cx + 14, ground, 9, 6, { wall: "#e6dcc6", roof: "#1f8a8a" });
      S.building(buf, cx - 22, ground, 8, 6, { wall: "#e6dcc6", roof: "#1f8a8a" });
      break;
    default:
      S.building(buf, cx - 15, ground, 30, 12, { wall: "#f7f1e2", roof: "#13797d", door: "#5a3b22", window: "#bfe6ff", roofH: 7 });
      S.tower(buf, cx - 22, ground, 6, 20, "#f1ead8", "#13797d");
      S.building(buf, cx + 16, ground, 10, 7, { wall: "#efe6d2", roof: "#13797d" });
      buf.stamp(S.flag("#f2c94c"), cx - 19, ground - 23);
      buf.stamp(S.flag("#2e86c1"), cx + 20, ground - 14);
      break;
  }

  for (const l of landmarks) {
    const at = HQ_SLOTS[l.id];
    if (at) drawLandmark(buf, l.id, at[0], at[1], lights);
  }
  for (const d of decorations) {
    const at = WHARF_SLOTS[d];
    if (at) drawDecoration(buf, d, at[0], at[1], lights);
  }

  return { label: [cx, 6], lights, character: [cx + (level === 0 ? 4 : 2), ground + 3], hit: shape };
}

/** The Outfitter's Wharf: purchases show up along HQ's south shore. */
const WHARF_SLOTS: Record<UpgradeCategory, [number, number]> = {
  leads: [48, 80],
  crm: [78, 80],
  dialer: [88, 74],
  training: [52, 86],
  equipment: [72, 86],
  service: [96, 67],
  other: [40, 85],
};

function drawDecoration(buf: PixelBuffer, category: UpgradeCategory, x: number, y: number, lights: NonNullable<Anchors["lights"]>): void {
  switch (category) {
    case "leads":
      buf.stamp(S.crate(), x - 2, y);
      buf.stamp(S.crate(), x + 1, y);
      buf.stamp(S.crate(), x, y - 3);
      break;
    case "crm":
      S.building(buf, x - 3, y, 6, 4, { wall: "#e6dcc6", roof: "#2e86c1", roofH: 2 });
      buf.set(x - 2, y - 3, "#9fd8ff");
      lights.push({ at: [x - 2, y - 3], color: "#9fd8ff", blink: false });
      break;
    case "dialer":
      buf.rect(x - 1, y - 6, 3, 6, "#d94f4f");
      buf.rect(x, y - 5, 1, 2, "#bfe6ff");
      break;
    case "training":
      buf.rect(x - 3, y - 3, 7, 3, "#8a5a33");
      ["#d94f4f", "#2e86c1", "#f2c94c", "#5a8a2e", "#7b5ea7"].forEach((c, i) => buf.rect(x - 2 + i, y - 5, 1, 2, c));
      break;
    case "equipment":
      S.building(buf, x - 3, y, 7, 4, { wall: "#a8794a", roof: "#5e4a32", roofH: 2, door: "#3b2a1a" });
      break;
    case "service":
      buf.stamp(S.banner("#1f9a8a", "#f4efe3"), x, y);
      break;
    case "other":
      buf.ellipse(x, y - 2, 2, 2, "#8a5a33");
      buf.rect(x - 2, y - 2, 5, 1, "#5e3c22");
      break;
  }
}

function drawLandmark(buf: PixelBuffer, id: string, x: number, y: number, lights: NonNullable<Anchors["lights"]>): void {
  switch (id) {
    case "antenna":
      buf.line(x, y, x, y - 14, "#9aa1ab");
      buf.line(x - 3, y, x, y - 8, "#9aa1ab");
      buf.line(x + 3, y, x, y - 8, "#9aa1ab");
      lights.push({ at: [x, y - 15], color: "#ff4d4d", blink: true });
      break;
    case "radio-tower":
      buf.line(x, y, x, y - 22, "#d4a017");
      buf.line(x - 4, y, x, y - 12, "#d4a017");
      buf.line(x + 4, y, x, y - 12, "#d4a017");
      lights.push({ at: [x, y - 23], color: "#fff3b0", blink: true });
      break;
    case "harbor-fort":
      buf.rect(x - 5, y - 6, 11, 6, "#b8a88a");
      for (let i = 0; i < 11; i += 2) buf.set(x - 5 + i, y - 7, "#b8a88a");
      buf.rect(x + 5, y - 6, 1, 6, "#8f8166");
      buf.stamp(S.banner("#b7852b"), x, y - 6);
      break;
    case "flagship":
      buf.stamp(S.boat("#f7f1e2", "#5a3b22"), x, y);
      buf.stamp(S.flag("#d4a017"), x + 1, y - 6);
      break;
    case "scales":
      buf.rect(x - 2, y - 2, 5, 2, "#cfc6b4");
      buf.stamp(S.scales(), x, y - 2);
      break;
    case "dome":
      buf.rect(x - 5, y - 5, 11, 5, "#efe6d2");
      S.dome(buf, x, y - 6, 5, "#c9963a");
      break;
    case "lighthouse":
      for (let i = 0; i < 12; i++) buf.rect(x - 1, y - i, 3, 1, Math.floor(i / 3) % 2 ? "#d94f4f" : "#f7f1e2");
      lights.push({ at: [x, y - 13], color: "#fff3b0", blink: false });
      break;
    case "hearth":
      buf.ellipse(x, y - 1, 6, 2, "#c9b27a");
      for (const dx of [-5, 0, 5]) {
        buf.stamp(S.lantern(), x + dx, y);
        lights.push({ at: [x + dx, y - 4], color: "#ffd166", blink: false });
      }
      break;
    case "monorail":
      buf.rect(x - 12, y - 6, 24, 1, "#9aa1ab");
      for (let i = -12; i <= 12; i += 6) buf.rect(x + i, y - 6, 1, 6, "#7a808a");
      buf.rect(x - 4, y - 9, 8, 3, "#e2453c");
      buf.rect(x - 3, y - 8, 6, 1, "#bfe6ff");
      break;
    case "spire":
      for (let i = 0; i < 20; i++) buf.rect(x - (i < 6 ? 1 : 0), y - i, i < 6 ? 3 : 1, 1, i % 4 === 0 ? "#fff3b0" : "#d4a017");
      lights.push({ at: [x, y - 21], color: "#fffbe0", blink: true });
      break;
  }
}

// ---------- Carrier Archipelago ----------

const BANNERS = ["#d94f4f", "#2e86c1", "#7b5ea7", "#d4a017", "#1f9a8a", "#e07a2e", "#c2457a", "#5a8a2e"];

function drawArchipelago(buf: PixelBuffer, { islets = [] }: DrawInput): Anchors {
  const n = Math.max(1, islets.length);
  const fog: NonNullable<Anchors["fog"]> = [];
  const shapes: Shape[] = [];
  islets.forEach((islet, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const cx = Math.round(78 + Math.cos(a) * 56);
    const cy = Math.round(54 + Math.sin(a) * 34);
    const shape = blob(cx, cy, 14, 9, 200 + i, 0.1);
    shapes.push(shape);
    drawLand(buf, shape, style(STORM, GREEN, islet.level), { cliff: 2, seed: 200 + i });
    const base = cy + 3;
    switch (islet.level) {
      case 0:
        buf.stamp(S.rubble(), cx - 3, base);
        buf.stamp(S.brokenColumn(), cx + 3, base);
        break;
      case 1:
        for (let j = 0; j < 4; j++) buf.rect(cx - 3 + j, base - 4 + j, 7 - 2 * j, 1, "#c96f3c");
        buf.stamp(S.bush(), cx + 6, base);
        break;
      default: {
        const w = islet.level >= 4 ? 13 : islet.level >= 3 ? 11 : 9;
        const h = islet.level >= 4 ? 7 : 5;
        buf.rect(cx - Math.floor(w / 2), base - h, w, h, "#cbbd9e");
        buf.rect(cx + Math.ceil(w / 2) - 1, base - h, 1, h, "#9f9175");
        for (let k = 0; k < w; k += 2) buf.set(cx - Math.floor(w / 2) + k, base - h - 1, "#cbbd9e");
        buf.set(cx, base - 1, "#4a2e1c");
        if (islet.level >= 3) buf.stamp(S.banner(BANNERS[i % BANNERS.length]!, islet.level >= 4 ? "#ffe17a" : "#f4efe3"), cx + 1, base - h);
        if (islet.level >= 4) buf.stamp(S.tree(), cx - 9, base + 1);
        break;
      }
    }
    if (islet.level < 2) fog.push({ cx, cy, rx: islet.level === 0 ? 16 : 12, ry: islet.level === 0 ? 11 : 8 });
  });
  return { label: [78, 4], fog, hit: union(...shapes, blob(78, 54, 70, 46, 1, 0)) };
}

// ---------- Script Foundry ----------

function drawFoundry(buf: PixelBuffer, { level }: DrawInput): Anchors {
  const shape = blob(52, 64, 44, 22, 301, 0.08);
  drawLand(buf, shape, style(ASH, { ...GREEN, grass: "#6a8a4a", grassDark: "#566e3c" }, level), { cliff: 4, seed: 301 });
  const lava = level === 0 ? "#6b6460" : mix("#c0541c", "#ffb347", (level - 1) / 3);
  const rockC = mix("#55504c", "#6e5446", level / 4);

  // Cone, from base (y=60) up to the caldera (y=20).
  for (let y = 20; y <= 60; y++) {
    const half = Math.round(6 + (y - 20) * 0.62);
    for (let x = 52 - half; x <= 52 + half; x++) {
      const lightSide = x < 52 - half / 3;
      buf.set(x, y, hash2(x, y, 9) < 0.1 ? shade(rockC, -0.2) : lightSide ? shade(rockC, 0.12) : x > 52 + half / 2 ? shade(rockC, -0.15) : rockC);
    }
  }
  buf.ellipse(52, 21, 6, 2, level === 0 ? "#3e3a38" : lava);
  if (level >= 3) {
    // Lava channels running down the cone.
    for (const dx of [-3, 4]) for (let y = 23; y < 50; y++) buf.set(52 + dx + Math.round(Math.sin(y / 3) * 1.5) + Math.round((y - 23) * dx * 0.08), y, lava);
  }

  const base = 74;
  if (level === 0) {
    buf.stamp(S.anvil("#4a4644"), 30, base);
    buf.stamp(S.rubble("#6e6862"), 74, base);
    buf.stamp(S.deadTree(), 84, base - 2);
  } else {
    buf.stamp(S.anvil(), 28, base);
    if (level >= 2) S.building(buf, 66, base, 14, 7, { wall: "#8a6a52", roof: "#4a3a32", door: "#ffb347", window: "#ffd38a" });
    if (level >= 3) S.tower(buf, 16, base, 5, 14, "#b08a5a", "#6e5a3a");
    if (level >= 4) {
      S.building(buf, 38, base + 2, 12, 5, { wall: "#c9963a", roof: "#8a6424", window: "#fff3b0" });
      buf.stamp(S.flag("#ffb347"), 70, base - 15);
    }
    for (const [x, y] of scatter(shape, buf.w, buf.h, level * 2, 302, 4)) if (y > 66) buf.stamp(level >= 3 ? S.pine() : S.bush("#6a8a4a"), x, y);
  }
  const lights: Anchors["lights"] = level >= 2 ? [{ at: [72, base - 3], color: "#ffb347", blink: false }] : [];
  return { label: [52, 4], smoke: level >= 1 ? [52, 18] : undefined, lights, hit: union(shape, blob(52, 40, 22, 24, 1, 0)) };
}

// ---------- Court of Objections ----------

function drawCourt(buf: PixelBuffer, { level }: DrawInput): Anchors {
  const shape = blob(50, 46, 42, 24, 401, 0.06);
  drawLand(buf, shape, style(STORM, MARBLE, level), { cliff: 9, seed: 401 });
  const base = 50;
  const marble = mix("#a9a39a", "#f4efe3", level / 4);

  if (level === 0) {
    for (const [x, dx] of [
      [28, 0],
      [38, 1],
      [60, 0],
      [70, 1],
    ] as const)
      buf.stamp(dx ? S.rubble(marble) : S.brokenColumn(marble), x, base);
    buf.stamp(S.deadTree(), 82, base + 4);
  } else if (level === 1) {
    buf.rect(32, base - 1, 36, 2, marble);
    buf.stamp(S.column(marble), 40, base - 1);
    buf.stamp(S.column(marble), 58, base - 1);
    buf.stamp(S.rubble(marble), 74, base + 2);
  } else {
    // Steps, columns, and (from level 3) the pediment roof.
    buf.rect(28, base - 1, 44, 2, shade(marble, -0.1));
    buf.rect(30, base - 3, 40, 2, marble);
    const top = base - 13;
    for (let x = 32; x <= 66; x += 6) buf.stamp(S.column(marble), x, base - 3);
    if (level >= 3) {
      buf.rect(29, top - 1, 42, 2, marble);
      for (let i = 0; i < 6; i++) buf.rect(31 + i * 3, top - 2 - i, 38 - i * 6, 1, shade(marble, i === 0 ? 0 : 0.1));
    } else buf.rect(30, top, 40, 1, marble);
    if (level >= 4) {
      S.dome(buf, 50, top - 8, 6, "#d4a017");
      buf.stamp(S.scales(), 50, base + 9);
      buf.stamp(S.banner("#7b5ea7", "#f2c94c"), 24, base);
      buf.stamp(S.banner("#7b5ea7", "#f2c94c"), 78, base);
    }
    for (const [x, y] of scatter(shape, buf.w, buf.h, level * 2, 402, 4)) if (y > base + 3) buf.stamp(S.pine("#3f8a5a"), x, y);
  }
  return { label: [50, 4], storm: level < 2, hit: union(shape, blob(50, 60, 44, 20, 1, 0)) };
}

// ---------- Last Broadcast ----------

function drawBroadcast(buf: PixelBuffer, { level }: DrawInput): Anchors {
  const shape = blob(62, 40, 56, 22, 501, 0.07);
  drawLand(buf, shape, style(WASTE, GREEN, level), { cliff: 2, seed: 501 });
  // Cracks fade as the land heals.
  if (level < 3) {
    for (let i = 0; i < 9 - level * 3; i++) {
      const x = 20 + Math.floor(hash2(i, 1, 503) * 84);
      const y = 30 + Math.floor(hash2(i, 2, 503) * 18);
      if (shape(x, y)) buf.line(x, y, x + 4, y + 1 + (i % 2), shade("#6e6a2c", -0.25));
    }
  }
  const mastX = 70;
  const base = 44;
  const lights: Anchors["lights"] = [];
  if (level === 0) {
    buf.line(mastX, base, mastX + 12, base - 9, "#6e6a62"); // fallen mast
    buf.stamp(S.deadTree(), 30, base);
    buf.stamp(S.deadTree(), 96, base - 2);
    buf.stamp(S.rubble("#7a6a5a"), 52, base);
  } else {
    const height = 16 + level * 4;
    buf.line(mastX, base, mastX, base - height, level >= 4 ? "#d4a017" : "#9aa1ab");
    buf.line(mastX - 4, base, mastX, base - height / 2, "#7a808a");
    buf.line(mastX + 4, base, mastX, base - height / 2, "#7a808a");
    lights.push({ at: [mastX, base - height - 1], color: "#ff4d4d", blink: true });
    S.building(buf, 46, base, level >= 2 ? 14 : 8, level >= 2 ? 7 : 5, { wall: level >= 2 ? "#d8cdb4" : "#8a7a62", roof: level >= 2 ? "#7a8b2e" : "#5e4a32", door: "#4a2e1c", window: "#ffe9a0" });
    if (level >= 2) lights.push({ at: [47, base - 6], color: "#ffe9a0", blink: false });
    if (level >= 4) {
      buf.ellipse(mastX + 6, base - height + 6, 3, 2, "#e8e2d4");
      buf.set(mastX + 6, base - height + 6, "#9aa1ab");
    }
    for (const [x, y] of scatter(shape, buf.w, buf.h, level * 4, 504, 4)) {
      if (Math.abs(x - mastX) < 6 || (x > 42 && x < 64 && y < base + 2)) continue;
      buf.stamp(level >= 3 && hash2(x, y) > 0.4 ? S.tree() : level >= 2 ? S.bush() : S.flowers("#c9c35a"), x, y);
    }
    if (level >= 4) for (const [x, y] of scatter(shape, buf.w, buf.h, 6, 505, 3)) buf.stamp(S.flowers(), x, y);
  }
  return { label: [62, 6], lights, hit: shape };
}

// ---------- Conversation Cove ----------

function drawCove(buf: PixelBuffer, { level }: DrawInput): Anchors {
  // A crescent: a big blob with a bay cut out of its south side.
  const shape = minus(blob(62, 36, 54, 28, 601, 0.05), blob(62, 60, 30, 22, 602, 0.03));
  drawLand(buf, shape, style(GREY_DOCK, GREEN, level), { cliff: 3, seed: 601 });
  const wood = level === 0 ? "#6e6458" : "#9a6b3c";
  // Pier into the bay; broken while ruined.
  for (let y = 40; y < 64; y++) if (level > 0 || hash2(0, y, 7) > 0.35) buf.rect(60, y, 4, 1, y % 3 ? wood : shade(wood, -0.25));

  const lights: Anchors["lights"] = [];
  const boats: [number, number][] = [];
  if (level === 0) {
    buf.stamp(S.crate(), 24, 30);
    buf.stamp(S.rubble("#7e7468"), 98, 32);
  }
  if (level >= 2) {
    const roofs = ["#c2457a", "#2e86c1", "#e07a2e"];
    [18, 32, 90].forEach((x, i) => S.building(buf, x, 34 - (i === 1 ? 4 : 0), 9, 6, { wall: "#efe6d2", roof: roofs[i]!, door: "#5a3b22", window: "#ffe9a0" }));
  }
  if (level >= 3) {
    // Market stalls with striped awnings, and boats in the bay.
    for (const [x, c] of [
      [46, "#d94f4f"],
      [74, "#2e86c1"],
    ] as const) {
      buf.rect(x, 28, 7, 2, c);
      buf.rect(x + 1, 28, 1, 2, "#f4efe3");
      buf.rect(x + 4, 28, 1, 2, "#f4efe3");
      buf.rect(x, 30, 1, 3, "#6b4a2b");
      buf.rect(x + 6, 30, 1, 3, "#6b4a2b");
    }
    boats.push([48, 62], [80, 58]);
  }
  if (level >= 4) {
    for (let i = 0; i < 16; i++) buf.rect(105, 26 - i, 3, 1, Math.floor(i / 4) % 2 ? "#d94f4f" : "#f7f1e2");
    lights.push({ at: [106, 9], color: "#fff3b0", blink: false });
    boats.push([66, 72]);
  }
  if (level >= 2) {
    for (const x of [40, 58, 68, 86]) {
      buf.stamp(S.lantern(), x, 40);
      lights.push({ at: [x, 36], color: "#ffd166", blink: false });
    }
  }
  if (level >= 1) for (const [x, y] of scatter(shape, buf.w, buf.h, 3 + level * 2, 603, 4)) if (y < 26) buf.stamp(level >= 3 ? S.palm() : S.bush(), x, y);
  return { label: [62, 4], lights, boats, hit: union(shape, blob(62, 56, 30, 16, 1, 0)) };
}

// ---------- Velocity Circuit ----------

function drawVelocity(buf: PixelBuffer, { level }: DrawInput): Anchors {
  const shape = blob(54, 34, 50, 24, 701, 0.05);
  drawLand(buf, shape, style(ASPHALT, GREEN, level), { cliff: 3, seed: 701 });
  const track = { cx: 54, cy: 36, rx: 38, ry: 15 };
  const asphalt = mix("#5a5652", "#3a3d44", level / 4);
  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      const dx = (x - track.cx) / track.rx;
      const dy = (y - track.cy) / track.ry;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0.82 && d < 1.06) {
        if (level === 0 && hash2(x, y, 9) < 0.18) continue; // cracked, gaps
        const edge = d < 0.86 || d > 1.02;
        const curb = level >= 3 && edge ? (Math.floor((x + y) / 2) % 2 ? "#e2453c" : "#f4efe3") : null;
        buf.set(x, y, curb ?? (level >= 4 && edge ? "#36e2c8" : asphalt));
      }
    }
  }
  // Start line
  if (level >= 1) for (let y = 21; y < 25; y++) buf.set(54, y, (y % 2 ? "#f4efe3" : "#1b1f2a"));
  if (level >= 2) S.building(buf, 40, 18, 28, 3, { wall: "#cfc6b4", roof: "#d33d5c", roofH: 2 });
  if (level >= 3) S.tower(buf, 80, 38, 4, 12, "#e8e2d4", "#d33d5c", false);
  if (level >= 4) {
    buf.rect(6, 54, 96, 1, "#9aa1ab");
    for (let x = 10; x < 100; x += 12) buf.rect(x, 55, 1, 4, "#7a808a");
    buf.stamp(S.flag("#36e2c8"), 30, 20);
    buf.stamp(S.flag("#d33d5c"), 78, 20);
  }
  if (level === 0) buf.stamp(S.rubble("#6e6a62"), 54, 38);
  else if (level >= 2) buf.stamp(S.tree(), 54, 40);
  const lights: Anchors["lights"] = level >= 3 ? [{ at: [81, 25], color: "#36e2c8", blink: true }] : [];
  return { label: [54, 2], track: level >= 1 ? track : undefined, lights, hit: shape };
}

const DRAWERS: Record<string, (buf: PixelBuffer, input: DrawInput) => Anchors> = {
  [ISLAND_IDS.hq]: drawHq,
  [ISLAND_IDS.archipelago]: drawArchipelago,
  [ISLAND_IDS.foundry]: drawFoundry,
  [ISLAND_IDS.court]: drawCourt,
  [ISLAND_IDS.broadcast]: drawBroadcast,
  [ISLAND_IDS.cove]: drawCove,
  [ISLAND_IDS.velocity]: drawVelocity,
};
