// First-person weapon view: the gun and arms drawn in their own scene on top of the world (own camera and depth buffer, so
// they never poke into walls). Procedural voxel guns per weapon kind with the equipped attachments, and the animation state:
// walk bob, sprint pose, aim down sights, recoil kick, reload, weapon switch, mouse sway, knife swing.
import * as THREE from '../../vendor/three/three.module.js';
import { VoxelModel } from './voxel.js';
import { voxelGeometry, VOXEL_MAT } from './models3d.js';
import { assets, buildGun, hasGun, makeEnvironment } from './assets.js';

const U = 0.0115;                 // view-model units per voxel
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------------------------------------ gun models
// Model space: x forward, y right, z up (voxels). The sight line is z = 5..7; `meta` gives the muzzle, grip and fore-grip.
const METAL = '#8b929c', LIGHT = '#b3bac4', DARK = '#23262c', BLK = '#2c2f36', BLK2 = '#3b3f47', RED = '#e23a2a';

// Each weapon's look: receiver colours, furniture (handguard / grip / stock), magazine and shape parameters.
const LOOK = {
  ar7:   { rec: '#b39257', rec2: '#977a4b', hand: BLK, hand2: BLK2, stock: BLK, mag: '#3c4048', mag2: '#4a4f57', hg: 15, bar: 8, stockS: 'std' },
  br12:  { rec: '#59653f', rec2: '#48533a', hand: '#2a2d32', hand2: '#3a3e44', stock: '#2a2d32', mag: '#3c4048', mag2: '#4d525a', hg: 19, bar: 9, stockS: 'fixed', fat: 1 },
  vx9:   { rec: BLK, rec2: '#3b3f47', hand: '#b39257', hand2: '#977a4b', stock: '#b39257', mag: '#b39257', mag2: '#977a4b', hg: 10, bar: 4, stockS: 'skel' },
  sg4:   { rec: '#3a3d43', rec2: '#2c2f36', hand: '#b98f5a', hand2: '#8f6d40', stock: '#b98f5a', mag: '#3c4048', mag2: '#4a4f57', hg: 14, bar: 10, stockS: 'fixed', pump: 1 },
  mg60:  { rec: '#55603f', rec2: '#434c31', hand: '#2c2f36', hand2: '#3b3f47', stock: '#3b4630', mag: '#5a6a40', mag2: '#4a5836', hg: 18, bar: 10, stockS: 'fixed', fat: 1, lmg: 1 },
  dmr14: { rec: '#a68a52', rec2: '#8e7444', hand: BLK, hand2: BLK2, stock: '#2c2f36', mag: '#3c4048', mag2: '#4a4f57', hg: 17, bar: 12, stockS: 'fixed' },
  sr50:  { rec: '#4a5537', rec2: '#3b4530', hand: '#2a2d32', hand2: '#3a3e44', stock: '#3b4630', mag: '#3c4048', mag2: '#4a4f57', hg: 18, bar: 16, stockS: 'sniper', bolt: 1 },
  p18:   { rec: BLK, rec2: '#3b3f47', hand: '#bd9d66', hand2: '#a58857', stock: BLK, mag: '#3b3f47', mag2: '#4a4f57', hg: 9, bar: 2, stockS: 'none' },
};
const LOOK_KIND = { rifle: 'ar7', smg: 'vx9', shotgun: 'sg4', lmg: 'mg60', dmr: 'dmr14', sniper: 'sr50', pistol: 'p18' };

/** stamp a small model into another one at an offset */
function stamp(dst, src, dx, dy, dz) { for (const [k, c] of src.vox) { const [x, y, z] = k.split(',').map(Number); dst.vox.set(`${x + dx},${y + dy},${z + dz}`, c); } return dst; }

// ---- the attachments, each buildable on its own (loadout icons) or mounted on a gun ----------------------------------
/** sights, base on z = 0, centred on x = 0: returns { m, ads (sight height above the base), sightX } */
function opticModel(id) {
  const m = new VoxelModel(1);
  if (id === 'reddot') {
    // minimal open sight: rail clamp, two slim posts, no hood — the whole window stays clear
    m.box(-3, -1, 0, 4, 2, 1, DARK).box(-2, -3, 1, 3, 4, 2, BLK2).box(-2, -3, 2, 3, -2, 4, BLK).box(-2, 3, 2, 3, 4, 4, BLK);
    m.box(2, 0, 3, 3, 1, 4, RED);
    return { m, ads: 1.4, sightX: 0 };
  }
  if (id === 'holo') {
    m.box(-4, -1, 0, 5, 2, 1, DARK).box(-3, -4, 1, 4, 5, 2, BLK2).box(-3, -4, 2, 4, -3, 5, BLK).box(-3, 4, 2, 4, 5, 5, BLK).box(-3, -4, 5, 4, 5, 6, BLK);
    m.box(3, 0, 3, 4, 1, 4, '#ff6a3d');
    return { m, ads: 1.4, sightX: 0 };
  }
  if (id === 'acog') {
    m.box(-6, -1, 0, 7, 2, 1, DARK).box(-5, -2, 1, 6, 3, 2, BLK2).box(-5, -2, 2, 6, 3, 6, '#3d434c').box(-4, -2, 6, 5, 3, 7, BLK).box(6, -3, 2, 8, 4, 7, BLK).box(-7, -3, 2, -5, 4, 7, BLK).box(7, -2, 3, 8, 3, 6, '#7ad0ff').box(-6, -1, 3, -5, 2, 6, '#182028');
    m.box(-3, 2, 3, 3, 3, 5, '#c1a26c');
    return { m, ads: 5, sightX: 0 };
  }
  if (id === 'sniper') {
    m.box(-9, -1, 0, -5, 2, 1, DARK).box(3, -1, 0, 7, 2, 1, DARK).box(-9, -1, 1, -6, 2, 3, BLK).box(4, -1, 1, 7, 2, 3, BLK);
    m.box(-10, -2, 3, 10, 3, 7, '#25282d').box(-13, -3, 2, -10, 4, 8, BLK).box(10, -3, 2, 14, 4, 8, BLK).box(-2, -3, 6, 3, 4, 8, BLK2).box(-1, 3, 4, 2, 4, 6, BLK2).box(13, -2, 3, 14, 3, 7, '#7ad0ff');
    m.box(-12, -1, 3, -10, 2, 7, '#182028');
    return { m, ads: 5, sightX: -1 };
  }
  return { m, ads: 0, sightX: 0 };
}

