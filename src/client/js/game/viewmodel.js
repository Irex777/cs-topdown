// First-person weapon view: the gun and arms drawn in their own scene on top of the world (own camera and depth buffer, so
// they never poke into walls). Procedural voxel guns per weapon kind with the equipped attachments, and the animation state:
// walk bob, sprint pose, aim down sights, recoil kick, reload, weapon switch, mouse sway, knife swing.
import * as THREE from '../../vendor/three/three.module.js';
import { VoxelModel } from './voxel.js';
import { voxelGeometry, VOXEL_MAT } from './models3d.js';
import { TEAM_PAL } from './voxel.js';

const U = 0.0115;                 // view-model units per voxel
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------------------------------------ gun models
// Model space: x forward, y right, z up (voxels). The sight line is z = 5..7; `meta` gives the muzzle, grip and fore-grip.
const BODY = '#565d68', METAL = '#7b838e', LIGHT = '#a3abb6', WOOD = '#a06a3e', MAG = '#444a54', DARK = '#3b4049';

function rifleParts(o) {
  const m = new VoxelModel(1);
  const long = o.long || 0;
  // stock (a separate model: hidden when aiming so it does not fill the view), receiver, rails
  const stock = new VoxelModel(1);
  stock.box(-17, -1, -1, -16, 2, 4, DARK).box(-16, -1, 0, -8, 2, 4, o.wood ? WOOD : BODY).box(-15, -1, 1, -8, 2, 3, o.wood ? '#8a6238' : '#525963');
  m.box(-8, -1, 0, 4, 2, 4, '#4b515b').box(-8, -1, 4, 6, 2, 5, '#5b626d').box(-2, 1, 1, 0, 2, 3, DARK);
  m.box(-6, -1, -4, -3, 2, 0, '#3a3f47').box(-3, 0, -1, 1, 1, 0, DARK);
  // handguard and barrel
  const hg = o.hg || 15;
  m.box(4, -1, 0, hg, 2, 4, o.wood ? WOOD : '#59606b').box(4, -1, 4, hg, 2, 5, '#5b626d');
  m.box(hg, 0, 1, hg + 8 + long, 1, 3, METAL).box(hg - 1, 0, 4, hg, 1, 7, METAL);
  // rear sight: a low notch block
  m.box(-7, -1, 5, -6, 2, 6, DARK);
  return { m, stock, muzzle: hg + 8 + long, hg };
}

function magFor(kind, ext) {
  const m = new VoxelModel(1);
  const n = ext ? 3 : 0;
  if (kind === 'smg') m.box(0, -1, -8 - n, 3, 2, 0, MAG).box(0, -1, -8 - n, 3, 2, -7 - n, '#59606b');
  else if (kind === 'lmg') m.box(-3, -2, -9, 6, 3, 0, '#3a4a2f').box(-3, -2, -9, 6, 3, -8, '#2c3a24');
  else if (kind === 'pistol') m.box(-4, -1, -7, -1, 2, 0, MAG);
  else if (kind === 'shotgun') return null;
  else if (kind === 'sniper') m.box(-1, -1, -5 - n, 2, 2, 0, MAG);
  else m.box(0, -1, -7 - n, 3, 2, 0, MAG).box(1, -1, -7 - n, 3, 2, -6 - n, '#525963');
  return m;
}

