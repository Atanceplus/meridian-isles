import { PixelBuffer, hash2, mix } from "./pixels";

/** The sea: deep at the edges, lighter toward the center, with a gentle dither. */
export function drawOcean(w: number, h: number): PixelBuffer {
  const buf = new PixelBuffer(w, h);
  const deep = "#164e63";
  const mid = "#1f6f86";
  const light = "#2a8aa0";
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - w / 2) / (w / 2);
      const dy = (y - h / 2) / (h / 2);
      const d = Math.min(1, Math.sqrt(dx * dx * 0.8 + dy * dy));
      const base = d > 0.75 ? deep : d > 0.4 ? mix(mid, deep, (d - 0.4) / 0.35) : mix(light, mid, d / 0.4);
      // Ordered dither between bands keeps the gradient "pixel".
      const n = hash2(x, y, 3);
      buf.set(x, y, n < 0.04 ? mix(base, "#ffffff", 0.08) : n > 0.97 ? mix(base, "#000000", 0.1) : base);
    }
  }
  return buf;
}

/** Sparse wave glints on transparency; the map scrolls and fades this layer. */
export function drawWaves(w: number, h: number, seed = 1): PixelBuffer {
  const buf = new PixelBuffer(w, h);
  for (let i = 0; i < (w * h) / 220; i++) {
    const x = Math.floor(hash2(i, 1, seed) * w);
    const y = Math.floor(hash2(i, 2, seed) * h);
    buf.rect(x, y, 2 + (i % 3), 1, "#cfeff5aa");
  }
  return buf;
}

/** A soft pixel cloud. */
export function drawCloud(seed: number): PixelBuffer {
  const buf = new PixelBuffer(34, 12);
  for (let i = 0; i < 5; i++) {
    const cx = 6 + i * 5 + Math.floor(hash2(i, 1, seed) * 3);
    const cy = 7 - Math.floor(hash2(i, 2, seed) * 3);
    buf.ellipse(cx, cy, 5, 3 + (i % 2), "#ffffffcc");
  }
  return buf;
}
