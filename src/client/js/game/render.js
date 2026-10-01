// The 3D renderer: a chase camera behind the player, voxel terrain and units built from cubes, real shadows. The 2D canvas
// above it (overlay.js) carries the name tags, markers and crosshair. World axes: x, z = map x, y; y = up.
import * as THREE from '../../vendor/three/three.module.js';
import { PostFX } from './post.js';
import { SPEC, GREN_ORDER, TILE } from '../../shared/constants.js';
import { WEAPON_LIST, HELD_GREN_BASE, HELD_GADGET_BASE, GADGET_LIST, PROJ } from '../../shared/weapons.js';
import { vehicleAimPoint } from '../../shared/vehicle-aim.js';
import { roofHit } from '../../shared/buildings.js';
import { VEHICLES, VEHICLE_LIST, vehicleShot, vehicleGunMount } from '../../shared/vehicles.js';
import { TEAM_PAL } from './voxel.js';
import { soldierGeo, vehicleGeo, propGeo, grenadeGeo, VOXEL_MAT } from './models3d.js';
import { BlockField, Ground } from './world3d.js';
import { BuildingField } from './buildings3d.js';
import { FX3D } from './fx3d.js';
import { RigidField } from './rigid3d.js';
import { billboardCloud, finishCloud } from './particles3d.js';
import { Overlay } from './overlay.js';
import { Viewmodel } from './viewmodel.js';
import { Sky, moodFor } from './sky.js';
import { assets, makeSoldier, soldierGun, makeVehicle, makeEnvironment, onAssets, hasWorld } from './assets.js';

export { TEAM_COL } from './overlay.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const PROJ_LIST = Object.keys(PROJ);
const KIND_TIP = { pistol: 14, smg: 20, rifle: 26, dmr: 26, lmg: 28, sniper: 32, shotgun: 24, knife: 16, launcher: 24, tool: 16, grenade: 12 };
const TOP = { jeep: 21, apc: 21, tank: 15, boat: 18 };
// the voxel fallback models are drawn this much larger (the Blender models come in at the same size)
const VOX_K = { quad: 1, jeep: 1, apc: 1, tank: 1, heli: 1, boat: 1 };
const SKY = new THREE.Color('#9cc4ea');
const FOV = 62;
const SCOPE = [{ d: 95, fov: 50 }, { d: 52, fov: 34 }, { d: 32, fov: 22 }, { d: 22, fov: 14 }];

export function weaponKindOf(held) {
  if (held >= HELD_GADGET_BASE) { const g = GADGET_LIST[held - HELD_GADGET_BASE]; return g ? (g.kind === 'launcher' ? 'launcher' : 'tool') : 'tool'; }
  if (held >= HELD_GREN_BASE) return 'grenade';
  const w = WEAPON_LIST[held];
  return w ? w.kind : 'rifle';
}

/** id -> entry pool: entries not asked for during a frame are removed */
class Pool {
  constructor(parent, make) { this.parent = parent; this.make = make; this.map = new Map(); this.used = new Set(); }
  get(key) {
    let e = this.map.get(key);
    if (!e) { e = this.make(key); this.parent.add(e.obj); this.map.set(key, e); }
    e.obj.visible = true;
    this.used.add(key);
    return e;
  }
  sweep() {
    for (const [k, e] of this.map) {
      if (this.used.has(k)) continue;
      this.parent.remove(e.obj);
      if (e.dispose) e.dispose();
      this.map.delete(k);
    }
    this.used.clear();
  }
  clear() { this.used.clear(); this.sweep(); }
}