/** muzzle devices: the barrel points to +x, centred on y = 0, z = 2 */
function muzzleModel(id) {
  const m = new VoxelModel(1);
  if (id === 'supp') {
    m.box(0, -2, 0, 14, 3, 4, '#2a2d33').box(0, -1, 4, 14, 2, 5, '#33373e').box(0, -1, -1, 14, 2, 0, '#33373e').box(14, -1, 1, 15, 2, 3, DARK);
    for (const x of [3, 6, 9, 12]) m.box(x, -2, 1, x + 1, 3, 3, '#3c4048');
    m.box(0, -2, 0, 2, 3, 4, '#3a3e46');
  } else if (id === 'comp') {
    m.box(0, -1, 0, 8, 2, 4, '#3a3e46').box(0, -2, 1, 8, 3, 3, '#454a52').box(8, -1, 0, 9, 2, 4, DARK);
    for (const x of [2, 4, 6]) m.box(x, -2, 3, x + 1, 3, 4, DARK).box(x, -2, 0, x + 1, 3, 1, DARK);
  }
  return m;
}

/** rail / grip attachments, hanging below (or beside) the handguard: origin at the front of the mount, z = 0 is the handguard's bottom */
function underModel(id) {
  const m = new VoxelModel(1);
  if (id === 'vgrip') m.box(0, -1, -8, 3, 2, 0, '#2f3238').box(-1, -1, -1, 4, 2, 0, '#454a52').box(0, -1, -8, 3, 2, -7, '#23262b').box(1, 0, -6, 2, 1, -2, '#3d4148');
  else if (id === 'agrip') m.box(0, -1, -3, 6, 2, 0, '#2f3238').box(3, -1, -6, 6, 2, -3, '#2f3238').box(-1, -1, -1, 7, 2, 0, '#454a52').box(3, -1, -6, 6, 2, -5, '#23262b');
  else if (id === 'laser') {
    m.box(0, -1, -1, 9, 2, 3, '#3e444c').box(9, -1, 0, 11, 2, 2, DARK).box(1, -1, 3, 8, 2, 4, '#595f69').box(9, 0, 1, 10, 1, 2, RED).box(2, -1, -2, 5, 2, -1, '#2a2e34');
    m.box(0, -1, 0, 3, 2, 2, '#5b626c');
  } else if (id === 'flash') {
    m.box(0, -2, -4, 10, 3, 1, '#3a3f47').box(10, -2, -5, 12, 3, 2, '#20232a').box(11, -1, -4, 12, 2, 1, '#fff0a8').box(2, -2, -5, 8, 3, -4, '#4a5058').box(3, -1, 1, 8, 2, 2, '#595f69');
  }
  return m;
}

/** magazine below the receiver; origin at the top-front of the well */
function magModel(kind, magType, look, id) {
  const m = new VoxelModel(1);
  const c1 = look.mag, c2 = look.mag2;
  if (magType === 'drum' && (kind === 'rifle' || kind === 'smg' || kind === 'lmg')) {
    m.box(-1, -1, -3, 3, 2, 0, c1).box(-4, -3, -12, 8, 4, -3, c1).box(-5, -2, -11, 9, 3, -4, c1).box(-3, -3, -11, 7, 4, -10, c2).box(-3, -3, -5, 7, 4, -4, c2);
    m.box(-3, 4, -9, 7, 5, -6, '#c9a15a').box(-1, -3, -8, 5, -2, -7, '#7d8590');
    return m;
  }
  const n = magType === 'ext' ? 3 : 0;
  if (kind === 'smg') m.box(0, -1, -9 - n, 3, 2, 0, c1).box(0, -1, -9 - n, 3, 2, -8 - n, c2).box(-1, -1, -1, 4, 2, 0, c2);
  else if (kind === 'lmg') m.box(-4, -3, -10, 7, 4, 0, c1).box(-4, -3, -10, 7, 4, -9, c2).box(-3, -2, -9, 6, 3, -8, c1).box(6, -2, -6, 8, 3, -2, c2);
  else if (kind === 'pistol') m.box(-4, -1, -8 - n, -1, 2, 0, c1).box(-4, -1, -8 - n, -1, 2, -7 - n, c2);
  else if (kind === 'shotgun') return null;
  else if (kind === 'sniper') m.box(-1, -1, -6 - n, 3, 2, 0, c1).box(0, -1, -6 - n, 3, 2, -5 - n, c2);
  else if (id === 'br12') m.box(0, -1, -8 - n, 4, 2, 0, c1).box(0, -1, -8 - n, 4, 2, -7 - n, c2).box(-1, -1, -1, 5, 2, 0, c2);
  else m.box(0, -1, -8 - n, 3, 2, 0, c1).box(1, -1, -8 - n, 3, 2, -7 - n, c2).box(-1, -1, -1, 4, 2, 0, c2);
  return m;
}

