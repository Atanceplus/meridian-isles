/**
 * Renders every island at every restoration level into one PNG, so the art can
 * be reviewed without a browser. Run with:
 *   npx vite-node scripts/contact-sheet.ts <out.png> [scale]
 */
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { ISLAND_IDS, LAYOUT, WORLD, drawIsland } from "../src/world/art/islands";
import { drawOcean } from "../src/world/art/ocean";
import { PixelBuffer } from "../src/world/art/pixels";
import { LANDMARKS, type RestorationLevel } from "../src/world/restoration";

const out = process.argv[2] ?? "contact-sheet.png";
const scale = Number(process.argv[3] ?? 2);

const ids = Object.values(ISLAND_IDS);
const cellW = 160;
const cellH = 110;
const sheet = new PixelBuffer(cellW * 5, cellH * ids.length + WORLD.h);

const labels = ["fe:carrier.a", "b", "c", "d", "e", "f", "g", "h"];
ids.forEach((id, row) => {
  for (let level = 0; level <= 4; level++) {
    const ocean = drawOcean(cellW, cellH);
    sheet.blit(ocean, level * cellW, row * cellH);
    const art = drawIsland(id, {
      level: level as RestorationLevel,
      islets: labels.map((key, i) => ({ key, label: key, level: Math.max(0, Math.min(4, level + ((i % 3) - 1))) as RestorationLevel })),
      landmarks: LANDMARKS.filter((l) => l.rank <= level + 1 && level >= 3),
      decorations: level >= 2 ? ["leads", "crm", "dialer", "training", "equipment", "service", "other"] : [],
    });
    sheet.blit(art.buf, level * cellW + Math.floor((cellW - art.buf.w) / 2), row * cellH + Math.floor((cellH - art.buf.h) / 2));
  }
});

// Whole world at mid restoration, below the grid.
const world = drawOcean(WORLD.w, WORLD.h);
ids.forEach((id, i) => {
  const { x, y } = LAYOUT[id]!;
  const art = drawIsland(id, { level: ((i % 5) as RestorationLevel), islets: labels.map((key, j) => ({ key, label: key, level: (j % 5) as RestorationLevel })), landmarks: LANDMARKS.slice(0, 4) });
  world.blit(art.buf, x, y);
});
sheet.blit(world, 0, cellH * ids.length);

writeFileSync(out, png(sheet, scale));
console.log(`wrote ${out}`);

function png(buf: PixelBuffer, k: number): Buffer {
  const w = buf.w * k;
  const h = buf.h * k;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const p = buf.get(Math.floor(x / k), Math.floor(y / k))!;
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = p[0];
      raw[o + 1] = p[1];
      raw[o + 2] = p[2];
      raw[o + 3] = p[3] || 255;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function crc32(b: Buffer): number {
  let c = ~0;
  for (const byte of b) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
