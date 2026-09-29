// Tiny DSL for authoring tile maps as rectangles instead of raw ASCII.
export class MapBuilder {
  constructor(w, h, fill = '#') {
    this.w = w; this.h = h;
    this.g = Array.from({ length: h }, () => Array(w).fill(fill));
  }
  set(x, y, ch) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.g[y][x] = ch; return this; }
  get(x, y) { return this.g[y]?.[x]; }
  /** fill a rectangle: x, y, width, height */
  rect(x, y, w, h, ch = '.') {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, ch);
    return this;
  }
  /** rectangle outline */
  box(x, y, w, h, ch) {
    this.rect(x, y, w, 1, ch).rect(x, y + h - 1, w, 1, ch).rect(x, y, 1, h, ch).rect(x + w - 1, y, 1, h, ch);
    return this;
  }
  /** horizontal / vertical runs */
  hline(x, y, len, ch) { return this.rect(x, y, len, 1, ch); }
  vline(x, y, len, ch) { return this.rect(x, y, 1, len, ch); }
  /** sprinkle floor variant tiles for visual noise */
  speckle(seed, chance = 0.08, ch = ',') {
    let s = seed >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.g[y][x] === '.' && rnd() < chance) this.g[y][x] = ch;
    return this;
  }
  /** copy the top half onto the bottom (vertical mirror) */
  mirrorV(swap = {}) {
    for (let y = 0; y < Math.floor(this.h / 2); y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.g[y][x];
        this.g[this.h - 1 - y][x] = swap[c] || c;
      }
    }
    return this;
  }
  /** copy the first half onto the second by 180 degree rotation */
  rot180(swap = {}) {
    const total = this.w * this.h;
    for (let i = 0; i < total / 2; i++) {
      const x = i % this.w, y = Math.floor(i / this.w);
      const c = this.g[y][x];
      this.g[this.h - 1 - y][this.w - 1 - x] = swap[c] || c;
    }
    return this;
  }
  rows() { return this.g.map((r) => r.join('')); }
}
