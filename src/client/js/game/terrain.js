// Voxel terrain ground. The floor is baked into 256 px canvas chunks (re-baked when something is destroyed); world3d.js puts them
// on the ground as textures. Also the source of the minimap thumbnail.
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
    this.dirtyCount = 0;
    this.shadows = opts.shadows !== false;    // baked fake shadows; the 3D renderer uses real ones
    this.thumb = null;
    this.detailImages = null;
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
  setDetailImages(images) {
    if (this.detailImages === images) return;
    this.detailImages = images;
    // Recreate canvases at the selected detail resolution; Ground retires their old textures.
    this.chunks.clear();
  }

  chunkCanvas(cx, cy) {
    const key = cy * this.cw + cx;
    let c = this.chunks.get(key);
    if (!c) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = CPX * (this.detailImages ? 2 : 1);
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
    const scale = c.canvas.width / CPX;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
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
      // Generated surfaces repeat in world coordinates, including across chunk boundaries.
      const image = this.detailImages && ((f === '.' || f === ',' || f === 'd') ? this.detailImages.grass : (f === ';' || f === 't' || f === 'c') ? this.detailImages.concrete : null);
      if (image) {
        const span = 128, sx = (tx * TILE % span) * image.width / span, sy = (ty * TILE % span) * image.height / span;
        ctx.drawImage(image, sx, sy, TILE * image.width / span, TILE * image.height / span, px, py, TILE, TILE);
        ctx.globalAlpha = f === 'd' ? 0.3 : 0.12;
        ctx.fillStyle = rgb(base); ctx.fillRect(px, py, TILE, TILE);
        ctx.globalAlpha = 1;
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
    if (this.shadows) for (let ty = ty0 - 2; ty < Math.min(map.h, ty0 + CHUNK); ty++) for (let tx = tx0 - 2; tx < Math.min(map.w, tx0 + CHUNK); tx++) {
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
    c.ver = (c.ver || 0) + 1;
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
