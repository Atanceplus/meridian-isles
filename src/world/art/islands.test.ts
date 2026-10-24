import { describe, expect, it } from "vitest";
import { LANDMARKS, type RestorationLevel } from "../restoration";
import { ISLAND_IDS, LAYOUT, WORLD, drawIsland } from "./islands";
import { mix, rgba } from "./pixels";

const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.length === b.length && a.every((v, i) => v === b[i]);

const painted = (data: Uint8ClampedArray) => {
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) n++;
  return n;
};

describe("island art", () => {
  it("draws every island at every level, inside the world", () => {
    for (const id of Object.values(ISLAND_IDS)) {
      const l = LAYOUT[id]!;
      expect(l.x >= 0 && l.y >= 0 && l.x + l.w <= WORLD.w && l.y + l.h <= WORLD.h).toBe(true);
      let previous: Uint8ClampedArray | null = null;
      for (let level = 0; level <= 4; level++) {
        const art = drawIsland(id, {
          level: level as RestorationLevel,
          islets: Array.from({ length: 8 }, (_, i) => ({ key: `k${i}`, label: `C${i}`, level: level as RestorationLevel })),
          landmarks: level === 4 ? LANDMARKS : [],
        });
        expect(painted(art.buf.data)).toBeGreaterThan(500);
        // Each level looks different from the one before it.
        if (previous) expect(same(art.buf.data, previous)).toBe(false);
        previous = art.buf.data;
      }
    }
  });

  it("handles any number of carriers in the Archipelago", () => {
    for (const n of [0, 1, 3, 8]) {
      const art = drawIsland(ISLAND_IDS.archipelago, { level: 0, islets: Array.from({ length: n }, (_, i) => ({ key: `k${i}`, label: "", level: 0 })) });
      expect(art.anchors.fog).toHaveLength(n);
    }
  });

  it("is deterministic", () => {
    const a = drawIsland(ISLAND_IDS.cove, { level: 3 });
    const b = drawIsland(ISLAND_IDS.cove, { level: 3 });
    expect(same(a.buf.data, b.buf.data)).toBe(true);
  });

  it("only adds animation anchors where the level supports them", () => {
    expect(drawIsland(ISLAND_IDS.foundry, { level: 0 }).anchors.smoke).toBeUndefined();
    expect(drawIsland(ISLAND_IDS.foundry, { level: 2 }).anchors.smoke).toBeDefined();
    expect(drawIsland(ISLAND_IDS.velocity, { level: 0 }).anchors.track).toBeUndefined();
    expect(drawIsland(ISLAND_IDS.court, { level: 1 }).anchors.storm).toBe(true);
    expect(drawIsland(ISLAND_IDS.court, { level: 2 }).anchors.storm).toBe(false);
  });

  it("parses and mixes colors", () => {
    expect(rgba("#fff")).toEqual([255, 255, 255, 255]);
    expect(rgba("#11223380")).toEqual([17, 34, 51, 128]);
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});
