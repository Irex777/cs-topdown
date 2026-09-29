// The static world in 3D: instanced voxel blocks for every solid tile (rebuilt tile by tile as things get destroyed),
// ground chunk planes textured from the baked terrain canvases, and decal planes (craters, blood) on top.
import * as THREE from '../../vendor/three/three.module.js';
import { TILE } from '../../shared/constants.js';
import { TILES } from '../../shared/gamemap.js';
import { hash2 } from './terrain.js';
import { VoxelModel, mixc } from './voxel.js';
import { voxelGeometry, linear } from './models3d.js';
import { assets, worldTex, hasWorld } from './assets.js';

/** how tall a solid tile stands (px above the ground) — the same value the simulation uses for cover and bullets */
export const tileHeight = (ch) => (TILES[ch] && TILES[ch].solid ? TILES[ch].h3 : 0);

const rgb = (c, k = 1) => `rgb(${Math.max(0, Math.min(255, Math.round(c[0] * k)))},${Math.max(0, Math.min(255, Math.round(c[1] * k)))},${Math.max(0, Math.min(255, Math.round(c[2] * k)))})`;

function canvasTex(w, h, paint, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  paint(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** paints jittered cells over a rectangle */
function cells(g, x, y, w, h, base, jit, sx, sy, seed) {
  for (let j = 0; j < Math.ceil(h / sy); j++) for (let i = 0; i < Math.ceil(w / sx); i++) {
    g.fillStyle = rgb(base, 1 + (hash2(i, j, seed) - 0.5) * 2 * jit);
    g.fillRect(x + i * sx, y + j * sy, Math.min(sx, w - i * sx), Math.min(sy, h - j * sy));
  }
}

/** side + top textures per tile type, in the theme's colours */
function makeTextures(k, H) {
  const S = 32;
  const T = {};
  const top = (base, jit = 0.06, edge = true) => canvasTex(S, S, (g) => {
    cells(g, 0, 0, S, S, base, jit, 4, 4, 11);
    if (edge) { g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 0, S, 1); g.fillRect(0, 0, 1, S); g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(S - 1, 0, 1, S); g.fillRect(0, S - 1, S, 1); }
  });
  const side = (h, paint) => canvasTex(S, h, paint);
  const rock = mixc(k.rock, [40, 40, 45], 0.2);
  T['#'] = { side: side(H['#'], (g, w, h) => { cells(g, 0, 0, w, h, rock, 0.12, 4, 4, 3); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, h - 3, w, 3); }), top: top(mixc(k.rock, [255, 255, 255], 0.12), 0.12) };
  const brick = k.brick;
  T.B = {
    side: side(H.B, (g, w, h) => {
      g.fillStyle = rgb(mixc(brick, [40, 30, 30], 0.35)); g.fillRect(0, 0, w, h);
      for (let r = 0; r * 8 < h; r++) for (let i = 0; i < 3; i++) {
        const off = (r & 1) ? -8 : 0;
        g.fillStyle = rgb(brick, 0.86 + hash2(i, r, 5) * 0.28);
        g.fillRect(off + i * 16 + 1, r * 8 + 1, 14, 6);
        g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(off + i * 16 + 1, r * 8 + 1, 14, 1);
      }
      g.fillStyle = 'rgba(0,0,0,0.30)'; g.fillRect(0, h - 3, w, 3);
    }),
    top: top(mixc(brick, k.concrete, 0.5), 0.05),
  };
  T.G = {
    side: side(H.G, (g, w, h) => {
      g.fillStyle = rgb(mixc(brick, [30, 30, 40], 0.4)); g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgb(150,215,240)'; g.fillRect(3, 5, w - 6, h - 12);
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(6, 7, 6, h - 16); g.fillRect(17, 7, 3, h - 16);
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(w / 2 - 1, 5, 2, h - 12);
    }),
    top: top(mixc(brick, k.concrete, 0.5), 0.05),
  };
  T.M = {
    side: side(H.M, (g, w, h) => {
      g.fillStyle = '#d7dadd'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.22)'; for (let i = 3; i < w; i += 4) g.fillRect(i, 2, 1, h - 4);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, w, 2); g.fillRect(0, h - 2, w, 2);
    }),
    top: canvasTex(S, S, (g) => { g.fillStyle = '#e8eaec'; g.fillRect(0, 0, S, S); g.fillStyle = 'rgba(0,0,0,0.2)'; for (let i = 3; i < S; i += 6) g.fillRect(i, 2, 1, S - 4); }),
  };
  T.X = {
    side: side(H.X, (g, w, h) => {
      cells(g, 0, 0, w, h, k.crate, 0.07, 16, 8, 21);
      g.strokeStyle = rgb(k.crate, 0.6); g.lineWidth = 2; g.strokeRect(2, 2, w - 4, h - 4);
      g.beginPath(); g.moveTo(3, 3); g.lineTo(w - 3, h - 3); g.moveTo(w - 3, 3); g.lineTo(3, h - 3); g.stroke();
    }),
    top: canvasTex(S, S, (g) => { cells(g, 0, 0, S, S, mixc(k.crate, [255, 240, 200], 0.18), 0.07, 16, 8, 22); g.strokeStyle = rgb(k.crate, 0.6); g.lineWidth = 2; g.strokeRect(3, 3, S - 6, S - 6); }),
  };
  const bag = [196, 178, 128];
  T.L = {
    side: side(H.L, (g, w, h) => {
      for (let r = 0; r * 6 < h; r++) for (let i = 0; i < 3; i++) {
        const off = (r & 1) ? -8 : 0;
        g.fillStyle = rgb(bag, 0.8 + hash2(i, r, 8) * 0.2); g.fillRect(off + i * 16 + 1, r * 6, 15, 5);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(off + i * 16 + 1, r * 6 + 4, 15, 1);
      }
    }),
    top: top(bag, 0.09, false),
  };
  const col = [212, 92, 48];
  T.o = {
    side: side(H.o, (g, w, h) => { g.fillStyle = rgb(col, 0.82); g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 4, w, 2); g.fillRect(0, h - 7, w, 2); g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(4, 0, 3, h); g.fillStyle = 'rgb(255,220,120)'; g.fillRect(w / 2 - 3, h / 2 - 4, 6, 8); g.fillStyle = 'rgb(60,20,10)'; g.fillRect(w / 2 - 1, h / 2 - 3, 2, 6); }),
    top: canvasTex(S, S, (g) => { g.fillStyle = rgb(col, 1.05); g.fillRect(0, 0, S, S); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(8, 8, 16, 16); g.fillStyle = 'rgba(255,220,120,0.9)'; g.fillRect(13, 13, 6, 6); }),
  };
  T['='] = {
    side: canvasTex(S, H['='], (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(190,205,220,0.9)';
      for (let i = 0; i < w; i += 4) g.fillRect(i, 3, 1, h - 3);
      for (let j = 3; j < h; j += 4) g.fillRect(0, j, w, 1);
      g.fillStyle = 'rgb(90,98,110)'; g.fillRect(0, 0, w, 3); g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h);
    }),
    top: null,
  };
  return T;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const PX_PER_M = 16;