function gunBody(id, kind, look) {
  const m = new VoxelModel(1), stock = new VoxelModel(1);
  const { rec, rec2, hand, hand2 } = look, hg = look.hg, fat = look.fat ? 1 : 0;
  // stock
  if (look.stockS === 'std') stock.box(-17, -1, -1, -16, 2, 4, DARK).box(-16, -1, 0, -8, 2, 4, look.stock).box(-15, -1, 1, -8, 2, 3, BLK2);
  else if (look.stockS === 'fixed') stock.box(-18, -1, -2, -17, 2, 4, DARK).box(-17, -1, -1, -8, 2, 4 + fat, look.stock).box(-16, -1, 0, -8, 2, 3, BLK2);
  else if (look.stockS === 'skel') stock.box(-16, -1, 0, -8, 0, 1, look.stock).box(-16, 1, 0, -8, 2, 1, look.stock).box(-16, -1, 3, -8, 2, 4, look.stock).box(-17, -1, -1, -16, 2, 4, DARK);
  else if (look.stockS === 'sniper') stock.box(-20, -1, -3, -19, 2, 4, DARK).box(-19, -1, -2, -8, 2, 3, look.stock).box(-18, -1, 3, -10, 2, 5, look.stock).box(-19, -1, -1, -9, 2, 2, BLK2);
  // receiver
  if (kind === 'pistol') {
    m.box(-6, -1, 1, 9, 2, 5, rec).box(-6, -1, 1, 9, 2, 2, rec2).box(-6, -1, -1, 6, 2, 1, rec2).box(-7, -1, -6, -2, 2, 1, hand).box(-7, 0, -6, -6, 1, 1, hand2).box(9, 0, 2, 11, 1, 4, METAL);
    m.box(-6, -1, 5, -5, 0, 6, DARK).box(-6, 1, 5, -5, 2, 6, DARK).box(8, 0, 5, 9, 1, 6, DARK).box(-3, 0, -1, 1, 1, 0, DARK).box(0, -1, 2, 6, 2, 3, '#4b515a');
    m.box(1, -1, -2, 6, 2, -1, hand2).box(2, 0, -2, 5, 1, 0, hand2);
    return { m, stock: null, muzzle: 11, hgEnd: 5 };
  }
  m.box(-8, -1, 0, 4, 2, 4 + fat, rec2).box(-8, -1, 4 + fat, 6, 2, 5 + fat, rec).box(-2, 1, 1, 0, 2, 3, DARK).box(-3, -1, 1, 3, 2, 3, rec);
  m.box(-6, -1, -4, -3, 2, 0, hand).box(-3, 0, -1, 1, 1, 0, DARK).box(-7, 0, -3, -6, 1, 0, hand2);
  m.box(4, -1, 0, hg, 2, 4, hand).box(4, -1, 4, hg, 2, 5, rec).box(5, -2, 1, hg - 2, -1, 3, hand2).box(5, 2, 1, hg - 2, 3, 3, hand2);
  m.box(hg, 0, 1, hg + look.bar, 1, 3, METAL).box(hg - 1, 0, 4, hg, 1, 7, METAL).box(hg + look.bar - 1, 0, 3, hg + look.bar, 1, 4, LIGHT);
  m.box(-7, -1, 5, -6, 2, 6, DARK);                                        // rear sight
  if (look.lmg) {
    m.box(hg - 8, -2, -1, hg + 1, 3, 4, look.rec2).box(hg - 6, -2, 4, hg - 1, 3, 5, DARK).box(-7, -1, 5, 3, 2, 7, hand);   // shroud + carry handle
    m.box(hg + 1, -1, -6, hg + 2, 0, 0, METAL).box(hg + 1, 1, -6, hg + 2, 2, 0, METAL);                          // folded bipod legs
    m.box(hg - 3, -1, 0, hg + 1, 2, 1, METAL);
  }
  if (look.pump) {
    m.box(4, -1, -2, 13, 2, 0, hand).box(5, -1, -3, 12, 2, -2, hand2).box(hg, 0, -1, hg + 9, 1, 0, METAL);     // pump and magazine tube
    m.box(hg, 0, 3, hg + 8, 1, 4, METAL);
  }
  if (look.bolt) {
    m.box(-4, 2, 3, -1, 3, 4, METAL).box(-1, 3, 3, 0, 4, 5, LIGHT);                                              // bolt handle
    m.box(hg + 6, -2, -6, hg + 7, 0, 0, METAL).box(hg + 6, 1, -6, hg + 7, 3, 0, METAL);                             // bipod
    m.box(hg, -1, 1, hg + 3, 2, 3, METAL);
  }
  return { m, stock, muzzle: hg + look.bar, hgEnd: hg };
}

