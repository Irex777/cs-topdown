// Particle / tracer / decal simulation and screen shake. Everything is made of little cubes to match the voxel look;
// particles carry a height z. The 3D renderer (fx3d.js) draws what is simulated here.
import { TILE } from '../../shared/constants.js';

const rnd = Math.random;
const TAU = Math.PI * 2;
const CH = 256;

const DEBRIS = {
  '#': ['#7c7a78', '#5e5c5b'], B: ['#b5674a', '#8c4a35', '#c9a58f'], X: ['#b58a4a', '#8a6631'], o: ['#d45c30', '#8a3a1c'], '=': ['#9aa4b0', '#6a727c'],
  L: ['#c4b280', '#a89660'], G: ['#a8dcf0', '#e6f6ff'], T: ['#3f7f3a', '#60422a', '#4f9a48'], M: ['#5a7ea6', '#3a566f'], default: ['#8a8580', '#6a6560'],
};

export class FX {
  constructor() {
    this.parts = [];
    this.tracers = [];
    this.rings = [];
    this.floaters = [];
    this.decals = new Map();
    this.shake = 0;
    this.shakeX = 0; this.shakeY = 0;
    this.map = null;
    this.smokeGate = new Map();
  }

  /** rate limit for damage smoke of one vehicle */
  shouldSmoke(id, now) {
    const last = this.smokeGate.get(id) || 0;
    if (now - last < 90) return false;
    this.smokeGate.set(id, now);
    return true;
  }

  initMap(map) {
    this.map = map;
    this.decals.clear();
    this.parts.length = 0; this.tracers.length = 0; this.rings.length = 0; this.floaters.length = 0;
  }

  clearAll() { this.decals.clear(); this.parts.length = 0; this.tracers.length = 0; this.rings.length = 0; this.floaters.length = 0; }

  addShake(a) { this.shake = Math.min(16, this.shake + a); }

  // ------------------------------------------------------------------ decals (per 256 px chunk, created on demand)
  decalCtx(cx, cy) {
    const key = cy * 4096 + cx;
    let d = this.decals.get(key);
    if (!d) { const c = document.createElement('canvas'); c.width = CH; c.height = CH; d = { c, g: c.getContext('2d'), ver: 0 }; this.decals.set(key, d); }
    return d;
  }

