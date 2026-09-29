// Turns voxel model data into three.js geometry (one merged, vertex-coloured mesh per model) and builds the small props
// (gadgets, flag parts, grenades...) the world is populated with. World axes: x, z = map x, y; y = up.
import * as THREE from '../../vendor/three/three.module.js';
import { VoxelModel, soldierModel, vehicleModel, parse } from './voxel.js';

const TMP = new THREE.Color();
/** sRGB [r,g,b] 0..255 -> linear components (vertex colours are not colour-managed by three) */
export function linear(c) { TMP.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace); return [TMP.r, TMP.g, TMP.b]; }

const hash3 = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// [normal axis, sign, tangent1, tangent2] in three coordinates (0=X, 1=Y, 2=Z); t1 x t2 = normal
const FACES = [
  { n: [1, 0, 0], t1: [0, 1, 0], t2: [0, 0, 1], shade: 0.92, d: [1, 0, 0] },   // +X (model forward)
  { n: [-1, 0, 0], t1: [0, 0, 1], t2: [0, 1, 0], shade: 0.8, d: [-1, 0, 0] },
  { n: [0, 1, 0], t1: [0, 0, 1], t2: [1, 0, 0], shade: 1.06, d: [0, 1, 0] },   // up
  { n: [0, -1, 0], t1: [1, 0, 0], t2: [0, 0, 1], shade: 0.55, d: [0, -1, 0] },
  { n: [0, 0, 1], t1: [1, 0, 0], t2: [0, 1, 0], shade: 0.86, d: [0, 0, 1] },   // model right side
  { n: [0, 0, -1], t1: [0, 1, 0], t2: [1, 0, 0], shade: 0.74, d: [0, 0, -1] },
];