function build(id, kind, att) {
  let ads = 7.5, sightX = -6.5, grip = [-4.5, 0.5, -2], fore = [9, 0.5, -1.5], ejection = [-1, 1.5, 3], mag = null, stock = null, body, muzzle = 23;
  if (kind === 'knife') {
    body = new VoxelModel(1);
    body.box(-7, -1, -1, 0, 1, 2, '#3b3f47').box(0, -1, -2, 1, 1, 4, LIGHT).box(1, 0, -1, 15, 1, 3, '#cfd5dc').box(15, 0, 0, 18, 1, 2, '#cfd5dc').box(1, 0, 2, 12, 1, 3, '#e6ebf0');
    return { body, mag, stock, meta: { muzzle: 18, grip: [-3, 0, 0.5], fore: [-3, 0, 0.5], ads: 4, sightX, ejection } };
  }
  if (kind === 'grenade') {
    body = new VoxelModel(1);
    body.box(-3, -2, -3, 3, 3, 4, '#4a6b3a').box(-2, -1, 4, 2, 2, 5, '#3a3d45').box(-1, 2, 1, 1, 3, 5, '#9aa0a8').box(-1, -1, 5, 0, 2, 6, '#c9cdd2');
    return { body, mag, stock, meta: { muzzle: 0, grip: [0, 0.5, 0], fore: [0, 0.5, 0], ads: 4, sightX, ejection } };
  }
  if (kind === 'launcher') {
    body = new VoxelModel(1);
    body.box(-16, -2, -1, 24, 3, 4, '#5a6642').box(-16, -3, -2, -12, 4, 5, '#3a4230').box(20, -3, -2, 27, 4, 5, '#3a4230').box(-4, -1, 4, 6, 2, 6, DARK).box(-6, -1, -6, -2, 2, 0, '#3a3f47').box(6, -1, -5, 9, 2, -1, '#3a3f47');
    body.box(-2, -2, 4, 5, 3, 5, '#3a3f47').box(12, -3, 4, 14, 4, 5, '#c9a15a').box(0, -3, 0, 20, -2, 3, '#4d5938');
    return { body, mag, stock, meta: { muzzle: 27, grip: [-4, 0.5, -2], fore: [7, 0.5, -1], ads: 8, sightX, ejection } };
  }
  if (kind === 'tool') {
    body = new VoxelModel(1);
    body.box(-4, -3, -3, 8, 4, 3, '#e8ebee').box(-4, -3, 3, 8, 4, 4, '#c9cdd2').box(-1, -1, 4, 5, 2, 6, '#d0392b').box(8, -2, -2, 11, 3, 2, DARK).box(-6, -1, -8, -3, 2, -3, '#3a3f47');
    return { body, mag, stock, meta: { muzzle: 11, grip: [-4, 0.5, -3], fore: [3, 0.5, -2], ads: 5, sightX, ejection } };
  }
  const look = LOOK[id] || LOOK[LOOK_KIND[kind] || 'ar7'];
  const g = gunBody(id, kind, look);
  body = g.m; stock = g.stock; muzzle = g.muzzle;
  const hg = g.hgEnd;
  if (kind === 'pistol') { grip = [-4.5, 0.5, -3]; fore = [-3, 0.5, -3.5]; ads = 6; sightX = -5.5; ejection = [1, 1.5, 4]; }
  else fore = [hg - 4, 0.5, -1.5];
  // optic (pistols get a low red dot on the slide)
  const opt = att ? att.optic : 'iron';
  if (opt !== 'iron') {
    const o = opticModel(opt);
    const base = kind === 'pistol' ? 5 : (look.fat ? 6 : 5);
    const ox = kind === 'pistol' ? 1 : (opt === 'sniper' ? 1 : opt === 'acog' ? 0 : -1);
    stamp(body, o.m, ox, 0, base);
    sightX = ox + o.sightX; ads = base + o.ads;
  } else if (kind !== 'pistol') ads = (look.fat ? 6 : 5) + 2.5;
  // muzzle
  const br = att ? att.barrel : 'none';
  if (br !== 'none') { const mm = muzzleModel(br); stamp(body, mm, muzzle, 0, kind === 'pistol' ? 1 : 0); muzzle += br === 'supp' ? 15 : 9; }
  // rail / grip
  const un = att ? att.under : 'none';
  if (un !== 'none') {
    const um = underModel(un);
    if (kind === 'pistol') stamp(body, un === 'laser' || un === 'flash' ? um : um, 3, 0, -2);
    else stamp(body, um, un === 'laser' ? hg - 9 : hg - 6, un === 'laser' ? 1 : 0, un === 'laser' ? 1 : 0);
  }
  mag = magModel(kind, att ? att.mag : 'std', look, id);
  if (mag && kind !== 'pistol') { const mm = new VoxelModel(1); stamp(mm, mag, 0, 0, 0); mag = mm; }
  return { body, mag, stock, meta: { muzzle, grip, fore, ads, sightX, ejection, light: un === 'flash', laser: un === 'laser', hg } };
}

