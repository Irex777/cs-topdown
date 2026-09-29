// Stacked-voxel sprites. A model is a set of coloured voxel boxes; it is baked into one small image per height layer, and
// composites (all layers stacked with a vertical offset and rotated to a heading) are cached per angle. This gives soldiers,
// vehicles and props a chunky 2.5D voxel look while the game logic stays flat.

const TAU = Math.PI * 2;
const BUCKETS = 72;

const parse = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const tint = (c, k) => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class VoxelModel {
  constructor(u = 2) {
    this.u = u;
    this.vox = new Map();
    this.done = false;
    this.cache = new Map();
  }

  /** box from (x0,y0,z0) up to but not including (x1,y1,z1); color is [r,g,b] or '#rrggbb' */
  box(x0, y0, z0, x1, y1, z1, color) {
    const c = typeof color === 'string' ? parse(color) : color;
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.vox.set(`${x},${y},${z}`, c);
    this.done = false;
    return this;
  }

  finish() {
    if (this.done) return;
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, zmax = 0;
    for (const key of this.vox.keys()) {
      const [x, y, z] = key.split(',').map(Number);
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; if (z > zmax) zmax = z;
    }
    if (minx > maxx) { minx = miny = 0; maxx = maxy = 0; }
    this.minx = minx; this.miny = miny; this.w = maxx - minx + 1; this.h = maxy - miny + 1; this.zn = zmax + 1;
    this.layers = [];
    for (let z = 0; z < this.zn; z++) {
      const c = document.createElement('canvas');
      c.width = this.w; c.height = this.h;
      const g = c.getContext('2d');
      const shade = 0.68 + 0.32 * (z / Math.max(1, this.zn - 1));
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        const col = this.vox.get(`${x + minx},${y + miny},${z}`);
        if (!col) continue;
        // voxels that nothing sits on top of catch more light
        const topExposed = !this.vox.has(`${x + minx},${y + miny},${z + 1}`);
        const k = shade * (topExposed ? 1.12 : 0.92);
        g.fillStyle = `rgb(${Math.min(255, Math.round(col[0] * k))},${Math.min(255, Math.round(col[1] * k))},${Math.min(255, Math.round(col[2] * k))})`;
        g.fillRect(x, y, 1, 1);
      }
      this.layers.push(c);
    }
    this.radius = Math.ceil(Math.hypot(Math.max(Math.abs(minx), Math.abs(maxx + 1)), Math.max(Math.abs(miny), Math.abs(maxy + 1))) * this.u) + 2;
    this.done = true;
  }

  /** composite at heading `ang` (radians, 0 = facing +x): {canvas, ax, ay} with the anchor at the model origin on the ground */
  sprite(ang) {
    this.finish();
    const b = Math.round(((ang % TAU) + TAU) % TAU / TAU * BUCKETS) % BUCKETS;
    let s = this.cache.get(b);
    if (s) return s;
    const u = this.u, R = this.radius, zh = this.zn * u;
    const canvas = document.createElement('canvas');
    canvas.width = R * 2; canvas.height = R * 2 + zh;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    const a = b / BUCKETS * TAU;
    for (let z = 0; z < this.zn; z++) {
      g.save();
      g.translate(R, R + zh - z * u);
      g.rotate(a);
      g.drawImage(this.layers[z], this.minx * u, this.miny * u, this.w * u, this.h * u);
      // each layer slightly overlaps the one above so no gaps show between the vertical steps
      g.drawImage(this.layers[z], this.minx * u, this.miny * u - u * 0.5, this.w * u, this.h * u);
      g.restore();
    }
    s = { canvas, ax: R, ay: R + zh };
    this.cache.set(b, s);
    return s;
  }
}

