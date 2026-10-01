// Tile map: collision, ray casting, destruction, objectives. Used by server, bots and client prediction.
//
// The world is a grid of 32 px tiles above a continuous, shared terrain heightfield.
// Solid tiles have hit points and can be destroyed by explosives, turning into walkable rubble.
import { TILE, STEP_H, BODY_H } from './constants.js';
import { VEHICLES } from './vehicles.js';
import { collectBuildings, updateBuildingSupports, roofHit } from './buildings.js';
import { rayBody } from './rigid.js';
import { treeHeight } from './heights.js';
import { buildElevation, terrainHeight, terrainGradient } from './elevation.js';

/**
 * Tile legend
 *  solid:   #  rock / cliff   B  building wall   X  crate   o  explosive barrel
 *           =  chain-link fence (see-through)  L  sandbags / low barrier (see-through)
 *           G  window glass (see-through)      T  tree trunk (see-through)   M  steel container
 *  floor:   .  ,  grass       _  road      ;  concrete / interior   :  sand   r  rubble   d  debris
 *  water:   ~  deep (blocks soldiers & ground vehicles)   w  shallow (walkable)
 *  zones:   t  red spawn zone   c  blue spawn zone   (walkable floor)
 */
export const TILES = {
  '#': { solid: 1, opaque: 1, hp: 1200, h: 46, h3: 64, name: 'Rock', debris: 'r' },
  'B': { solid: 1, opaque: 1, hp: 520, h: 34, h3: 52, name: 'Wall', debris: 'r' },
  'M': { solid: 1, opaque: 1, hp: 900, h: 26, h3: 42, name: 'Container', debris: 'd' },
  'X': { solid: 1, opaque: 0, hp: 90,  h: 18, h3: 20, name: 'Crate', debris: 'd' },
  'o': { solid: 1, opaque: 0, hp: 26,  h: 16, h3: 18, name: 'Barrel', debris: 'd', explosive: 1 },
  '=': { solid: 1, opaque: 0, hp: 24,  h: 11, h3: 16, name: 'Fence', debris: '.', pass: 1 },
  'L': { solid: 1, opaque: 0, hp: 160, h: 12, h3: 14, name: 'Sandbags', debris: 'd' },
  'G': { solid: 1, opaque: 0, hp: 22,  h: 34, h3: 52, name: 'Window', debris: ';' },
  'T': { solid: 1, opaque: 0, hp: 150, h: 46, h3: 144, name: 'Tree', debris: 'd', pass: 1 },
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
    this.blockInf = new Uint8Array(n);    // ground vehicles cannot enter (walls, deep water)
    this.blockFoot = new Uint8Array(n);   // soldiers cannot enter (walls only: they can wade and swim)
    this.blockBoat = new Uint8Array(n);   // boats cannot enter
    this.wallHeights = new Float32Array(n);
    this.headerBottom = new Float32Array(n);
    this.roofByTile = new Int16Array(n); this.roofByTile.fill(-1);
    this.top = new Float32Array(n);       // height of a solid tile above the ground (px); 0 for open ground and water
    this.bstop = new Uint8Array(n);       // stops bullets that are lower than the tile's top (fences and trees let them through)
    this.hp = new Float32Array(n);
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
    this.elevation = buildElevation(this, def.elevation);
    this._extractObjects();
    this.buildings = collectBuildings(this);
    for (const [index, b] of this.buildings.entries()) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      const i = y * this.w + x, ch = this.chars[i]; this.roofByTile[i] = index;
      if (ch === b.wall || ch === 'G') { this.wallHeights[i] = b.wallHeight; this.top[i] = b.wallHeight; }
      else if ((x === b.x || x === b.x + b.w - 1 || y === b.y || y === b.y + b.h - 1) && !this.solid[i]) {
        this.headerBottom[i] = 40; this.wallHeights[i] = b.wallHeight;
      }
    }
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
    this.blockFoot[i] = t.solid ? 1 : 0;
    this.blockBoat[i] = (t.solid || !t.water) ? 1 : 0;
    this.top[i] = t.solid ? ch === 'T' ? treeHeight(i % this.w, Math.floor(i / this.w)) : ((ch === 'B' || ch === 'G' || ch === '#') && this.wallHeights[i]) || t.h3 : 0;
    this.bstop[i] = t.solid && !t.pass ? 1 : 0;
  }

  charAt(tx, ty) { return this.chars[ty * this.w + tx]; }
  heightAt(x, y) { return terrainHeight(this, x, y); }
  gradientAt(x, y) { return terrainGradient(this, x, y); }
  tileBase(tx, ty) { return this.heightAt((tx + .5) * TILE, (ty + .5) * TILE); }
  // Top surface of the object/roof at a point, used by landing and aircraft collision.
  surfaceAt(x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (!this.inBounds(tx, ty)) return this.heightAt(x, y);
    const i = ty * this.w + tx, b = this.buildings[this.roofByTile[i]];
    let top = this.heightAt(x, y);
    if (this.solid[i]) top = Math.max(top, this.tileBase(tx, ty) + this.top[i]);
    if (b?.active) {
      const offset = b.axis === 'y' ? y - (b.y0 + b.y1) / 2 : x - (b.x0 + b.x1) / 2;
      top = Math.max(top, b.ridge - Math.abs(offset) * b.slope);
    }
    return top;
  }
  ceilingAt(x, y, feet) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE), i = ty * this.w + tx;
    const b = this.buildings[this.roofByTile[i]];
    if (!b?.active || feet >= b.eave) return Infinity;
    return this.headerBottom[i] ? b.base + this.headerBottom[i] : b.eave;
  }
  landingHeight(x, y, radius = 0) {
    let top = this.surfaceAt(x, y);
    for (let i = 0; radius && i < 8; i++) { const a = i * Math.PI / 4; top = Math.max(top, this.surfaceAt(x + Math.cos(a) * radius, y + Math.sin(a) * radius)); }
    return top;
  }
  aircraftMask(z) { return (i, tx, ty) => this.surfaceAt((tx + .5) * TILE, (ty + .5) * TILE) > z + 2; }
  inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
  /** wall-like solid (blocks bullets that are not see-through, grenades, explosions' reach) */
  isSolidTile(tx, ty) { return tx < 0 || ty < 0 || tx >= this.w || ty >= this.h || this.solid[ty * this.w + tx] === 1; }
  /** soldiers / ground vehicles cannot stand here (walls or deep water) */
  /** 0 land, 1 shallows, 2 deep water at a world position */
  waterAt(x, y) { const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE); return tx < 0 || ty < 0 || tx >= this.w || ty >= this.h ? 0 : this.water[ty * this.w + tx]; }
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

  setTile(tx, ty, ch, reason = 'edit') {
    if (!this.inBounds(tx, ty)) return false;
    const i = ty * this.w + tx;
    const old = this.chars[i];
    if (old === ch) return false;
    this.chars[i] = ch;
    this._apply(i, ch);
    updateBuildingSupports(this, tx, ty);
    for (let dj = 0; dj <= 1; dj++) for (let di = 0; di <= 1; di++) this._refreshVertex(tx + di, ty + dj);
    this.changes.set(i, ch);
    for (const fn of this.listeners) fn(tx, ty, old, ch, reason);
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
    this.setTile(tx, ty, to, 'damage');
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
      if (def) {
        const mask = def.kind === 'boat' ? this.blockBoat : this.blockInf;
        const clear = def.kind === 'air' ? 3 : def.kind === 'tracked' ? 2 : 1;
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
  los(x0, y0, x1, y1, z0 = this.heightAt(x0, y0) + 26, z1 = this.heightAt(x1, y1) + 26) {
    const dx = x1 - x0, dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return true;
    return this.castBullet(x0, y0, z0, dx / d, dy / d, (z1 - z0) / d, d, this.opaque).d >= d - 0.01;
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
            const header = mask === this.blockFoot && this.headerBottom[ti] && this.buildings[this.roofByTile[ti]]?.active && z + BODY_H > this.tileBase(tx, ty) + this.headerBottom[ti] && z < this.tileBase(tx, ty) + this.wallHeights[ti];
            if (!(typeof mask === 'function' ? mask(ti, tx, ty) : mask[ti]) && !header) continue;
            // a soldier whose feet are above a low tile (jumped onto sandbags) is not blocked by it; deep water always blocks
            const top = this.top[ti];
            if (top > 0 && top + this.tileBase(tx, ty) <= z + STEP_H) continue;
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
    if (mask === this.blockFoot) for (const b of this.dynamicBodies || []) {
      if (b.z1 <= z + STEP_H || b.z0 >= z + BODY_H || b.id === this.ignoreRigid) continue;
      const cx = clamp(x, b.x0, b.x1), cy = clamp(y, b.y0, b.y1), ddx = x - cx, ddy = y - cy, d = Math.hypot(ddx, ddy);
      if (d >= r) continue;
      if (d > .001) { x += ddx / d * (r - d); y += ddy / d * (r - d); }
    }
    this._out.x = x; this._out.y = y;
    return this._out;
  }

  /** Move an oriented vehicle hull against solid tiles, preserving contact normals. */
  moveHull(x, y, dx, dy, length, width, angle, mask) {
    // Separating-axis collision between the actual oriented hull and nearby tile volumes.
    // Substeps stop fast vehicles tunnelling through thin obstacles.
    const c = Math.cos(angle), s = Math.sin(angle), hx = length / 2, hy = width / 2;
    const radius = Math.hypot(hx, hy), steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 8));
    let nx = 0, ny = 0;
    for (let n = 0; n < steps; n++) {
      x += dx / steps; y += dy / steps;
      for (let pass = 0; pass < 3; pass++) {
        for (let ty = Math.floor((y - radius) / TILE); ty <= Math.floor((y + radius) / TILE); ty++) for (let tx = Math.floor((x - radius) / TILE); tx <= Math.floor((x + radius) / TILE); tx++) {
          if (this.inBounds(tx, ty) && !mask[ty * this.w + tx]) continue;
          const rx = x - (tx + .5) * TILE, ry = y - (ty + .5) * TILE;
          let penetration = Infinity, ax = 0, ay = 0;
          for (const [ux, uy] of [[1, 0], [0, 1], [c, s], [-s, c]]) {
            const overlap = hx * Math.abs(c * ux + s * uy) + hy * Math.abs(-s * ux + c * uy) + TILE / 2 * (Math.abs(ux) + Math.abs(uy)) - Math.abs(rx * ux + ry * uy);
            if (overlap <= 0) { penetration = -1; break; }
            if (overlap < penetration) { penetration = overlap; const sign = rx * ux + ry * uy >= 0 ? 1 : -1; ax = ux * sign; ay = uy * sign; }
          }
          if (penetration > 0) { x += ax * (penetration + .01); y += ay * (penetration + .01); nx = ax; ny = ay; }
        }
      }
    }
    return { x, y, nx, ny };
  }

  /** Height of terrain, roofs and low rigid bodies a soldier can stand on. */
  groundAt(x, y, r, z) {
    const w = this.w;
    const fr = r * 0.6;
    const tx0 = Math.floor((x - fr) / TILE), tx1 = Math.floor((x + fr) / TILE);
    const ty0 = Math.floor((y - fr) / TILE), ty1 = Math.floor((y + fr) / TILE);
    let best = this.heightAt(x, y);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (tx < 0 || ty < 0 || tx >= w || ty >= this.h) continue;
      const i = ty * w + tx;
      if (!this.top[i]) continue;
      const top = this.top[i] + this.tileBase(tx, ty);
      if (top > best && top <= z + STEP_H) best = top;
    }
    const roof = this.buildings[this.roofByTile[Math.floor(y / TILE) * this.w + Math.floor(x / TILE)]];
    if (roof?.active) {
      const offset = roof.axis === 'y' ? y - (roof.y0 + roof.y1) / 2 : x - (roof.x0 + roof.x1) / 2;
      const top = roof.ridge - Math.abs(offset) * roof.slope;
      if (top <= z + STEP_H) best = Math.max(best, top);
    }
    for (const b of this.dynamicBodies || []) if (b.id !== this.ignoreRigid && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && b.z1 <= z + STEP_H && b.z1 > best) {
      const d = rayBody(b.tuple, x, y, z + STEP_H, 0, 0, -1, 1000);
      if (Number.isFinite(d)) best = Math.max(best, z + STEP_H - d);
    }
    return best;
  }

  /**
   * Casts a bullet through the 2.5D world from height oz, rising `slope` px per horizontal px. Tiles stop it while it is lower
   * than their top. Returns the scratch object {d (horizontal distance travelled), tx, ty (the tile hit or -1), top (true when
   * the bullet came down onto the top of a low wall)}.
   */
  castBullet(ox, oy, oz, dx, dy, slope, maxD, mask = this.bstop) {
    const r = this._bh || (this._bh = { d: 0, tx: -1, ty: -1, top: false });
    r.d = maxD; r.tx = -1; r.ty = -1; r.top = false; r.ground = false; r.rigid = 0;
    for (const b of this.dynamicBodies || []) {
      if (b.id === this.ignoreRigid) continue;
      const d = rayBody(b.tuple, ox, oy, oz, dx, dy, slope, maxD);
      if (d < maxD) { maxD = d; r.d = d; r.rigid = b.id; }
    }
    const roof = roofHit(this.buildings, ox, oy, oz, dx, dy, slope, maxD);
    if (roof) { r.rigid = 0; maxD = roof.d; r.d = roof.d; r.tx = roof.tx; r.ty = roof.ty; r.top = true; }
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
      const tExit = Math.min(tMaxX, tMaxY, maxD);
      // A ray crosses at most two terrain planes inside a tile. Split at their shared diagonal.
      const diagonal = Math.abs(dx + dy) > 1e-9 ? (((tx + ty + 1) * TILE) - ox - oy) / (dx + dy) : -1;
      const points = diagonal > tEnter + 1e-7 && diagonal < tExit - 1e-7 ? [tEnter, diagonal, tExit] : [tEnter, tExit];
      let groundD = Infinity;
      for (let j = 0; j < points.length - 1; j++) {
        const a = points[j], b = points[j + 1];
        const za = oz + slope * a - this.heightAt(ox + dx * a, oy + dy * a);
        const zb = oz + slope * b - this.heightAt(ox + dx * b, oy + dy * b);
        if (za < -.001) { groundD = a; break; }
        if (zb < -.001 && zb < za) { groundD = a + (b - a) * Math.max(0, za) / (za - zb); break; }
      }
      const building = this.buildings[this.roofByTile[i]], header = this.headerBottom[i] && building?.active;
      if (mask[i] || header) {
        const base = this.tileBase(tx, ty), top = base + (header ? this.wallHeights[i] : this.top[i]);
        const bottom = header ? base + this.headerBottom[i] : -Infinity;
        let enter = tEnter, leave = tExit;
        if (Math.abs(slope) < 1e-9) { if (oz < bottom || oz >= top) leave = -1; }
        else {
          const a = (bottom - oz) / slope, b = (top - oz) / slope;
          enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
        }
        if (enter <= leave && enter < maxD && enter <= groundD) {
          r.rigid = 0; r.tx = tx; r.ty = ty; r.d = Math.max(tEnter, enter); r.top = enter > tEnter + .001; return r;
        }
      }
      if (groundD < maxD) { r.rigid = 0; r.d = groundD; r.tx = tx; r.ty = ty; r.top = true; r.ground = true; return r; }
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