/** merged geometry of a VoxelModel, hidden faces removed. Model origin = ground point under the model's (0,0). */
export function voxelGeometry(model, opts = {}) {
  const u = model.u;
  const vox = model.vox;
  let zmax = 0, zmin = 0;
  const cells = [];
  for (const [key, col] of vox) {
    const [x, y, z] = key.split(',').map(Number);
    cells.push([x, y, z, col]);
    if (z > zmax) zmax = z;
    if (z < zmin) zmin = z;
  }
  const pos = [], nor = [], colr = [], idx = [];
  for (const [x, y, z, col] of cells) {
    // voxel axes (x fwd, y right, z up) -> three (X, Z, Y): three vector components are [X, Y, Z] = [x, z, y]
    const three = [x, z, y];
    const base = (z - zmin) / Math.max(1, zmax - zmin);
    const grad = 0.74 + 0.26 * base;
    const jit = 0.96 + hash3(x, y, z) * 0.08;
    for (const f of FACES) {
      if (opts.noBottom && f.n[1] < 0) continue;
      // neighbour in three space -> voxel space
      const nx = three[0] + f.d[0], ny = three[1] + f.d[1], nz = three[2] + f.d[2];
      if (vox.has(`${nx},${nz},${ny}`)) continue;
      const k = f.shade * grad * jit;
      const lc = linear([Math.min(255, col[0] * k), Math.min(255, col[1] * k), Math.min(255, col[2] * k)]);
      const c = [(three[0] + 0.5) * u, (three[1] + 0.5) * u, (three[2] + 0.5) * u];
      const half = u / 2;
      const i0 = pos.length / 3;
      const sg = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (const [a, b] of sg) {
        pos.push(c[0] + f.n[0] * half + f.t1[0] * half * a + f.t2[0] * half * b,
          c[1] + f.n[1] * half + f.t1[1] * half * a + f.t2[1] * half * b,
          c[2] + f.n[2] * half + f.t1[2] * half * a + f.t2[2] * half * b);
        nor.push(f.n[0], f.n[1], f.n[2]);
        colr.push(lc[0], lc[1], lc[2]);
      }
      idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const geoCache = new Map();
function cached(key, build, noBottom = true) {
  let g = geoCache.get(key);
  if (!g) { g = voxelGeometry(build(), { noBottom }); geoCache.set(key, g); }
  return g;
}

export const VOXEL_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });

export const soldierGeo = (team, cls, kind, frame, dead = false) => cached(`s${team}${cls}${kind}${frame}${dead ? 'x' : ''}`, () => soldierModel(team, cls, kind, frame, dead));
export const vehicleGeo = (type, team, part) => cached(`v${type}${team}${part}`, () => vehicleModel(type, team, part), type !== 'heli');

// ------------------------------------------------------------------------------------------------ props
function prop(name) {
  const m = new VoxelModel(2);
  switch (name) {
    case 'medkit': m.box(-4, -3, 0, 4, 3, 5, '#eeeeee').box(-1, -3, 5, 1, 3, 6, '#d0392b').box(-3, -1, 5, 3, 1, 6, '#d0392b').box(-4, -3, 4, 4, 3, 5, '#c9cdd2'); break;
    case 'ammo': m.box(-4, -3, 0, 4, 3, 5, '#6f8a3f').box(-3, -2, 5, 3, 2, 6, '#586f34').box(-2, -3, 3, 2, -2, 4, '#e8d26a'); break;
    case 'mine': m.box(-4, -4, 0, 4, 4, 1, '#20232a').box(-3, -3, 1, 3, 3, 2, '#2a2e36').box(-1, -1, 2, 1, 1, 3, '#e05a3a'); break;
    case 'claymore': m.box(-1, -5, 0, 1, 5, 4, '#5d7a45').box(1, -4, 1, 2, 4, 3, '#3d5230').box(-2, -3, 0, -1, -2, 2, '#20232a').box(-2, 2, 0, -1, 3, 2, '#20232a'); break;
    case 'c4': m.box(-3, -3, 0, 3, 3, 3, '#d9cdaa').box(-1, -1, 3, 1, 1, 4, '#ff3b2f').box(-3, -3, 0, 3, -2, 1, '#a89c78'); break;
    case 'beacon': m.box(-3, -3, 0, 3, 3, 2, '#3a3f46').box(-1, -1, 2, 1, 1, 16, '#2b2f36').box(-2, -2, 16, 2, 2, 18, '#7dff9a'); break;
    case 'sensor': m.box(-3, -3, 0, 3, 3, 2, '#3a3f46').box(-2, -2, 2, 2, 2, 4, '#7fe08a').box(0, 0, 4, 1, 1, 10, '#2b2f36'); break;
    case 'gadget': m.box(-3, -3, 0, 3, 3, 4, '#aaaaaa'); break;
    case 'mcom': m.box(-6, -4, 0, 6, 4, 6, '#4b5158').box(-5, -3, 6, 5, 3, 8, '#2b2f33').box(-4, -3, 8, 4, 3, 9, '#5aa7ff').box(-6, 2, 1, 6, 4, 5, '#383d43'); break;
    case 'mcomDead': m.box(-6, -4, 0, 6, 4, 3, '#2a2624').box(-4, -3, 3, 1, 1, 5, '#4a4440'); break;
    case 'flagBase': m.box(-3, -3, 0, 3, 3, 3, '#8d8f94').box(-2, -2, 3, 2, 2, 4, '#5a5d63').box(-1, -1, 4, 0, 0, 30, '#cfd3d8').box(-1, -1, 30, 0, 0, 31, '#ffffff'); break;
    case 'rocket': m.box(-4, -1, 0, 3, 1, 2, '#2a2d33').box(-4, -1, 0, -2, 1, 2, '#ffb030').box(3, -1, 0, 4, 1, 2, '#d6d9de'); break;
    case 'shell': m.box(-3, -1, 0, 3, 1, 2, '#2a2d33').box(3, -1, 0, 4, 1, 2, '#ffb030'); break;
    case 'hat': m.box(-2, -2, 0, 2, 2, 2, '#7a281c'); break;
    default: m.box(-2, -2, 0, 2, 2, 2, '#aaaaaa');
  }
  return m;
}
export const propGeo = (name) => cached('p' + name, () => prop(name));

const GREN_HEX = { he: '#4a6b3a', flash: '#e8e8e8', smoke: '#b0b8c0', molo: '#d4552a' };
export const grenadeGeo = (kind) => cached('g' + kind, () => { const m = new VoxelModel(2); m.box(-1, -1, 0, 2, 2, 3, GREN_HEX[kind] || '#888888').box(-1, -1, 3, 2, 2, 4, '#3a3d45'); return m; });

export { VoxelModel, parse };