function build(kind, att, ext) {
  let stock = null, body, muzzle = 23, grip = [-4.5, 0.5, -2], fore = [9, 0.5, -1.5], ads = 7.5, sightX = -6.5, mag = null, ejection = [-1, 1.5, 3];
  if (kind === 'pistol') {
    body = new VoxelModel(1);
    body.box(-6, -1, 1, 9, 2, 5, '#59606b').box(-6, -1, 1, 9, 2, 2, '#3a3f47').box(-6, -1, -1, 6, 2, 1, '#4a505a').box(-7, -1, -6, -2, 2, 1, '#3a3f47').box(9, 0, 2, 11, 1, 4, METAL);
    body.box(-6, -1, 5, -5, 0, 6, DARK).box(-6, 1, 5, -5, 2, 6, DARK).box(8, 0, 5, 9, 1, 6, DARK).box(-3, 0, -1, 1, 1, 0, DARK);
    muzzle = 11; grip = [-4.5, 0.5, -3]; fore = [-3, 0.5, -3.5]; ads = 6; sightX = -5.5; ejection = [1, 1.5, 4];
  } else if (kind === 'knife') {
    body = new VoxelModel(1);
    body.box(-7, -1, -1, 0, 1, 2, '#525963').box(0, -1, -2, 1, 1, 4, LIGHT).box(1, 0, -1, 15, 1, 3, '#cfd5dc').box(15, 0, 0, 18, 1, 2, '#cfd5dc').box(1, 0, 2, 12, 1, 3, '#e6ebf0');
    muzzle = 18; grip = [-3, 0, 0.5]; fore = [-3, 0, 0.5]; ads = 4;
  } else if (kind === 'grenade') {
    body = new VoxelModel(1);
    body.box(-3, -2, -3, 3, 3, 4, '#4a6b3a').box(-2, -1, 4, 2, 2, 5, '#3a3d45').box(-1, 2, 1, 1, 3, 5, '#9aa0a8').box(-1, -1, 5, 0, 2, 6, '#c9cdd2');
    grip = [0, 0.5, 0]; fore = [0, 0.5, 0]; muzzle = 0;
  } else if (kind === 'launcher') {
    body = new VoxelModel(1);
    body.box(-16, -2, -1, 24, 3, 4, '#55603f').box(-16, -3, -2, -12, 4, 5, '#3a4230').box(20, -3, -2, 27, 4, 5, '#3a4230').box(-4, -1, 4, 6, 2, 6, DARK).box(-6, -1, -6, -2, 2, 0, '#3a3f47').box(6, -1, -5, 9, 2, -1, '#3a3f47');
    muzzle = 27; grip = [-4, 0.5, -2]; fore = [7, 0.5, -1]; ads = 8;
  } else if (kind === 'tool') {
    body = new VoxelModel(1);
    body.box(-4, -3, -3, 8, 4, 3, '#e8ebee').box(-4, -3, 3, 8, 4, 4, '#c9cdd2').box(-1, -1, 4, 5, 2, 6, '#d0392b').box(8, -2, -2, 11, 3, 2, DARK).box(-6, -1, -8, -3, 2, -3, '#3a3f47');
    muzzle = 11; grip = [-4, 0.5, -3]; fore = [3, 0.5, -2]; ads = 5;
  } else {
    const o = { hg: 15, long: 0, wood: false };
    if (kind === 'smg') { o.hg = 10; o.long = -2; }
    if (kind === 'lmg') { o.hg = 18; o.long = 2; }
    if (kind === 'dmr') { o.hg = 17; o.long = 4; }
    if (kind === 'sniper') { o.hg = 18; o.long = 10; o.wood = false; }
    if (kind === 'shotgun') { o.hg = 14; o.long = 0; o.wood = true; }
    if (att && att.barrel === 'long') o.long += 5;
    const r = rifleParts(o);
    body = r.m; stock = r.stock; muzzle = r.muzzle; fore = [r.hg - 4, 0.5, -1.5];
    if (kind === 'lmg') {
      body.box(r.hg - 6, -2, 0, r.hg - 1, 3, 1, '#3a4a2f');
      body.box(r.hg + 1, -1, -6, r.hg + 2, 0, 0, METAL).box(r.hg + 1, 1, -6, r.hg + 2, 2, 0, METAL);    // bipod
    }
    if (kind === 'shotgun') {
      body.box(4, -1, -2, 13, 2, 0, WOOD).box(5, -1, -3, 12, 2, -2, '#5b3d24');                          // pump
      body.box(r.hg, 0, 3, r.hg + 8, 1, 4, METAL);                                                            // second tube
    }
    if (kind === 'sniper') body.box(-16, -1, 4, -8, 2, 6, '#59606b').box(r.hg + 4, -2, -6, r.hg + 5, 0, 0, METAL).box(r.hg + 4, 1, -6, r.hg + 5, 3, 0, METAL);
    // optics
    const opt = att ? att.optic : 'iron';
    if (opt === 'reddot') { sightX = -3; body.box(-3, -1, 5, 3, 2, 6, DARK).box(-3, -1, 6, -2, 0, 9, DARK).box(-3, 1, 6, -2, 2, 9, DARK).box(-3, -1, 9, 3, 2, 10, DARK).box(-3, -1, 5, 3, 2, 6, DARK); ads = 7.5; }
    else if (opt === 'holo') { sightX = -4; body.box(-4, -1, 5, 4, 2, 6, DARK).box(-4, -1, 6, -3, 2, 10, DARK).box(3, -1, 6, 4, 2, 10, DARK).box(-4, -1, 10, 4, 2, 11, DARK); ads = 8; }
    else if (opt === 'acog') { sightX = -5; body.box(-4, -1, 5, 6, 2, 9, '#3a3f47').box(6, -2, 5, 8, 3, 10, DARK).box(-6, -2, 5, -4, 3, 10, DARK); ads = 7.5; }
    else if (opt === 'scope8' || opt === 'scope12') {
      const L = opt === 'scope12' ? 16 : 11;
      sightX = -9;
      body.box(-8, -1, 5, -6, 2, 6, DARK).box(-2, -1, 5, 0, 2, 6, DARK).box(-8, -2, 6, -8 + L, 3, 10, '#23262b').box(-10, -3, 5, -8, 4, 11, DARK).box(-8 + L, -3, 5, -6 + L, 4, 11, DARK);
      ads = 7.5;
    }
    // muzzle devices
    const br = att ? att.barrel : 'none';
    if (br === 'supp') { body.box(muzzle - 1, -1, 1, muzzle + 9, 2, 4, '#2a2c31').box(muzzle + 9, 0, 2, muzzle + 10, 1, 3, DARK); muzzle += 10; }
    else if (br === 'flash') { body.box(muzzle, -1, 1, muzzle + 3, 2, 4, DARK); muzzle += 3; }
    else if (br === 'comp') { body.box(muzzle, -1, 1, muzzle + 3, 2, 4, DARK).box(muzzle + 1, -2, 2, muzzle + 2, 3, 3, DARK); muzzle += 3; }
    else if (br === 'heavy') body.box(r.hg + 1, -1, 1, muzzle, 2, 4, METAL);
    // underbarrel
    const un = att ? att.under : 'none';
    if (un === 'vgrip') body.box(r.hg - 6, -1, -6, r.hg - 3, 2, 0, '#3a3f47');
    else if (un === 'agrip') body.box(r.hg - 7, -1, -3, r.hg - 3, 2, 0, '#3a3f47').box(r.hg - 4, -1, -5, r.hg - 2, 2, -3, '#3a3f47');
    else if (un === 'laser') body.box(r.hg - 5, 2, 1, r.hg, 3, 3, '#525963').box(r.hg, 2, 2, r.hg + 1, 3, 3, '#ff2a2a');
    else if (un === 'bipod') body.box(r.hg - 2, -1, -5, r.hg - 1, 0, 0, METAL).box(r.hg - 2, 1, -5, r.hg - 1, 2, 0, METAL);
    else if (un === 'ugl') body.box(r.hg - 9, -1, -4, r.hg + 1, 2, 0, '#59606b').box(r.hg - 9, -1, -6, r.hg - 5, 2, -4, '#3a3f47');
    else if (un === 'mk') body.box(r.hg - 8, -1, -3, r.hg + 2, 2, 0, '#525963');
    mag = magFor(kind, att && att.mag === 'ext');
  }
  return { body, mag, stock, meta: { muzzle, grip, fore, ads, sightX, ejection } };
}