const flatRing = (inner, outer, seg = 48, a0 = 0, len = Math.PI * 2) => { const g = new THREE.RingGeometry(inner, outer, seg, 1, a0, len); g.rotateX(-Math.PI / 2); return g; };
const UNIT_RING = flatRing(0.965, 1, 64);
const UNIT_DISC = new THREE.RingGeometry(0, 1, 64, 16).rotateX(-Math.PI / 2);
const BOX = new THREE.BoxGeometry(1, 1, 1);

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;                 // the 2D overlay: it also receives the mouse
    this.game = game;
    this.dpr = 1; this.W = 0; this.H = 0;
    this.t = 0;
    this.yaw = 0; this.pitch = 0;
    this.focal = 700;
    this.crossDY = 0;
    this.cam = { x: 0, y: 0 };            // free camera centre lives in game.cam; this mirrors the pivot for spectators
    this.map = null; this.terrain = null;
    this.scopeK = 0; this.fovNow = FOV; this.camT = 1;
    this.aimGround = null;
    this.ctx = canvas.getContext('2d');
    this.overlay = new Overlay(this);
    this.fpsNow = false; this.bobT = 0; this.eyeSmooth = null;

    this.gl = document.createElement('canvas');
    this.gl.id = 'game3d';
    canvas.parentNode.insertBefore(this.gl, canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.gl, antialias: true, powerPreference: 'high-performance' });
    let q = 1; try { const v = parseInt(localStorage.getItem('fl.q'), 10); if (v >= 0 && v <= 2) q = v; this.qLocked = localStorage.getItem('fl.qm') === '1'; } catch { /* ignore */ }
    this.slowT = 0; this.slowCool = 0;
    this.quality = q;                     // 0 low (no shadows, native pixels), 1 medium, 2 high
    this.renderer.shadowMap.enabled = q > 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.scene = new THREE.Scene();
    this.scene.background = SKY;
    this.scene.fog = new THREE.Fog(SKY, 650, 2300);
    this.sky = new Sky(this.scene);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 3, 4200);
    this.scene.add(this.camera);
    this.post = new PostFX(this.renderer, this.scene, this.camera);   // bloom / grade / tone mapping / AA at Medium and High
    this.post.configure(q);

    this.hemi = new THREE.HemisphereLight(0xdcecff, 0x8a8570, 1.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.7);
    this.sun.castShadow = q > 0;
    this.sun.shadow.mapSize.set(q >= 2 ? 2048 : 1024, q >= 2 ? 2048 : 1024);
    const sc = this.sun.shadow.camera; sc.left = -720; sc.right = 720; sc.top = 720; sc.bottom = -720; sc.near = 50; sc.far = 2200;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);
    this.sunDir = new THREE.Vector3(-0.55, 1, -0.4).normalize();

    this.void = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2a3038 }));
    this.void.position.y = -2;
    this.scene.add(this.void);

    this.world = new THREE.Group(); this.scene.add(this.world);
    this.pools = {};
    this.mkPools();
    this.viewmodel = new Viewmodel(this);
    this._v = new THREE.Vector3(); this._ray = new THREE.Raycaster();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  mkPools() {
    const W = this.world;
    const mesh = (geo, mat = VOXEL_MAT) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = false; return m; };
    this.pools.soldiers = new Pool(W, () => {
      const obj = new THREE.Group();
      const vox = mesh(soldierGeo(0, 'assault', 'rifle', 0));           // procedural fallback until the Blender model has loaded
      obj.add(vox);
      const shield = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.28, depthWrite: false }));
      shield.scale.set(20, 34, 20); shield.position.y = 17; shield.visible = false; obj.add(shield);
      return { obj, vox, shield, geo: null, rig: null, rigKey: '' };
    });
    this.pools.corpses = new Pool(W, () => { const obj = new THREE.Group(); const vox = mesh(soldierGeo(0, 'assault', 'rifle', 0, true)); obj.add(vox); return { obj, vox, geo: null, rig: null, rigKey: '' }; });
    this.pools.vehicles = new Pool(W, (id) => ({ obj: new THREE.Group(), id, key: '', parts: {} , dispose() { /* geometry is shared */ } }));
    this.pools.flags = new Pool(W, () => {
      const obj = new THREE.Group();
      obj.add(mesh(propGeo('flagBase')));
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(26, 15), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, color: 0xffffff }));
      banner.castShadow = true; obj.add(banner);
      const zone = new THREE.Mesh(UNIT_DISC.clone(), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.1, depthWrite: false })); zone.renderOrder = 1; zone.position.y = 1.2;
      const rim = new THREE.Mesh(UNIT_RING.clone(), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75, depthWrite: false })); rim.renderOrder = 1; rim.position.y = 1.4;
      W.add(zone, rim);
      return { obj, banner, zone, rim, arc: null, arcKey: -1, dispose() { W.remove(zone, rim); zone.geometry.dispose(); rim.geometry.dispose(); if (this.arc) { W.remove(this.arc); this.arc.geometry.dispose(); } } };
    });
    this.pools.mcoms = new Pool(W, () => {
      const obj = new THREE.Group();
      const body = mesh(propGeo('mcom')); obj.add(body);
      const lamp = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ color: 0x5aa7ff })); lamp.scale.set(10, 3, 6); lamp.position.set(0, 18, 0); obj.add(lamp);
      return { obj, body, lamp, state: -1 };
    });
    this.pools.gadgets = new Pool(W, () => {
      const obj = new THREE.Group();
      const m = mesh(propGeo('gadget')); obj.add(m);
      const ring = new THREE.Mesh(UNIT_RING.clone(), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false })); ring.position.y = 1.6; ring.renderOrder = 1; ring.visible = false; W.add(ring);
      const cone = new THREE.Mesh(new THREE.CircleGeometry(150, 20, -0.75, 1.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide })); cone.position.y = 1.5; cone.visible = false; W.add(cone);
      return { obj, m, ring, cone, id: '', dispose() { W.remove(ring, cone); ring.geometry.dispose(); cone.geometry.dispose(); } };
    });
    this.pools.grenades = new Pool(W, () => ({ obj: mesh(grenadeGeo('he')), kind: '' }));
    this.pools.projectiles = new Pool(W, () => ({ obj: mesh(propGeo('rocket')) }));
    this.pools.revive = new Pool(W, () => {
      const obj = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0x5dff9a, transparent: true, opacity: 0.8 });
      const a = new THREE.Mesh(BOX, mat); a.scale.set(20, 2, 5); a.position.y = 3;
      const b = new THREE.Mesh(BOX, mat); b.scale.set(5, 2, 20); b.position.y = 3;
      obj.add(a, b);
      return { obj, mat };
    });
    this.pools.fires = new Pool(W, () => {
      const obj = new THREE.Mesh(UNIT_DISC.clone(), new THREE.MeshBasicMaterial({ color: 0xff7a1e, transparent: true, opacity: 0.35, depthWrite: false }));
      obj.renderOrder = 1; obj.position.y = 1.6;
      return { obj, dispose() { obj.geometry.dispose(); } };
    });
    this.smoke = billboardCloud(900, { opacity: 0.92 });
    W.add(this.smoke);
    this.muzzles = [];
  }

  // ------------------------------------------------------------------ setup
  setMap(map, terrain) {
    this.map = map; this.terrain = terrain;
    this.rigids?.dispose(); this.rigids = new RigidField(this.scene);
    if (this.ground) this.ground.dispose();
    if (this.blocks) { this.blocks.dispose(); this.blocks = null; }
    for (const p of Object.values(this.pools)) p.clear();
    this.ground = new Ground(this.scene, terrain, this.game.fx);
    this.buildBlocks();
    map.onChange((tx, ty, old, ch) => { this.blocks.tileChanged(tx, ty, old, ch); this.buildings.sync(); });
    onAssets(() => this.upgradeWorld());
    if (!this.fx3d) this.fx3d = new FX3D(this.scene, this.game.fx);
    // sky and haze follow the map's mood
    const th = terrain.th.c;
    this.void.material.color.setRGB(th.rock[0] / 700, th.rock[1] / 700, th.rock[2] / 700, THREE.SRGBColorSpace);
    this.camT = 1;
    this.applyMood(moodFor(map.id));
  }

  /** the block field in the quality the settings ask for (physically based Blender materials and props unless Low) */
  buildBlocks() {
    if (this.blocks) this.blocks.dispose();
    if (this.buildings) this.buildings.dispose();
    const pbr = this.quality > 0;
    this.blocks = new BlockField(this.scene, this.map, this.terrain, { pbr });
    this.buildings = new BuildingField(this.scene, this.map, this.blocks.pbr);
    if (this.ground) this.ground.setPbr(pbr);
    if (this.blocks.pbr && !this.env) this.env = makeEnvironment(this.renderer);
    this.scene.environment = this.blocks.pbr ? this.env : null;
    this.scene.environmentIntensity = 0.35;
  }

  /** the models and textures arrived after the map was built (or the quality changed): rebuild the world with them */
  upgradeWorld() {
    if (!this.map || !this.terrain) return;
    if (this.blocks && this.blocks.pbr === (this.quality > 0 && hasWorld()) && this.blocks.modeled === !!assets.props) return;
    this.buildBlocks();
  }

  /** sky, haze and sun colour for the map's time of day */
  applyMood(m) {
    this.mood = m;
    this.sky.set(m);
    const fog = new THREE.Color(m.fog);
    this.scene.background = fog; this.scene.fog.color.copy(fog); this.scene.fog.near = m.fogNear; this.scene.fog.far = m.fogFar;
    this.hemi.color.setHex(m.hemiSky); this.hemi.groundColor.setHex(m.hemiGround); this.hemi.intensity = m.hemi;
    this.sun.color.setHex(m.sun); this.sun.intensity = m.sunI;
    this.sunDir.set(m.sunDir[0], m.sunDir[1], m.sunDir[2]).normalize();
  }

  /** a machine that cannot keep up (under ~24 fps for 4 s of play) steps the graphics down one level, unless the player chose one himself */
  autoQuality(dt) {
    if (this.qLocked || this.quality === 0 || navigator.webdriver) return;
    this.slowCool = Math.max(0, this.slowCool - dt);
    this.slowT = dt > 1 / 24 ? this.slowT + dt : Math.max(0, this.slowT - dt * 2);
    if (this.slowT < 4 || this.slowCool > 0) return;
    this.slowT = 0; this.slowCool = 10;
    this.setQuality(this.quality - 1);
    try { const ui = this.game.ui && this.game.ui.app; if (ui && ui.toast) ui.toast(`Running slowly: graphics set to ${this.quality === 0 ? 'Low' : 'Medium'} (Esc, Graphics to change)`); } catch { /* ignore */ }
  }

  /** graphics quality from the settings: applies immediately */
  setQuality(q, manual = false) {
    this.quality = q;
    if (manual) { this.qLocked = true; try { localStorage.setItem('fl.qm', '1'); } catch { /* ignore */ } }
    try { localStorage.setItem('fl.q', String(q)); } catch { /* ignore */ }
    this.renderer.shadowMap.enabled = q > 0;
    this.sun.castShadow = q > 0;
    if (this.post) this.post.configure(q);
    const sz = q >= 2 ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== sz) { this.sun.shadow.mapSize.set(sz, sz); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
    this.scene.traverse((o) => { if (o.material) { for (const m of [].concat(o.material)) m.needsUpdate = true; } });
    this.upgradeWorld();
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.canvas.width = Math.floor(this.W * this.dpr); this.canvas.height = Math.floor(this.H * this.dpr);
    this.canvas.style.width = this.W + 'px'; this.canvas.style.height = this.H + 'px';
    this.renderer.setPixelRatio(Math.min(this.dpr, this.quality >= 2 ? 1.5 : 1));
    this.renderer.setSize(this.W, this.H, false);
    if (this.post) this.post.resize(this.W, this.H);
    this.gl.style.width = this.W + 'px'; this.gl.style.height = this.H + 'px';
    this.camera.aspect = this.W / this.H;
    this.camera.updateProjectionMatrix();
    if (this.viewmodel) this.viewmodel.resize(this.W, this.H);
  }

  // ------------------------------------------------------------------ projection helpers (used by the overlay and input)
  project(x, y, z = 0, allowBehind = false) {
    const v = this._v.set(x, z, y).applyMatrix4(this.camera.matrixWorldInverse);
    const depth = -v.z;
    const e = this.camera.projectionMatrix.elements;
    const behind = depth < 1;
    if (behind && !allowBehind) return null;
    const d = behind ? (depth < 0 ? depth : -1) : depth;
    const nx = e[0] * v.x / d, ny = e[5] * v.y / d;
    return { x: (nx * 0.5 + 0.5) * this.W, y: (-ny * 0.5 + 0.5) * this.H, dist: Math.hypot(v.x, v.y, v.z), behind };
  }

  /** ground point under a screen position */
  screenToWorld(sx, sy) {
    this._ray.setFromCamera({ x: (sx / this.W) * 2 - 1, y: -(sy / this.H) * 2 + 1 }, this.camera);
    const o = this._ray.ray.origin, d = this._ray.ray.direction;
    const horizontal = Math.max(1e-6, Math.hypot(d.x, d.z));
    const hit = this.map.castBullet(o.x, o.z, o.y, d.x / horizontal, d.z / horizontal, d.y / horizontal, 3200);
    return { x: o.x + d.x / horizontal * hit.d, y: o.z + d.z / horizontal * hit.d, z: o.y + d.y / horizontal * hit.d };
  }

  worldToScreen(x, y) { const p = this.project(x, y, this.map?.heightAt(x, y) || 0, true); return { x: p.x, y: p.y }; }

  // ------------------------------------------------------------------ camera
  camParams(viewer) {
    const g = this.game, me = g.me;
    if (g.freecam) return { D: 0, H: g.camH || 240, ahead: 300, fov: FOV, hideOwn: false };
    if (!viewer) return { D: 0, H: 320, ahead: 300, fov: FOV, hideOwn: false };
    if (me && me.veh) {
      const def = g.vehDef();
      if (def && def.kind === 'air') return { D: 360, H: viewer.z + 28, ahead: 520, fov: FOV, hideOwn: false };
      const r = def ? def.r : 14;
      return { D: 120 + r * 6, H: 18 + r * 0.9, ahead: 330, fov: FOV, hideOwn: false };
    }
    const lvl = clamp(viewer.scopeLvl || 0, 0, 3);
    const s = SCOPE[lvl];
    const k = this.scopeK;
    return { D: lerp(165, s.d, k), H: lerp(24, 26, k), ahead: lerp(280, 420, k), fov: lerp(FOV, s.fov, k), hideOwn: k > 0.6 && lvl >= 1 };
  }

  /** first tile along the pivot -> camera segment whose top is above the ray: keeps the camera out of walls */
  clipCamera(px, pz, py, cx, cz, cy) {
    const map = this.map;
    if (!map) return 1;
    const dist = Math.hypot(cx - px, cz - pz, cy - py);
    const n = Math.max(1, Math.ceil(dist / 8));
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const x = px + (cx - px) * f, z = pz + (cz - pz) * f, y = py + (cy - py) * f;
      const tx = Math.floor(x / TILE), ty = Math.floor(z / TILE);
      if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
      const ch = map.chars[ty * map.w + tx];
      const trunk = ch === 'T' && Math.hypot(x - (tx + .5) * TILE, z - (ty + .5) * TILE) < 12;
      const h = ch === 'T' ? (trunk ? map.top[ty * map.w + tx] * .58 : 0) : map.top[ty * map.w + tx];
      if (y < map.heightAt(x, z) + 4 || (h > 0 && y < map.tileBase(tx, ty) + h + 4)) return Math.max(0.1, (i - 1.6) / n);
    }
    const roof = roofHit(map.buildings, px, pz, py, (cx - px) / dist, (cz - pz) / dist, (cy - py) / dist, dist);
    return roof ? Math.max(.02, (roof.d - 5) / dist) : 1;
  }

  /** first person: on foot (yours, or the soldier you are spectating); vehicles, the death view and the free camera use the chase camera */
  isFps(viewer) {
    const g = this.game, me = g.me;
    if (g.freecam || !viewer) return false;
    if (!g.alive && !g.spec) return !(me && me.veh) && this.game.deathLook;      // just died: the view sinks to the ground where you fell
    if (!me || me.veh) return false;
    if (g.alive && me.own) return true;
    return !g.alive && !!g.spec && me.id === g.spec && !me.own;
  }

  updateCameraFps(dt, viewer) {
    const g = this.game, cam = this.camera, me = g.me || {};
    const dead = !g.alive && !g.spec;
    this.deadT = dead ? (this.deadT || 0) + dt : 0;
    const own = dead ? true : !!me.own;
    const yaw = own ? g.viewYaw() : g.yaw;
    const pitch = own ? g.viewPitch() : g.pitch;
    this.yaw = yaw;
    // aiming zoom
    const scoped = !!(viewer.scoped && g.alive) || (!own && !!(me.sc));
    this.scopeK += ((scoped ? 1 : 0) - this.scopeK) * (1 - Math.exp(-(viewer.scopeLvl >= 2 ? 8 : 12) * dt));
    const aspect = Math.max(1.2, this.W / this.H);
    const hFov = Math.min(g.fov, 118) * Math.PI / 180;
    const sprintK = own && !dead && me.spr ? 1 : 0;
    this.sprintFov = (this.sprintFov || 0) + (sprintK - (this.sprintFov || 0)) * (1 - Math.exp(-6 * dt));
    let tanHalf = Math.tan(hFov / 2) / aspect * (1 + 0.025 * this.sprintFov);
    tanHalf *= 1 + (g.zoomMul(viewer.scopeLvl) - 1) * this.scopeK;
    const vfov = 2 * Math.atan(tanHalf) * 180 / Math.PI;
    if (Math.abs(cam.fov - vfov) > 0.01 || cam.near !== 1.4) { cam.fov = vfov; cam.near = 1.4; cam.updateProjectionMatrix(); }
    // eye position: crouching lowers it, walking bobs it, landing dips it
    const speed = dead ? 0 : own ? Math.hypot(g.pred.vx, g.pred.vy) : Math.hypot(me.vx || 0, me.vy || 0);
    const air = dead ? false : own ? Math.abs(g.pred.vz) > 1 : Math.abs(me.vz || 0) > 1;
    const moving = Math.min(1.6, speed / 92) * (air ? 0 : 1);
    this.bobT += dt * (3 + moving * 5.5);
    const ads = this.scopeK;
    const bobA = moving * (sprintK ? 1.5 : viewer.cf > 0.5 ? 0.5 : 1) * (1 - ads * 0.85);
    g.landDip *= Math.exp(-9 * dt);
    let eye = viewer.eye + Math.abs(Math.cos(this.bobT)) * -0.22 * bobA - g.landDip * 2.2;
    // swimming: the eye drops to the waterline
    const wet = this.map && this.map.waterAt(viewer.x, viewer.y) === 2 ? 1 : 0;
    this.wetK = (this.wetK || 0) + (wet - (this.wetK || 0)) * (1 - Math.exp(-6 * dt));
    eye -= 9 * this.wetK;
    const sink = dead ? Math.min(1, this.deadT / 0.55) : 0;
    eye = eye + (this.map.heightAt(viewer.x, viewer.y) + 5 - eye) * sink * sink;
    if (this.eyeSmooth === null || Math.abs(eye - this.eyeSmooth) > 30) this.eyeSmooth = eye;
    this.eyeSmooth += (eye - this.eyeSmooth) * (1 - Math.exp(-22 * dt));   // stepping onto cover glides instead of snapping
    eye = this.eyeSmooth;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const side = Math.sin(this.bobT) * 0.06 * bobA;
    const sh = g.fx.shake;
    const px = viewer.x - sy * side + g.fx.shakeX * 0.35, pz = viewer.y + cy * side + g.fx.shakeY * 0.35;
    cam.position.set(px, eye + g.fx.shakeY * 0.25, pz);
    const cp = Math.cos(pitch);
    cam.lookAt(px + cy * cp, cam.position.y + Math.sin(pitch), pz + sy * cp);
    // lean into strafing, wobble with explosions
    const rx = -sy, ry = cy;
    const strafe = own && !dead ? (g.pred.vx * rx + g.pred.vy * ry) / 92 : 0;
    this.leanRoll = (this.leanRoll || 0) + ((clamp(strafe, -1, 1) * 0.004 + g.fx.shakeX * 0.0015) - (this.leanRoll || 0)) * (1 - Math.exp(-10 * dt));
    cam.rotateZ(this.leanRoll + sink * 0.9);
    cam.updateMatrixWorld();
    this.focal = this.H / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    this.pivot = { x: viewer.x, y: viewer.y, h: eye };
    this.camDist = 0; this.hideOwn = true;
    this.cam.x = viewer.x; this.cam.y = viewer.y;
    this.aimGround = this.screenToWorld(this.W / 2, this.H / 2);
    const tx = viewer.x + cy * 260, tz = viewer.y + sy * 260;
    this.sun.target.position.set(tx, this.map.heightAt(tx, tz), tz);
    this.sun.position.set(tx + this.sunDir.x * 1200, this.map.heightAt(tx, tz) + this.sunDir.y * 1200, tz + this.sunDir.z * 1200);
    this.sun.target.updateMatrixWorld();
    this.fpsCtx = { speed, air, strafe, sh };
  }

  updateVehicleCamera(dt, viewer) {
    const g = this.game, cam = this.camera, own = g.me.veh, def = g.vehDef(), seat = def.seats[own.seat];
    const zoom = !!seat.weapon && g.input.right && g.playing();
    let first = g.vehicleCameraMode === 'first' || (g.vehicleCameraMode === 'auto' && own.seat > 0 && !!seat.weapon) || zoom;
    let pitch = g.vehiclePitch, yaw = g.yaw, c = Math.cos(yaw), s = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const altitude = viewer.z, pivot = altitude + Math.max(30, def.size[2] + 12);
    const distance = Math.max(110, def.size[0] * .65 + 85);
    let cx = viewer.x - c * cp * distance, cz = viewer.y - s * cp * distance, cy = pivot - sp * distance;
    const clipped = this.clipCamera(viewer.x, viewer.y, pivot, cx, cz, cy);
    this.camT = clipped < this.camT ? clipped : this.camT + (clipped - this.camT) * (1 - Math.exp(-9 * dt));
    if (this.camT < .22) first = true;
    let gunMount = null;
    // Keep the mounted weapon below the view as its elevation changes.
    // A world-space vertical offset lets the shield rise across the reticle.
    const placeGunnerCamera = () => {
      cx = gunMount.x - c * cp * 12 - c * sp * 10;
      cz = gunMount.y - s * cp * 12 - s * sp * 10;
      cy = gunMount.z - sp * 12 + cp * 10;
    };
    if (first) {
      const height = seat.weapon ? (def.id === 'tank' && own.seat === 0 ? 31 : def.id === 'apc' && own.seat === 0 ? 43 : def.id === 'heli' ? 20 : def.id === 'tank' ? 40 : def.id === 'apc' ? 44 : 23) : def.size[2] * .85;
      const forward = Math.min(24, def.size[0] * .18), heading = seat.aim === 'turret' ? g.turretAngle() : g.inDriverSeat() ? g.predVeh.a : own.a;
      cx = viewer.x + Math.cos(heading) * forward; cz = viewer.y + Math.sin(heading) * forward; cy = altitude + height + 5;
      if (own.seat > 0 && seat.weapon) {
        const vehicle = g.interpolatedVeh(own.id) || own;
        gunMount = vehicleGunMount({ ...vehicle, x: viewer.x, y: viewer.y, z: altitude, def }, own.seat);
        placeGunnerCamera();
      }
    } else {
      cx = viewer.x + (cx - viewer.x) * this.camT; cz = viewer.y + (cz - viewer.y) * this.camT; cy = pivot + (cy - pivot) * this.camT;
    }
    const cameraKey = `${own.id}:${own.seat}`;
    if (this.vehicleCameraKey === cameraKey && this.vehicleFirst !== first && this.vehicleAim && seat.weapon) {
      const target = this.vehicleAim, ox = first ? cx : viewer.x, oy = first ? cz : viewer.y, oz = first ? cy : pivot;
      yaw = Math.atan2(target.y - oy, target.x - ox); pitch = clamp(Math.atan2(target.z - oz, Math.hypot(target.x - ox, target.y - oy)), seat.aim === 'free' ? -1.25 : -.75, seat.aim === 'free' ? 1.25 : .85);
      g.yaw = yaw; g.vehiclePitch = pitch; c = Math.cos(yaw); s = Math.sin(yaw); cp = Math.cos(pitch); sp = Math.sin(pitch);
      if (gunMount) placeGunnerCamera();
      if (!first) { cx = viewer.x - c * cp * distance * this.camT; cz = viewer.y - s * cp * distance * this.camT; cy = pivot - sp * distance * this.camT; }
    }
    this.vehicleCameraKey = cameraKey;
    cy = Math.max(this.map.heightAt(cx, cz) + 8, cy);
    this.vehicleFirst = first;
    this.scopeK += ((zoom ? 1 : 0) - this.scopeK) * (1 - Math.exp(-12 * dt));
    // The setting is horizontal FOV, just as on foot; Three.js expects vertical FOV.
    const aspect = Math.max(1.2, this.W / this.H);
    const tanHalf = Math.tan(Math.min(g.fov, 118) * Math.PI / 360) / aspect * (zoom ? .52 : 1);
    const targetFov = 2 * Math.atan(tanHalf) * 180 / Math.PI;
    this.fovNow += (targetFov - this.fovNow) * (1 - Math.exp(-14 * dt));
    cam.near = first ? 1 : 3;
    cam.position.set(cx, cy, cz); cam.lookAt(cx + c * cp, cy + sp, cz + s * cp);
    cam.fov = this.fovNow; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    this.yaw = yaw; this.focal = this.H / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    this.pivot = { x: viewer.x, y: viewer.y, h: pivot }; this.camDist = first ? 0 : distance * this.camT; this.hideOwn = first;
    this.cam.x = viewer.x; this.cam.y = viewer.y;
    this._ray.setFromCamera({ x: 0, y: 0 }, cam);
    const ray = this._ray.ray;
    this.vehicleAim = vehicleAimPoint(this.map, { x: ray.origin.x, y: ray.origin.z, z: ray.origin.y }, { x: ray.direction.x, y: ray.direction.z, z: ray.direction.y }, g.soldiers(), g.vehiclesDrawn(), own.id, VEHICLE_LIST.map((id) => VEHICLES[id]), 2400, true);
    this.aimGround = this.vehicleAim;
    const tx = viewer.x + c * 240, tz = viewer.y + s * 240;
    this.sun.target.position.set(tx, this.map.heightAt(tx, tz), tz); this.sun.position.set(tx + this.sunDir.x * 1200, this.map.heightAt(tx, tz) + this.sunDir.y * 1200, tz + this.sunDir.z * 1200); this.sun.target.updateMatrixWorld();
  }

  updateCamera(dt, viewer) {
    const g = this.game, cam = this.camera;
    this.fpsNow = this.isFps(viewer);
    if (this.fpsNow) { this.updateCameraFps(dt, viewer); return; }
    if (!g.freecam && g.me?.veh && viewer) { this.updateVehicleCamera(dt, viewer); return; }
    if (cam.near !== 3) { cam.near = 3; cam.updateProjectionMatrix(); }
    const P = this.camParams(viewer);
    const scoped = !!(viewer && viewer.scoped && g.alive);
    this.scopeK += ((scoped ? 1 : 0) - this.scopeK) * (1 - Math.exp(-12 * dt));
    this.fovNow += (P.fov - this.fovNow) * (1 - Math.exp(-14 * dt));
    let px, py;
    if (g.freecam) { px = g.cam.x; py = g.cam.y; }
    else if (viewer) { px = viewer.x; py = viewer.y; }
    else { px = this.map.width / 2; py = this.map.height / 2; }
    P.H = g.freecam ? Math.max(P.H, this.map.heightAt(px, py) + 8) : P.H + this.map.heightAt(px, py);
    const yaw = g.yaw;
    this.yaw = yaw;
    const elev = clamp(g.elev, 0.05, 1.3) * (1 - this.scopeK * 0.35);
    const dh = P.D * Math.cos(elev), dv = P.D * Math.sin(elev);
    let cx = px - Math.cos(yaw) * dh, cz = py - Math.sin(yaw) * dh, cy = P.H + dv;
    if (P.D === 0) { cy = P.H; cx = px; cz = py; }
    const t = P.D > 0 ? this.clipCamera(px, py, P.H, cx, cz, cy) : 1;
    this.camT = t < this.camT ? t : this.camT + (t - this.camT) * (1 - Math.exp(-5 * dt));
    const k = this.camT;
    cx = px + (cx - px) * k; cz = py + (cz - py) * k; cy = P.H + (cy - P.H) * k;
    const sh = g.fx.shake;
    cam.position.set(cx + g.fx.shakeX * 0.7, cy + g.fx.shakeY * 0.5, cz + (g.fx.shakeY) * 0.7);
    // freecam pitches with the mouse; everything else looks at a point ahead of the pivot
    if (P.D === 0) cam.lookAt(px + Math.cos(yaw) * 400, P.H - Math.tan(elev) * 400, py + Math.sin(yaw) * 400);
    else cam.lookAt(px + Math.cos(yaw) * P.ahead, P.H - 2, py + Math.sin(yaw) * P.ahead);
    if (Math.abs(cam.fov - this.fovNow) > 0.01) { cam.fov = this.fovNow; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    this.focal = this.H / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    this.pivot = { x: px, y: py, h: P.H };
    this.camDist = P.D * k;
    this.hideOwn = P.hideOwn || this.camDist < 46;
    this.cam.x = px; this.cam.y = py;
    void sh;
    // ground point under the crosshair drives grenade range and spotting
    const a = this.screenToWorld(this.W / 2, this.H / 2 + this.crossDY);
    this.aimGround = a;
    // shadows follow the action
    const tx = px + Math.cos(yaw) * 240, tz = py + Math.sin(yaw) * 240;
    this.sun.target.position.set(tx, this.map.heightAt(tx, tz), tz);
    this.sun.position.set(tx + this.sunDir.x * 1200, this.map.heightAt(tx, tz) + this.sunDir.y * 1200, tz + this.sunDir.z * 1200);
    this.sun.target.updateMatrixWorld();
  }

  // ------------------------------------------------------------------ frame
  render(dt, nowMs) {
    const g = this.game;
    if (!this.map || !this.terrain || !this.ground) return;
    this.t = nowMs / 1000;
    const viewer = g.viewer();
    if (g.freecam) this.moveFreecam(dt);
    this.updateCamera(dt, viewer);
    this.ground.update(this.pivot.x + Math.cos(this.yaw) * 400, this.pivot.y + Math.sin(this.yaw) * 400, 1700);
    this.updateEntities(viewer, nowMs);
    const elapsed = Math.min(.15, (performance.now() - (g.projRecv || 0)) / 1000);
    g.fx.flares = (g.ents.cf || []).map((f) => ({ id: f[0], x: f[1] + f[4] * elapsed, y: f[2] + f[5] * elapsed, z: f[3] + f[6] * elapsed, fade: f[7] }));
    for (const f of g.fx.flares) if (g.fx.shouldSmoke('flare' + f.id, nowMs)) g.fx.smokeTrail(f.x, f.y, f.z);
    this.rigids?.update(g.ents.rb || [], (nowMs - g.projRecv) / 1000, dt);
    this.fx3d.update(this.camera);
    this.renderer.autoClear = true;
    this.sky.follow(this.camera.position);
    if (this.debugVm) { this.renderer.setClearColor(0x6d8fb3); this.renderer.clear(); } else if (!this.post.render(dt)) this.renderer.render(this.scene, this.camera);
    this.drawViewmodel(dt, viewer);
    this.overlay.draw(this.ctx, viewer, dt);
  }

  drawViewmodel(dt, viewer) {
    const g = this.game, me = g.me, vm = this.viewmodel;
    if (!this.fpsNow || !me || me.veh || me.hb || !viewer || !g.alive && !g.spec) { vm.visible = false; return; }
    const own = !!me.own;
    if (!vm.flash.material.map && this.fx3d) { vm.flash.material.map = this.fx3d.glowTex; vm.flash.material.needsUpdate = true; }
    const held = me.held;
    const kind = weaponKindOf(held);
    const weapon = (own ? g.heldWeapon(me) : WEAPON_LIST[held]) || (held >= HELD_GADGET_BASE ? GADGET_LIST[held - HELD_GADGET_BASE] : null);
    const fc = this.fpsCtx || {};
    const edge = own && g.input.left && !this._prevLeft;
    this._prevLeft = own && g.input.left;
    const zoomed = !!(viewer.scoped && (viewer.scopeLvl || 0) >= 1 && this.scopeK > 0.55);
    vm.render(dt, {
      fps: true, me, viewer, kind, weapon, team: g.pt(g.teamOf(me.id)),
      speed: fc.speed || 0, air: !!fc.air, strafe: fc.strafe || 0,
      ads: !!(viewer.scoped && g.alive) || (!own && !!me.sc), sprint: !!me.spr, crouch: viewer.cf > 0.5,
      reload: me.rel || 0, swing: edge && (kind === 'knife' || kind === 'grenade' || kind === 'tool'), scopedView: zoomed,
    });
  }

  moveFreecam(dt) {
    const g = this.game, inp = g.input, sp = 900 * dt;
    let f = 0, r = 0;
    if (inp.down.has('KeyW')) f += 1; if (inp.down.has('KeyS')) f -= 1;
    if (inp.down.has('KeyD')) r += 1; if (inp.down.has('KeyA')) r -= 1;
    const c = Math.cos(g.yaw), s = Math.sin(g.yaw);
    g.cam.x += (f * c - r * s) * sp; g.cam.y += (f * s + r * c) * sp;
    if (inp.down.has('Space')) g.camH = Math.min(1200, (g.camH || 240) + sp * 0.6);
    if (inp.down.has('ControlLeft') || inp.down.has('KeyC')) g.camH = Math.max(40, (g.camH || 240) - sp * 0.6);
    g.cam.x = clamp(g.cam.x, 0, this.map.width); g.cam.y = clamp(g.cam.y, 0, this.map.height);
  }

  near(x, y, m = 2600) { const c = this.camera.position; return Math.abs(x - c.x) < m && Math.abs(y - c.z) < m; }

  updateEntities(viewer, nowMs) {
    const g = this.game, P = this.pools, t = this.t;
    const now = nowMs;
    // soldiers
    for (const p of g.soldiers()) {
      if (!this.near(p.x, p.y)) continue;
      const e = P.soldiers.get(p.id);
      const team = g.pt(p.team);
      const kind = weaponKindOf(p.held);
      const speed = p.speed || 0;
      if (assets.soldier) {
        const rk = `${team}|${p.cls || 'assault'}`;
        if (e.rigKey !== rk) { if (e.rig) e.obj.remove(e.rig.root); e.rig = makeSoldier(team, p.cls || 'assault'); e.rigKey = rk; if (e.rig) e.obj.add(e.rig.root); }
        if (e.rig) {
          e.vox.visible = false;
          const wid = p.held < HELD_GREN_BASE ? (WEAPON_LIST[p.held] ? WEAPON_LIST[p.held].id : '') : (p.held >= HELD_GADGET_BASE && kind === 'launcher' ? 'rpg' : '');
          soldierGun(e.rig, kind === 'knife' ? '' : wid, WEAPON_LIST[p.held] ? WEAPON_LIST[p.held].defOptic : '');
          const k = Math.min(1, speed / 70), ph = t * (speed > 240 ? 11 : 8.5) * Math.min(1.4, 0.55 + speed / 130) + p.id * 1.7;
          const sw = Math.sin(ph) * 0.75 * k;
          if (e.rig.legL) { e.rig.legL.rotation.z = sw; e.rig.legR.rotation.z = -sw; }
          e.rig.root.position.y = Math.abs(Math.cos(ph)) * 0.35 * k;
        }
      } else e.vox.visible = true;
      const frame = speed > 35 ? (Math.floor(t * (speed > 240 ? 12 : 9) + p.id) % 2 === 0 ? 1 : 2) : 0;
      const geo = soldierGeo(team, p.cls || 'assault', kind, frame);
      if (e.geo !== geo) { e.vox.geometry = geo; e.geo = geo; }
      e.obj.position.set(p.x, p.z || 0, p.y); e.obj.rotation.y = -p.a;
      e.obj.scale.set(1, 1 - 0.3 * (p.cf || 0), 1);
      e.obj.visible = !((p.own || (this.fpsNow && g.me && p.id === g.me.id)) && this.hideOwn);
      e.shield.visible = !!(p.fl & 32);
      if ((g.muzzle.get(p.id) || 0) > now) this.muzzle(p.x + Math.cos(p.a) * (KIND_TIP[kind] || 20), 15, p.y + Math.sin(p.a) * (KIND_TIP[kind] || 20));
    }
    P.soldiers.sweep();
    // corpses
    for (const c of g.corpses) {
      if (!this.near(c.x, c.y)) continue;
      const e = P.corpses.get(c.id);
      const cteam = g.pt(c.team), ck = `${cteam}|${c.cls || 'assault'}`;
      if (assets.soldier) {
        if (e.rigKey !== ck) { if (e.rig) e.obj.remove(e.rig.root); e.rig = makeSoldier(cteam, c.cls || 'assault'); e.rigKey = ck; if (e.rig) { e.rig.root.rotation.x = -Math.PI / 2; e.rig.root.position.y = 4; e.obj.add(e.rig.root); } }
        e.vox.visible = !e.rig;
        if (e.rig && e.rig.legL) { e.rig.legL.rotation.z = 0.25; e.rig.legR.rotation.z = -0.15; }
      } else e.vox.visible = true;
      const geo = soldierGeo(cteam, c.cls || 'assault', 'rifle', 0, true);
      if (e.geo !== geo) { e.vox.geometry = geo; e.geo = geo; }
      e.obj.position.set(c.x, this.map.heightAt(c.x, c.y), c.y); e.obj.rotation.y = -(c.a + 0.5);
    }
    P.corpses.sweep();
    this.updateVehicles(now);
    this.updateObjectives(t);
    this.updateGadgets(t);
    // grenades and projectiles
    for (const n of g.ents.g || []) {
      const [id, type, x, y] = n;
      if (!this.near(x, y)) continue;
      const e = P.grenades.get(id);
      const kind = GREN_ORDER[type];
      if (e.kind !== kind) { e.obj.geometry = grenadeGeo(kind); e.kind = kind; }
      e.obj.position.set(x, n[5] ?? this.map.heightAt(x, y) + 4, y); e.obj.rotation.y = t * 6; e.obj.rotation.x = t * 9;
    }
    P.grenades.sweep();
    for (const q of g.projectilesDrawn()) {
      if (!this.near(q.x, q.y)) continue;
      const pr = PROJ[PROJ_LIST[q.idx]];
      const e = P.projectiles.get(q.id);
      const geo = propGeo(pr && pr.speed > 1000 ? 'shell' : 'rocket');
      if (e.obj.geometry !== geo) e.obj.geometry = geo;
      e.obj.position.set(q.x, q.z, q.y); e.obj.rotation.y = -q.a; e.obj.rotation.z = q.pitch;
      if (Math.random() < 0.6) g.fx.smokeTrail(q.x - Math.cos(q.a) * 8, q.y - Math.sin(q.a) * 8, q.z);
    }
    P.projectiles.sweep();
    // revive markers
    let i = 0;
    for (const c of g.ents.cp || []) {
      const [, x, y] = c;
      if (!this.near(x, y)) continue;
      const e = P.revive.get(i++);
      e.obj.position.set(x, this.map.heightAt(x, y), y); e.obj.rotation.y = t * 1.5;
      e.mat.opacity = 0.55 + 0.35 * Math.sin(t * 6);
    }
    P.revive.sweep();
    // fires (molotov)
    i = 0;
    for (const f of g.ents.fi || []) {
      const [, x, y, r, age] = f;
      if (!this.near(x, y)) continue;
      const e = P.fires.get(i++);
      const fade = clamp((7 - age) / 1.2, 0, 1) * clamp(age / 0.2, 0, 1);
      this.drape(e.obj, x, y, r * .95);
      e.obj.position.x = x; e.obj.position.y = this.map.heightAt(x, y) + 1.2; e.obj.position.z = y; e.obj.scale.set(r * 0.95, 1, r * 0.95);
      e.obj.material.opacity = 0.36 * fade;
      if (fade > 0.3) g.fx.flames(x, y, r * 0.85);
    }
    P.fires.sweep();
    this.updateSmoke(t);
    // muzzle flashes were queued during this frame
    this.flushMuzzles();
    void viewer;
  }

  muzzle(x, y, z) { this.muzzles.push(x, y, z); }

  flushMuzzles() {
    const list = this.muzzles, fx3 = this.fx3d;
    let n = 0;
    for (let i = 0; i < list.length; i += 3) {
      let s = this.muzzleSprites && this.muzzleSprites[n];
      if (!s) {
        s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fx3.glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffd27a }));
        s.renderOrder = 5; this.scene.add(s);
        (this.muzzleSprites || (this.muzzleSprites = [])).push(s);
      }
      s.visible = true; s.position.set(list[i], list[i + 1], list[i + 2]); s.scale.set(30, 30, 1);
      n++;
    }
    if (this.muzzleSprites) for (let i = n; i < this.muzzleSprites.length; i++) this.muzzleSprites[i].visible = false;
    list.length = 0;
  }

  // ------------------------------------------------------------------ vehicles
  buildVehicle(e, def, team) {
    const grp = e.obj;
    while (grp.children.length) grp.remove(grp.children[0]);
    e.parts = {};
    e.pose = null;
    e.glb = null;
    const mv = assets.vehicles[def.id] ? makeVehicle(def.id, team) : null;
    if (mv) {
      e.glb = mv;
      for (const [n, node] of Object.entries(mv.parts)) { grp.add(node); e.parts[n] = node; }
      e.key = `${def.id}${team}g`;
      return;
    }
    const add = (part) => { const m = new THREE.Mesh(vehicleGeo(def.id, team, part), VOXEL_MAT); m.castShadow = true; grp.add(m); e.parts[part] = m; return m; };
    add('body');
    if (def.id === 'tank' || def.id === 'apc') { add('turret'); add('gun'); }
    else if (def.id === 'jeep' || def.id === 'boat') add('gun');
    else if (def.id === 'heli') { add('rotor'); add('gun'); }
    if (def.open) {
      const c = TEAM_PAL[team] || TEAM_PAL[2];
      const hat = new THREE.Mesh(propGeo('hat'), new THREE.MeshLambertMaterial({ vertexColors: true })); hat.castShadow = true; grp.add(hat); e.parts.hat = hat; void c;
    }
    e.key = `${def.id}${team}`;
    for (const m of Object.values(e.parts)) m.matrixAutoUpdate = true;
  }

  updateVehicles(now) {
    const g = this.game, P = this.pools;
    for (const v of g.vehiclesDrawn()) {
      const def = VEHICLES[VEHICLE_LIST[v.ty]];
      if (!def || !this.near(v.x, v.y)) continue;
      const team = g.pt(v.team);
      const e = P.vehicles.get(v.id);
      if (e.key !== `${def.id}${team}${assets.vehicles[def.id] ? 'g' : ''}`) this.buildVehicle(e, def, team);
      const ownFirst = v.id === g.me?.veh?.id && this.vehicleFirst;
      const gunnerFirst = ownFirst && g.me.veh.seat > 0 && !!def.seats[g.me.veh.seat].weapon;
      e.obj.visible = !ownFirst || gunnerFirst;
      const pr = e.parts;
      const gunnerZoom = gunnerFirst && g.input.right && g.playing();
      for (const [name, part] of Object.entries(pr)) part.visible = !ownFirst || (gunnerFirst && name === 'gun' && !gunnerZoom && !!e.glb);
      for (const shield of e.glb?.viewOccluders || []) shield.visible = !gunnerFirst;
      const M = e.glb ? e.glb.mount : null;
      const t = this.t;
      const bob = def.kind === 'boat' ? Math.sin(t * 2.2 + v.id) * 1.4 : 0;
      const k = M ? 1 : (VOX_K[def.id] || 1);
      const top = (TOP[def.id] || 0) * k;
      const x = v.x, z = v.y, a = v.a;
      const dt = e.pose ? clamp((now - e.pose.time) / 1000, .001, .05) : 1 / 60;
      const pose = e.pose || (e.pose = { x, z, time: now, speed: 0, travel: 0, pitch: 0, roll: 0, height: 0 });
      const vx = (x - pose.x) / dt, vy = (z - pose.z) / dt;
      const forwardSpeed = vx * Math.cos(a) + vy * Math.sin(a), sideSpeed = -vx * Math.sin(a) + vy * Math.cos(a);
      const acceleration = clamp((forwardSpeed - pose.speed) / dt, -300, 300);
      pose.travel += clamp(forwardSpeed, -def.maxSpeed, def.maxSpeed) * dt;
      let pitchTarget = 0, rollTarget = 0;
      if (def.kind === 'air') {
        pitchTarget = clamp(-forwardSpeed / 1600, -.14, .14); rollTarget = clamp(sideSpeed / 1100, -.17, .17);
      } else if (def.kind !== 'boat') {
        const f = def.size[0] * .32, r = def.size[1] * .35;
        const height = (f, r) => this.map.heightAt(x + Math.cos(a) * f - Math.sin(a) * r, z + Math.sin(a) * f + Math.cos(a) * r);
        pitchTarget = Math.atan2(height(f, 0) - height(-f, 0), 2 * f) + clamp(-acceleration / (def.kind === 'tracked' ? 12000 : 6500), -.04, .04);
        rollTarget = -Math.atan2(height(0, r) - height(0, -r), 2 * r) + clamp((v.yawRate || 0) * forwardSpeed / 8500, -.045, .045);
      }
      const settle = 1 - Math.exp(-(def.kind === 'tracked' ? 5 : 8) * dt);
      pose.pitch += (pitchTarget - pose.pitch) * settle; pose.roll += (rollTarget - pose.roll) * settle;
      pose.x = x; pose.z = z; pose.time = now; pose.speed += (forwardSpeed - pose.speed) * (1 - Math.exp(-12 * dt));
      e.obj.position.set(x, v.z || 0, z);
      // Tilt the complete assembly around the chassis, keeping turret and wheel mounts attached.
      e.obj.quaternion.setFromEuler(new THREE.Euler(pose.roll, -a, pose.pitch, 'YXZ'));
      e.obj.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a));
      // The local sight follows the simulation's mount; suspension tilt belongs
      // to the external chassis, rather than rolling a hidden hull's gun into view.
      if (gunnerFirst) e.obj.quaternion.identity();
      const set = (m, px, py, pz, ang) => { m.position.set(px - x, py, pz - z); m.rotation.y = -ang; if (!M) m.scale.setScalar(k); };
      // a point `f` ahead and `r` to the right of (x, z) for heading h
      const off = (h, f, r) => [x + Math.cos(h) * f - Math.sin(h) * r, z + Math.sin(h) * f + Math.cos(h) * r];
      if (def.id === 'heli') {
        const alt = Math.sin(t * 1.7 + v.id) * 1.2;
        set(pr.body, x, alt, z, a);
        pr.body.rotation.z = 0;
        if (pr.rotor) set(pr.rotor, x, alt + (M ? M.ry : 24 * k), z, t * 26);
        if (pr.gun) { if (M) { const [gx, gz] = off(a, M.gx, M.gz); set(pr.gun, gx, alt + M.gy, gz, v.ga); } else set(pr.gun, x + Math.cos(a) * 9 * k, alt - 2 * k, z + Math.sin(a) * 9 * k, v.ga); }
        if (v.hp < 55 && g.fx.shouldSmoke(v.id, now)) g.fx.damageSmoke(x, z, v.hp < 25, (v.z || 0) + alt + 12);
      } else {
        set(pr.body, x, bob, z, a);
        pr.body.rotation.set(0, -a, 0);
        if (def.id === 'tank') {
          if (pr.turret) { const [tx, tz] = M ? off(v.ta, M.tx, M.tz) : [x, z]; set(pr.turret, tx, M ? M.ty : top, tz, v.ta); }
          if (pr.gun) { if (M) { const [gx, gz] = off(v.ta, M.gx, M.gz); set(pr.gun, gx, M.gy, gz, v.ga); } else set(pr.gun, x - Math.cos(v.ta) * 6 * k, top + 15 * k, z - Math.sin(v.ta) * 6 * k, v.ga); }
        } else if (def.id === 'apc') {
          if (pr.turret) { const [tx, tz] = M ? off(v.ta, M.tx, M.tz) : [x, z]; set(pr.turret, tx, M ? M.ty : top, tz, v.ta); }
          if (pr.gun) { if (M) { const [gx, gz] = off(a, M.gx, M.gz); set(pr.gun, gx, M.gy, gz, v.ga); } else set(pr.gun, x - Math.cos(a) * 12 * k, top + 12 * k, z - Math.sin(a) * 12 * k, v.ga); }
        } else if ((def.id === 'jeep' || def.id === 'boat') && pr.gun) {
          if (M) { const [gx, gz] = off(a, M.gx, M.gz); set(pr.gun, gx, M.gy + bob, gz, v.ga); } else set(pr.gun, x - Math.cos(a) * 9 * k, top + bob, z - Math.sin(a) * 9 * k, v.ga);
        }
        if (pr.hat) set(pr.hat, x - Math.cos(a) * 3 * k, 17 * k, z - Math.sin(a) * 3 * k, a);
        if (v.hp < 55 && g.fx.shouldSmoke(v.id, now)) g.fx.damageSmoke(x, z, v.hp < 25, (v.z || 0) + 14);
      }
      if (M && e.glb.wheels) for (const w of e.glb.wheels) {
        const mesh = pr[w.name], [wx, wz] = off(a, w.x, w.z);
        const steered = w.front ? (v.steer || 0) * (def.steerAngle || .5) / (1 + Math.pow((v.speed || 0) / def.maxSpeed, 2) * 2.5) : 0;
        set(mesh, wx, w.y, wz, a + steered);
        mesh.rotation.z = -pose.travel / w.radius + (def.kind === 'tracked' ? a * w.z / w.radius : 0);
      }
      const local = v.id === g.me?.veh?.id;
      const shotPose = (seat, angle) => local && g.me.veh.seat === seat ? vehicleShot({ ...v, def }, seat, angle, g.aimDist, g.aimHeight, this.vehicleAim) : { pitch: seat === 0 ? v.pitch0 : v.pitch1, yaw: angle };
      if (pr.cannon && M) {
        const [cx, cz] = off(v.ta, M.cx, M.cz), shot = shotPose(0, v.ta);
        set(pr.cannon, cx, M.cy + bob, cz, shot.yaw); pr.cannon.rotation.z = shot.pitch;
      }
      if (pr.gun) {
        const shot = shotPose(1, v.ga);
        pr.gun.rotation.z = shot.pitch; pr.gun.rotation.y = -shot.yaw;
        if (M && def.id !== 'heli') {
          // The HMG's bore is .27 m above its pintle. Rotate around the bore
          // used by vehicleShot, so elevating it cannot lift the barrel across
          // the sight or separate the rendered muzzle from the bullet origin.
          const bore = .27 * e.glb.scale;
          pr.gun.position.x += Math.sin(shot.pitch) * bore * Math.cos(shot.yaw);
          pr.gun.position.y += (1 - Math.cos(shot.pitch)) * bore;
          pr.gun.position.z += Math.sin(shot.pitch) * bore * Math.sin(shot.yaw);
        }
      }
    }
    P.vehicles.sweep();
  }

  // ------------------------------------------------------------------ flags, M-COMs, gadgets, smoke
  // Drape range markers over the same surface as collision. Cached for stationary objectives.
  drape(obj, x, y, radius, angle = 0) {
    const geo = obj.geometry, key = `${x},${y},${radius},${angle}`;
    if (geo.userData.drapeKey === key) return;
    const attr = geo.attributes.position;
    const original = geo.userData.original || (geo.userData.original = attr.array.slice());
    const c = Math.cos(angle), s = Math.sin(angle), base = this.map.heightAt(x, y);
    for (let i = 0; i < attr.count; i++) {
      const lx = original[i * 3] * radius, ly = original[i * 3 + 2] * radius;
      attr.setY(i, this.map.heightAt(x + lx * c - ly * s, y + lx * s + ly * c) - base);
    }
    attr.needsUpdate = true; geo.computeBoundingSphere(); geo.userData.drapeKey = key;
  }

  updateObjectives(t) {
    const g = this.game, P = this.pools;
    const COL = { 0: 0xe0523a, 1: 0x3f86e8, '-1': 0xd8dce0 };
    for (const f of g.flagList()) {
      if (!this.near(f.x, f.y)) continue;
      const e = P.flags.get(f.id);
      const base = this.map.heightAt(f.x, f.y);
      e.obj.position.set(f.x, base, f.y);
      const prog = f.owner >= 0 ? 1 : Math.abs(f.cap);
      const capCol = COL[g.pt(f.cap < 0 ? 0 : 1)];
      const col = f.owner >= 0 ? COL[g.pt(f.owner)] : (prog > 0.05 ? capCol : COL['-1']);
      e.banner.material.color.setHex(col);
      e.banner.position.set(15, 14 + prog * 34, 0);
      e.banner.rotation.y = Math.sin(t * 3 + f.id) * 0.25;
      const zc = f.owner >= 0 ? COL[g.pt(f.owner)] : COL['-1'];
      this.drape(e.zone, f.x, f.y, f.r); this.drape(e.rim, f.x, f.y, f.r);
      e.zone.position.set(f.x, base + 1.2, f.y); e.zone.scale.set(f.r, 1, f.r); e.zone.material.color.setHex(zc);
      e.rim.position.set(f.x, base + 1.4, f.y); e.rim.scale.set(f.r, 1, f.r); e.rim.material.color.setHex(zc);
      const key = Math.round(prog * 50) + (f.cap < 0 ? 100 : 0);
      if (prog > 0.01 && prog < 0.999) {
        if (e.arcKey !== key) {
          if (e.arc) { this.world.remove(e.arc); e.arc.geometry.dispose(); }
          e.arc = new THREE.Mesh(flatRing(0.9, 0.96, 64, -Math.PI / 2, -Math.PI * 2 * prog), new THREE.MeshBasicMaterial({ color: capCol, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
          e.arc.renderOrder = 2; this.world.add(e.arc); e.arcKey = key;
        }
        this.drape(e.arc, f.x, f.y, f.r);
        e.arc.position.set(f.x, base + 1.8, f.y); e.arc.scale.set(f.r, 1, f.r); e.arc.visible = true;
      } else if (e.arc) e.arc.visible = false;
    }
    P.flags.sweep();
    for (const m of g.mcomList()) {
      if (!this.near(m.x, m.y)) continue;
      const e = P.mcoms.get(m.id);
      e.obj.position.set(m.x, this.map.heightAt(m.x, m.y), m.y);
      if (e.state !== m.state) { e.body.geometry = propGeo(m.state === 2 ? 'mcomDead' : 'mcom'); e.state = m.state; }
      e.lamp.visible = m.state !== 2;
      const armed = m.state === 1;
      const blink = armed && Math.floor(t * (m.timer < 10 ? 8 : 3)) % 2 === 0;
      e.lamp.material.color.setHex(armed ? (blink ? 0xff3b2f : 0x661a14) : 0x5aa7ff);
      if (m.state === 2 && Math.random() < 0.15) g.fx.damageSmoke(m.x, m.y, true);
    }
    P.mcoms.sweep();
  }

  updateGadgets(t) {
    const g = this.game, P = this.pools;
    for (const d of g.ents.gd || []) {
      const [id, gi, x, y, a, team, armed] = d;
      const def = GADGET_LIST[gi];
      if (!def || !this.near(x, y)) continue;
      const e = P.gadgets.get(id);
      if (e.id !== def.id) {
        e.id = def.id; e.m.geometry = propGeo(['medkit', 'ammo', 'mine', 'claymore', 'c4', 'beacon', 'sensor'].includes(def.id) ? def.id : 'gadget');
        const ringCol = def.id === 'medkit' ? 0x5aff96 : def.id === 'ammo' ? 0xffdc6e : def.id === 'sensor' ? (g.pt(team) === 0 ? 0xff7864 : 0x78aaff) : 0;
        e.ring.visible = !!ringCol; if (ringCol) e.ring.material.color.setHex(ringCol);
        e.cone.visible = def.id === 'claymore'; e.cone.material.color.setHex(g.pt(team) === 0 ? 0xff7864 : 0x78aaff);
      }
      const base = d[8] ?? this.map.heightAt(x, y);
      e.obj.position.set(x, base, y); e.obj.rotation.y = -a;
      e.ring.position.x = x; e.ring.position.y = base + 1.6; e.ring.position.z = y;
      const rad = def.id === 'sensor' ? 340 : def.radius || 110;
      this.drape(e.ring, x, y, rad); this.drape(e.cone, x, y, 1, a);
      e.ring.scale.set(rad, 1, rad);
      e.cone.position.x = x; e.cone.position.y = base + 1.5; e.cone.position.z = y; e.cone.rotation.y = -a;
      void armed; void t;
    }
    P.gadgets.sweep();
  }

  updateSmoke(t) {
    const g = this.game;
    const D = this._d || (this._d = new THREE.Object3D()), C = this._c || (this._c = new THREE.Color());
    let n = 0;
    for (const s of g.ents.sm || []) {
      const [id, x, y, r, age] = s;
      if (!this.near(x, y)) continue;
      const fade = age > 16 ? clamp((18 - age) / 2, 0, 1) : 1;
      const grow = clamp(age / 1.2, 0.25, 1);
      for (let i = 0; i < 26 && n < 900; i++) {
        const h = Math.sin(id * 12.9898 + i * 78.233) * 43758.5453, q = h - Math.floor(h);
        const h2 = Math.sin(id * 4.1414 + i * 37.719) * 12345.678, q2 = h2 - Math.floor(h2);
        const ang = q * Math.PI * 2 + t * (0.1 + q2 * 0.15) * (i % 2 ? 1 : -1);
        const d = Math.sqrt(q2) * r * 0.7 * grow;
        const size = r * (0.3 + q * 0.2) * grow * 2.4;
        D.position.set(x + Math.cos(ang) * d, this.map.heightAt(x, y) + size * 0.5 + (i % 4) * 9 + 2, y + Math.sin(ang) * d);
        D.quaternion.copy(this.camera.quaternion); D.rotateZ(q * 6 + t * 0.06); D.scale.set(size, size, 1); D.updateMatrix();
        this.smoke.setMatrixAt(n, D.matrix);
        const shade = (176 + q2 * 44) / 255; C.setRGB(shade, shade, shade + 0.03, THREE.SRGBColorSpace);
        this.smoke.setColorAt(n, C);
        this.smoke.geometry.attributes.particleOpacity.setX(n, fade);
        n++;
      }
    }
    finishCloud(this.smoke, n);
  }
}
export { SPEC };