/** multiplier that moves a baked texture's average colour toward the map theme's colour */
function themeTint(theme, ref, amt = 0.75) {
  const c = new THREE.Color();
  const f = (i) => 1 + (Math.max(0.35, Math.min(1.7, theme[i] / ref[i])) - 1) * amt;
  return c.setRGB(f(0), f(1), f(2), THREE.LinearSRGBColorSpace);
}

/** a physically based material from the baked texture set (albedo + normal + roughness), repeated over the face */
function pbrMat(name, rx, ry, o = {}) {
  return new THREE.MeshStandardMaterial({
    map: worldTex(name, 'c', rx, ry), normalMap: worldTex(name, 'n', rx, ry), normalScale: new THREE.Vector2(o.ns || 1, o.ns || 1),
    roughnessMap: worldTex(name, 'r', rx, ry), roughness: 1, metalness: o.metal || 0, color: o.color || new THREE.Color(1, 1, 1),
  });
}

/** the parts of a Blender prop: geometry with its node transform baked in, feet on y=0, centred on the tile, scaled to game pixels */
function propParts(name) {
  const node = assets.props && assets.props.getObjectByName(name);
  if (!node) return null;
  node.updateMatrixWorld(true);
  const wp = node.getWorldPosition(new THREE.Vector3());
  const parts = [];
  node.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    geo.translate(-wp.x, 0, -wp.z);
    geo.scale(PX_PER_M, PX_PER_M, PX_PER_M);
    const m = o.material.clone();
    const nm = o.material.name;
    if (nm === 'wood' || nm === 'wood_dark') { m.map = worldTex('wood', 'c'); m.normalMap = worldTex('wood', 'n'); m.roughnessMap = worldTex('wood', 'r'); m.roughness = 1; m.metalness = 0; }
    else if (nm === 'sandbag') { m.map = worldTex('sandbag', 'c'); m.normalMap = worldTex('sandbag', 'n'); m.roughnessMap = worldTex('sandbag', 'r'); m.roughness = 1; m.normalScale = new THREE.Vector2(1.2, 1.2); }
    m.needsUpdate = true;
    parts.push({ geo, mat: m });
  });
  return parts.length ? parts : null;
}
const DUMMY = new THREE.Object3D();
const COLOR = new THREE.Color();