const geoCache = new Map();
const cvGeo = (vm) => { const m = new VoxelModel(U); for (const [k, c] of vm.vox) m.vox.set(k, c); const g = voxelGeometry(m); g.translate(0, 0, -0.5 * U); return g; };
function modelFor(key, id, kind, att) {
  let e = geoCache.get(key);
  if (!e) {
    const b = build(id, kind, att);
    e = { body: cvGeo(b.body), mag: b.mag ? cvGeo(b.mag) : null, stock: b.stock ? cvGeo(b.stock) : null, meta: b.meta };
    geoCache.set(key, e);
  }
  return e;
}

// ------------------------------------------------------------------------------------------------ the rig
const HIP = { rifle: [0.17, -0.16, -0.36], smg: [0.17, -0.15, -0.34], pistol: [0.15, -0.14, -0.32], lmg: [0.18, -0.17, -0.38], sniper: [0.18, -0.17, -0.38], dmr: [0.18, -0.17, -0.37], shotgun: [0.18, -0.16, -0.36], knife: [0.17, -0.16, -0.33], grenade: [0.14, -0.15, -0.33], launcher: [0.19, -0.19, -0.4], tool: [0.16, -0.16, -0.33] };

export class Viewmodel {
  constructor(renderer) {
    this.r = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.02, 10);
    this.scene.add(new THREE.HemisphereLight(0xeaf3ff, 0x9a9584, 4.4));
    const sun = new THREE.DirectionalLight(0xffe6c4, 2.8); sun.position.set(-0.5, 1, 0.6); this.scene.add(sun);
    this.rig = new THREE.Group();                   // moves the whole weapon (position + rotation animation)
    this.scene.add(this.rig);
    this.model = new THREE.Group();                 // the gun; voxel model space (x forward) turned so forward = -z
    this.model.rotation.y = Math.PI / 2;
    this.rig.add(this.model);
    this.bodyMesh = new THREE.Mesh(new THREE.BufferGeometry(), VOXEL_MAT);
    this.magMesh = new THREE.Mesh(new THREE.BufferGeometry(), VOXEL_MAT);
    this.stockMesh = new THREE.Mesh(new THREE.BufferGeometry(), VOXEL_MAT);
    this.model.add(this.bodyMesh, this.magMesh, this.stockMesh);
    this.arms = new THREE.Group(); this.model.add(this.arms);
    this.armMats = { sleeve: new THREE.MeshLambertMaterial({ color: 0x6a7a55 }), glove: new THREE.MeshLambertMaterial({ color: 0x4a4d55 }), skin: new THREE.MeshLambertMaterial({ color: 0xd9a988 }) };
    this.armMeshes = [];
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), i % 2 ? this.armMats.glove : this.armMats.sleeve); this.arms.add(b); this.armMeshes.push(b); }
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: renderer.fx3d ? renderer.fx3d.glowTex : null, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffd27a }));
    this.flash.visible = false; this.scene.add(this.flash);
    this.key = ''; this.meta = null; this.kind = 'rifle';
    this.t = 0; this.bobT = 0;
    this.ads = 0; this.sprint = 0; this.kick = 0; this.draw = 0; this.swing = 0; this.reload = 0; this.air = 0;
    this.sway = { x: 0, y: 0 }; this.roll = 0; this.flashT = 0;
    this.visible = false; this.lastMag = true;
    this.prevFire = false;
    this.glb = null; this.envReady = false; this.sleeveMats = [];
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  /** the muzzle position in world coordinates (for tracers), or null when hidden */
  setTeam(team) {
    const tint = ['#e2d4bf', '#cbd8ca', '#ddd8c6'][team] || '#ddd8c6';
    this.armMats.sleeve.color.set('#626b54');
    this.team = team;
    for (const m of this.sleeveMats) m.color.set(tint);
  }

  clearGlb() {
    if (this.glb) { this.model.remove(this.glb); this.glb = null; }
    this.sleeveMats = [];
  }

  /** the Blender model of this weapon with its attachments, life size scaled to the view, plus glove hands */
  setGlb(gun) {
    if (!this.envReady) { this.scene.environment = makeEnvironment(this.r.renderer); this.scene.environmentIntensity = 0.7; this.envReady = true; }
    const s = gun.scale;
    const grp = new THREE.Group();
    const g = new THREE.Group(); g.scale.setScalar(s); g.add(gun.root); grp.add(g);
    this.glb = grp; this.model.add(grp);
    this.bodyMesh.visible = this.magMesh.visible = this.stockMesh.visible = false;
    this.armMeshes.forEach((m) => { m.visible = false; });
    const S = (v) => v.clone().multiplyScalar(s);
    const rh = S(gun.gripR), lh = S(gun.gripL);
    this.meta = { glb: true, adsV: S(gun.ads), muzzleV: S(gun.muzzle), ads: 0, sightX: 0, muzzle: 0, light: gun.light };
    this.magHas = false;
    if (assets.hands) {
      const arm = (from, to, right, roll) => {
        const dir = new THREE.Vector3().subVectors(to, from); const len = dir.length(); dir.normalize();
        const fore = assets.hands.getObjectByName('forearm').clone(true);
        fore.traverse((o) => { if (o.material) { o.material = o.material.clone(); if (o.material.name === 'sleeve') this.sleeveMats.push(o.material); } });
        const q0 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
        fore.position.copy(from); fore.quaternion.copy(q0); fore.scale.set(Math.max(0.01, len - 0.03), s * 0.7, s * 0.7);
        grp.add(fore);
        const hand = assets.hands.getObjectByName(right ? 'hand_r' : 'hand_l').clone(true);
        hand.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(dir, roll).multiply(q0));
        hand.position.copy(to); hand.scale.setScalar(s * 0.95);
        grp.add(hand);
      };
      arm(new THREE.Vector3(-0.276, -0.127, 0.10), rh.clone().add(new THREE.Vector3(-0.012, -0.004, 0)), true, Math.PI / 2);
      if (this.kind !== 'pistol') arm(new THREE.Vector3(-0.207, -0.127, -0.115), lh.clone().add(new THREE.Vector3(-0.02, -0.006, 0)), false, Math.PI);
    }
    if (this.team !== undefined) this.setTeam(this.team);
  }

  rebuild(kind, att, id, key) {
    this.clearGlb();
    this.kind = kind;
    const gun = (kind !== 'knife' && kind !== 'grenade' && kind !== 'tool' && id && hasGun(id)) ? buildGun(id, att || {}) : null;
    if (gun) { this.setGlb(gun); return; }
    this.bodyMesh.visible = this.stockMesh.visible = true;
    const m = modelFor(key, id, kind, att);
    this.bodyMesh.geometry = m.body;
    this.magMesh.geometry = m.mag || new THREE.BufferGeometry();
    this.magMesh.visible = !!m.mag;
    this.stockMesh.geometry = m.stock || new THREE.BufferGeometry();
    this.meta = m.meta; this.kind = kind; this.magHas = !!m.mag;
    // arms: from off-screen shoulders to the grip and fore-grip hands (model space, in units)
    const u = U;
    const hand = (p) => new THREE.Vector3(p[0] * u, p[2] * u, p[1] * u);            // model (x,y,z) -> mesh space (X fwd, Y up, Z right)
    const rh = hand(m.meta.grip), lh = hand(m.meta.fore);
    const place = (i, from, to, th) => {
      const dir = new THREE.Vector3().subVectors(to, from); const len = dir.length();
      const sleeve = this.armMeshes[i], glove = this.armMeshes[i + 1];
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
      const cut = 0.66;
      for (const [mesh, a, b, t] of [[sleeve, 0, cut, th], [glove, cut, 1, th * 0.88]]) {
        mesh.position.copy(from).addScaledVector(dir, (a + b) / 2);
        mesh.quaternion.copy(q);
        mesh.scale.set(t, t, len * (b - a));
      }
    };
    const knife = kind === 'knife', gren = kind === 'grenade';
    place(0, new THREE.Vector3(-24 * u, -11 * u, 9 * u), rh.clone().add(new THREE.Vector3(-1 * u, 0, 0)), 4.6 * u);
    if (knife || gren || kind === 'pistol') { this.armMeshes[2].visible = this.armMeshes[3].visible = false; }
    else { this.armMeshes[2].visible = this.armMeshes[3].visible = true; place(2, new THREE.Vector3(-18 * u, -11 * u, -10 * u), lh, 4.4 * u); }
  }

  /** advance the animation and draw. `ctx`: { fps, viewer, kind, weapon, held, me } from the renderer */
  render(dt, ctx) {
    const g = this.r.game, gl = this.r.renderer;
    const on = !!ctx && ctx.fps && !(ctx.scopedView);
    this.visible = on;
    if (!ctx || !ctx.fps) return;
    this.t += dt;
    const { kind, weapon } = ctx;
    const key = `${kind}|${weapon ? weapon.key || weapon.id : ''}|${assets.ready ? 1 : 0}`;
    if (key !== this.key) {
      this.key = key;
      this.rebuild(kind, weapon && weapon.att ? weapon.att : null, weapon && weapon.id, key);
      this.draw = 1; this.reload = 0;
      this.setTeam(ctx.team);
    }
    const speed = ctx.speed;
    // ---- state targets
    const adsT = ctx.ads ? 1 : 0;
    const adsRate = kind === 'sniper' || kind === 'lmg' ? 7 : 11;
    this.ads += (adsT - this.ads) * (1 - Math.exp(-adsRate * dt));
    this.sprint += ((ctx.sprint ? 1 : 0) - this.sprint) * (1 - Math.exp(-9 * dt));
    this.air += ((ctx.air ? 1 : 0) - this.air) * (1 - Math.exp(-10 * dt));
    this.draw = Math.max(0, this.draw - dt / Math.max(0.22, (weapon && weapon.draw) || 0.3));
    this.reload += ((ctx.reload || 0) - this.reload) * (1 - Math.exp(-30 * dt));
    if (g.shotKick) { this.kick = Math.min(1.6, this.kick + 1); this.flashT = 0.055; g.shotKick = 0; }
    if (ctx.swing) { this.swing = 1; }
    this.kick *= Math.exp(-15 * dt); this.swing = Math.max(0, this.swing - dt / 0.3);
    this.flashT -= dt;
    // ---- walking bob
    const moving = clamp(speed / 92, 0, 1.6) * (ctx.air ? 0 : 1);
    this.bobT += dt * (3 + moving * 5.5 * (ctx.sprint ? 1.25 : 1));
    const bobA = moving * (ctx.sprint ? 1.5 : ctx.crouch ? 0.5 : 1) * (1 - this.ads * .99);
    const bx = Math.sin(this.bobT) * 0.007 * bobA, by = Math.abs(Math.cos(this.bobT)) * -0.008 * bobA;
    // ---- mouse sway: the gun lags behind quick turns
    const sk = 1 - Math.exp(-11 * dt);
    const swayK = 1 - this.ads;
    this.sway.x += (clamp(-g.lookRate.y * 1.2, -0.012, 0.012) * swayK - this.sway.x) * sk;
    this.sway.y += (clamp(-g.lookRate.p * 1.2, -0.01, 0.01) * swayK - this.sway.y) * sk;
    this.roll += (clamp(ctx.strafe * 0.05, -0.05, 0.05) - this.roll) * sk;

    // ---- pose
    const hip = HIP[kind] || HIP.rifle;
    const mt = this.meta;
    const sightH = ((mt ? mt.ads : 7.5) + 1.8) * U;
    const adsPos = mt && mt.glb ? [-mt.adsV.z, -mt.adsV.y, -0.29 + mt.adsV.x] : [0, -sightH, -0.29 + (mt ? mt.sightX : -6.5) * U];
    const gl3 = mt && mt.glb;
    let px = lerp(gl3 ? hip[0] * 0.78 : hip[0], adsPos[0], this.ads), py = lerp(gl3 ? hip[1] * 0.92 : hip[1], adsPos[1], this.ads), pz = lerp(gl3 ? hip[2] * 1.02 : hip[2], adsPos[2], this.ads);
    let rx = 0, ry = gl3 ? 0.07 * (1 - this.ads) : 0, rz = 0;      // rotation: pitch, yaw, roll
    // sprint: weapon lowered and turned in
    px += -0.01 * this.sprint; py += -0.05 * this.sprint; pz += 0.04 * this.sprint;
    rx += -0.2 * this.sprint; ry += 0.5 * this.sprint; rz += 0.14 * this.sprint;
    // recoil: back and up
    pz += 0.035 * this.kick * (1 - this.ads * 0.4); py += 0.006 * this.kick; rx += 0.06 * this.kick * (1 - this.ads * 0.35);
    // reload: dip, tilt, mag out
    const rl = this.reload, rs = Math.sin(Math.PI * rl);
    py += -0.17 * rs; px += -0.05 * rs; rx += -0.55 * rs; rz += 0.45 * rs; ry += 0.25 * rs;
    if (this.meta && this.meta.glb) { if (this.glb) this.glb.traverse((o) => { if (o.name && o.name.endsWith('_stock')) o.visible = this.ads < 0.35; }); }
    else this.stockMesh.visible = this.ads < 0.35;
    if (this.magHas) this.magMesh.visible = !(rl > 0.3 && rl < 0.6);
    // switching weapons
    const d = this.draw;
    py += -0.34 * d * d; rx += -0.7 * d * d; ry += 0.3 * d;
    // knife / grenade / tool swing
    if (this.swing > 0) {
      const s = this.swing, e = Math.sin((1 - s) * Math.PI);
      if (kind === 'knife') { px += -0.28 * e + 0.1; py += 0.06 * e; pz += -0.08 * e; ry += 1.1 * e - 0.4; rz += -0.9 * e; rx += 0.3 * e; }
      else { pz += -0.12 * e; py += 0.08 * e; rx += 0.5 * e; }
    }
    // airborne: the weapon rides up a little
    py += 0.02 * this.air;
    px += bx + this.sway.x; py += by + this.sway.y * 0.6;
    this.rig.position.set(px, py, pz);
    this.rig.rotation.set(rx + this.sway.y * 0.6, ry + this.sway.x * 0.8, rz + this.roll * (1 - this.ads), 'YXZ');
    // Keep the optical axis at the actual shot direction through movement and animation.
    if (mt?.glb) {
      const anchor = new THREE.Vector3(mt.adsV.z, mt.adsV.y, -mt.adsV.x).applyEuler(this.rig.rotation);
      const pin = Math.pow(this.ads, 4) * (1 - rs);
      this.rig.position.x = lerp(this.rig.position.x, -anchor.x, pin);
      this.rig.position.y = lerp(this.rig.position.y, -anchor.y, pin);
    }
    // muzzle flash at the barrel tip
    this.flash.visible = this.flashT > 0 && this.meta && (this.meta.glb || this.meta.muzzle > 0);
    if (this.flash.visible) {
      const mp = this.meta.glb ? this.meta.muzzleV.clone() : new THREE.Vector3(this.meta.muzzle * U, 2.5 * U, 0.5 * U);
      this.model.updateMatrixWorld(true);
      this.flash.position.copy(this.model.localToWorld(mp));
      const sc = 0.09 + Math.random() * 0.05; this.flash.scale.set(sc, sc, 1);
    }
    if (ctx.scopedView) return;                     // looking through a scope: the overlay takes over
    const ac = gl.autoClear;
    gl.autoClear = false;
    gl.clearDepth();
    gl.render(this.scene, this.camera);
    gl.autoClear = ac;
  }
}

