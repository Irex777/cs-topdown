/* global URL */
// Loads the high-fidelity glTF models made in Blender (tools/blender/) and builds guns with their attachments from them.
// Everything falls back to the procedural voxel models until a file has arrived (or if it fails to load).
import * as THREE from '../../vendor/three/three.module.js';
import { GLTFLoader } from '../../vendor/three/GLTFLoader.js';

const BASE = new URL('../../assets/', import.meta.url).href;
const loader = new GLTFLoader();

export const assets = { weapons: {}, attachments: null, hands: null, soldier: null, vehicles: {}, props: null, tex: {}, ready: false, failed: 0, listeners: [] };
const WEAPON_FILES = ['ar7', 'br12', 'vx9', 'sg4', 'mg60', 'dmr14', 'sr50', 'p18', 'rpg'];
const VEHICLE_FILES = ['tank', 'jeep', 'apc', 'quad', 'heli', 'boat'];
// baked PBR sets (tools/blender/build_textures.py): c = albedo, n = tangent normal, r = roughness
const TEX_FILES = ['brick_c', 'brick_n', 'brick_r', 'concrete_c', 'concrete_n', 'concrete_r', 'rock_c', 'rock_n', 'rock_r', 'metal_c', 'metal_n', 'metal_r', 'wood_c', 'wood_n', 'wood_r', 'sandbag_c', 'sandbag_n', 'sandbag_r', 'ground_n', 'ground_r'];
const texLoader = new THREE.TextureLoader();
const loadTex = (name) => new Promise((resolve) => {
  texLoader.load(`${BASE}tex/${name}.jpg`, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = name.endsWith('_c') ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    resolve(t);
  }, undefined, () => { assets.failed++; resolve(null); });
});

/** a texture of the baked set with its own repeat (shares the decoded image) */
export function worldTex(name, kind, rx = 1, ry = 1) {
  const b = assets.tex[`${name}_${kind}`];
  if (!b) return null;
  const t = b.clone();
  t.needsUpdate = true;
  t.repeat.set(rx, ry);
  return t;
}
export const hasWorld = () => !!(assets.props && assets.tex.brick_c && assets.tex.ground_n);

const load = (file) => new Promise((resolve) => {
  loader.load(BASE + file, (g) => resolve(g.scene), undefined, () => { assets.failed++; resolve(null); });
});

let started = null;
/** Starts loading everything once; resolves when all files are in (or failed). */
export function loadAssets() {
  if (started) return started;
  started = (async () => {
    const [att, hands, soldier, props, ...rest] = await Promise.all([load('attachments.glb'), load('hands.glb'), load('soldier.glb'), load('props.glb'), ...WEAPON_FILES.map((n) => load(`weapons/${n}.glb`)), ...VEHICLE_FILES.map((n) => load(`vehicles/${n}.glb`)), ...TEX_FILES.map(loadTex)]);
    assets.attachments = att; assets.hands = hands; assets.soldier = soldier; assets.props = props;
    const base = WEAPON_FILES.length + VEHICLE_FILES.length;
    TEX_FILES.forEach((n, i) => { if (rest[base + i]) assets.tex[n] = rest[base + i]; });
    WEAPON_FILES.forEach((n, i) => { if (rest[i]) assets.weapons[n] = rest[i]; });
    VEHICLE_FILES.forEach((n, i) => { if (rest[WEAPON_FILES.length + i]) assets.vehicles[n] = rest[WEAPON_FILES.length + i]; });
    assets.ready = !!att;
    for (const fn of assets.listeners) { try { fn(); } catch { /* ignore */ } }
    return assets;
  })();
  return started;
}
export const onAssets = (fn) => { if (assets.ready) fn(); else assets.listeners.push(fn); };

/** metres -> viewmodel units per weapon (the models are life size; the first-person gun is drawn a bit smaller) */
const SCALE = { ar7: 0.62, br12: 0.62, dmr14: 0.6, vx9: 0.7, sg4: 0.58, mg60: 0.56, sr50: 0.5, p18: 1.05, rpg: 0.5 };
const MODEL_OF = { smaw: 'rpg', stinger: 'rpg' };

export function hasGun(id) { return !!(assets.ready && assets.weapons[MODEL_OF[id] || id]); }