/** a chunky stacked-cube tree (8 px cubes: cheap enough for the forests, and it fits the voxel look) */
function treeGeometry() {
  const m = new VoxelModel(8);
  m.box(0, 0, 0, 1, 1, 3, '#60422a');
  m.box(-2, -2, 3, 3, 3, 4, '#2f6a2c').box(-1, -1, 4, 2, 2, 5, '#3f7f3a').box(-1, -1, 5, 2, 2, 6, '#4f9a48').box(0, 0, 6, 1, 1, 7, '#62b058');
  const g = voxelGeometry(m, { noBottom: true });
  g.translate(-4, 0, -4);
  return g;
}

export class BlockField {
  constructor(scene, map, terrain, opts = {}) {
    this.scene = scene; this.map = map;
    this.k = terrain.th.c;
    this.types = new Map();
    this.slot = new Map();
    this.group = new THREE.Group();
    scene.add(this.group);
    this.pbr = !!opts.pbr && hasWorld();
    const H = {};
    for (const ch of Object.keys(TILES)) if (TILES[ch].solid) H[ch] = Math.round(tileHeight(ch));
    const tex = makeTextures(this.k, H);
    this.tex = tex;
    const lam = (map, extra = {}) => new THREE.MeshLambertMaterial({ map, ...extra });
    this.specs = {};
    const box = (ch, side, top, shrink) => { this.specs[ch] = { parts: [{ geo: BOX, mat: [side, side, top, side, side, side] }], shrink }; };
    for (const ch of ['#', 'B', 'G', 'M', 'X', 'L', 'o']) {
      const t = tex[ch];
      box(ch, lam(t.side), lam(t.top), ch === 'o' ? 0.72 : ch === 'X' ? 0.9 : 1);
    }
    const fence = lam(tex['='].side, { transparent: false, alphaTest: 0.35, side: THREE.DoubleSide });
    this.specs['='] = { parts: [{ geo: BOX, mat: fence }], fence: true };
    this.specs.T = { parts: [{ geo: treeGeometry(), mat: new THREE.MeshLambertMaterial({ vertexColors: true }) }], tree: true };
    if (this.pbr) this.upgradeSpecs(H);
    // count per type
    const counts = {};
    for (let i = 0; i < map.chars.length; i++) { const ch = map.chars[i]; if (this.specs[ch]) counts[ch] = (counts[ch] || 0) + 1; }
    for (const ch of Object.keys(this.specs)) this.makeType(ch, (counts[ch] || 0) + 160);
    for (let i = 0; i < map.chars.length; i++) if (this.specs[map.chars[i]]) this.place(i);
    for (const t of this.types.values()) this.commit(t);
  }

  /** swap the flat canvas materials for the Blender-baked PBR set, and the boxy props for the modelled ones */
  upgradeSpecs(H) {
    const k = this.k;
    const side = (name, ch, tintc, o) => pbrMat(name, 1, Math.max(1, H[ch] / 32), { color: tintc, ...o });
    const wallTop = pbrMat('concrete', 1, 1, { color: themeTint(mixc(k.brick, k.concrete, 0.5), [150, 150, 144]) });
    const rockTint = themeTint(mixc(k.rock, [40, 40, 45], 0.2), [104, 98, 88]);
    const rs = side('rock', '#', rockTint);
    this.specs['#'].parts[0].mat = [rs, rs, pbrMat('rock', 1, 1, { color: themeTint(k.rock, [104, 98, 88], 0.5) }), rs, rs, rs];
    const bs = side('brick', 'B', themeTint(k.brick, [165, 92, 74]));
    this.specs.B.parts[0].mat = [bs, bs, wallTop, bs, bs, bs];
    const ms = side('metal', 'M', new THREE.Color(1, 1, 1), { metal: 0.45 });
    this.specs.M.parts[0].mat = [ms, ms, pbrMat('metal', 1, 1, { metal: 0.45 }), ms, ms, ms];
    const crate = propParts('crate'), barrels = propParts('barrels'), bags = propParts('sandbags'), tree = propParts('tree');
    if (crate) this.specs.X = { parts: crate, prop: 'crate' };
    if (barrels) this.specs.o = { parts: barrels, prop: 'barrels' };
    if (bags) this.specs.L = { parts: bags, prop: 'bags' };
    if (tree) this.specs.T = { parts: tree, tree: true, prop: 'tree' };
  }