// ------------------------------------------------------------------------------------------------ icons
// Weapons and attachments drawn once by a small offscreen renderer, for the loadout cards, HUD panel and kill feed.
let iconGL = null;
function iconRenderer() {
  if (iconGL !== null) return iconGL || null;
  try {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9098a4, 2.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(-1.4, 2.2, 3); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xbfd0ff, 1.3); fill.position.set(1, -2, 2); scene.add(fill);
    iconGL = { renderer, scene, canvas };
  } catch { iconGL = false; }
  return iconGL || null;
}

const iconCache = new Map();
function drawIcon(key, geos, w = 480, h = 240, tilt = { x: 0.2, y: 0.32 }) {
  if (iconCache.has(key)) return iconCache.get(key);
  const gl = iconRenderer();
  let url = '';
  if (gl) {
    const grp = new THREE.Group();
    for (const g of geos) if (g) grp.add(new THREE.Mesh(g, VOXEL_MAT));
    grp.rotation.set(tilt.x, tilt.y, 0, 'YXZ');
    gl.scene.add(grp);
    grp.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(grp), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const pad = 1.12, aspect = w / h;
    const halfW = Math.max(size.x * pad, size.y * pad * aspect) / 2, halfH = halfW / aspect;
    const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, 20);
    cam.position.set(c.x, c.y, c.z + 4); cam.lookAt(c);
    gl.renderer.setSize(w, h, false);
    gl.renderer.render(gl.scene, cam);
    try { url = gl.canvas.toDataURL('image/png'); } catch { url = ''; }
    gl.scene.remove(grp);
  }
  iconCache.set(key, url);
  return url;
}