  /** run fn(ctx) with the context translated into every decal chunk that the box touches */
  paintDecal(x, y, r, fn) {
    if (!this.map) return;
    const cx0 = Math.max(0, Math.floor((x - r) / CH)), cx1 = Math.floor((x + r) / CH);
    const cy0 = Math.max(0, Math.floor((y - r) / CH)), cy1 = Math.floor((y + r) / CH);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const d = this.decalCtx(cx, cy);
      d.g.save(); d.g.translate(-cx * CH, -cy * CH); fn(d.g); d.g.restore();
      d.ver++;
    }
  }

  // ------------------------------------------------------------------ spawners
  tracer(x0, y0, z0, x1, y1, z1, own, big) {
    this.tracers.push({ x0, y0, z0, x1, y1, z1, t: 0, life: big ? 0.16 : 0.09, own, big });
    if (this.tracers.length > 160) this.tracers.shift();
  }

  cube(o) { this.parts.push(Object.assign({ z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 0.5, r: 3, k: 'cube', g: 0, col: '#fff', drag: 0 }, o)); }

  blood(x, y, dir, n = 8, z = 10) {
    for (let i = 0; i < n; i++) {
      const a = dir + (rnd() - 0.5) * 1.1, sp = 60 + rnd() * 200;
      this.cube({ x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 40 + rnd() * 90, g: 700, life: 0.3 + rnd() * 0.3, r: 1.5 + rnd() * 1.8, col: rnd() < 0.5 ? '#a3121a' : '#7a0d12', drag: 3 });
    }
    this.splat(x, y, dir, 3 + Math.floor(rnd() * 3));
  }

  splat(x, y, dir, n) {
    this.paintDecal(x, y, 24, (c) => {
      for (let i = 0; i < n; i++) {
        const d = 3 + rnd() * 14, a = dir + (rnd() - 0.5) * 1.6;
        c.fillStyle = `rgba(${120 + (rnd() * 30) | 0},8,10,${0.3 + rnd() * 0.3})`;
        const s = 2 + Math.floor(rnd() * 3) * 2;
        c.fillRect(Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d), s, s);
      }
    });
  }

  corpseStain(x, y) {
    this.paintDecal(x, y, 22, (c) => {
      for (let i = 0; i < 9; i++) { c.fillStyle = `rgba(${110 + (rnd() * 30) | 0},6,8,${0.25 + rnd() * 0.25})`; const s = 4 + Math.floor(rnd() * 4) * 2; c.fillRect(Math.round(x + (rnd() - 0.5) * 24), Math.round(y + (rnd() - 0.5) * 24), s, s); }
    });
  }

  scorch(x, y, r) {
    this.paintDecal(x, y, r + 4, (c) => {
      // a ragged blocky crater: squares of soot, darker toward the middle
      const n = Math.ceil(r / 6);
      for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
        const d = Math.hypot(i, j) / n;
        if (d > 1 || rnd() < d * 0.6) continue;
        c.fillStyle = `rgba(${10 + (rnd() * 14) | 0},${8 + (rnd() * 8) | 0},6,${(1 - d) * 0.55})`;
        c.fillRect(Math.round(x + i * 6 - 3), Math.round(y + j * 6 - 3), 6, 6);
      }
    });
  }

  sparks(x, y, dir, n = 5, z = 8) {
    for (let i = 0; i < n; i++) {
      const a = dir + Math.PI + (rnd() - 0.5) * 1.6, sp = 80 + rnd() * 220;
      this.cube({ x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 30 + rnd() * 100, g: 600, life: 0.12 + rnd() * 0.15, r: 1.3, col: '#ffd98a', drag: 4 });
    }
    this.cube({ x, y, z, life: 0.35, r: 3, k: 'puff', col: '#bdb6a8', a0: 0.3, grow: 10, vz: 20 });
  }

  casing(x, y, ang, z = 12) {
    const a = ang + Math.PI / 2 + (rnd() - 0.5) * 0.6, sp = 90 + rnd() * 70;
    this.cube({ x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 90, g: 600, life: 0.5, r: 1.3, col: '#d7b14a', drag: 3 });
  }

  muzzle(x, y, ang, z = 11) {
    const fx = x + Math.cos(ang) * 16, fy = y + Math.sin(ang) * 16;
    this.cube({ x: fx, y: fy, z, life: 0.06, r: 5, k: 'flash' });
  }

  ring(x, y, r0, r1, life, color, width = 3) { this.rings.push({ x, y, r0, r1, life, t: 0, color, width }); }

  explosion(x, y, size) {
    const s = Math.max(0.5, size / 120);
    const n = Math.round(22 * s + 8);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, sp = (60 + rnd() * 240) * Math.sqrt(s);
      this.cube({ x, y, z: 6 + rnd() * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 60 + rnd() * 220 * s, g: -60, life: 0.35 + rnd() * 0.5, r: (3 + rnd() * 6) * Math.sqrt(s), k: 'fire', drag: 2 });
    }
    for (let i = 0; i < Math.round(10 * s + 4); i++) {
      const a = rnd() * TAU, sp = 15 + rnd() * 90 * Math.sqrt(s);
      this.cube({ x, y, z: 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 30 + rnd() * 60, g: -20, life: 1 + rnd() * 1.4, r: (7 + rnd() * 9) * Math.sqrt(s), k: 'puff', col: '#4a4644', a0: 0.5, grow: 24 * s, drag: 1.5 });
    }
    this.ring(x, y, 8, 40 + size * 1.3, 0.5, 'rgba(255,214,140,0.9)', 4 + s * 3);
    this.cube({ x, y, z: 10, life: 0.2, r: size * 0.9, k: 'glow' });
    this.scorch(x, y, Math.min(70, size * 0.5));
  }

  flashBurst(x, y) {
    this.cube({ x, y, z: 12, life: 0.35, r: 160, k: 'glow', col: '#ffffff' });
    this.ring(x, y, 10, 200, 0.3, 'rgba(255,255,255,0.9)', 4);
  }

  molotovSplash(x, y) {
    for (let i = 0; i < 24; i++) {
      const a = rnd() * TAU, sp = 40 + rnd() * 200;
      this.cube({ x, y, z: 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 40 + rnd() * 80, g: 300, life: 0.3 + rnd() * 0.4, r: 3 + rnd() * 4, k: 'fire', drag: 2 });
    }
    this.scorch(x, y, 40);
  }

  flames(x, y, r) {
    for (let i = 0; i < 2; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * r;
      this.cube({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: 0, vx: (rnd() - 0.5) * 16, vy: 0, vz: 30 + rnd() * 50, life: 0.3 + rnd() * 0.35, r: 3 + rnd() * 4, k: 'fire' });
    }
  }

  /** a wall block falls apart into cubes of its own colour */
  tileBreak(tx, ty, ch) {
    const cols = DEBRIS[ch] || DEBRIS.default;
    const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
    const n = ch === '=' ? 6 : ch === 'B' || ch === '#' ? 16 : 11;
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, sp = 40 + rnd() * 190;
      this.cube({ x: cx + (rnd() - 0.5) * 22, y: cy + (rnd() - 0.5) * 22, z: 6 + rnd() * 24, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 90 + rnd() * 260, g: 900, life: 0.9 + rnd() * 0.5, r: 2 + rnd() * 3.5, col: cols[i % cols.length], k: 'debris', bounce: 0.35 });
    }
    for (let i = 0; i < 3; i++) this.cube({ x: cx + (rnd() - 0.5) * 18, y: cy + (rnd() - 0.5) * 18, z: 10, vx: (rnd() - 0.5) * 40, vy: (rnd() - 0.5) * 40, vz: 40 + rnd() * 50, life: 0.9 + rnd() * 0.6, r: 8 + rnd() * 6, k: 'puff', col: '#8d867d', a0: 0.42, grow: 16, drag: 1.5 });
  }

  smokeTrail(x, y, z = 10) { this.cube({ x, y, z, vz: 12, life: 0.7, r: 3, k: 'puff', col: '#c8c2b8', a0: 0.35, grow: 8 }); }
  damageSmoke(x, y, heavy, z = 14) {
    this.cube({ x: x + (rnd() - 0.5) * 12, y: y + (rnd() - 0.5) * 12, z, vz: 26 + rnd() * 20, life: 0.9 + rnd() * 0.5, r: 4, k: 'puff', col: heavy ? '#26221f' : '#6d6862', a0: 0.55, grow: 14 });
    if (heavy && rnd() < 0.5) this.cube({ x: x + (rnd() - 0.5) * 10, y: y + (rnd() - 0.5) * 10, z: z - 4, vz: 40 + rnd() * 30, life: 0.35, r: 3 + rnd() * 2, k: 'fire' });
  }

  floater(x, y, text, color) { this.floaters.push({ x, y, text, color, t: 0, life: 1.4 }); }

  // ------------------------------------------------------------------ update / draw
  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t += dt;
      if (p.t >= p.life) { this.parts[i] = this.parts[this.parts.length - 1]; this.parts.pop(); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vz -= p.g * dt;
      if (p.drag) { const f = Math.exp(-p.drag * dt); p.vx *= f; p.vy *= f; }
      if (p.z < 0 && p.g > 0) { p.z = 0; if (p.bounce && Math.abs(p.vz) > 30) p.vz = -p.vz * p.bounce; else { p.vz = 0; p.vx *= 0.6; p.vy *= 0.6; } }
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) { this.tracers[i].t += dt; if (this.tracers[i].t > this.tracers[i].life) this.tracers.splice(i, 1); }
    for (let i = this.rings.length - 1; i >= 0; i--) { this.rings[i].t += dt; if (this.rings[i].t > this.rings[i].life) this.rings.splice(i, 1); }
    for (let i = this.floaters.length - 1; i >= 0; i--) { this.floaters[i].t += dt; if (this.floaters[i].t > this.floaters[i].life) this.floaters.splice(i, 1); }
    if (this.parts.length > 1400) this.parts.splice(0, this.parts.length - 1400);
    this.shake *= Math.exp(-7 * dt);
    if (this.shake < 0.05) this.shake = 0;
    this.shakeX = (rnd() - 0.5) * 2 * this.shake;
    this.shakeY = (rnd() - 0.5) * 2 * this.shake;
  }
}