/** a sunset-lit environment for reflections on the metal parts (physically based materials are black without one) */
export function makeEnvironment(renderer) {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const stops = [[-1, '#3a2c2a'], [-0.05, '#7a5a48'], [0.0, '#ffc58a'], [0.25, '#e58a62'], [0.6, '#8f6f9a'], [1, '#4d6db0']].map(([t, c]) => [t, new THREE.Color(c)]);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 50;
    let k = 0; while (k < stops.length - 2 && y > stops[k + 1][0]) k++;
    const t = Math.max(0, Math.min(1, (y - stops[k][0]) / (stops[k + 1][0] - stops[k][0])));
    tmp.copy(stops[k][1]).lerp(stops[k + 1][1], t);
    col.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sun = new THREE.Mesh(new THREE.BoxGeometry(14, 10, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 6.5, 3.4) }));
  sun.position.set(-30, 12, -25); sun.lookAt(0, 0, 0); scene.add(sun);
  const fill = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.8, 2.4) }));
  fill.position.set(28, 18, 18); fill.lookAt(0, 0, 0); scene.add(fill);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(scene, 0.03).texture;
  pm.dispose();
  return tex;
}

const ATT_NODE = {
  optic: { reddot: 'optic_reddot', holo: 'optic_holo', acog: 'optic_acog', sniper: 'optic_sniper' },
  barrel: { supp: 'muzzle_supp', comp: 'muzzle_comp' },
  under: { vgrip: 'under_vgrip', agrip: 'under_agrip', laser: 'under_laser', flash: 'under_flash' },
};
const MOUNT = { optic: 'mount_optic', barrel: 'mount_muzzle', under: 'mount_under' };

const posIn = (root, name) => {
  const o = root.getObjectByName(name);
  if (!o) return null;
  return o.getWorldPosition(new THREE.Vector3());
};

/**
 * A weapon with its attachments as a scene-graph node in the model's own axes (X forward, Y up, Z right), life size.
 * Returns { root, scale, ads, muzzle, gripR, gripL, light } with points in the gun's (unscaled) space, or null when unavailable.
 */
export function buildGun(id, att = {}) {
  if (!hasGun(id)) return null;
  const src = assets.weapons[MODEL_OF[id] || id];
  const root = src.clone(true);
  root.updateMatrixWorld(true);
  // magazine variant (fall back to the standard one when a gun has no such variant)
  const want = att.mag === 'ext' ? 'mag_ext' : att.mag === 'drum' ? 'mag_drum' : 'mag_std';
  const hasWant = !!root.getObjectByName(want);
  root.traverse((o) => { if (o.name && o.name.startsWith('mag_')) o.visible = o.name === (hasWant ? want : 'mag_std'); });
  const meta = {
    ads: posIn(root, 'ads') || new THREE.Vector3(-0.08, 0, 0.065), muzzle: posIn(root, 'muzzle') || new THREE.Vector3(0.6, 0, 0),
    gripR: posIn(root, 'grip_r') || new THREE.Vector3(-0.08, 0, -0.1), gripL: posIn(root, 'grip_l') || new THREE.Vector3(0.3, 0, -0.03), light: false,
  };
  for (const slot of ['optic', 'barrel', 'under']) {
    const name = ATT_NODE[slot][att[slot]];
    if (!name || !assets.attachments) continue;
    const node = assets.attachments.getObjectByName(name);
    const mount = posIn(root, MOUNT[slot]);
    if (!node || !mount) continue;
    const a = node.clone(true);
    a.position.copy(mount); a.rotation.set(0, 0, 0); a.scale.set(1, 1, 1);
    root.add(a);
    a.updateMatrixWorld(true);
    if (slot === 'optic') { const s = posIn(a, 'sight'); if (s) meta.ads = s; }
    if (slot === 'barrel') { const m = posIn(a, 'muzzle'); if (m) meta.muzzle = m; }
    if (slot === 'under' && att.under === 'flash') meta.light = true;
  }
  return { root, scale: SCALE[MODEL_OF[id] || id] || 0.5, ...meta };
}

// ------------------------------------------------------------------------------------------------ soldiers
const TEAM_LOOK = [   // visual team: 0 enemy (red), 1 friendly (blue), 2 neutral; uniform / helmet / vest
  { uniform: '#8a4234', helmet: '#6a3026', vest: '#4a3a34' },
  { uniform: '#3f6197', helmet: '#2f4a78', vest: '#37424f' },
  { uniform: '#6a7466', helmet: '#525c4e', vest: '#42463f' },
];
const CLASS_HEX = { assault: '#e0703a', engineer: '#e0b93a', support: '#4aa8e0', recon: '#7fd35a' };
const SOLDIER_SCALE = 16.3;      // px per metre: a 1.78 m soldier is the 29 px hit box
const matSets = new Map();