/** render a Blender-model group to a PNG data URL (transparent background, fitted to the frame) */
function drawObjIcon(key, obj, w = 480, h = 240, tilt = { x: 0.2, y: 0.32 }) {
  if (iconCache.has(key)) return iconCache.get(key);
  const gl = iconRenderer();
  let url = '';
  if (gl) {
    if (!gl.env) { gl.env = makeEnvironment(gl.renderer); gl.scene.environment = gl.env; gl.scene.environmentIntensity = 0.85; }
    const grp = new THREE.Group();
    grp.add(obj);
    grp.rotation.set(tilt.x, tilt.y, 0, 'YXZ');
    gl.scene.add(grp);
    grp.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(grp), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const pad = 1.1, aspect = w / h;
    const halfW = Math.max(size.x * pad, size.y * pad * aspect) / 2, halfH = halfW / aspect;
    const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, 40);
    cam.position.set(c.x, c.y, c.z + 6); cam.lookAt(c);
    gl.renderer.setSize(w, h, false);
    gl.renderer.render(gl.scene, cam);
    try { url = gl.canvas.toDataURL('image/png'); } catch { url = ''; }
    gl.scene.remove(grp);
  }
  iconCache.set(key, url);
  return url;
}

/** PNG data URL of a weapon with attachments (side view). Empty string when WebGL is unavailable. */
export function gunIcon(id, kind, att, w, h) {
  const a = att || {};
  if (kind !== 'knife' && hasGun(id)) {
    const gk = `G${id}|${a.optic}|${a.barrel}|${a.under}|${a.mag}|${w || ''}`;
    if (iconCache.has(gk)) return iconCache.get(gk);
    const gun = buildGun(id, a);
    if (gun) return drawObjIcon(gk, gun.root, w, h, { x: 0.16, y: 0.42 });
  }
  const key = `${id}|${a.optic}|${a.barrel}|${a.under}|${a.mag}`;
  const m = modelFor(key, id, kind, a);
  return drawIcon('g' + key + (w || ''), [m.body, m.mag, m.stock], w, h);
}

