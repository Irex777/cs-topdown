// Tiny DSL for authoring tile maps as rectangles instead of raw ASCII, plus terrain helpers
// (roads, buildings, rivers, forests, cliffs) used by the large maps. Everything is seeded and deterministic,
// so server and browser generate exactly the same map.
const GROUND = '.,;:_rd';
export class MapBuilder {
  constructor(w, h, fill = '#', seed = 1) {
    this.w = w; this.h = h;
    this.g = Array.from({ length: h }, () => Array(w).fill(fill));
    this._s = seed >>> 0;
    this.objects = { flags: [], vehicles: [], mcoms: [] };
  }
  rnd() { this._s = (this._s * 1664525 + 1013904223) >>> 0; return this._s / 4294967296; }
  ri(a, b) { return a + Math.floor(this.rnd() * (b - a + 1)); }
  set(x, y, ch) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.g[y][x] = ch; return this; }
  get(x, y) { return this.g[y]?.[x]; }
  /** fill a rectangle: x, y, width, height */
  rect(x, y, w, h, ch = '.') {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, ch);
    return this;
  }
  /** paint only where the existing tile is one of `over` */
  paint(x, y, w, h, ch, over) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (over.includes(this.get(i, j))) this.set(i, j, ch);
    return this;
  }
  /** rectangle outline */
  box(x, y, w, h, ch) {
    this.rect(x, y, w, 1, ch).rect(x, y + h - 1, w, 1, ch).rect(x, y, 1, h, ch).rect(x + w - 1, y, 1, h, ch);
    return this;
  }
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
  /** copy the left half onto the right (horizontal mirror), swapping zone letters */
  mirrorH(swap = { t: 'c', c: 't' }) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < Math.floor(this.w / 2); x++) {
      const c = this.g[y][x];
      this.g[y][this.w - 1 - x] = swap[c] || c;
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

  // ------------------------------------------------------------------ terrain helpers
  /** grass with a little variation everywhere that is currently `over` */
  grass(chance = 0.12, over = '#') {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (over.includes(this.g[y][x])) this.g[y][x] = this.rnd() < chance ? ',' : '.';
    return this;
  }
  /** irregular blob (hills, mesas, ponds, sand patches) */
  blob(cx, cy, rx, ry, ch, rough = 0.25, over = null) {
    const p1 = this.rnd() * 6.28, p2 = this.rnd() * 6.28, p3 = this.rnd() * 6.28;
    for (let y = Math.floor(cy - ry * 1.5); y <= cy + ry * 1.5; y++) for (let x = Math.floor(cx - rx * 1.5); x <= cx + rx * 1.5; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      const a = Math.atan2(dy, dx);
      const r = 1 + rough * (Math.sin(a * 3 + p1) * 0.5 + Math.sin(a * 5 + p2) * 0.3 + Math.sin(a * 2 + p3) * 0.2);
      if (dx * dx + dy * dy <= r * r && (!over || over.includes(this.get(x, y)))) this.set(x, y, ch);
    }
    return this;
  }
  /** clears a disc to open floor (used around flags and spawns) */
  clearing(cx, cy, r, ch = '.') {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r && this.get(x, y) !== undefined && this.get(x, y) !== '~' && this.get(x, y) !== 'w') this.set(x, y, ch);
    }
    return this;
  }
  /** road along a polyline of [x,y] points (axis-aligned legs), `w` tiles wide */
  road(pts, w = 4, ch = '_') {
    const over = '.,TXoL=:rd;';
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const lo = Math.floor(w / 2);
      if (y0 === y1) this.paint(Math.min(x0, x1) - lo, y0 - lo, Math.abs(x1 - x0) + 1 + 2 * lo, w, ch, over);
      else if (x0 === x1) this.paint(x0 - lo, Math.min(y0, y1) - lo, w, Math.abs(y1 - y0) + 1 + 2 * lo, ch, over);
      else throw new Error('road legs must be axis aligned');
    }
    return this;
  }
  /**
   * A building: walls B, interior floor, windows G and 1-2 door gaps. door = 'N','S','E','W' (any combination, e.g. 'NS').
   */
  house(x, y, w, h, o = {}) {
    const door = o.door === undefined ? 'S' : o.door, floor = o.floor || ';', wall = o.wall || 'B';
    this.rect(x, y, w, h, wall).rect(x + 1, y + 1, w - 2, h - 2, floor);
    const gaps = [];
    const gap = (sx, sy) => { gaps.push([sx, sy]); };
    for (const d of door) {
      const off = o.doorAt !== undefined ? o.doorAt : Math.max(1, Math.floor((d === 'N' || d === 'S' ? w : h) / 2) - 1 + this.ri(-1, 1));
      const len = o.doorW || 2;
      for (let k = 0; k < len; k++) {
        if (d === 'S') gap(x + off + k, y + h - 1);
        else if (d === 'N') gap(x + off + k, y);
        else if (d === 'E') gap(x + w - 1, y + off + k);
        else if (d === 'W') gap(x, y + off + k);
      }
    }
    const isGap = (px, py) => gaps.some(([a, b]) => Math.abs(a - px) + Math.abs(b - py) <= 1);
    if (o.windows !== false) {
      for (let i = 2; i < w - 2; i += 3) { if (!isGap(x + i, y)) this.set(x + i, y, 'G'); if (!isGap(x + i, y + h - 1)) this.set(x + i, y + h - 1, 'G'); }
      for (let j = 2; j < h - 2; j += 3) { if (!isGap(x, y + j)) this.set(x, y + j, 'G'); if (!isGap(x + w - 1, y + j)) this.set(x + w - 1, y + j, 'G'); }
    }
    for (const [gx, gy] of gaps) this.set(gx, gy, floor);
    if (o.partition !== false && w >= 10 && h >= 6) {
      const px = x + Math.floor(w / 2);
      this.vline(px, y + 1, h - 2, wall);
      const gy = y + 1 + this.ri(0, Math.max(0, h - 5));
      this.set(px, gy, floor); this.set(px, gy + 1, floor);
    }
    if (o.crates) for (let i = 0; i < o.crates; i++) { const cx = x + this.ri(2, w - 3), cy = y + this.ri(2, h - 3); if (this.get(cx, cy) === floor) this.set(cx, cy, 'X'); }
    return this;
  }
  /** fenced yard, `gate` sides get a 3 tile opening */
  yard(x, y, w, h, gate = 'S', ch = '=') {
    this.box(x, y, w, h, ch);
    for (const d of gate) {
      const cx = x + Math.floor(w / 2), cy = y + Math.floor(h / 2);
      for (let k = -1; k <= 1; k++) {
        if (d === 'S') this.set(cx + k, y + h - 1, '.');
        else if (d === 'N') this.set(cx + k, y, '.');
        else if (d === 'E') this.set(x + w - 1, cy + k, '.');
        else if (d === 'W') this.set(x, cy + k, '.');
      }
    }
    return this;
  }
  /** scatter trees over grass in a rectangle */
  forest(x, y, w, h, density = 0.25) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      const c = this.get(i, j);
      if ((c === '.' || c === ',') && this.rnd() < density) this.set(i, j, 'T');
    }
    return this;
  }
  /** a line of sandbags / fence pieces with random gaps */
  wallLine(x, y, len, vertical, ch = 'L', gapEvery = 0) {
    for (let k = 0; k < len; k++) {
      if (gapEvery && k % gapEvery === gapEvery - 1) continue;
      const px = vertical ? x : x + k, py = vertical ? y + k : y;
      if (GROUND.includes(this.get(px, py))) this.set(px, py, ch);
    }
    return this;
  }
  /** cover: scatter crates / barrels / sandbags on open ground in a rectangle */
  cover(x, y, w, h, n, kinds = 'XXXoL') {
    for (let k = 0; k < n; k++) {
      const px = x + this.ri(0, w - 1), py = y + this.ri(0, h - 1);
      if (this.get(px, py) === '.' || this.get(px, py) === ',') this.set(px, py, kinds[this.ri(0, kinds.length - 1)]);
    }
    return this;
  }
  /** north-south river between two y values. Half widths are given per row by fn(y) -> {cx, deep} */
  vriver(y0, y1, fn, bank = 2) {
    for (let y = y0; y <= y1; y++) {
      const { cx, deep } = fn(y);
      for (let x = Math.floor(cx - deep - bank); x <= Math.ceil(cx + deep + bank); x++) {
        const d = Math.abs(x - cx);
        const c = this.get(x, y);
        if (c === undefined) continue;
        this.set(x, y, d <= deep ? '~' : 'w');
      }
    }
    return this;
  }
  /** east-west bay / sea along the bottom (or top) edge */
  sea(y0, y1, fn, bank = 2) {
    for (let x = 0; x < this.w; x++) {
      const edge = fn(x);
      for (let y = y0; y <= y1; y++) {
        const d = y - edge;
        if (d >= 0) this.set(x, y, '~');
        else if (d >= -bank) this.set(x, y, 'w');
      }
    }
    return this;
  }
  /** horizontal bridge deck from x0..x1 at rows y..y+w-1 with rails */
  bridge(x0, x1, y, w = 5, rails = true) {
    for (let j = 0; j < w; j++) for (let i = x0; i <= x1; i++) this.set(i, y + j, '_');
    if (rails) for (let i = x0 + 1; i <= x1 - 1; i++) { this.set(i, y - 1, '=' ); this.set(i, y + w, '='); }
    return this;
  }
  flag(name, x, y, owner = -1, r = 118) { this.objects.flags.push({ name, x, y, owner, r }); return this; }
  vehicle(type, x, y, a = 0, o = {}) { this.objects.vehicles.push({ type, x, y, a, ...o }); return this; }
  /** turns every walkable pocket that cannot be reached from (sx, sy) into rock, so no map has sealed-off floor */
  seal(sx, sy) {
    const solid = '#BMXo=LGT~';
    const seen = Array.from({ length: this.h }, () => new Uint8Array(this.w));
    const q = [[sx, sy]]; seen[sy][sx] = 1;
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h || seen[ny][nx] || solid.includes(this.g[ny][nx])) continue;
        seen[ny][nx] = 1; q.push([nx, ny]);
      }
    }
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (!seen[y][x] && !solid.includes(this.g[y][x])) this.g[y][x] = '#';
    return this;
  }
  finish() { return { rows: this.rows(), objects: this.objects }; }
}

/** Mirror the objects of a half-built map onto the right side. Vehicle angles are flipped and teams swapped. */
export function mirrorObjects(objects, w) {
  const out = { flags: [], vehicles: [], mcoms: [] };
  const mx = (x) => w - 1 - x;
  const flipOwner = (o) => (o === 0 ? 1 : o === 1 ? 0 : o);
  for (const f of objects.flags) out.flags.push(f);
  for (const f of objects.flags) if (!f.mid) out.flags.push({ ...f, name: f.mirror || f.name + '2', x: mx(f.x), owner: flipOwner(f.owner) });
  for (const v of objects.vehicles) out.vehicles.push(v);
  for (const v of objects.vehicles) if (!v.mid) out.vehicles.push({ ...v, x: mx(v.x), a: 180 - (v.a || 0), team: v.team === undefined ? undefined : flipOwner(v.team) });
  return out;
}
