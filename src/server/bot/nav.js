// Navigation for bots: A* over the tile grid + string-pulling path smoothing + map analysis (anchors, spots).
import { TILE, PLAYER_R } from '../../shared/constants.js';

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0], lk = k.pop(), lv = v.pop();
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

export class NavGrid {
  constructor(map) {
    this.map = map;
    this.w = map.w; this.h = map.h;
    const n = this.w * this.h;
    this.cost = new Float32Array(n);   // extra cost near walls
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (map.isSolidTile(x, y)) continue;
      let near = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (map.isSolidTile(x + dx, y + dy)) near++;
      this.cost[y * this.w + x] = near > 0 ? 0.35 + Math.min(near, 4) * 0.12 : 0;
    }
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gen = 0;
    this._analyse();
  }

  tileOf(x, y) { return [Math.floor(x / TILE), Math.floor(y / TILE)]; }
  center(tx, ty) { return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE }; }
  walkable(tx, ty) { return !this.map.isSolidTile(tx, ty); }

  nearestWalkable(tx, ty) {
    if (this.walkable(tx, ty)) return [tx, ty];
    for (let r = 1; r < 8; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (this.walkable(tx + dx, ty + dy)) return [tx + dx, ty + dy];
      }
    }
    return [tx, ty];
  }

  /** A* from pixel (sx,sy) to (gx,gy). Returns array of {x,y} pixel waypoints (smoothed), or null. */
  findPath(sx, sy, gx, gy, smooth = true) {
    const w = this.w, map = this.map;
    let [stx, sty] = this.tileOf(sx, sy); [stx, sty] = this.nearestWalkable(stx, sty);
    let [gtx, gty] = this.tileOf(gx, gy); [gtx, gty] = this.nearestWalkable(gtx, gty);
    const start = sty * w + stx, goal = gty * w + gtx;
    if (start === goal) return [{ x: gx, y: gy }];
    const gen = ++this.gen;
    const heap = new MinHeap();
    this.g[start] = 0; this.stamp[start] = gen; this.parent[start] = -1;
    heap.push(0, start);
    let found = false, iters = 0;
    while (heap.size && iters++ < 20000) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goal) { found = true; break; }
      const cx = cur % w, cy = (cur / w) | 0;
      const gc = this.g[cur];
      for (let d = 0; d < 8; d++) {
        const dx = DIRS[d][0], dy = DIRS[d][1];
        const nx = cx + dx, ny = cy + dy;
        if (map.isSolidTile(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (map.isSolidTile(cx + dx, cy) || map.isSolidTile(cx, cy + dy))) continue;
        const ni = ny * w + nx;
        if (this.closed[ni] === gen) continue;
        const ng = gc + DIRS[d][2] + this.cost[ni];
        if (this.stamp[ni] !== gen || ng < this.g[ni]) {
          this.g[ni] = ng; this.stamp[ni] = gen; this.parent[ni] = cur;
          const h = Math.hypot(nx - gtx, ny - gty);
          heap.push(ng + h, ni);
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = goal; c !== -1; c = this.parent[c]) cells.push(c);
    cells.reverse();
    let pts = cells.map((c) => ({ x: ((c % w) + 0.5) * TILE, y: (((c / w) | 0) + 0.5) * TILE }));
    pts[pts.length - 1] = { x: gx, y: gy };
    if (map.isSolidAt(gx, gy)) pts[pts.length - 1] = this.center(gtx, gty);
    return smooth ? this.smoothPath(sx, sy, pts) : pts;
  }

  /** Path length in pixels along the (unsmoothed) route, or Infinity. */
  pathLength(sx, sy, gx, gy) {
    const p = this.findPath(sx, sy, gx, gy, false);
    if (!p) return Infinity;
    let len = 0, px = sx, py = sy;
    for (const q of p) { len += Math.hypot(q.x - px, q.y - py); px = q.x; py = q.y; }
    return len;
  }

  smoothPath(sx, sy, pts) {
    const out = [];
    let cx = sx, cy = sy, i = 0;
    const R = PLAYER_R + 2;
    while (i < pts.length) {
      // farthest waypoint we can walk to in a straight line
      let j = Math.min(pts.length - 1, i + 24);
      while (j > i && !this.map.clearLineR(cx, cy, pts[j].x, pts[j].y, R)) j--;
      out.push(pts[j]);
      cx = pts[j].x; cy = pts[j].y; i = j + 1;
    }
    return out;
  }

  // ------------------------------------------------------------------ map analysis for bots
  _analyse() {
    const map = this.map;
    this.siteSpots = [[], []];      // spots on/around each site
    this.siteCentre = [null, null];
    this.lanes = [[], []];          // forward holding positions on the way to each site
    this.entries = [null, null];    // where the route into each site begins
    this.midSpots = [];
    const T = map.spawnCenter[0], CT = map.spawnCenter[1];
    for (let s = 0; s < 2; s++) {
      const site = map.sites[s];
      if (!site) continue;
      const [tx, ty] = this.nearestWalkable(Math.floor(site.x / TILE), Math.floor(site.y / TILE));
      this.siteCentre[s] = this.center(tx, ty);
      // site tiles that make good plant / hold spots: open floor, not touching walls
      const cand = [];
      for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
        if (map.site[y * map.w + x] !== s + 1 || map.isSolidTile(x, y)) continue;
        let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (map.isSolidTile(x + dx, y + dy)) ok = false;
        if (ok) cand.push(this.center(x, y));
      }
      // farthest-point pick for spread
      const picked = [];
      if (cand.length) {
        cand.sort((a, b) => Math.hypot(a.x - site.x, a.y - site.y) - Math.hypot(b.x - site.x, b.y - site.y));
        picked.push(cand[0]);
        while (picked.length < 8) {
          let best = null, bd = -1;
          for (const c of cand) {
            let md = Infinity;
            for (const p of picked) md = Math.min(md, Math.hypot(c.x - p.x, c.y - p.y));
            if (md > bd) { bd = md; best = c; }
          }
          if (!best || bd < TILE * 2.5) break;
          picked.push(best);
        }
      }
      this.siteSpots[s] = picked;
      // route from T spawn to the site, sample forward lane spots along it
      const route = this.findPath(T.x, T.y, this.siteCentre[s].x, this.siteCentre[s].y, false);
      if (route) {
        const total = route.length;
        const at = (f) => route[Math.max(0, Math.min(total - 1, Math.floor(total * f)))];
        this.entries[s] = at(0.78);
        this.lanes[s] = [at(0.86), at(0.92)].map((p) => ({ x: p.x, y: p.y }));
        this.routeToSite = this.routeToSite || [];
        this.routeToSite[s] = route;
      }
    }
    // mid: halfway along the T -> CT route
    const mid = this.findPath(T.x, T.y, CT.x, CT.y, false);
    if (mid) {
      for (const f of [0.4, 0.5, 0.6]) {
        const p = mid[Math.floor(mid.length * f)];
        if (p) this.midSpots.push({ x: p.x, y: p.y });
      }
    }
  }

  /** Direction (radians) that a bot standing at (x,y) should watch: back along the enemy's approach route. */
  watchAngle(x, y, fromX, fromY) {
    const p = this.findPath(fromX, fromY, x, y, false);
    if (!p || p.length < 2) return Math.atan2(fromY - y, fromX - x);
    const q = p[Math.max(0, p.length - 1 - 7)];
    return Math.atan2(q.y - y, q.x - x);
  }

  /** Random walkable point near (x,y) that can see (x,y). */
  spotWithLos(x, y, minD, maxD, rnd = Math.random) {
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2, d = minD + rnd() * (maxD - minD);
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      if (this.map.isSolidAt(px, py)) continue;
      // keep off walls
      if (this.map.isSolidAt(px + 14, py) || this.map.isSolidAt(px - 14, py) || this.map.isSolidAt(px, py + 14) || this.map.isSolidAt(px, py - 14)) continue;
      if (this.map.los(px, py, x, y)) return { x: px, y: py };
    }
    return { x, y };
  }
}