  makeType(ch, cap) {
    const spec = this.specs[ch];
    const meshes = spec.parts.map((p) => {
      const mesh = new THREE.InstancedMesh(p.geo, p.mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = !spec.fence; mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      COLOR.setRGB(1, 1, 1);
      mesh.setColorAt(0, COLOR);           // allocate instanceColor
      this.group.add(mesh);
      return mesh;
    });
    const old = this.types.get(ch);
    const t = { ch, meshes, cap, n: 0, tiles: new Int32Array(cap) };
    this.types.set(ch, t);
    if (old) for (const m of old.meshes) { this.group.remove(m); m.dispose(); }
    return t;
  }

  commit(t) {
    for (const mesh of t.meshes) {
      mesh.count = t.n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** write instance n of type t for tile index i */
  write(t, n, i) {
    const map = this.map, w = map.w, tx = i % w, ty = (i / w) | 0, ch = t.ch, spec = this.specs[ch];
    const h = tileHeight(ch);
    const cx = (tx + 0.5) * TILE, cz = (ty + 0.5) * TILE;
    const v = hash2(tx, ty, 5);
    if (spec.tree) {
      const sc = 0.9 + hash2(tx, ty, 9) * 0.3;
      DUMMY.position.set(cx, 0, cz); DUMMY.rotation.set(0, v * 6.28, 0); DUMMY.scale.set(spec.prop ? sc : 1, spec.prop ? sc * (0.95 + hash2(tx, ty, 4) * 0.2) : sc, spec.prop ? sc : 1);
      const g = 0.85 + hash2(tx, ty, 2) * 0.3;
      COLOR.setRGB(g, g, g);
    } else if (spec.prop) {
      let ry = v * 6.283;
      if (spec.prop === 'crate') ry = Math.floor(v * 4) * Math.PI / 2 + (hash2(tx, ty, 6) - 0.5) * 0.14;
      else if (spec.prop === 'bags') { const c = map.chars; ry = (c[i - 1] === 'L' || c[i + 1] === 'L') ? 0 : (c[i - map.w] === 'L' || c[i + map.w] === 'L') ? Math.PI / 2 : Math.floor(v * 2) * Math.PI / 2; }
      DUMMY.position.set(cx, 0, cz); DUMMY.rotation.set(0, ry, 0); DUMMY.scale.set(1, 1, 1);
      const g = 0.9 + hash2(tx, ty, 2) * 0.2;
      COLOR.setRGB(g, g, g, THREE.LinearSRGBColorSpace);
    } else if (spec.fence) {
      const horiz = map.chars[i - 1] === '=' || map.chars[i + 1] === '=';
      DUMMY.position.set(cx, h / 2, cz); DUMMY.rotation.set(0, horiz ? 0 : Math.PI / 2, 0); DUMMY.scale.set(TILE, h, 2);
      COLOR.setRGB(1, 1, 1);
    } else {
      const s = spec.shrink || 1;
      DUMMY.position.set(cx, h / 2, cz); DUMMY.rotation.set(0, 0, 0); DUMMY.scale.set(TILE * s, h, TILE * s);
      if (ch === 'M') { const cols = [[0.55, 0.7, 0.9], [0.95, 0.42, 0.36], [0.4, 0.75, 0.5], [0.95, 0.75, 0.32]]; const c = cols[(tx * 7 + ty * 3) & 3]; COLOR.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); }
      else { const g = 0.92 + v * 0.14; COLOR.setRGB(g, g, g, THREE.LinearSRGBColorSpace); }
    }
    DUMMY.updateMatrix();
    for (const mesh of t.meshes) {
      mesh.setMatrixAt(n, DUMMY.matrix);
      mesh.setColorAt(n, COLOR);
    }
  }

  place(i) {
    const ch = this.map.chars[i];
    if (!this.specs[ch]) return;
    let t = this.types.get(ch);
    if (t.n >= t.cap) t = this.grow(t);
    this.write(t, t.n, i);
    t.tiles[t.n] = i; this.slot.set(i, t.n); t.n++;
  }

  grow(t) {
    const nt = this.makeType(t.ch, t.cap * 2);
    for (let n = 0; n < t.n; n++) { this.write(nt, n, t.tiles[n]); nt.tiles[n] = t.tiles[n]; }
    nt.n = t.n;
    return nt;
  }

  unplace(i, ch) {
    const t = this.types.get(ch);
    const s = this.slot.get(i);
    if (!t || s === undefined) return;
    this.slot.delete(i);
    const last = t.n - 1;
    if (s !== last) {
      const tile = t.tiles[last];
      this.write(t, s, tile);
      t.tiles[s] = tile; this.slot.set(tile, s);
    }
    t.n--;
  }

  tileChanged(tx, ty, old, ch) {
    const map = this.map, i = ty * map.w + tx;
    if (this.slot.has(i)) this.unplace(i, old);
    if (this.specs[ch]) this.place(i);
    // fences turn with their neighbours
    for (const j of [i - 1, i + 1, i - map.w, i + map.w]) if (map.chars[j] === '=' && this.slot.has(j)) { this.unplace(j, '='); this.place(j); }
    for (const t of this.types.values()) this.commit(t);
  }
}

// ------------------------------------------------------------------------------------------------ ground
const CPX = 256;
const PLANE = new THREE.PlaneGeometry(CPX, CPX);
PLANE.rotateX(-Math.PI / 2);

function texFor(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export class Ground {
  constructor(scene, terrain, fx) {
    this.scene = scene; this.terrain = terrain; this.fx = fx;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.chunks = new Map();
    this.mat = { ground: null };
    this.frame = 0;
    this.pbr = false;
  }

  /** fine-grain normal + roughness over the painted ground (from the Blender texture set); rebuilds the chunk materials */
  setPbr(on) {
    on = !!on && hasWorld();
    if (on === this.pbr) return;
    this.pbr = on;
    for (const [k, e] of [...this.chunks]) this.drop(k, e);
    if (on && !this.detail) this.detail = { n: worldTex('ground', 'n', 12, 12), r: worldTex('ground', 'r', 12, 12) };
  }

  update(px, pz, radius) {
    const terrain = this.terrain;
    terrain.frame++; terrain.bakes = 0;
    const cw = terrain.cw, ch = terrain.chh;
    const cx0 = Math.max(0, Math.floor((px - radius) / CPX)), cx1 = Math.min(cw - 1, Math.floor((px + radius) / CPX));
    const cy0 = Math.max(0, Math.floor((pz - radius) / CPX)), cy1 = Math.min(ch - 1, Math.floor((pz + radius) / CPX));
    const live = new Set();
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const key = cy * cw + cx;
      const c = terrain.chunkCanvas(cx, cy);
      if (!c.ver) continue;                     // not baked yet (bake budget per frame): try again next frame
      live.add(key);
      let e = this.chunks.get(key);
      if (!e) {
        const tex = texFor(c.canvas);
        const mat = this.pbr
          ? new THREE.MeshStandardMaterial({ map: tex, normalMap: this.detail.n, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: this.detail.r, roughness: 1, metalness: 0 })
          : new THREE.MeshLambertMaterial({ map: tex });
        const mesh = new THREE.Mesh(PLANE, mat);
        mesh.position.set(cx * CPX + CPX / 2, 0, cy * CPX + CPX / 2);
        mesh.receiveShadow = true;
        this.group.add(mesh);
        e = { mesh, tex, canvas: c.canvas, ver: c.ver, decal: null };
        this.chunks.set(key, e);
      } else if (e.canvas !== c.canvas) { e.canvas = c.canvas; e.tex.image = c.canvas; e.tex.needsUpdate = true; e.ver = c.ver; }
      else if (e.ver !== c.ver) { e.tex.needsUpdate = true; e.ver = c.ver; }
      // decals painted by the effects system
      const d = this.fx.decals.get(cy * 4096 + cx);
      if (d) {
        if (!e.decal) {
          const dt = texFor(d.c);
          dt.generateMipmaps = false; dt.minFilter = THREE.NearestFilter;
          const dm = new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({ map: dt, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
          dm.position.set(cx * CPX + CPX / 2, 0.4, cy * CPX + CPX / 2);
          dm.renderOrder = 1;
          this.group.add(dm);
          e.decal = { mesh: dm, tex: dt, ver: d.ver || 0 };
        } else if (e.decal.ver !== (d.ver || 0)) { e.decal.tex.needsUpdate = true; e.decal.ver = d.ver || 0; }
      }
    }
    for (const [key, e] of this.chunks) {
      if (live.has(key)) continue;
      const cx = key % cw, cy = (key / cw) | 0;
      if (cx >= cx0 - 1 && cx <= cx1 + 1 && cy >= cy0 - 1 && cy <= cy1 + 1) continue;
      this.drop(key, e);
    }
  }

  drop(key, e) {
    this.group.remove(e.mesh); e.mesh.material.dispose(); e.tex.dispose();
    if (e.decal) { this.group.remove(e.decal.mesh); e.decal.mesh.material.dispose(); e.decal.tex.dispose(); }
    this.chunks.delete(key);
  }

  dispose() { for (const [k, e] of [...this.chunks]) this.drop(k, e); this.scene.remove(this.group); }
}

export { linear };