function tintedMats(team, cls) {
  const key = `${team}|${cls}`;
  let set = matSets.get(key);
  if (set) return set;
  const look = TEAM_LOOK[team] || TEAM_LOOK[2];
  set = new Map();
  const mk = (name, hex) => { const src = new THREE.MeshStandardMaterial(); src.name = name; src.color.set(hex); set.set(name, src); };
  mk('uniform', look.uniform); mk('helmet', look.helmet); mk('vest', look.vest); mk('accent', CLASS_HEX[cls] || '#e0703a');
  matSets.set(key, set);
  return set;
}

/** a soldier for a (visual) team and class: shared geometry, tinted materials; legs, weapon mount and scale ready to use */
export function makeSoldier(team, cls) {
  if (!assets.soldier) return null;
  const root = assets.soldier.clone(true);
  const tint = tintedMats(team, cls);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const out = list.map((m) => {
      const t = tint.get(m.name);
      if (!t) return m;
      const c = m.clone(); c.color.copy(t.color); c.name = m.name; return c;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
  root.scale.setScalar(SOLDIER_SCALE);
  const mount = root.getObjectByName('weapon');
  return { root, legL: root.getObjectByName('legL'), legR: root.getObjectByName('legR'), mount: mount ? mount.position.clone() : new THREE.Vector3(0.43, -0.09, 1.33), gun: null, gunId: '' };
}

const gunTemplates = new Map();
/** the weapon a soldier carries (default attachments), positioned so its right-hand grip meets the soldier's hand */
export function soldierGun(soldier, id, defOptic) {
  if (soldier.gunId === id) return;
  if (soldier.gun) { soldier.root.remove(soldier.gun); soldier.gun = null; }
  soldier.gunId = id;
  if (!id || !hasGun(id)) return;
  let t = gunTemplates.get(id);
  if (!t) { t = buildGun(id, defOptic && defOptic !== 'iron' ? { optic: defOptic } : {}); gunTemplates.set(id, t); }
  if (!t) return;
  const g = t.root.clone(true);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const rightHand = soldier.mount.clone().add(new THREE.Vector3(-0.086, 0, -0.095));
  g.position.copy(rightHand).sub(t.gripR);
  soldier.root.add(g);
  soldier.gun = g;
}

// ------------------------------------------------------------------------------------------------ vehicles
const VEH_LOOK = [
  { paint: '#8f4a3c', paint2: '#6a362d' }, { paint: '#4a6690', paint2: '#374e70' }, { paint: '#6f7a66', paint2: '#4a5344' },
];
/** px per metre for each vehicle model (so the hull matches the size the simulation uses) */
export const VEH_SCALE = { tank: 11.3, jeep: 13.5, apc: 9.9, quad: 15.4, heli: 7.6, boat: 9.4 };
const vehMats = new Map();

export function hasVehicle(id) { return !!assets.vehicles[id]; }

/** parts of a vehicle model ({ body, turret, gun, rotor }) as separate, team-tinted nodes plus its mount points in px */
export function makeVehicle(id, team) {
  const src = assets.vehicles[id];
  if (!src) return null;
  src.updateMatrixWorld(true);
  const look = VEH_LOOK[team] || VEH_LOOK[2];
  const sc = VEH_SCALE[id] || 8;
  const key = `${id}|${team}`;
  let set = vehMats.get(key);
  if (!set) { set = new Map(); for (const n of ['paint', 'paint2']) { const m = new THREE.MeshStandardMaterial(); m.color.set(n === 'paint' ? look.paint : look.paint2); set.set(n === 'paint' ? 'paint' : 'paint_dark', m); } vehMats.set(key, set); }
  const parts = {};
  for (const n of ['body', 'turret', 'gun', 'rotor']) {
    const node = src.getObjectByName(n);
    if (!node) continue;
    const c = node.clone(true);
    c.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      const out = list.map((m) => { const t = set.get(m.name); if (!t) return m; const cm = m.clone(); cm.color.copy(t.color); cm.name = m.name; return cm; });
      o.material = Array.isArray(o.material) ? out : out[0];
    });
    c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); c.scale.setScalar(sc);
    parts[n] = c;
  }
  const body = src.getObjectByName('body');
  const pos = (name) => { const o = body && body.getObjectByName(name); return o ? o.getWorldPosition(new THREE.Vector3()) : null; };
  // the body node sits at the model origin, so world == body-local for the empties
  const tm = pos('turret_mount'), gm = pos('gun_mount'), rm = pos('rotor_mount');
  const mount = {
    ty: (tm ? tm.y : 1) * sc,
    gx: (gm ? gm.x : 0) * sc, gy: (gm ? gm.y : 1) * sc, gz: (gm ? gm.z : 0) * sc,
    ry: (rm ? rm.y : 3) * sc,
  };
  return { parts, mount, scale: sc };
}
