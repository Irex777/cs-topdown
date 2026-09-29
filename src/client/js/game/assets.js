/* global URL */
// Loads the high-fidelity glTF models made in Blender (tools/blender/) and builds guns with their attachments from them.
// Everything falls back to the procedural voxel models until a file has arrived (or if it fails to load).
import * as THREE from '../../vendor/three/three.module.js';
import { GLTFLoader } from '../../vendor/three/GLTFLoader.js';

const BASE = new URL('../../assets/', import.meta.url).href;
const loader = new GLTFLoader();

export const assets = { weapons: {}, attachments: null, hands: null, ready: false, failed: 0, listeners: [] };
const WEAPON_FILES = ['ar7', 'br12', 'vx9', 'sg4', 'mg60', 'dmr14', 'sr50', 'p18', 'rpg'];

const load = (file) => new Promise((resolve) => {
  loader.load(BASE + file, (g) => resolve(g.scene), undefined, () => { assets.failed++; resolve(null); });
});

let started = null;
/** Starts loading everything once; resolves when all files are in (or failed). */
export function loadAssets() {
  if (started) return started;
  started = (async () => {
    const [att, hands, ...guns] = await Promise.all([load('attachments.glb'), load('hands.glb'), ...WEAPON_FILES.map((n) => load(`weapons/${n}.glb`))]);
    assets.attachments = att; assets.hands = hands;
    WEAPON_FILES.forEach((n, i) => { if (guns[i]) assets.weapons[n] = guns[i]; });
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
