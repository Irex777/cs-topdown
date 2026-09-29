// Voxel terrain. The ground is baked into 256 px chunks (re-baked when something is destroyed); solid tiles are drawn every
// frame as extruded blocks, y-sorted together with the units so walls hide whatever stands behind them (2.5D).
import { TILE } from '../../shared/constants.js';
import { TILES } from '../../shared/gamemap.js';

export const CHUNK = 8;                 // tiles per chunk side
const CPX = CHUNK * TILE;
const CELL = 8;                          // one voxel cell of floor texture
const MAX_CHUNKS = 260;

const DEF_THEME = {
  grass: '#6f9d4e', grass2: '#679347', road: '#5b6068', concrete: '#a39d92', sand: '#cdb98a', deep: '#2f6fb5', shallow: '#5fb0d8',
  brick: '#b5674a', rock: '#7c7a78', crate: '#b58a4a', metal: '#5a7ea6', tree: '#3f7f3a', accent: '#ffd95a', fog: [10, 14, 20],
};

const parse = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgb = (c, k = 1, add = 0) => `rgb(${Math.max(0, Math.min(255, Math.round(c[0] * k + add)))},${Math.max(0, Math.min(255, Math.round(c[1] * k + add)))},${Math.max(0, Math.min(255, Math.round(c[2] * k + add)))})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** cheap deterministic hash -> 0..1 */
export function hash2(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function resolveTheme(t = {}) {
  const out = {};
  for (const k of Object.keys(DEF_THEME)) out[k] = t[k] !== undefined && t[k] !== null ? t[k] : DEF_THEME[k];
  out.c = {};
  for (const k of Object.keys(DEF_THEME)) if (typeof out[k] === 'string') out.c[k] = parse(out[k]);
  out.legacy = !!t.legacy;
  return out;
}

export class Terrain {
  constructor(map, opts = {}) {
    this.map = map;
    this.th = resolveTheme(map.theme);
    this.cw = Math.ceil(map.w / CHUNK); this.chh = Math.ceil(map.h / CHUNK);
    this.chunks = new Map();
    this.frame = 0;
    this.bakes = 0;
    this.sprites = new Map();
    this.dirtyCount = 0;
    this.thumb = null;
    if (opts.listen !== false) map.onChange((tx, ty, old, ch) => this.tileChanged(tx, ty, ch));
  }

  tileChanged(tx, ty, ch) {
    // shadows spill two tiles to the right and down, so neighbours' chunks may need a refresh too
    const cx0 = Math.floor(Math.max(0, tx) / CHUNK), cy0 = Math.floor(Math.max(0, ty) / CHUNK);
    const cx1 = Math.floor(Math.min(this.map.w - 1, tx + 2) / CHUNK), cy1 = Math.floor(Math.min(this.map.h - 1, ty + 2) / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) { const c = this.chunks.get(cy * this.cw + cx); if (c) c.dirty = true; }
    if (this.thumb) this.paintThumbTile(tx, ty);
  }

  // ------------------------------------------------------------------ ground chunks
  chunkCanvas(cx, cy) {
    const key = cy * this.cw + cx;
    let c = this.chunks.get(key);
    if (!c) {
      const canvas = document.createElement('canvas');
      canvas.width = CPX; canvas.height = CPX;
      c = { canvas, dirty: true, used: 0, cx, cy };
      this.chunks.set(key, c);
      if (this.chunks.size > MAX_CHUNKS) this.evict();
    }
    if (c.dirty && this.bakes < 8) { this.bake(c); c.dirty = false; this.bakes++; }
    c.used = this.frame;
    return c;
  }

  evict() {
    let worst = null;
    for (const c of this.chunks.values()) if (!worst || c.used < worst.used) worst = c;
    if (worst) this.chunks.delete(worst.cy * this.cw + worst.cx);
  }

  /** draws every chunk touching the world rectangle */
  drawGround(ctx, x0, y0, x1, y1) {
    this.frame++; this.bakes = 0;
    const cx0 = Math.max(0, Math.floor(x0 / CPX)), cy0 = Math.max(0, Math.floor(y0 / CPX));
    const cx1 = Math.min(this.cw - 1, Math.floor(x1 / CPX)), cy1 = Math.min(this.chh - 1, Math.floor(y1 / CPX));
    ctx.imageSmoothingEnabled = false;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const c = this.chunkCanvas(cx, cy);
      if (c.fresh === undefined) c.fresh = true;
      ctx.drawImage(c.canvas, cx * CPX, cy * CPX);
    }
  }

  floorOf(ch, tx, ty) {
    const t = TILES[ch];
    if (!t || !t.solid) return ch;
    if (ch === 'T' || ch === '=') return '.';
    if (ch === '#') return '#';
    return ';';
  }

  bake(c) {
    const map = this.map, th = this.th, k = th.c;
    const ctx = c.canvas.getContext('2d');
    const tx0 = c.cx * CHUNK, ty0 = c.cy * CHUNK;
    ctx.clearRect(0, 0, CPX, CPX);
    const chAt = (x, y) => (map.inBounds(x, y) ? map.chars[y * map.w + x] : '#');
    const isWater = (x, y) => map.inBounds(x, y) && map.water[y * map.w + x] > 0;
    for (let ty = ty0; ty < Math.min(map.h, ty0 + CHUNK); ty++) for (let tx = tx0; tx < Math.min(map.w, tx0 + CHUNK); tx++) {
      const ch = chAt(tx, ty);
      const f = this.floorOf(ch, tx, ty);
      const px = (tx - tx0) * TILE, py = (ty - ty0) * TILE;
      let base = k.grass, jit = 0.075, cellStyle = 0;
      switch (f) {
        case ',': base = k.grass2; break;
        case '_': base = k.road; jit = 0.05; break;
        case ';': base = k.concrete; jit = 0.045; break;
        case ':': base = k.sand; jit = 0.06; break;
        case 'r': base = mix(k.concrete, [60, 56, 54], 0.55); jit = 0.09; break;
        case 'd': base = mix(k.grass, [90, 70, 48], 0.5); jit = 0.09; break;
        case '~': base = k.deep; jit = 0.05; cellStyle = 1; break;
        case 'w': base = k.shallow; jit = 0.05; cellStyle = 2; break;
        case '#': base = mix(k.rock, [40, 38, 40], 0.45); jit = 0.06; break;
        case 't': base = mix(k.concrete, [200, 70, 60], 0.16); jit = 0.04; break;
        case 'c': base = mix(k.concrete, [70, 110, 210], 0.18); jit = 0.04; break;
        default: break;
      }
      for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
        const h = hash2(tx * 4 + cx, ty * 4 + cy, 7);
        let col = rgb(base, 1 + (h - 0.5) * 2 * jit);
        if (cellStyle === 1) { const wv = (tx * 4 + cx + ty * 4 + cy * 2) % 7; if (wv === 0 && h > 0.35) col = rgb(base, 1.18); }
        else if (cellStyle === 2) { const wv = (tx * 4 + cx * 3 + ty * 4 + cy) % 6; if (wv === 0) col = rgb(base, 1.14); }
        else if (f === '.' && h > 0.965) col = rgb(k.grass, 1.28, 8);
        else if (f === ',' && h > 0.96) col = rgb([230, 210, 90], 1);
        ctx.fillStyle = col;
        ctx.fillRect(px + cx * CELL, py + cy * CELL, CELL, CELL);
      }
      // per-type details
      if (f === ';' || f === 't' || f === 'c') {
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.fillRect(px, py, TILE, 1); ctx.fillRect(px, py, 1, TILE);
        if (f !== ';') {
          // spawn zone outline
          const same = (x, y) => chAt(x, y) === f;
          ctx.fillStyle = f === 't' ? 'rgba(255,120,100,0.55)' : 'rgba(110,160,255,0.55)';
          if (!same(tx, ty - 1)) ctx.fillRect(px, py, TILE, 3);
          if (!same(tx, ty + 1)) ctx.fillRect(px, py + TILE - 3, TILE, 3);
          if (!same(tx - 1, ty)) ctx.fillRect(px, py, 3, TILE);
          if (!same(tx + 1, ty)) ctx.fillRect(px + TILE - 3, py, 3, TILE);
        }
      } else if (f === '_') {
        // curbs where the road meets anything else
        ctx.fillStyle = 'rgba(230,225,200,0.5)';
        const road = (x, y) => { const q = chAt(x, y); return q === '_' || (TILES[q] && TILES[q].solid && q !== '#' && q !== 'B') || q === ';'; };
        if (!road(tx, ty - 1) && chAt(tx, ty - 1) !== '~' ) ctx.fillRect(px, py, TILE, 3);
        if (!road(tx, ty + 1) && chAt(tx, ty + 1) !== '~') ctx.fillRect(px, py + TILE - 3, TILE, 3);
        if (!road(tx - 1, ty) && chAt(tx - 1, ty) !== '~') ctx.fillRect(px, py, 3, TILE);
        if (!road(tx + 1, ty) && chAt(tx + 1, ty) !== '~') ctx.fillRect(px + TILE - 3, py, 3, TILE);
      } else if (f === 'r') {
        for (let i = 0; i < 5; i++) {
          const h1 = hash2(tx, ty, 20 + i), h2 = hash2(tx, ty, 40 + i), s = 4 + Math.floor(hash2(tx, ty, 60 + i) * 6);
          ctx.fillStyle = rgb(k.concrete, 0.5 + h1 * 0.5);
          ctx.fillRect(px + Math.floor(h1 * 24), py + Math.floor(h2 * 24), s, s);
          ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(px + Math.floor(h1 * 24), py + Math.floor(h2 * 24) + s - 2, s, 2);
        }
      } else if (f === 'd') {
        for (let i = 0; i < 4; i++) {
          const h1 = hash2(tx, ty, 80 + i), h2 = hash2(tx, ty, 90 + i);
          ctx.fillStyle = rgb(k.crate, 0.55 + h1 * 0.4);
          ctx.fillRect(px + Math.floor(h1 * 26), py + Math.floor(h2 * 26), 3 + (i % 3) * 2, 3);
        }
      } else if (f === 'w' || f === '~') {
        // sandy shoreline: shallow water next to land gets a sand rim, deep water a darker rim next to shallows
        if (f === 'w') {
          ctx.fillStyle = rgb(k.sand, 1, 0);
          ctx.globalAlpha = 0.55;
          if (!isWater(tx, ty - 1)) ctx.fillRect(px, py, TILE, 6);
          if (!isWater(tx, ty + 1)) ctx.fillRect(px, py + TILE - 6, TILE, 6);
          if (!isWater(tx - 1, ty)) ctx.fillRect(px, py, 6, TILE);
          if (!isWater(tx + 1, ty)) ctx.fillRect(px + TILE - 6, py, 6, TILE);
          ctx.globalAlpha = 1;
        }
      }
      // ambient occlusion where the floor meets a wall
      if (!TILES[ch].solid) {
        const sd = (x, y) => { const q = chAt(x, y); return TILES[q] && TILES[q].solid && TILES[q].h > 20; };
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        if (sd(tx, ty - 1)) ctx.fillRect(px, py, TILE, 5);
        if (sd(tx - 1, ty)) ctx.fillRect(px, py, 4, TILE);
      }
    }
    // cast shadows of solid blocks (light from the upper left)
    ctx.fillStyle = 'rgba(8,10,20,0.26)';
    for (let ty = ty0 - 2; ty < Math.min(map.h, ty0 + CHUNK); ty++) for (let tx = tx0 - 2; tx < Math.min(map.w, tx0 + CHUNK); tx++) {
      if (!map.inBounds(tx, ty)) continue;
      const ch = map.chars[ty * map.w + tx];
      const t = TILES[ch];
      if (!t || !t.solid || ch === '#') continue;
      const h = t.h;
      const px = (tx - tx0) * TILE, py = (ty - ty0) * TILE;
      const sx = h * 0.42, sy = h * 0.3;
      ctx.beginPath();
      ctx.moveTo(px + TILE, py + 6); ctx.lineTo(px + TILE + sx, py + 6 + sy); ctx.lineTo(px + TILE + sx, py + TILE + sy); ctx.lineTo(px + TILE, py + TILE);
      ctx.lineTo(px, py + TILE); ctx.lineTo(px + sx * 0.4, py + TILE + sy); ctx.lineTo(px + TILE + sx, py + TILE + sy); ctx.lineTo(px + TILE, py + TILE);
      ctx.closePath(); ctx.fill();
    }
  }

  // ------------------------------------------------------------------ block sprites
  /** {c: canvas, ox, oy}: draw at (tileX*TILE - ox, tileY*TILE - oy) */
  blockSprite(ch, front, orient, variant) {
    const key = `${ch}${front ? 1 : 0}${orient}${variant}`;
    let s = this.sprites.get(key);
    if (!s) { s = this.makeSprite(ch, front, orient, variant); this.sprites.set(key, s); }
    return s;
  }

  makeSprite(ch, front, orient, variant) {
    const th = this.th, k = th.c;
    const H = TILES[ch].h;
    const canvas = document.createElement('canvas');
    let W = TILE, ox = 0, ex = 0;
    if (ch === 'T') { W = 64; ox = 16; ex = 30; }
    canvas.width = W; canvas.height = TILE + H + ex;
    const g = canvas.getContext('2d');
    const top = ex;                     // y of the top face's upper edge
    const rnd = (i) => hash2(variant, i, 3);
    const cells = (x, y, w, h, base, jit, sx = CELL, sy = CELL, seed = 0) => {
      for (let j = 0; j < Math.ceil(h / sy); j++) for (let i = 0; i < Math.ceil(w / sx); i++) {
        g.fillStyle = rgb(base, 1 + (rnd(i * 7 + j * 13 + seed) - 0.5) * 2 * jit);
        g.fillRect(x + i * sx, y + j * sy, Math.min(sx, w - i * sx), Math.min(sy, h - j * sy));
      }
    };
    const outline = (x, y, w, h, a = 0.35) => { g.strokeStyle = `rgba(0,0,0,${a})`; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); };
    const frontFace = (base, jit, colsPx = CELL, rowsPx = CELL) => {
      if (!front) return;
      const fy = top + TILE;
      cells(0, fy, TILE, H, base, jit, colsPx, rowsPx, 50);
      // top-down light gradient + dark foot
      const grad = g.createLinearGradient(0, fy, 0, fy + H);
      grad.addColorStop(0, 'rgba(255,255,255,0.10)'); grad.addColorStop(1, 'rgba(0,0,0,0.30)');
      g.fillStyle = grad; g.fillRect(0, fy, TILE, H);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, fy + H - 2, TILE, 2);
    };
    const topFace = (base, jit) => {
      cells(0, top, TILE, TILE, base, jit, CELL, CELL, 0);
      g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(0, top, TILE, 2); g.fillRect(0, top, 2, TILE);
      g.fillStyle = 'rgba(0,0,0,0.20)'; g.fillRect(TILE - 2, top, 2, TILE); g.fillRect(0, top + TILE - 2, TILE, 2);
    };

    switch (ch) {
      case '#': {
        const base = k.rock;
        frontFace(mix(base, [40, 40, 45], 0.25), 0.10, 8, 8);
        topFace(mix(base, [255, 255, 255], 0.12), 0.10);
        break;
      }
      case 'B': case 'G': {
        const wall = mix(k.brick, k.concrete, 0.35);
        if (ch === 'G' && front) {
          const fy = top + TILE;
          cells(0, fy, TILE, H, mix(wall, [0, 0, 0], 0.15), 0.05);
          g.fillStyle = 'rgba(150,215,240,0.85)'; g.fillRect(3, fy + 4, TILE - 6, H - 10);
          g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(6, fy + 6, 6, H - 14); g.fillRect(16, fy + 6, 3, H - 14);
          g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(TILE / 2 - 1, fy + 4, 2, H - 10);
          g.fillRect(0, fy + H - 2, TILE, 2);
        } else {
          frontFace(k.brick, 0.07, 16, 8);
          if (front) {
            g.fillStyle = 'rgba(0,0,0,0.20)';
            for (let r = 0; r < Math.ceil(H / 8); r++) {
              g.fillRect(0, top + TILE + r * 8 + 7, TILE, 1);
              const off = (r & 1) ? 8 : 0;
              g.fillRect(off + 7, top + TILE + r * 8, 1, 7); g.fillRect(off + 23 > 31 ? 7 : off + 23, top + TILE + r * 8, 1, 7);
            }
          }
        }
        topFace(mix(wall, [255, 255, 255], 0.15), 0.05);
        break;
      }
      case 'M': {
        const cols = [k.metal, [181, 71, 58], [58, 138, 90], [217, 165, 58]];
        const base = cols[variant % 4];
        frontFace(mix(base, [0, 0, 0], 0.1), 0.05, 4, 32);
        if (front) { g.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 3; i < TILE; i += 4) g.fillRect(i, top + TILE + 2, 1, H - 4); }
        topFace(mix(base, [255, 255, 255], 0.12), 0.04);
        g.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 3; i < TILE; i += 6) g.fillRect(i, top + 2, 1, TILE - 4);
        break;
      }
      case 'X': {
        frontFace(k.crate, 0.08, 16, 8);
        if (front) { g.strokeStyle = rgb(k.crate, 0.62); g.lineWidth = 2; g.beginPath(); const fy = top + TILE; g.moveTo(3, fy + 3); g.lineTo(TILE - 3, fy + H - 3); g.moveTo(TILE - 3, fy + 3); g.lineTo(3, fy + H - 3); g.stroke(); outline(1, fy, TILE - 2, H, 0.4); }
        topFace(mix(k.crate, [255, 240, 200], 0.18), 0.07);
        g.strokeStyle = rgb(k.crate, 0.6); g.lineWidth = 2; g.strokeRect(4, top + 4, TILE - 8, TILE - 8);
        break;
      }
      case 'L': {
        const bag = [196, 178, 128];
        if (front) {
          const fy = top + TILE;
          for (let r = 0; r < 2; r++) for (let i = 0; i < 2; i++) {
            const off = r ? 8 : 0;
            g.fillStyle = rgb(bag, 0.78 + rnd(r * 5 + i) * 0.16); g.fillRect(off + i * 16 - (off ? 0 : 0), fy + r * 6, 15, 6);
            g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(off + i * 16, fy + r * 6 + 5, 15, 1);
          }
        }
        cells(0, top, TILE, TILE, bag, 0.09, 16, 8);
        g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, top + 8, TILE, 1); g.fillRect(0, top + 16, TILE, 1); g.fillRect(0, top + 24, TILE, 1);
        g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(0, top, TILE, 1);
        break;
      }
      case 'o': {
        const cx = TILE / 2, r = 10;
        const col = [212, 92, 48];
        if (front) { g.fillStyle = rgb(col, 0.72); g.fillRect(cx - r, top + TILE / 2 + 4, r * 2, H + TILE / 2 - 6); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(cx - r, top + TILE + 4, r * 2, 2); g.fillRect(cx - r, top + TILE + H - 6, r * 2, 2); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(cx - r + 2, top + TILE / 2 + 4, 3, H + TILE / 2 - 8); }
        g.fillStyle = rgb(col, 1.05);
        g.fillRect(cx - r + 3, top + TILE / 2 - r, r * 2 - 6, r * 2); g.fillRect(cx - r, top + TILE / 2 - r + 3, r * 2, r * 2 - 6);
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(cx - 6, top + TILE / 2 - 6, 12, 12);
        g.fillStyle = 'rgba(255,220,120,0.9)'; g.fillRect(cx - 3, top + TILE / 2 - 3, 6, 6);
        break;
      }
      case '=': {
        // chain-link fence: thin posts and a see-through mesh
        const horiz = orient === 'h';
        g.fillStyle = 'rgba(0,0,0,0.5)';
        if (horiz) {
          const fy = top + TILE / 2;
          g.fillStyle = 'rgba(190,205,220,0.28)'; g.fillRect(0, fy + 2, TILE, H);
          g.fillStyle = 'rgba(190,205,220,0.65)'; for (let i = 0; i < TILE; i += 4) { g.fillRect(i, fy + 2, 1, H); }
          g.fillStyle = 'rgb(90,98,110)'; g.fillRect(0, fy, TILE, 3);
          g.fillRect(2, fy, 3, H + 3); g.fillRect(TILE - 5, fy, 3, H + 3);
        } else {
          g.fillStyle = 'rgb(90,98,110)'; g.fillRect(TILE / 2 - 2, top, 4, TILE);
          g.fillStyle = 'rgb(130,140,155)'; g.fillRect(TILE / 2 - 3, top + 1, 6, 4); g.fillRect(TILE / 2 - 3, top + TILE - 5, 6, 4);
          if (front) { g.fillStyle = 'rgba(190,205,220,0.5)'; g.fillRect(TILE / 2 - 3, top + TILE, 6, H); }
        }
        break;
      }
      case 'T': {
        const cx = 32;
        // trunk
        g.fillStyle = 'rgb(96,66,40)'; g.fillRect(cx - 5, top + 24, 10, H - 6);
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(cx + 1, top + 24, 4, H - 6);
        // canopy: three stacked voxel tiers
        const tiers = [[42, 0.78, 22], [34, 0.94, 12], [24, 1.1, 2]];
        for (const [sz, br, up] of tiers) {
          const x = cx - sz / 2, y = top + 10 - up + 8;
          const nc = Math.ceil(sz / 6);
          for (let j = 0; j < nc; j++) for (let i = 0; i < nc; i++) {
            const inCorner = (i === 0 || i === nc - 1) && (j === 0 || j === nc - 1);
            if (inCorner) continue;
            g.fillStyle = rgb(k.tree, br * (0.9 + rnd(i * 11 + j * 3 + up) * 0.2));
            g.fillRect(x + i * 6, y + j * 6, 6, 6);
          }
        }
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(cx - 12, top + 10, 10, 4);
        break;
      }
      default: {
        topFace(k.concrete, 0.05);
      }
    }
    return { c: canvas, ox, oy: top === 0 ? H : H + ex, w: W, h: canvas.height, ex };
  }

  /** what to draw for the solid tile at (tx,ty): sprite plus screen offset */
  spriteAt(tx, ty) {
    const map = this.map;
    const i = ty * map.w + tx;
    const ch = map.chars[i];
    const t = TILES[ch];
    const H = t.h;
    let front = true;
    if (ty + 1 < map.h) {
      const s = TILES[map.chars[i + map.w]];
      if (s.solid && s.h >= H - 2) front = false;
    }
    let orient = '';
    if (ch === '=') orient = (map.chars[i - 1] === '=' || map.chars[i + 1] === '=') ? 'h' : 'v';
    const variant = ch === 'M' ? (tx * 7 + ty * 3) & 3 : Math.floor(hash2(tx, ty, 5) * 4);
    return { ch, spr: this.blockSprite(ch, front, orient, variant), H };
  }

  // ------------------------------------------------------------------ minimap thumbnail (1 tile = S px)
  buildThumb(S = 4) {
    const map = this.map;
    const c = document.createElement('canvas');
    c.width = map.w * S; c.height = map.h * S;
    this.thumb = c; this.thumbS = S;
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) this.paintThumbTile(x, y);
    return c;
  }

  paintThumbTile(tx, ty) {
    const c = this.thumb; if (!c) return;
    const map = this.map, k = this.th.c, S = this.thumbS;
    const g = c.getContext('2d');
    const ch = map.chars[ty * map.w + tx];
    const t = TILES[ch];
    let col;
    if (ch === '#') col = mix(k.rock, [0, 0, 0], 0.15);
    else if (ch === 'B' || ch === 'G') col = mix(k.brick, [0, 0, 0], 0.15);
    else if (ch === 'M') col = k.metal;
    else if (ch === 'X' || ch === 'L' || ch === 'o') col = mix(k.crate, [0, 0, 0], 0.1);
    else if (ch === 'T') col = mix(k.tree, [0, 0, 0], 0.15);
    else if (ch === '=') col = k.grass;
    else if (ch === '~') col = k.deep;
    else if (ch === 'w') col = k.shallow;
    else if (ch === '_') col = k.road;
    else if (ch === ';') col = k.concrete;
    else if (ch === ':') col = k.sand;
    else if (ch === 't') col = mix(k.concrete, [220, 60, 50], 0.4);
    else if (ch === 'c') col = mix(k.concrete, [60, 100, 230], 0.4);
    else if (ch === 'r' || ch === 'd') col = mix(k.concrete, [0, 0, 0], 0.4);
    else col = ch === ',' ? k.grass2 : k.grass;
    void t;
    g.fillStyle = rgb(col);
    g.fillRect(tx * S, ty * S, S, S);
  }
}

/** small preview canvas of a map (lobby cards) */
export function mapThumb(map, w, h) {
  const t = new Terrain(map, { listen: false });
  const big = t.buildThumb(3);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#05070b'; g.fillRect(0, 0, w, h);
  const k = Math.min(w / big.width, h / big.height);
  g.drawImage(big, (w - big.width * k) / 2, (h - big.height * k) / 2, big.width * k, big.height * k);
  return c;
}