// ------------------------------------------------------------------------------------------------ palettes
export const TEAM_PAL = [
  { main: '#c4472f', dark: '#8c2e20', vest: '#a03826', hat: '#7a281c', trim: '#ffb09a', name: '#ff8a72' },
  { main: '#3f7fd8', dark: '#264f8f', vest: '#2f62b0', hat: '#213f73', trim: '#a8caff', name: '#7fb0ff' },
  { main: '#8a8f96', dark: '#555a60', vest: '#6a6f76', hat: '#484c52', trim: '#d0d4da', name: '#c8ccd2' },
];
const CLASS_COL = { assault: '#e0703a', engineer: '#e0b93a', support: '#4aa8e0', recon: '#7fd35a' };
const SKIN = '#e2b48c', PANTS = '#3a3d45', BOOT = '#17181c', GUN = '#2a2d33', GUNL = '#4a4f57', WOOD = '#6b4a2e';

const models = new Map();

function heldKindOf(held, weaponKinds, gadgetKinds) {
  if (held >= 200) return gadgetKinds[held - 200] || 'tool';
  if (held >= 100) return 'grenade';
  return weaponKinds[held] || 'rifle';
}
export { heldKindOf };

/** soldier model for a team, class, item kind ('rifle', 'smg', 'pistol', 'lmg', 'sniper', 'shotgun', 'dmr', 'knife', 'grenade', 'launcher', 'tool') and leg frame 0..2 */
export function soldierModel(team, cls, kind, frame, dead = false) {
  const key = `s${team}${cls}${kind}${frame}${dead ? 'x' : ''}`;
  let m = models.get(key);
  if (m) return m;
  const pal = TEAM_PAL[team] || TEAM_PAL[2];
  const c = CLASS_COL[cls] || CLASS_COL.assault;
  m = new VoxelModel(2);
  if (dead) {
    m.box(-2, -4, 0, 3, 4, 2, pal.main).box(-1, -4, 2, 2, 4, 3, pal.vest);
    m.box(3, -2, 0, 6, 2, 2, SKIN).box(3, -2, 2, 6, 2, 3, pal.hat);
    m.box(-6, -3, 0, -2, -1, 1, PANTS).box(-7, 0, 0, -2, 2, 1, PANTS).box(-8, -3, 0, -6, -1, 1, BOOT).box(-9, 0, 0, -7, 2, 1, BOOT);
    m.box(-2, -7, 0, 1, -4, 1, pal.dark).box(0, 4, 0, 4, 7, 1, pal.dark);
    m.box(-4, -3, 2, -2, 3, 3, c);
    models.set(key, m);
    return m;
  }
  const lf = frame === 1 ? 1 : frame === 2 ? -1 : 0;
  // legs
  m.box(-1 + lf, -3, 1, 1 + lf, -1, 4, PANTS).box(-1 - lf, 1, 1, 1 - lf, 3, 4, PANTS);
  m.box(-1 + lf, -3, 0, 2 + lf, -1, 1, BOOT).box(-1 - lf, 1, 0, 2 - lf, 3, 1, BOOT);
  // torso, vest, backpack
  m.box(-2, -4, 4, 2, 4, 9, pal.main);
  m.box(-1, -3, 5, 2, 3, 8, pal.vest);
  m.box(0, -3, 8, 2, 3, 9, pal.dark);
  m.box(-4, -3, 4, -2, 3, 9, c);
  if (cls === 'support') m.box(-5, -2, 5, -4, 2, 8, mixc(parse(c), [0, 0, 0], 0.3));
  if (cls === 'engineer') m.box(-4, -4, 9, -2, 4, 10, '#7a7f86');
  if (cls === 'recon') m.box(-6, -1, 8, -4, 1, 14, '#2d3a2a').box(-5, -1, 13, -4, 1, 14, c);
  // head and helmet
  m.box(-1, -2, 9, 2, 2, 12, SKIN);
  m.box(-2, -3, 11, 2, 3, 13, pal.hat);
  m.box(-2, -3, 11, 2, 3, 12, pal.hat).box(1, -2, 10, 2, 2, 11, SKIN).box(1, -2, 11, 3, 2, 12, '#1a1c22');
  m.box(-2, -1, 13, 1, 1, 14, pal.trim);
  if (cls === 'recon') m.box(-3, -3, 12, 2, 3, 13, '#3f5a35');
  // arms and what they hold
  const arm = (y, x1, z) => { m.box(0, y, z, x1, y + 1, z + 1, pal.main); m.box(x1, y, z, x1 + 1, y + 1, z + 1, SKIN); };
  m.box(-1, -5, 5, 1, -4, 8, pal.main).box(-1, 4, 5, 1, 5, 8, pal.main);
  switch (kind) {
    case 'pistol': arm(-2, 3, 6); arm(2, 3, 6); m.box(3, -1, 6, 7, 1, 8, GUN); break;
    case 'smg': arm(-2, 4, 6); arm(2, 3, 6); m.box(2, -1, 6, 9, 1, 8, GUN).box(4, -1, 4, 5, 1, 6, GUNL).box(0, -1, 6, 2, 1, 7, GUN); break;
    case 'rifle': case 'dmr': arm(-2, 6, 6); arm(2, 3, 6); m.box(2, -1, 6, 8, 1, 8, GUN).box(8, 0, 6, 13, 1, 7, GUNL).box(4, -1, 4, 5, 1, 6, GUNL).box(-1, -1, 6, 2, 1, 8, WOOD); if (kind === 'dmr') m.box(4, -1, 8, 8, 1, 9, '#111318'); break;
    case 'lmg': arm(-2, 6, 6); arm(2, 3, 6); m.box(2, -1, 5, 8, 2, 8, GUN).box(8, 0, 6, 14, 1, 7, GUNL).box(4, -1, 3, 7, 2, 5, GUNL).box(-1, -1, 6, 2, 1, 8, GUN); m.box(10, -2, 4, 11, -1, 6, GUNL).box(10, 1, 4, 11, 2, 6, GUNL); break;
    case 'sniper': arm(-2, 7, 6); arm(2, 3, 6); m.box(2, -1, 6, 8, 1, 8, GUN).box(8, 0, 6, 16, 1, 7, GUNL).box(-1, -1, 6, 2, 1, 8, GUN).box(4, -1, 8, 9, 1, 10, '#0f1116').box(3, -1, 8, 4, 1, 9, GUNL); break;
    case 'shotgun': arm(-2, 5, 6); arm(2, 3, 6); m.box(2, -1, 6, 9, 1, 8, GUN).box(9, 0, 6, 12, 1, 7, GUNL).box(5, -1, 5, 8, 1, 6, WOOD); break;
    case 'knife': arm(2, 4, 6); m.box(5, 2, 6, 8, 3, 7, '#d8dde3'); break;
    case 'grenade': arm(2, 4, 6); m.box(5, 2, 6, 7, 4, 8, '#4a6b3a'); break;
    case 'launcher': m.box(-4, 2, 8, 11, 4, 10, '#54595f').box(11, 2, 8, 13, 4, 10, '#a83c2c').box(2, 2, 6, 4, 3, 8, GUN); arm(2, 3, 6); arm(-2, 4, 6); break;
    case 'tool': arm(-2, 4, 6); arm(2, 4, 6); m.box(4, -1, 6, 7, 1, 8, '#e8e8e8').box(5, -1, 7, 6, 1, 8, '#d0392b'); break;
    default: arm(-2, 4, 6); arm(2, 4, 6);
  }
  models.set(key, m);
  return m;
}