/** PNG data URL of a single attachment on its own. */
export function attachIcon(slot, id, w = 300, h = 200) {
  const key = `a${slot}|${id}`;
  if (iconCache.has(key)) return iconCache.get(key);
  if (assets.ready && assets.attachments) {
    const names = { reddot: 'optic_reddot', holo: 'optic_holo', acog: 'optic_acog', sniper: 'optic_sniper', supp: 'muzzle_supp', comp: 'muzzle_comp', vgrip: 'under_vgrip', agrip: 'under_agrip', laser: 'under_laser', flash: 'under_flash' };
    let node = null;
    if (names[id]) { const n = assets.attachments.getObjectByName(names[id]); if (n) node = n.clone(true); }
    else if (slot === 'mag' && hasGun('ar7')) { const g = buildGun('ar7', { mag: id }); if (g) { g.root.traverse((o) => { if (o.name && (o.name === 'ar7_body' || o.name.endsWith('_stock') || (o.name.startsWith('mag_') && o.name !== 'mag_' + (id === 'drum' ? 'drum' : id === 'ext' ? 'ext' : 'std')))) o.visible = false; }); node = g.root; } }
    if (node) { node.position.set(0, 0, 0); return drawObjIcon('A' + key, node, w, h, slot === 'mag' ? { x: 0.1, y: 0.7 } : { x: 0.3, y: 0.62 }); }
  }
  let vm;
  if (slot === 'optic') vm = opticModel(id).m;
  else if (slot === 'barrel') vm = muzzleModel(id);
  else if (slot === 'under') vm = underModel(id);
  else vm = magModel(id === 'drum' ? 'lmg' : 'rifle', id, LOOK.ar7, 'ar7');
  if (!vm) return '';
  const tmp = new VoxelModel(1); stamp(tmp, vm, 0, 0, 0);
  return drawIcon(key, [cvGeo(tmp)], w, h, slot === 'mag' ? { x: 0.15, y: 0.5 } : { x: 0.25, y: 0.45 });
}