const geoCache = new Map();
function modelFor(key, kind, att, ext) {
  let e = geoCache.get(key);
  if (!e) {
    const b = build(kind, att, ext);
    const cv = (vm) => { const m = new VoxelModel(U); for (const [k, c] of vm.vox) m.vox.set(k, c); const g = voxelGeometry(m); g.translate(0, 0, -0.5 * U); return g; };
    e = { body: cv(b.body), mag: b.mag ? cv(b.mag) : null, stock: b.stock ? cv(b.stock) : null, meta: b.meta };
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
    this.scene.add(new THREE.HemisphereLight(0xeaf3ff, 0x9a9584, 7.5));
    const sun = new THREE.DirectionalLight(0xfff0d8, 5.5); sun.position.set(-0.5, 1, 0.6); this.scene.add(sun);
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
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  /** the muzzle position in world coordinates (for tracers), or null when hidden */
  setTeam(team) {
    const pal = TEAM_PAL[team] || TEAM_PAL[2];
    this.armMats.sleeve.color.set(pal.dark).multiplyScalar(0.9);
  }

  rebuild(kind, att, ext, key) {
    const m = modelFor(key, kind, att, ext);
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
    const key = `${kind}|${weapon ? weapon.key || weapon.id : ''}`;
    if (key !== this.key) {
      this.key = key;
      this.rebuild(kind, weapon && weapon.att ? weapon.att : null, !!(weapon && weapon.att && weapon.att.mag === 'ext'), key);
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
    const bobA = moving * (ctx.sprint ? 1.5 : ctx.crouch ? 0.5 : 1) * (1 - this.ads * 0.85);
    const bx = Math.sin(this.bobT) * 0.007 * bobA, by = Math.abs(Math.cos(this.bobT)) * -0.008 * bobA;
    // ---- mouse sway: the gun lags behind quick turns
    const sk = 1 - Math.exp(-11 * dt);
    const swayK = 1 - this.ads * 0.7;
    this.sway.x += (clamp(-g.lookRate.y * 5, -0.07, 0.07) * swayK - this.sway.x) * sk;
    this.sway.y += (clamp(-g.lookRate.p * 5, -0.05, 0.05) * swayK - this.sway.y) * sk;
    this.roll += (clamp(ctx.strafe * 0.05, -0.05, 0.05) - this.roll) * sk;

    // ---- pose
    const hip = HIP[kind] || HIP.rifle;
    const sightH = ((this.meta ? this.meta.ads : 7.5) + 1.8) * U;
    const adsPos = [0, -sightH, -0.21 + (this.meta ? this.meta.sightX : -6.5) * U];
    let px = lerp(hip[0], adsPos[0], this.ads), py = lerp(hip[1], adsPos[1], this.ads), pz = lerp(hip[2], adsPos[2], this.ads);
    let rx = 0, ry = 0, rz = 0;                                     // rotation: pitch, yaw, roll
    // sprint: weapon lowered and turned in
    px += -0.01 * this.sprint; py += -0.05 * this.sprint; pz += 0.04 * this.sprint;
    rx += -0.2 * this.sprint; ry += 0.5 * this.sprint; rz += 0.14 * this.sprint;
    // recoil: back and up
    pz += 0.035 * this.kick * (1 - this.ads * 0.4); py += 0.006 * this.kick; rx += 0.06 * this.kick * (1 - this.ads * 0.35);
    // reload: dip, tilt, mag out
    const rl = this.reload, rs = Math.sin(Math.PI * rl);
    py += -0.17 * rs; px += -0.05 * rs; rx += -0.55 * rs; rz += 0.45 * rs; ry += 0.25 * rs;
    this.stockMesh.visible = this.ads < 0.35;
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
    this.rig.rotation.set(rx + this.sway.y * 0.6, ry + this.sway.x * 1.4, rz + this.roll, 'YXZ');
    // muzzle flash at the barrel tip
    this.flash.visible = this.flashT > 0 && this.meta && this.meta.muzzle > 0;
    if (this.flash.visible) {
      const mp = new THREE.Vector3(this.meta.muzzle * U, 2.5 * U, 0.5 * U);
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