// ------------------------------------------------------------------------------------------------ vehicles
function wheel(m, x, y, s = 3, h = 3) { m.box(x, y, 0, x + s, y + 1, h, '#1b1c20'); }

const vehModels = new Map();
/** parts: 'body' (rotates with the hull), 'turret' (rotates with the turret angle), 'gun' (free mounted machine gun), 'rotor' */
export function vehicleModel(type, team, part) {
  const key = `v${type}${team}${part}`;
  let m = vehModels.get(key);
  if (m) return m;
  const pal = TEAM_PAL[team] || TEAM_PAL[2];
  const main = team >= 0 && team < 2 ? pal.main : '#6f7a66';
  const dark = team >= 0 && team < 2 ? pal.dark : '#4a5344';
  const olive = team >= 0 && team < 2 ? mixc(parse(main), [70, 84, 58], 0.28) : mixc(parse(main), [70, 84, 58], 0.55);
  const oliveD = team >= 0 && team < 2 ? mixc(parse(dark), [40, 50, 34], 0.28) : mixc(parse(dark), [40, 50, 34], 0.55);
  m = new VoxelModel(3);
  if (type === 'quad') {
    m.box(-4, -3, 1, 5, 3, 3, olive).box(-4, -2, 3, -1, 2, 4, '#26282d').box(1, -1, 3, 3, 1, 5, '#26282d').box(3, -4, 4, 4, 4, 5, '#26282d');
    for (const [x, y] of [[-4, -5], [-4, 4], [3, -5], [3, 4]]) m.box(x, y, 0, x + 3, y + 1, 3, '#15161a');
    m.box(4, -1, 2, 6, 1, 3, '#f0e6a0').box(-5, -3, 2, -4, 3, 3, main);
  } else if (type === 'jeep') {
    if (part === 'body') {
      m.box(-7, -4, 1, 8, 4, 4, olive).box(3, -4, 4, 8, 4, 5, oliveD);
      m.box(-4, -4, 4, 3, 4, 7, olive).box(-4, -3, 4, 3, 3, 6, '#1b1f26').box(3, -4, 4, 4, 4, 7, '#9fd0ea');
      m.box(-6, -4, 4, -4, 4, 5, oliveD).box(-7, -4, 2, -6, 4, 3, main).box(3, -3, 3, 5, 3, 4, main);
      for (const [x, y] of [[-6, -6], [-6, 4], [3, -6], [3, 4]]) m.box(x, y, 0, x + 4, y + 2, 4, '#15161a');
      m.box(8, -3, 2, 9, -1, 3, '#f5edb5').box(8, 1, 2, 9, 3, 3, '#f5edb5');
      m.box(-1, -4, 7, 0, 4, 8, '#26282d');
    } else if (part === 'gun') {
      m.box(-1, -1, 0, 2, 2, 2, '#26282d').box(2, 0, 1, 10, 1, 2, '#1a1c20').box(0, -1, 2, 1, 2, 3, '#26282d');
    }
  } else if (type === 'apc') {
    if (part === 'body') {
      m.box(-9, -5, 1, 9, 5, 5, olive).box(6, -5, 5, 10, 5, 6, oliveD).box(-9, -5, 5, 6, 5, 6, olive).box(-3, -4, 6, 5, 4, 7, oliveD);
      m.box(-9, -6, 0, 10, -4, 3, '#26282d').box(-9, 4, 0, 10, 6, 3, '#26282d');
      m.box(-9, -5, 1, -8, 5, 4, main).box(-7, -1, 7, -4, 1, 8, '#26282d');
      m.box(9, -2, 3, 10, 2, 4, '#f5edb5');
    } else if (part === 'turret') {
      m.box(-3, -3, 0, 3, 3, 3, olive).box(-3, -3, 3, 3, 3, 4, oliveD).box(3, -1, 1, 12, 1, 3, '#1a1c20').box(-2, -2, 4, 2, 2, 5, '#26282d');
    } else if (part === 'gun') {
      m.box(-1, -1, 0, 2, 2, 2, '#26282d').box(2, 0, 1, 8, 1, 2, '#1a1c20');
    }
  } else if (type === 'tank') {
    if (part === 'body') {
      m.box(-9, -5, 1, 10, 5, 4, olive).box(6, -5, 4, 10, 5, 5, oliveD).box(-9, -5, 4, 6, 5, 5, olive);
      m.box(-9, -7, 0, 11, -5, 4, '#1f2126').box(-9, 5, 0, 11, 7, 4, '#1f2126');
      m.box(-9, -7, 4, 11, -5, 5, oliveD).box(-9, 5, 4, 11, 7, 5, oliveD);
      m.box(-9, -5, 1, -8, 5, 4, main).box(-7, -2, 5, -3, 2, 6, '#26282d');
      for (let x = -8; x < 10; x += 3) { m.box(x, -7, 0, x + 2, -6, 1, '#3a3d45'); m.box(x, 6, 0, x + 2, 7, 1, '#3a3d45'); }
    } else if (part === 'turret') {
      m.box(-4, -4, 0, 4, 4, 3, olive).box(-4, -4, 3, 4, 4, 4, oliveD).box(-5, -3, 0, -4, 3, 3, oliveD).box(4, -1, 1, 17, 1, 3, '#1a1c20').box(4, -2, 1, 6, 2, 3, oliveD);
      m.box(-2, -2, 4, 2, 2, 5, '#26282d').box(-1, 2, 4, 3, 3, 5, '#26282d').box(-4, -4, 0, 4, -3, 1, main).box(-4, 3, 0, 4, 4, 1, main);
    } else if (part === 'gun') {
      m.box(-1, -1, 0, 2, 2, 2, '#26282d').box(2, 0, 1, 8, 1, 2, '#1a1c20');
    }
  } else if (type === 'heli') {
    if (part === 'body') {
      m.box(-4, -2, 2, 7, 3, 6, olive).box(-12, -1, 4, -4, 1, 6, olive).box(-13, -1, 5, -11, 1, 10, oliveD).box(5, -2, 3, 9, 2, 5, olive);
      m.box(3, -2, 3, 6, 2, 6, '#9fd0ea').box(-1, -1, 6, 3, 1, 7, oliveD).box(-4, -3, 3, -1, 3, 4, main);
      m.box(-5, -4, 0, 6, -3, 1, '#26282d').box(-5, 3, 0, 6, 4, 1, '#26282d').box(-2, -4, 1, -1, -2, 2, '#26282d').box(-2, 2, 1, -1, 4, 2, '#26282d').box(3, -4, 1, 4, -2, 2, '#26282d').box(3, 2, 1, 4, 4, 2, '#26282d');
      m.box(0, -4, 3, 5, -3, 4, '#3a3d45').box(0, 3, 3, 5, 4, 4, '#3a3d45').box(8, 0, 3, 10, 1, 4, '#1a1c20');
      m.box(0, -1, 6, 1, 1, 8, '#26282d');
    } else if (part === 'rotor') {
      m.box(-1, -1, 0, 2, 2, 1, '#26282d').box(-12, -1, 0, 13, 0, 1, '#3a3d45').box(-1, -12, 0, 0, 13, 1, '#3a3d45');
    } else if (part === 'gun') {
      m.box(-1, -1, 0, 2, 2, 1, '#26282d').box(2, 0, 0, 7, 1, 1, '#1a1c20');
    }
  } else if (type === 'boat') {
    if (part === 'body') {
      m.box(-9, -4, 0, 5, 4, 3, olive).box(5, -3, 0, 8, 3, 3, olive).box(8, -2, 0, 11, 2, 2, olive).box(-9, -4, 2, 5, 4, 3, oliveD);
      m.box(-3, -3, 3, 3, 3, 6, olive).box(2, -3, 4, 4, 3, 6, '#9fd0ea').box(-3, -3, 6, 3, 3, 7, oliveD).box(-9, -4, 0, -8, 4, 3, main);
      m.box(-10, -1, 0, -9, 1, 2, '#26282d');
    } else if (part === 'gun') {
      m.box(-1, -1, 0, 2, 2, 2, '#26282d').box(2, 0, 1, 10, 1, 2, '#1a1c20');
    }
  } else {
    m.box(-6, -4, 0, 6, 4, 4, olive);
  }
  vehModels.set(key, m);
  return m;
}

/** small helper: draw a stacked sprite at a world position */
export function drawSprite(ctx, spr, x, y) { ctx.drawImage(spr.canvas, Math.round(x - spr.ax), Math.round(y - spr.ay)); }

/** 2.5D axis-aligned box: footprint w x d centred on (cx,cy), height h. top/front are CSS colours. */
export function box25(ctx, cx, cy, w, d, h, top, front, z0 = 0) {
  const x = cx - w / 2, y = cy - d / 2 - z0;
  ctx.fillStyle = front; ctx.fillRect(x, y + d - h, w, h);
  ctx.fillStyle = top; ctx.fillRect(x, y - h, w, d);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x, y + d - 2, w, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x, y - h, w, 1);
}
export { TAU, tint, mixc, parse };
