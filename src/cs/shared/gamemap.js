// Tile map: collision, ray casting, spawn/site extraction. Used by server, bots and client prediction.
import { TILE } from './constants.js';

// Tile legend
//  #  wall            (solid, opaque)
//  X  crate           (solid, opaque)
//  o  pillar/barrel   (solid, opaque)
//  =  fence / window  (solid, see-through, bullets pass)
//  L  low barrier     (solid, see-through, bullets pass)
//  .  floor    ,  floor variant (visual only)
//  a  bombsite A      b  bombsite B
//  t  T spawn zone    c  CT spawn zone
export const SOLID_CHARS = '#Xo=L';
export const OPAQUE_CHARS = '#Xo';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class GameMap {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.theme = def.theme || {};
    const rows = def.rows;
    this.h = rows.length;
    this.w = rows[0].length;
    this.width = this.w * TILE;
    this.height = this.h * TILE;
    const n = this.w * this.h;
    this.chars = new Array(n);
    this.solid = new Uint8Array(n);
    this.opaque = new Uint8Array(n);
    this.site = new Uint8Array(n);   // 0 none, 1 = A, 2 = B
    this.zone = new Uint8Array(n);   // 0 none, 1 = T spawn zone, 2 = CT spawn zone
    for (let y = 0; y < this.h; y++) {
      if (rows[y].length !== this.w) throw new Error(`map ${def.id}: row ${y} has width ${rows[y].length}, expected ${this.w}`);
      for (let x = 0; x < this.w; x++) {
        const ch = rows[y][x];
        const i = y * this.w + x;
        this.chars[i] = ch;
        if (SOLID_CHARS.includes(ch)) this.solid[i] = 1;
        if (OPAQUE_CHARS.includes(ch)) this.opaque[i] = 1;
        if (ch === 'a') this.site[i] = 1;
        if (ch === 'b') this.site[i] = 2;
        if (ch === 't') this.zone[i] = 1;
        if (ch === 'c') this.zone[i] = 2;
      }
    }
    this._extractSites();
    this._extractSpawns();
    this._buildCorners();
    this._out = { x: 0, y: 0 };
  }

  charAt(tx, ty) { return this.chars[ty * this.w + tx]; }
  inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
  isSolidTile(tx, ty) { return tx < 0 || ty < 0 || tx >= this.w || ty >= this.h || this.solid[ty * this.w + tx] === 1; }
  isOpaqueTile(tx, ty) { return tx < 0 || ty < 0 || tx >= this.w || ty >= this.h || this.opaque[ty * this.w + tx] === 1; }
  isSolidAt(x, y) { return this.isSolidTile(Math.floor(x / TILE), Math.floor(y / TILE)); }

  siteAt(x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return this.inBounds(tx, ty) ? this.site[ty * this.w + tx] : 0;
  }
  zoneAt(x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return this.inBounds(tx, ty) ? this.zone[ty * this.w + tx] : 0;
  }

  _extractSites() {
    this.sites = [null, null];
    for (let s = 1; s <= 2; s++) {
      let sx = 0, sy = 0, c = 0;
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        if (this.site[y * this.w + x] === s) { sx += x; sy += y; c++; }
      }
      if (!c) continue;
      const cx = (sx / c + 0.5) * TILE, cy = (sy / c + 0.5) * TILE;
      let r = 0;
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        if (this.site[y * this.w + x] === s) r = Math.max(r, Math.hypot((x + 0.5) * TILE - cx, (y + 0.5) * TILE - cy));
      }
      this.sites[s - 1] = { id: s - 1, name: s === 1 ? 'A' : 'B', x: cx, y: cy, r: r + TILE / 2 };
    }
  }

  _extractSpawns() {
    this.spawns = [[], []];
    for (let team = 0; team < 2; team++) {
      const cand = [];
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        if (this.zone[y * this.w + x] !== team + 1) continue;
        // keep away from walls so nobody spawns wedged in a corner
        let free = true;
        for (let dy = -1; dy <= 1 && free; dy++) for (let dx = -1; dx <= 1; dx++) if (this.isSolidTile(x + dx, y + dy)) { free = false; break; }
        if (free) cand.push({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
      }
      if (!cand.length) throw new Error(`map ${this.id}: no spawn tiles for team ${team}`);
      // farthest-point sampling gives an evenly spread set of spawn points
      const picked = [cand[Math.floor(cand.length / 2)]];
      while (picked.length < 12 && picked.length < cand.length) {
        let best = null, bd = -1;
        for (const c of cand) {
          let md = Infinity;
          for (const p of picked) md = Math.min(md, Math.hypot(c.x - p.x, c.y - p.y));
          if (md > bd) { bd = md; best = c; }
        }
        if (bd < 30) break;
        picked.push(best);
      }
      this.spawns[team] = picked;
      let cx = 0, cy = 0;
      for (const c of cand) { cx += c.x; cy += c.y; }
      (this.spawnCenter ||= [null, null])[team] = { x: cx / cand.length, y: cy / cand.length };
    }
  }

  _buildCorners() {
    // vertices of the opaque region where a silhouette turns — vision rays are aimed at these
    this.corners = [];
    const o = (x, y) => (this.isOpaqueTile(x, y) ? 1 : 0);
    for (let j = 0; j <= this.h; j++) for (let i = 0; i <= this.w; i++) {
      const a = o(i - 1, j - 1), b = o(i, j - 1), c = o(i - 1, j), d = o(i, j);
      const n = a + b + c + d;
      const isCorner = n === 1 || n === 3 || (n === 2 && a === d);
      if (isCorner) this.corners.push(i * TILE, j * TILE);
    }
    this.cornerBucket = 256;
    this.cbw = Math.ceil(this.width / this.cornerBucket) + 1;
    this.cbh = Math.ceil(this.height / this.cornerBucket) + 1;
    this.cbuckets = Array.from({ length: this.cbw * this.cbh }, () => []);
    for (let k = 0; k < this.corners.length; k += 2) {
      const bx = Math.floor(this.corners[k] / this.cornerBucket), by = Math.floor(this.corners[k + 1] / this.cornerBucket);
      this.cbuckets[by * this.cbw + bx].push(this.corners[k], this.corners[k + 1]);
    }
  }

  /** Collects corner vertices within radius of (x,y) into out (flat x,y array). */
  cornersNear(x, y, r, out) {
    out.length = 0;
    const B = this.cornerBucket;
    const bx0 = Math.max(0, Math.floor((x - r) / B)), bx1 = Math.min(this.cbw - 1, Math.floor((x + r) / B));
    const by0 = Math.max(0, Math.floor((y - r) / B)), by1 = Math.min(this.cbh - 1, Math.floor((y + r) / B));
    const r2 = r * r;
    for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
      const arr = this.cbuckets[by * this.cbw + bx];
      for (let k = 0; k < arr.length; k += 2) {
        const dx = arr[k] - x, dy = arr[k + 1] - y;
        if (dx * dx + dy * dy <= r2) out.push(arr[k], arr[k + 1]);
      }
    }
    return out;
  }

  /** Distance along the unit direction (dx,dy) to the first tile flagged in `flags`. Exact (grid DDA). */
  castDist(ox, oy, dx, dy, maxD, flags = this.opaque) {
    let tx = Math.floor(ox / TILE), ty = Math.floor(oy / TILE);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h || flags[ty * this.w + tx]) return 0;
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(TILE / dy) : Infinity;
    let tMaxX = dx > 0 ? ((tx + 1) * TILE - ox) / dx : dx < 0 ? (tx * TILE - ox) / dx : Infinity;
    let tMaxY = dy > 0 ? ((ty + 1) * TILE - oy) / dy : dy < 0 ? (ty * TILE - oy) / dy : Infinity;
    for (;;) {
      let t;
      if (tMaxX < tMaxY) { t = tMaxX; tx += stepX; tMaxX += tDeltaX; }
      else { t = tMaxY; ty += stepY; tMaxY += tDeltaY; }
      if (t >= maxD) return maxD;
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h || flags[ty * this.w + tx]) return t;
    }
  }

  /** Line of sight between two points (opaque tiles only; smoke is handled by callers). */
  los(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return true;
    return this.castDist(x0, y0, dx / d, dy / d, d) >= d;
  }

  /** Can something walk/fly in a straight line (solid-tile check)? */
  clearLine(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return true;
    return this.castDist(x0, y0, dx / d, dy / d, d, this.solid) >= d;
  }

  /** Walkability of a straight corridor for a circle of radius r (samples the line). */
  clearLineR(x0, y0, x1, y1, r) {
    const dx = x1 - x0, dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return true;
    const nx = -dy / d * r, ny = dx / d * r;
    return this.clearLine(x0, y0, x1, y1) && this.clearLine(x0 + nx, y0 + ny, x1 + nx, y1 + ny) &&
      this.clearLine(x0 - nx, y0 - ny, x1 - nx, y1 - ny);
  }

  /** Moves a circle by (dx,dy), sliding along solid tiles. Result in the returned scratch object. */
  moveCircle(x, y, dx, dy, r) {
    x += dx; y += dy;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      const tx0 = Math.floor((x - r) / TILE), tx1 = Math.floor((x + r) / TILE);
      const ty0 = Math.floor((y - r) / TILE), ty1 = Math.floor((y + r) / TILE);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (!this.isSolidTile(tx, ty)) continue;
          const minX = tx * TILE, minY = ty * TILE;
          const cx = clamp(x, minX, minX + TILE), cy = clamp(y, minY, minY + TILE);
          const ddx = x - cx, ddy = y - cy;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 >= r * r) continue;
          moved = true;
          if (d2 > 1e-9) {
            const d = Math.sqrt(d2), k = (r - d) / d;
            x += ddx * k; y += ddy * k;
          } else {
            // centre is inside the tile: leave through the nearest face
            const l = x - minX, rr = minX + TILE - x, u = y - minY, dn = minY + TILE - y;
            const m = Math.min(l, rr, u, dn);
            if (m === l) x = minX - r; else if (m === rr) x = minX + TILE + r;
            else if (m === u) y = minY - r; else y = minY + TILE + r;
          }
        }
      }
      if (!moved) break;
    }
    this._out.x = x; this._out.y = y;
    return this._out;
  }

  /** Nearest free tile-centre to a point (for safety when spawning/dropping items). */
  nearestFree(x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (!this.isSolidTile(tx, ty)) return { x, y };
    for (let r = 1; r < 6; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (!this.isSolidTile(tx + dx, ty + dy)) return { x: (tx + dx + 0.5) * TILE, y: (ty + dy + 0.5) * TILE };
      }
    }
    return { x, y };
  }
}

// ---- small geometry helpers shared by combat & vision -------------------------------------

/** Distance along a unit ray to a circle, or -1 if it misses. */
export function rayCircle(ox, oy, dx, dy, cx, cy, r) {
  const fx = cx - ox, fy = cy - oy;
  const t = fx * dx + fy * dy;
  const px = fx - t * dx, py = fy - t * dy;
  const d2 = px * px + py * py;
  if (d2 > r * r) return -1;
  const h = Math.sqrt(r * r - d2);
  const t0 = t - h;
  if (t0 >= 0) return t0;
  if (t + h >= 0) return 0;
  return -1;
}

export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
