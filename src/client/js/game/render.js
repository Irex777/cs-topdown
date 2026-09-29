// The 3D renderer: a chase camera behind the player, voxel terrain and units built from cubes, real shadows. The 2D canvas
// above it (overlay.js) carries the name tags, markers and crosshair. World axes: x, z = map x, y; y = up.
import * as THREE from '../../vendor/three/three.module.js';
import { SPEC, GREN_ORDER, TILE } from '../../shared/constants.js';
import { WEAPON_LIST, HELD_GREN_BASE, HELD_GADGET_BASE, GADGET_LIST, PROJ } from '../../shared/weapons.js';
import { VEHICLES, VEHICLE_LIST } from '../../shared/vehicles.js';
import { TEAM_PAL } from './voxel.js';
import { soldierGeo, vehicleGeo, propGeo, grenadeGeo, VOXEL_MAT } from './models3d.js';
import { BlockField, Ground, tileHeight } from './world3d.js';
import { FX3D } from './fx3d.js';
import { Overlay } from './overlay.js';
import { Viewmodel } from './viewmodel.js';

export { TEAM_COL } from './overlay.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const PROJ_LIST = Object.keys(PROJ);
const KIND_TIP = { pistol: 14, smg: 20, rifle: 26, dmr: 26, lmg: 28, sniper: 32, shotgun: 24, knife: 16, launcher: 24, tool: 16, grenade: 12 };
const AIR_ALT = 44;
const TOP = { jeep: 21, apc: 21, tank: 15, boat: 18 };
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
const UNIT_DISC = (() => { const g = new THREE.CircleGeometry(1, 48); g.rotateX(-Math.PI / 2); return g; })();
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
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = SKY;
    this.scene.fog = new THREE.Fog(SKY, 650, 2300);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 3, 4200);
    this.scene.add(this.camera);

    this.hemi = new THREE.HemisphereLight(0xdcecff, 0x8a8570, 1.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
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
      const obj = mesh(soldierGeo(0, 'assault', 'rifle', 0));
      const shield = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.28, depthWrite: false }));
      shield.scale.set(20, 34, 20); shield.position.y = 17; shield.visible = false; obj.add(shield);
      return { obj, shield, geo: null };
    });
    this.pools.corpses = new Pool(W, () => ({ obj: mesh(soldierGeo(0, 'assault', 'rifle', 0, true)), geo: null }));
    this.pools.vehicles = new Pool(W, (id) => ({ obj: new THREE.Group(), id, key: '', parts: {} , dispose() { /* geometry is shared */ } }));
    this.pools.flags = new Pool(W, () => {
      const obj = new THREE.Group();
      obj.add(mesh(propGeo('flagBase')));
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(26, 15), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, color: 0xffffff }));
      banner.castShadow = true; obj.add(banner);
      const zone = new THREE.Mesh(UNIT_DISC, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.1, depthWrite: false })); zone.renderOrder = 1; zone.position.y = 1.2;
      const rim = new THREE.Mesh(UNIT_RING, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75, depthWrite: false })); rim.renderOrder = 1; rim.position.y = 1.4;
      W.add(zone, rim);
      return { obj, banner, zone, rim, arc: null, arcKey: -1, dispose() { W.remove(zone, rim); if (this.arc) { W.remove(this.arc); this.arc.geometry.dispose(); } } };
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
      const ring = new THREE.Mesh(UNIT_RING, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false })); ring.position.y = 1.6; ring.renderOrder = 1; ring.visible = false; W.add(ring);
      const cone = new THREE.Mesh(new THREE.CircleGeometry(150, 20, -0.75, 1.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide })); cone.position.y = 1.5; cone.visible = false; W.add(cone);
      return { obj, m, ring, cone, id: '', dispose() { W.remove(ring, cone); } };
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
      const obj = new THREE.Mesh(UNIT_DISC, new THREE.MeshBasicMaterial({ color: 0xff7a1e, transparent: true, opacity: 0.35, depthWrite: false }));
      obj.renderOrder = 1; obj.position.y = 1.6;
      return { obj };
    });
    this.smoke = new THREE.InstancedMesh(BOX, new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.92 }), 900);
    this.smoke.frustumCulled = false; this.smoke.count = 0; this.smoke.setColorAt(0, new THREE.Color(1, 1, 1));
    W.add(this.smoke);
    this.muzzles = [];
  }

  // ------------------------------------------------------------------ setup
  setMap(map, terrain) {
    this.map = map; this.terrain = terrain;
    if (this.ground) this.ground.dispose();
    if (this.blocks) { this.scene.remove(this.blocks.group); }
    for (const p of Object.values(this.pools)) p.clear();
    this.ground = new Ground(this.scene, terrain, this.game.fx);
    this.blocks = new BlockField(this.scene, map, terrain);
    map.onChange((tx, ty, old, ch) => this.blocks.tileChanged(tx, ty, old, ch));
    if (!this.fx3d) this.fx3d = new FX3D(this.scene, this.game.fx);
    // sky and haze follow the map's mood
    const th = terrain.th.c;
    this.void.material.color.setRGB(th.rock[0] / 700, th.rock[1] / 700, th.rock[2] / 700, THREE.SRGBColorSpace);
    this.camT = 1;
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.canvas.width = Math.floor(this.W * this.dpr); this.canvas.height = Math.floor(this.H * this.dpr);
    this.canvas.style.width = this.W + 'px'; this.canvas.style.height = this.H + 'px';
    this.renderer.setPixelRatio(Math.min(this.dpr, 1.5));
    this.renderer.setSize(this.W, this.H, false);
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
    let t = d.y < -0.02 ? -o.y / d.y : 2200;
    t = Math.min(t, 3200);
    return { x: o.x + d.x * t, y: o.z + d.z * t };
  }

  worldToScreen(x, y) { const p = this.project(x, y, 0, true); return { x: p.x, y: p.y }; }

  // ------------------------------------------------------------------ camera
  camParams(viewer) {
    const g = this.game, me = g.me;
    if (g.freecam) return { D: 0, H: g.camH || 240, ahead: 300, fov: FOV, hideOwn: false };
    if (!viewer) return { D: 0, H: 320, ahead: 300, fov: FOV, hideOwn: false };
    if (me && me.veh) {
      const def = g.vehDef();
      if (def && def.kind === 'air') return { D: 250, H: 56, ahead: 520, fov: FOV, hideOwn: false };
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
      const h = tileHeight(map.chars[ty * map.w + tx]);
      if (h > 0 && y < h + 4) return Math.max(0.1, (i - 1.6) / n);
    }
    return 1;
  }

  /** first person: on foot (yours, or the soldier you are spectating); vehicles, the death view and the free camera use the chase camera */
  isFps(viewer) {
    const g = this.game, me = g.me;
    if (g.freecam || !viewer || !me || me.veh) return false;
    if (g.alive && me.own) return true;
    return !g.alive && !!g.spec && me.id === g.spec && !me.own;
  }

  updateCameraFps(dt, viewer) {
    const g = this.game, cam = this.camera, me = g.me;
    const own = !!me.own;
    const yaw = own ? g.viewYaw() : g.yaw;
    const pitch = own ? g.viewPitch() : g.pitch;
    this.yaw = yaw;
    // aiming zoom
    const scoped = !!(viewer.scoped && g.alive) || (!own && !!(me.sc));
    this.scopeK += ((scoped ? 1 : 0) - this.scopeK) * (1 - Math.exp(-(viewer.scopeLvl >= 2 ? 8 : 12) * dt));
    const aspect = Math.max(1.2, this.W / this.H);
    const hFov = Math.min(g.fov, 118) * Math.PI / 180;
    const sprintK = own && me.spr ? 1 : 0;
    this.sprintFov = (this.sprintFov || 0) + (sprintK - (this.sprintFov || 0)) * (1 - Math.exp(-6 * dt));
    let tanHalf = Math.tan(hFov / 2) / aspect * (1 + 0.06 * this.sprintFov);
    tanHalf *= 1 + (g.zoomMul(viewer.scopeLvl) - 1) * this.scopeK;
    const vfov = 2 * Math.atan(tanHalf) * 180 / Math.PI;
    if (Math.abs(cam.fov - vfov) > 0.01 || cam.near !== 1.4) { cam.fov = vfov; cam.near = 1.4; cam.updateProjectionMatrix(); }
    // eye position: crouching lowers it, walking bobs it, landing dips it
    const speed = own ? Math.hypot(g.pred.vx, g.pred.vy) : Math.hypot(me.vx || 0, me.vy || 0);
    const air = own ? Math.abs(g.pred.vz) > 1 : Math.abs(me.vz || 0) > 1;
    const moving = Math.min(1.6, speed / 92) * (air ? 0 : 1);
    this.bobT += dt * (3 + moving * 5.5);
    const ads = this.scopeK;
    const bobA = moving * (sprintK ? 1.5 : viewer.cf > 0.5 ? 0.5 : 1) * (1 - ads * 0.85);
    g.landDip *= Math.exp(-9 * dt);
    let eye = viewer.eye + Math.abs(Math.cos(this.bobT)) * -0.55 * bobA - g.landDip * 3.2;
    if (this.eyeSmooth === null || Math.abs(eye - this.eyeSmooth) > 30) this.eyeSmooth = eye;
    this.eyeSmooth += (eye - this.eyeSmooth) * (1 - Math.exp(-22 * dt));   // stepping onto cover glides instead of snapping
    eye = this.eyeSmooth;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const side = Math.sin(this.bobT) * 0.32 * bobA;
    const sh = g.fx.shake;
    const px = viewer.x - sy * side + g.fx.shakeX * 0.35, pz = viewer.y + cy * side + g.fx.shakeY * 0.35;
    cam.position.set(px, eye + g.fx.shakeY * 0.25, pz);
    const cp = Math.cos(pitch);
    cam.lookAt(px + cy * cp, cam.position.y + Math.sin(pitch), pz + sy * cp);
    // lean into strafing, wobble with explosions
    const rx = -sy, ry = cy;
    const strafe = own ? (g.pred.vx * rx + g.pred.vy * ry) / 92 : 0;
    this.leanRoll = (this.leanRoll || 0) + ((clamp(strafe, -1, 1) * 0.012 + g.fx.shakeX * 0.002) - (this.leanRoll || 0)) * (1 - Math.exp(-10 * dt));
    cam.rotateZ(this.leanRoll + Math.sin(this.bobT) * 0.0035 * bobA);
    cam.updateMatrixWorld();
    this.focal = this.H / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    this.pivot = { x: viewer.x, y: viewer.y, h: eye };
    this.camDist = 0; this.hideOwn = true;
    this.cam.x = viewer.x; this.cam.y = viewer.y;
    this.aimGround = this.screenToWorld(this.W / 2, this.H / 2);
    const tx = viewer.x + cy * 260, tz = viewer.y + sy * 260;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx + this.sunDir.x * 1200, this.sunDir.y * 1200, tz + this.sunDir.z * 1200);
    this.sun.target.updateMatrixWorld();
    this.fpsCtx = { speed, air, strafe, sh };
  }

  updateCamera(dt, viewer) {
    const g = this.game, cam = this.camera;
    this.fpsNow = this.isFps(viewer);
    if (this.fpsNow) { this.updateCameraFps(dt, viewer); return; }
    if (cam.near !== 3) { cam.near = 3; cam.updateProjectionMatrix(); }
    const P = this.camParams(viewer);
    const scoped = !!(viewer && viewer.scoped && g.alive);
    this.scopeK += ((scoped ? 1 : 0) - this.scopeK) * (1 - Math.exp(-12 * dt));
    this.fovNow += (P.fov - this.fovNow) * (1 - Math.exp(-14 * dt));
    let px, py;
    if (g.freecam) { px = g.cam.x; py = g.cam.y; }
    else if (viewer) { px = viewer.x; py = viewer.y; }
    else { px = this.map.width / 2; py = this.map.height / 2; }
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
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx + this.sunDir.x * 1200, this.sunDir.y * 1200, tz + this.sunDir.z * 1200);
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
    this.fx3d.update();
    this.renderer.autoClear = true;
    if (this.debugVm) { this.renderer.setClearColor(0x6d8fb3); this.renderer.clear(); } else this.renderer.render(this.scene, this.camera);
    this.drawViewmodel(dt, viewer);
    this.overlay.draw(this.ctx, viewer, dt);
  }

  drawViewmodel(dt, viewer) {
    const g = this.game, me = g.me, vm = this.viewmodel;
    if (!this.fpsNow || !me || me.veh || !viewer) { vm.visible = false; return; }
    const own = !!me.own;
    if (!vm.flash.material.map && this.fx3d) { vm.flash.material.map = this.fx3d.glowTex; vm.flash.material.needsUpdate = true; }
    const held = me.held;
    const kind = weaponKindOf(held);
    const weapon = own ? g.heldWeapon(me) : WEAPON_LIST[held];
    const fc = this.fpsCtx || {};
    const edge = own && g.input.left && !this._prevLeft;
    this._prevLeft = own && g.input.left;
    const zoomed = !!(viewer.scoped && (viewer.scopeLvl || 0) >= 1 && this.scopeK > 0.55);
    vm.render(dt, {
      fps: true, me, viewer, kind, weapon, team: g.myTeam() >= 0 && own ? g.myTeam() : (g.teamOf(me.id) >= 0 ? g.teamOf(me.id) : 2),
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
      const team = p.team >= 0 ? p.team : 2;
      const kind = weaponKindOf(p.held);
      const speed = p.speed || 0;
      const frame = speed > 35 ? (Math.floor(t * (speed > 240 ? 12 : 9) + p.id) % 2 === 0 ? 1 : 2) : 0;
      const geo = soldierGeo(team, p.cls || 'assault', kind, frame);
      if (e.geo !== geo) { e.obj.geometry = geo; e.geo = geo; }
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
      const geo = soldierGeo(c.team >= 0 ? c.team : 2, c.cls || 'assault', 'rifle', 0, true);
      if (e.geo !== geo) { e.obj.geometry = geo; e.geo = geo; }
      e.obj.position.set(c.x, 0, c.y); e.obj.rotation.y = -(c.a + 0.5);
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
      e.obj.position.set(x, 8 + Math.abs(Math.sin(t * 9 + id)) * 3, y); e.obj.rotation.y = t * 6;
    }
    P.grenades.sweep();
    for (const q of g.projectilesDrawn()) {
      if (!this.near(q.x, q.y)) continue;
      const pr = PROJ[PROJ_LIST[q.idx]];
      const e = P.projectiles.get(q.id);
      const geo = propGeo(pr && pr.speed > 1000 ? 'shell' : 'rocket');
      if (e.obj.geometry !== geo) e.obj.geometry = geo;
      e.obj.position.set(q.x, 17, q.y); e.obj.rotation.y = -q.a;
      if (Math.random() < 0.6) g.fx.smokeTrail(q.x - Math.cos(q.a) * 8, q.y - Math.sin(q.a) * 8, 16);
    }
    P.projectiles.sweep();
    // revive markers
    let i = 0;
    for (const c of g.ents.cp || []) {
      const [, x, y] = c;
      if (!this.near(x, y)) continue;
      const e = P.revive.get(i++);
      e.obj.position.set(x, 0, y); e.obj.rotation.y = t * 1.5;
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
      e.obj.position.x = x; e.obj.position.z = y; e.obj.scale.set(r * 0.95, 1, r * 0.95);
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
      const team = v.team >= 0 ? v.team : 2;
      const e = P.vehicles.get(v.id);
      if (e.key !== `${def.id}${team}`) this.buildVehicle(e, def, team);
      const pr = e.parts;
      const t = this.t;
      const bob = def.kind === 'boat' ? Math.sin(t * 2.2 + v.id) * 1.4 : 0;
      const top = TOP[def.id] || 0;
      const x = v.x, z = v.y, a = v.a;
      e.obj.position.set(0, 0, 0);
      const set = (m, px, py, pz, ang) => { m.position.set(px, py, pz); m.rotation.y = -ang; };
      if (def.id === 'heli') {
        const alt = AIR_ALT + Math.sin(t * 1.7 + v.id) * 1.5;
        set(pr.body, x, alt, z, a);
        pr.body.rotation.z = clamp((v.speed || 0) / 340, 0, 1) * -0.09;
        set(pr.rotor, x, alt + 24, z, t * 26);
        set(pr.gun, x + Math.cos(a) * 9, alt - 2, z + Math.sin(a) * 9, v.ga);
        if (v.hp < 55 && g.fx.shouldSmoke(v.id, now)) g.fx.damageSmoke(x, z, v.hp < 25, alt + 12);
      } else {
        set(pr.body, x, bob, z, a);
        if (def.id === 'tank') {
          set(pr.turret, x, top, z, v.ta);
          set(pr.gun, x - Math.cos(v.ta) * 6, top + 15, z - Math.sin(v.ta) * 6, v.ga);
        } else if (def.id === 'apc') {
          set(pr.turret, x, top, z, v.ta);
          set(pr.gun, x - Math.cos(a) * 12, top + 12, z - Math.sin(a) * 12, v.ga);
        } else if (def.id === 'jeep' || def.id === 'boat') set(pr.gun, x - Math.cos(a) * 9, top + bob, z - Math.sin(a) * 9, v.ga);
        if (pr.hat) set(pr.hat, x - Math.cos(a) * 3, 17, z - Math.sin(a) * 3, a);
        if (v.hp < 55 && g.fx.shouldSmoke(v.id, now)) g.fx.damageSmoke(x, z, v.hp < 25);
      }
    }
    P.vehicles.sweep();
  }

  // ------------------------------------------------------------------ flags, M-COMs, gadgets, smoke
  updateObjectives(t) {
    const g = this.game, P = this.pools;
    const COL = { 0: 0xe0523a, 1: 0x3f86e8, '-1': 0xd8dce0 };
    for (const f of g.flagList()) {
      if (!this.near(f.x, f.y)) continue;
      const e = P.flags.get(f.id);
      e.obj.position.set(f.x, 0, f.y);
      const prog = f.owner >= 0 ? 1 : Math.abs(f.cap);
      const col = f.owner >= 0 ? COL[f.owner] : (prog > 0.05 ? (f.cap < 0 ? COL[0] : COL[1]) : COL['-1']);
      e.banner.material.color.setHex(col);
      e.banner.position.set(15, 14 + prog * 34, 0);
      e.banner.rotation.y = Math.sin(t * 3 + f.id) * 0.25;
      const zc = f.owner >= 0 ? COL[f.owner] : COL['-1'];
      e.zone.position.set(f.x, 1.2, f.y); e.zone.scale.set(f.r, 1, f.r); e.zone.material.color.setHex(zc);
      e.rim.position.set(f.x, 1.4, f.y); e.rim.scale.set(f.r, 1, f.r); e.rim.material.color.setHex(zc);
      const key = Math.round(prog * 50) + (f.cap < 0 ? 100 : 0);
      if (prog > 0.01 && prog < 0.999) {
        if (e.arcKey !== key) {
          if (e.arc) { this.world.remove(e.arc); e.arc.geometry.dispose(); }
          e.arc = new THREE.Mesh(flatRing(0.9, 0.96, 64, -Math.PI / 2, -Math.PI * 2 * prog), new THREE.MeshBasicMaterial({ color: f.cap < 0 ? COL[0] : COL[1], transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
          e.arc.renderOrder = 2; this.world.add(e.arc); e.arcKey = key;
        }
        e.arc.position.set(f.x, 1.8, f.y); e.arc.scale.set(f.r, 1, f.r); e.arc.visible = true;
      } else if (e.arc) e.arc.visible = false;
    }
    P.flags.sweep();
    for (const m of g.mcomList()) {
      if (!this.near(m.x, m.y)) continue;
      const e = P.mcoms.get(m.id);
      e.obj.position.set(m.x, 0, m.y);
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
        const ringCol = def.id === 'medkit' ? 0x5aff96 : def.id === 'ammo' ? 0xffdc6e : def.id === 'sensor' ? (team === 0 ? 0xff7864 : 0x78aaff) : 0;
        e.ring.visible = !!ringCol; if (ringCol) e.ring.material.color.setHex(ringCol);
        e.cone.visible = def.id === 'claymore'; e.cone.material.color.setHex(team === 0 ? 0xff7864 : 0x78aaff);
      }
      e.obj.position.set(x, 0, y); e.obj.rotation.y = -a;
      e.ring.position.x = x; e.ring.position.z = y;
      const rad = def.id === 'sensor' ? 340 : def.radius || 110;
      e.ring.scale.set(rad, 1, rad);
      e.cone.position.x = x; e.cone.position.z = y; e.cone.rotation.y = -a;
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
        const size = r * (0.3 + q * 0.2) * fade * grow * 1.4;
        D.position.set(x + Math.cos(ang) * d, size * 0.5 + (i % 4) * 9 + 2, y + Math.sin(ang) * d);
        D.rotation.set(0, q * 3 + t * 0.1, 0); D.scale.setScalar(size); D.updateMatrix();
        this.smoke.setMatrixAt(n, D.matrix);
        const shade = (176 + q2 * 44) / 255; C.setRGB(shade, shade, shade + 0.03, THREE.SRGBColorSpace);
        this.smoke.setColorAt(n, C);
        n++;
      }
    }
    this.smoke.count = n;
    this.smoke.instanceMatrix.needsUpdate = true;
    if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true;
  }
}
export { SPEC };
