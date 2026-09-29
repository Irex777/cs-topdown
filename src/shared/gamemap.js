// Tile map: collision, ray casting, destruction, objectives. Used by server, bots and client prediction.
//
// The world is a grid of 32 px tiles. Logic is 2D; the client builds the solid tiles into 3D voxel blocks.
// Solid tiles have hit points and can be destroyed by explosives, turning into walkable rubble.
import { TILE, STEP_H } from './constants.js';
import { VEHICLES } from './vehicles.js';

/**
 * Tile legend
 *  solid:   #  rock / cliff (indestructible)   B  building wall   X  crate   o  explosive barrel
 *           =  chain-link fence (see-through)  L  sandbags / low barrier (see-through)
 *           G  window glass (see-through)      T  tree trunk (see-through)   M  steel container
 *  floor:   .  ,  grass       _  road      ;  concrete / interior   :  sand   r  rubble   d  debris
 *  water:   ~  deep (blocks soldiers & ground vehicles)   w  shallow (walkable)
 *  zones:   t  red spawn zone   c  blue spawn zone   (walkable floor)
 */
export const TILES = {
  '#': { solid: 1, opaque: 1, hp: 0,   h: 46, h3: 64, name: 'Rock' },
  'B': { solid: 1, opaque: 1, hp: 520, h: 34, h3: 52, name: 'Wall', debris: 'r' },
  'M': { solid: 1, opaque: 1, hp: 900, h: 26, h3: 42, name: 'Container', debris: 'd' },
  'X': { solid: 1, opaque: 0, hp: 90,  h: 18, h3: 20, name: 'Crate', debris: 'd' },
  'o': { solid: 1, opaque: 0, hp: 26,  h: 16, h3: 18, name: 'Barrel', debris: 'd', explosive: 1 },
  '=': { solid: 1, opaque: 0, hp: 24,  h: 11, h3: 16, name: 'Fence', debris: '.', pass: 1 },
  'L': { solid: 1, opaque: 0, hp: 160, h: 12, h3: 14, name: 'Sandbags', debris: 'd' },
  'G': { solid: 1, opaque: 0, hp: 22,  h: 34, h3: 52, name: 'Window', debris: ';' },
  'T': { solid: 1, opaque: 0, hp: 150, h: 46, h3: 72, name: 'Tree', debris: 'd', pass: 1 },
  '.': {}, ',': {}, '_': {}, ';': {}, ':': {}, 'r': {}, 'd': {},
  '~': { water: 2 }, 'w': { water: 1 },
  't': {}, 'c': {},
};
export const isSolidChar = (ch) => !!(TILES[ch] && TILES[ch].solid);
export const isOpaqueChar = (ch) => !!(TILES[ch] && TILES[ch].opaque);

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
    this.solid = new Uint8Array(n);       // walls, crates, trees...
    this.opaque = new Uint8Array(n);      // blocks sight and bullets
    this.water = new Uint8Array(n);       // 0 land, 1 shallow, 2 deep
    this.blockInf = new Uint8Array(n);    // soldiers and ground vehicles cannot enter
    this.blockBoat = new Uint8Array(n);   // boats cannot enter
    this.top = new Float32Array(n);       // height of a solid tile above the ground (px); 0 for open ground and water
    this.bstop = new Uint8Array(n);       // stops bullets that are lower than the tile's top (fences and trees let them through)
    this.hp = new Uint16Array(n);
    this.zone = new Uint8Array(n);        // 0 none, 1 = red spawn zone, 2 = blue spawn zone
    this.changes = new Map();             // tile index -> char, for everything destroyed since the start
    this.listeners = [];
    for (let y = 0; y < this.h; y++) {
      if (rows[y].length !== this.w) throw new Error(`map ${def.id}: row ${y} has width ${rows[y].length}, expected ${this.w}`);
      for (let x = 0; x < this.w; x++) {
        const ch = rows[y][x];
        if (!TILES[ch]) throw new Error(`map ${def.id}: unknown tile '${ch}' at ${x},${y}`);
        const i = y * this.w + x;
        this.chars[i] = ch;
        this._apply(i, ch);
        if (ch === 't') this.zone[i] = 1;
        if (ch === 'c') this.zone[i] = 2;
      }
    }
    this._extractObjects();
    this._extractSpawns();
    this._buildCorners();
    this._out = { x: 0, y: 0 };
  }

  _apply(i, ch) {
    const t = TILES[ch];
    this.solid[i] = t.solid ? 1 : 0;
    this.opaque[i] = t.opaque ? 1 : 0;
    this.water[i] = t.water || 0;
    this.hp[i] = t.hp || 0;
    this.blockInf[i] = (t.solid || t.water === 2) ? 1 : 0;
    this.blockBoat[i] = (t.solid || !t.water) ? 1 : 0;
    this.top[i] = t.solid ? t.h3 : 0;
    this.bstop[i] = t.solid && !t.pass ? 1 : 0;
  }

  charAt(tx, ty) { return this.chars[ty * this.w + tx]; }
  inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
  /** wall-like solid (blocks bullets that are not see-through, grenades, explosions' reach) */
  isSolidTile(tx, ty) { return tx < 0 || ty < 0 || tx >= this.w || ty >= this.h || this.solid[ty * this.w + tx] === 1; }
  /** soldiers / ground vehicles cannot stand here (walls or deep water) */
  isBlockedTile(tx, ty) { return tx < 0 || ty < 0 || tx >= this.w || ty >= this.h || this.blockInf[ty * this.w + tx] === 1; }
  isOpaqueTile(tx, ty) { return tx < 0 || ty < 0 || tx >= this.w || ty >= this.h || this.opaque[ty * this.w + tx] === 1; }
  isSolidAt(x, y) { return this.isSolidTile(Math.floor(x / TILE), Math.floor(y / TILE)); }
  isBlockedAt(x, y) { return this.isBlockedTile(Math.floor(x / TILE), Math.floor(y / TILE)); }
  waterAt(x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return this.inBounds(tx, ty) ? this.water[ty * this.w + tx] : 0;
  }
  zoneAt(x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return this.inBounds(tx, ty) ? this.zone[ty * this.w + tx] : 0;
  }

  // ------------------------------------------------------------------ destruction
  onChange(fn) { this.listeners.push(fn); }

  setTile(tx, ty, ch) {
    if (!this.inBounds(tx, ty)) return false;
    const i = ty * this.w + tx;
    const old = this.chars[i];
    if (old === ch) return false;
    this.chars[i] = ch;
    this._apply(i, ch);
    for (let dj = 0; dj <= 1; dj++) for (let di = 0; di <= 1; di++) this._refreshVertex(tx + di, ty + dj);
    this.changes.set(i, ch);
    for (const fn of this.listeners) fn(tx, ty, old, ch);
    return true;
  }

  isDestructible(tx, ty) { return this.inBounds(tx, ty) && (TILES[this.chars[ty * this.w + tx]].hp || 0) > 0; }

  /** Applies damage to a tile. Returns the char it turned into when it was destroyed, else null. */
  damageTile(tx, ty, dmg) {
    if (!this.inBounds(tx, ty)) return null;
    const i = ty * this.w + tx;
    const t = TILES[this.chars[i]];
    if (!t.hp) return null;
    this.hp[i] = Math.max(0, this.hp[i] - dmg);
    if (this.hp[i] > 0) return null;
    const to = t.debris || '.';
    this.setTile(tx, ty, to);
    return to;
  }

  /** Applies a list of [index, char] pairs (sent by the server to late joiners). */
  applyChanges(list) {
    for (const [i, ch] of list) this.setTile(i % this.w, (i / this.w) | 0, ch);
  }

  // ------------------------------------------------------------------ objectives, spawns
  _extractObjects() {
    const o = this.def.objects || {};
    const px = (v) => (v + 0.5) * TILE;
    this.flags = (o.flags || []).map((f, i) => ({ id: i, name: f.name || String.fromCharCode(65 + i), x: px(f.x), y: px(f.y), r: f.r || 118, owner: f.owner === undefined ? -1 : f.owner }));
    // vehicles are nudged to the nearest spot with enough free ground around it
    this.vehSpawns = (o.vehicles || []).map((v, i) => {
      const def = VEHICLES[v.type];
      let x = px(v.x), y = px(v.y);
      if (def && def.kind !== 'air') {
        const mask = def.kind === 'boat' ? this.blockBoat : this.blockInf;
        const clear = def.kind === 'tracked' ? 2 : def.kind === 'boat' ? 1 : 1;
        const s = this.nearestClear(x, y, mask, clear);
        x = s.x; y = s.y;
      }
      return { id: i, type: v.type, x, y, a: (v.a || 0) * Math.PI / 180, team: v.team === undefined ? -1 : v.team, flag: v.flag === undefined ? -1 : v.flag, respawn: v.respawn || 0 };
    });
    this.mcoms = (o.mcoms || []).map((m, i) => ({ id: i, stage: m.stage, x: px(m.x), y: px(m.y) }));
    this.rush = o.rush ? o.rush.map((s) => ({ attack: s.attack.map((q) => ({ x: px(q[0]), y: px(q[1]) })), defend: s.defend.map((q) => ({ x: px(q[0]), y: px(q[1]) })) })) : null;
    this.modes = this.def.modes || ['tdm'];
  }

  _extractSpawns() {
    this.spawns = [[], []];
    this.spawnCenter = [null, null];
    for (let team = 0; team < 2; team++) {
      const cand = [];
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        if (this.zone[y * this.w + x] !== team + 1) continue;
        let free = true;
        for (let dy = -1; dy <= 1 && free; dy++) for (let dx = -1; dx <= 1; dx++) if (this.isBlockedTile(x + dx, y + dy)) { free = false; break; }
        if (free) cand.push({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
      }
      if (!cand.length) throw new Error(`map ${this.id}: no spawn tiles for team ${team}`);
      const picked = [cand[Math.floor(cand.length / 2)]];
      while (picked.length < 28 && picked.length < cand.length) {
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
      this.spawnCenter[team] = { x: cx / cand.length, y: cy / cand.length };
    }
  }

  /** nearest tile centre whose surrounding (2*clear+1)^2 tiles are all free in `mask` */
  nearestClear(x, y, mask, clear, maxR = 12) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    const free = (a, b) => {
      for (let dy = -clear; dy <= clear; dy++) for (let dx = -clear; dx <= clear; dx++) {
        const px = a + dx, py = b + dy;
        if (px < 0 || py < 0 || px >= this.w || py >= this.h || mask[py * this.w + px]) return false;
      }
      return true;
    };
    if (free(tx, ty)) return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (free(tx + dx, ty + dy)) return { x: (tx + dx + 0.5) * TILE, y: (ty + dy + 0.5) * TILE };
      }
    }
    return { x, y };
  }

  /** A random walkable spot between rmin and rmax px from (x,y), preferring open ground (used for flag / squad spawns). */
  freeSpotNear(x, y, rmin, rmax, rnd = Math.random, clearance = 1) {
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2, d = rmin + rnd() * (rmax - rmin);
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
      let ok = true;
      for (let dy = -clearance; dy <= clearance && ok; dy++) for (let dx = -clearance; dx <= clearance; dx++) if (this.isBlockedTile(tx + dx, ty + dy)) { ok = false; break; }
      if (ok) return { x: px, y: py };
    }
    return this.nearestFree(x, y);
  }

  // ------------------------------------------------------------------ vision corners (kept up to date as walls fall)
  _cornerAt(i, j) {
    const o = (x, y) => (this.isOpaqueTile(x, y) ? 1 : 0);
    const a = o(i - 1, j - 1), b = o(i, j - 1), c = o(i - 1, j), d = o(i, j);
    const n = a + b + c + d;
    return n === 1 || n === 3 || (n === 2 && a === d);
  }

  _bucketOf(x, y) {
    const B = this.cornerBucket;
    return Math.min(this.cbh - 1, Math.floor(y / B)) * this.cbw + Math.min(this.cbw - 1, Math.floor(x / B));
  }

  _buildCorners() {
    this.cornerBucket = 256;
    this.cbw = Math.ceil(this.width / this.cornerBucket) + 1;
    this.cbh = Math.ceil(this.height / this.cornerBucket) + 1;
    this.cbuckets = Array.from({ length: this.cbw * this.cbh }, () => []);
    for (let j = 0; j <= this.h; j++) for (let i = 0; i <= this.w; i++) {
      if (this._cornerAt(i, j)) this.cbuckets[this._bucketOf(i * TILE, j * TILE)].push(i * TILE, j * TILE);
    }
  }

  _refreshVertex(i, j) {
    if (i < 0 || j < 0 || i > this.w || j > this.h) return;
    const x = i * TILE, y = j * TILE;
    const arr = this.cbuckets[this._bucketOf(x, y)];
    let at = -1;
    for (let k = 0; k < arr.length; k += 2) if (arr[k] === x && arr[k + 1] === y) { at = k; break; }
    const is = this._cornerAt(i, j);
    if (is && at < 0) arr.push(x, y);
    else if (!is && at >= 0) arr.splice(at, 2);
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

  // ------------------------------------------------------------------ ray casting
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

  /** Like castDist but also returns which tile stopped the ray. Result in the returned scratch object. */
  castTile(ox, oy, dx, dy, maxD, flags = this.opaque) {
    const r = this._hit || (this._hit = { d: 0, tx: -1, ty: -1 });
    let tx = Math.floor(ox / TILE), ty = Math.floor(oy / TILE);
    r.d = maxD; r.tx = -1; r.ty = -1;
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h || flags[ty * this.w + tx]) { r.d = 0; r.tx = tx; r.ty = ty; return r; }
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(TILE / dy) : Infinity;
    let tMaxX = dx > 0 ? ((tx + 1) * TILE - ox) / dx : dx < 0 ? (tx * TILE - ox) / dx : Infinity;
    let tMaxY = dy > 0 ? ((ty + 1) * TILE - oy) / dy : dy < 0 ? (ty * TILE - oy) / dy : Infinity;
    for (;;) {
      let t;
      if (tMaxX < tMaxY) { t = tMaxX; tx += stepX; tMaxX += tDeltaX; }
      else { t = tMaxY; ty += stepY; tMaxY += tDeltaY; }
      if (t >= maxD) return r;
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h || flags[ty * this.w + tx]) { r.d = t; r.tx = tx; r.ty = ty; return r; }
    }
  }

  /** Line of sight between two points (opaque tiles only; smoke is handled by callers). */
  los(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return true;
    return this.castDist(x0, y0, dx / d, dy / d, d) >= d;
  }

  /** Can something walk in a straight line (walls and deep water block)? */
  clearLine(x0, y0, x1, y1, mask = this.blockInf) {
    const dx = x1 - x0, dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return true;
    return this.castDist(x0, y0, dx / d, dy / d, d, mask) >= d;
  }

  /** Walkability of a straight corridor for a circle of radius r (samples the line). */
  clearLineR(x0, y0, x1, y1, r, mask = this.blockInf) {
    const dx = x1 - x0, dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return true;
    const nx = -dy / d * r, ny = dx / d * r;
    return this.clearLine(x0, y0, x1, y1, mask) && this.clearLine(x0 + nx, y0 + ny, x1 + nx, y1 + ny, mask) &&
      this.clearLine(x0 - nx, y0 - ny, x1 - nx, y1 - ny, mask);
  }

  /**
   * Moves a circle by (dx,dy), sliding along blocked tiles. Result in the returned scratch object.
   * mask: blockInf (default: soldiers, ground vehicles), blockBoat, or null for aircraft (only the map edge stops them).
   */
  moveCircle(x, y, dx, dy, r, mask = this.blockInf, z = -1e9) {
    x += dx; y += dy;
    if (mask === null) {
      this._out.x = clamp(x, r, this.width - r); this._out.y = clamp(y, r, this.height - r);
      return this._out;
    }
    const w = this.w, h = this.h;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      const tx0 = Math.floor((x - r) / TILE), tx1 = Math.floor((x + r) / TILE);
      const ty0 = Math.floor((y - r) / TILE), ty1 = Math.floor((y + r) / TILE);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (!(tx < 0 || ty < 0 || tx >= w || ty >= h)) {
            const ti = ty * w + tx;
            if (!mask[ti]) continue;
            // a soldier whose feet are above a low tile (jumped onto sandbags) is not blocked by it; deep water always blocks
            const top = this.top[ti];
            if (top > 0 && top <= z + STEP_H) continue;
          }
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

  /** Height of the floor under a soldier at (x,y) whose feet are at height z: the tallest low tile they can stand on, else 0. */
  groundAt(x, y, r, z) {
    const w = this.w;
    const fr = r * 0.6;
    const tx0 = Math.floor((x - fr) / TILE), tx1 = Math.floor((x + fr) / TILE);
    const ty0 = Math.floor((y - fr) / TILE), ty1 = Math.floor((y + fr) / TILE);
    let best = 0;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (tx < 0 || ty < 0 || tx >= w || ty >= this.h) continue;
      const top = this.top[ty * w + tx];
      if (top > best && top <= z + STEP_H) best = top;
    }
    return best;
  }

  /**
   * Casts a bullet through the 2.5D world from height oz, rising `slope` px per horizontal px. Tiles stop it while it is lower
   * than their top. Returns the scratch object {d (horizontal distance travelled), tx, ty (the tile hit or -1), top (true when
   * the bullet came down onto the top of a low wall)}.
   */
  castBullet(ox, oy, oz, dx, dy, slope, maxD) {
    const r = this._bh || (this._bh = { d: 0, tx: -1, ty: -1, top: false });
    r.d = maxD; r.tx = -1; r.ty = -1; r.top = false;
    let tx = Math.floor(ox / TILE), ty = Math.floor(oy / TILE);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(TILE / dy) : Infinity;
    let tMaxX = dx > 0 ? ((tx + 1) * TILE - ox) / dx : dx < 0 ? (tx * TILE - ox) / dx : Infinity;
    let tMaxY = dy > 0 ? ((ty + 1) * TILE - oy) / dy : dy < 0 ? (ty * TILE - oy) / dy : Infinity;
    let tEnter = 0;
    for (;;) {
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) { r.d = tEnter; r.tx = tx; r.ty = ty; return r; }
      const i = ty * this.w + tx;
      if (this.bstop[i]) {
        const tExit = Math.min(tMaxX, tMaxY, maxD);
        const top = this.top[i];
        const zIn = oz + slope * tEnter, zOut = oz + slope * tExit;
        if (Math.min(zIn, zOut) < top) {
          r.tx = tx; r.ty = ty;
          if (zIn >= top && slope < 0) { r.d = Math.min(maxD, (top - oz) / slope); r.top = true; } else r.d = tEnter;
          return r;
        }
      }
      if (tMaxX < tMaxY) { tEnter = tMaxX; tx += stepX; tMaxX += tDeltaX; } else { tEnter = tMaxY; ty += stepY; tMaxY += tDeltaY; }
      if (tEnter >= maxD) return r;
    }
  }

  /** Nearest free tile-centre to a point (for safety when spawning/dropping items). */
  nearestFree(x, y, mask = this.blockInf) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    const blocked = (a, b) => a < 0 || b < 0 || a >= this.w || b >= this.h || mask[b * this.w + a];
    if (!blocked(tx, ty)) return { x, y };
    for (let r = 1; r < 10; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (!blocked(tx + dx, ty + dy)) return { x: (tx + dx + 0.5) * TILE, y: (ty + dy + 0.5) * TILE };
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
