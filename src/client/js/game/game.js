// Client-side game controller: snapshot buffer, interpolation, prediction (soldier and vehicle driver), events, per-frame loop.
import { DT, PHASE, KEY, SPEC, TILE, T, CT, BASE_SPEED, EYE_H, EYE_H_CROUCH } from '../../shared/constants.js';
import { WEAPON_LIST, HELD_GREN_BASE, HELD_GADGET_BASE, GADGET_LIST, PROJ, maxSpeedFor, resolveWeapon } from '../../shared/weapons.js';
import { VEHICLES, VEHICLE_LIST, stepVehicle, vehicleGunMount } from '../../shared/vehicles.js';
import { createMap } from '../../shared/maps/index.js';
import { stepMovement, relativeDir } from '../../shared/movement.js';
import { canSee, viewParams } from '../../shared/vision.js';
import { audio } from '../battlefield-audio.js';
import { bodyBounds } from '../../shared/rigid.js';
import { FX } from './fx.js';
import { Input } from './input.js';
import { Terrain } from './terrain.js';
import { Renderer } from './render.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
const CLS = ['assault', 'engineer', 'support', 'recon'];
const PROJ_LIST = Object.keys(PROJ);

export class ClientGame {
  constructor(canvas, net, ui) {
    this.canvas = canvas;
    this.net = net;
    this.ui = ui;
    this.input = new Input(canvas);
    this.input.isBlocked = () => !!(this.ui.inputBlocked && this.ui.inputBlocked());
    this.fx = new FX();
    this.renderer = new Renderer(canvas, this);
    this.active = false;
    this.roster = new Map();
    this.you = 0;
    this.snaps = [];
    this.offset = 0;                 // serverTime - localTime
    this.haveOffset = false;
    // player settings (kept in the browser)
    this.sens = 0.0012; this.fov = 90; this.invertY = false;
    try {
      const n = (k) => parseFloat(localStorage.getItem(k));
      if (Number.isFinite(n('fl.sens'))) this.sens = clamp(n('fl.sens'), 0.0004, 0.008);
      if (Number.isFinite(n('fl.fov'))) this.fov = clamp(n('fl.fov'), 70, 120);
      this.invertY = localStorage.getItem('fl.inv') === '1';
      this.input.adsToggle = localStorage.getItem('fl.adsT') === '1';
    } catch { /* ignore */ }
    this.reset();
    this._bindInput();
    this._last = 0;
    this._raf = 0;
    this.frame = this.frame.bind(this);
  }

  reset() {
    this.map = null; this.terrain = null;
    this.mode = 'conquest';
    this.phase = PHASE.LIVE; this.timer = 0; this.timerRecv = 0;
    this.tix = [0, 0]; this.target = 0; this.rush = null;
    this.snaps.length = 0;
    this.me = null;                   // latest server-side own (or spectated) state
    this.pred = { x: 0, y: 0, vx: 0, vy: 0, z: 0, vz: 0, cf: 0 };
    this.predVeh = { x: 0, y: 0, a: 0, vx: 0, vy: 0 };
    this.predMode = '';
    this.predValid = false;
    this.errX = 0; this.errY = 0;     // visual smoothing of prediction corrections
    this.pending = [];
    this.seq = 0;
    this.acc = 0;
    this.alive = false;
    this.rc = -1;
    this.angle = 0;
    this.aimDist = 300; this.aimHeight = 14;
    this.vehiclePitch = -.14; this.vehicleCameraMode = 'auto';
    this.deathLook = true;            // dead view: stay in first person and sink to the ground
    this.yaw = 0;                     // where the camera (and aim) points, radians, 0 = +x
    this.pitch = 0;                   // look up (+) / down (-), radians
    this.recoil = { p: 0, y: 0, hot: 0 };   // camera kick from shooting (added to the view, recovers over time)
    this.lookRate = { y: 0, p: 0 };   // how fast the view turned this frame (drives weapon sway)
    this.eyeBob = 0; this.landDip = 0; this.lastVz = 0;
    this.elev = 0.34;                 // camera elevation above the horizon (mouse up/down)
    this.followYaw = 0; this.lookOff = 0; this.lookIdle = 0; this.lookKey = '';
    this.camH = 240;
    this.ents = { g: [], sm: [], fi: [], pj: [], gd: [], cp: [], sp: [], v: [] };
    this.flagState = new Map();
    this.flagsCache = [];
    this.mcomState = [];
    this.corpses = [];
    this.muzzle = new Map();          // player id -> flash-until (ms)
    this.hitMarker = 0; this.hitKill = false;
    this.damageDirs = [];
    this.flashRecv = 0; this.flashLeft = 0; this.flashFull = 0;
    this.shots = { cd: 0, fired: [], prevFire: false };
    this.cam = { x: 0, y: 0 };
    this.freecam = false;
    this.fogOn = true;
    this.pings = [];
    this.bigmap = false;
    this.spec = 0;
    this.vision = null;
    this.stats = { fps: 0, frames: 0, t: 0 };
    this.recvAt = 0;
    this.kit = null;
    this.spawnOpts = [];
    this.respawnIn = 0;
    this.reviveLeft = -1;
    this.deployChoice = null;
    this.playerCache = null; this.vehCache = null; this.projCache = null;
    this.lastVehTick = 0;
    this._enginePos = new Map();
  }

  // ------------------------------------------------------------------ lifecycle
  startMatch(info) {
    this.reset();
    this.input.reset();
    // A hidden nickname/chat input must not continue swallowing gameplay keys.
    if (this.input.isTyping()) document.activeElement.blur();
    this.mode = info.mode;
    this.map = createMap(info.map);
    if (info.tiles && info.tiles.length) this.map.applyChanges(info.tiles);
    this.terrain = new Terrain(this.map, { shadows: false });
    this.fx.initMap(this.map);
    this.renderer.setMap(this.map, this.terrain);
    this.terrain.buildThumb(4);
    // live destruction: cubes fly and dust rises whenever a tile changes after this point
    this.map.onChange((tx, ty, old, ch) => { if (TILE_SOLID(old)) this.fx.tileBreak(tx, ty, old); void ch; });
    this.tix = info.tix || [0, 0];
    this.phase = info.phase ?? PHASE.LIVE;
    this.active = true;
    audio.startWorld();
    this.input.enabled = true;
    this.lastTime = performance.now();
    if (!this._raf) this._raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.active = false;
    audio.stopWorld();
    this.input.enabled = false;
    cancelAnimationFrame(this._raf); this._raf = 0;
  }

  teamOf(id) { const r = this.roster.get(id); return r ? r.tm : -1; }
  myTeam() { return this.teamOf(this.you); }
  /** Visual team index: 1 = friendly (blue), 0 = enemy (red), 2 = neutral. Spectators see the raw teams (T red, CT blue). */
  pt(team) {
    if (team === undefined || team < 0 || team > 1) return 2;
    const m = this.myTeam();
    if (m !== T && m !== CT) return team;
    return team === m ? 1 : 0;
  }
  mySquad() { const r = this.roster.get(this.you); return r ? r.sq : -1; }
  nameOf(id) { const r = this.roster.get(id); return r ? r.n : '?'; }
  clsOf(id) { const r = this.roster.get(id); return r ? r.cl : 'assault'; }

  // ------------------------------------------------------------------ server clock
  serverNow() { return performance.now() / 1000 + this.offset; }
  renderTime() { return this.serverNow() - 0.1; }

  // ------------------------------------------------------------------ snapshots
  onSnapshot(s) {
    const now = performance.now();
    const st = s.tk * DT;
    const sample = st - now / 1000;
    if (!this.haveOffset) { this.offset = sample; this.haveOffset = true; }
    else this.offset = sample > this.offset ? this.offset + (sample - this.offset) * 0.5 : this.offset + (sample - this.offset) * 0.02;
    this.phase = s.ph;
    this.timer = s.rt; this.timerRecv = now;
    if (s.tix) this.tix = s.tix;
    if (s.tg) this.target = s.tg;
    if (s.rs) this.rush = s.rs;
    const players = new Map();
    for (const t of s.p) players.set(t[0], t);
    const veh = new Map();
    for (const t of s.v || []) veh.set(t[0], t);
    const snap = { st, recv: now, players, veh, tk: s.tk };
    this.snaps.push(snap);
    if (this.snaps.length > 30) this.snaps.shift();
    this.playerCache = null; this.vehCache = null; this.projCache = null;

    // world entities
    this.ents = { g: s.g || [], sm: s.sm || [], fi: s.fi || [], pj: s.pj || [], gd: s.gd || [], cp: s.cp || [], sp: s.sp || [], v: s.v || [], cf: s.cf || [] };
    let deformed = false;
    for (const [i, z] of s.td || []) if (this.map.elevation[i] !== z) { this.map.elevation[i] = z; deformed = true; }
    if (deformed) this.renderer.ground?.deform();
    this.ents.rb = s.rb || [];
    this.map.dynamicBodies = this.ents.rb.filter((t) => t[1] !== 'G' && t[1] !== '=').map(bodyBounds);
    for (const id of s.bs || []) { const b = this.map.buildings.find((b) => b.id === id); if (b) { b.collapsed = true; b.active = false; } }
    this.renderer.buildings?.sync();
    this.projRecv = now;
    if (s.fl) { for (const f of s.fl) this.flagState.set(f[0], { owner: f[1], cap: f[2] / 100, contested: !!f[3] }); this.flagsCache = null; }
    if (s.mc) this.mcomState = s.mc.map((m) => ({ id: m[0], state: m[1], timer: m[2], stage: m[3], x: m[4], y: m[5] }));

    if (s.sps) this.spawnOpts = s.sps.map((o) => ({ k: o[0], id: o[1], name: o[2], x: o[3], y: o[4], ok: !!o[5], why: o[6], veh: !!o[7] }));
    this.respawnIn = s.rsp !== undefined ? s.rsp : 0;
    this.reviveLeft = s.rev !== undefined ? s.rev : -1;

    // own / spectated state
    if (s.me) {
      const wasAlive = this.alive;
      this.me = s.me;
      this.spec = s.spec;
      this.alive = !!s.al;
      if (s.me.own) this.reconcile(s, wasAlive);
      this.flashRecv = now; this.flashLeft = s.me.fl; this.flashFull = s.me.ff;
      if (s.me.fl > 0.05 && !this._flashing) { this._flashing = true; audio.flashRing(); }
      if (s.me.fl <= 0.05) this._flashing = false;
    } else { this.me = null; this.alive = !!s.al; }

    if (s.ev) this.processEvents(s.ev);
    if (this.alive && s.me?.own) {
      if (s.me.veh?.threat) audio.airWarning(s.me.veh.threat);
      if (s.me.lk) audio.seeker(s.me.lk[1] >= 1);
    }
    this.ui.onSnapshot && this.ui.onSnapshot(this, s);
  }

  inDriverSeat() { return !!(this.me && this.me.own && this.me.veh && this.me.veh.seat === 0); }
  inVehicle() { return !!(this.me && this.me.veh); }
  vehDef() { return this.me && this.me.veh ? VEHICLES[VEHICLE_LIST[this.me.veh.ty]] : null; }

  profile() {
    const mv = this.me ? this.me.mv : null;
    return mv ? { speedPx: mv[0], scope: mv[1], adsSpeed: mv[2], can: !!mv[3] } : { speedPx: BASE_SPEED, scope: 0, adsSpeed: 1, can: false };
  }

  reconcile(s, wasAlive) {
    const me = s.me;
    const drv = !!(me.veh && me.veh.seat === 0);
    const key = drv ? `v${me.veh.id}` : (me.veh ? 'p' : 'f');
    if (!this.predValid || me.rc !== this.rc || !wasAlive || this.predMode !== key) {
      const respawned = me.rc !== this.rc || !wasAlive;
      this.rc = me.rc;
      this.predMode = key;
      if (drv) this.predVeh = { x: me.veh.x, y: me.veh.y, a: me.veh.a, vx: me.veh.vx, vy: me.veh.vy, flightZ: me.veh.z, chassisZ: me.veh.z, vz: me.veh.vz || 0, steer: me.veh.steer || 0, yawRate: me.veh.yawRate || 0, throttle: me.veh.throttle || 0 };
      this.pred = { x: me.x, y: me.y, vx: me.vx, vy: me.vy, z: me.z || 0, vz: me.vz || 0, cf: me.cf || 0 };
      this.pending.length = 0;
      this.shots.fired.length = 0;
      this.errX = this.errY = this.errZ = 0;
      this.predValid = true;
      if (this.alive && respawned) { this.fx.clearAll && this._lastRc !== me.rc && this.onRespawn(); this._lastRc = me.rc; }
      return;
    }
    // drop acknowledged commands, replay the rest on top of the authoritative state
    while (this.pending.length && this.pending[0][0] <= s.ack) this.pending.shift();
    this.shots.fired = this.shots.fired.filter((q) => q > s.ack);
    if (drv) {
      const def = this.vehDef();
      const st = { x: me.veh.x, y: me.veh.y, a: me.veh.a, vx: me.veh.vx, vy: me.veh.vy, flightZ: me.veh.z, chassisZ: me.veh.z, vz: me.veh.vz || 0, steer: me.veh.steer || 0, yawRate: me.veh.yawRate || 0, throttle: me.veh.throttle || 0 };
      for (const c of this.pending) stepVehicle(this.map, st, def, c[1], c[2]);
      const ex = this.predVeh.x - st.x, ey = this.predVeh.y - st.y;
      if (Math.hypot(ex, ey) > 90) { this.errX = this.errY = this.errZ = 0; } else { this.errX += ex; this.errY += ey; }
      const ez = (this.predVeh.flightZ || 0) - st.flightZ;
      this.errZ = Math.abs(ez) > 60 ? 0 : (this.errZ || 0) + ez;
      this.predVeh.chassisZ = st.chassisZ; this.predVeh.flightZ = st.flightZ; this.predVeh.vz = st.vz; this.predVeh.steer = st.steer; this.predVeh.yawRate = st.yawRate; this.predVeh.throttle = st.throttle;
      this.predVeh.x = st.x; this.predVeh.y = st.y; this.predVeh.a = st.a; this.predVeh.vx = st.vx; this.predVeh.vy = st.vy;
      return;
    }
    if (me.veh) return;
    const st = { x: me.x, y: me.y, vx: me.vx, vy: me.vy, z: me.z || 0, vz: me.vz || 0, cf: me.cf || 0 };
    const prof = this.profile();
    for (const c of this.pending) {
      const keys = c[1];
      const scoped = !!(keys & KEY.SCOPE) && prof.can;
      const walk = !!(keys & KEY.WALK) || st.cf > 0.5;
      const sprint = !!(keys & KEY.SPRINT) && (keys & KEY.UP) !== 0 && !scoped && !walk && !(keys & KEY.FIRE);
      const [ax, ay] = relativeDir(keys, c[2]);
      stepMovement(this.map, st, keys, maxSpeedFor(prof, walk, scoped, sprint), false, ax, ay);
    }
    const ex = this.pred.x - st.x, ey = this.pred.y - st.y;
    if (Math.hypot(ex, ey) > 70) { this.errX = this.errY = this.errZ = 0; }
    else { this.errX += ex; this.errY += ey; }
    this.pred.x = st.x; this.pred.y = st.y; this.pred.vx = st.vx; this.pred.vy = st.vy;
    // vertical state: trust the replay, but never fight a small difference
    if (Math.abs(this.pred.z - st.z) > 4) { this.pred.z = st.z; this.pred.vz = st.vz; }
    this.pred.cf = st.cf;
  }

  onRespawn() {
    if (this.me && Number.isFinite(this.me.a)) this.yaw = this.me.a;
    this.pitch = 0; this.recoil.p = this.recoil.y = 0; this.input.right = false;
    this.lookKey = '';
    this.ui.onRespawn && this.ui.onRespawn();
  }

  // ------------------------------------------------------------------ derived world state for the renderer
  flagList() {
    if (!this.map) return [];
    if (!this.flagsCache) {
      this.flagsCache = this.map.flags.map((f) => {
        const st = this.flagState.get(f.id) || { owner: f.owner, cap: f.owner === T ? -1 : f.owner === CT ? 1 : 0, contested: false };
        return { id: f.id, name: f.name, x: f.x, y: f.y, r: f.r, owner: st.owner, cap: st.cap, contested: st.contested };
      });
      // flags are lettered A, B, C... from west to east
      const order = [...this.flagsCache].sort((a, b) => a.x - b.x || a.y - b.y);
      order.forEach((f, i) => { f.letter = String.fromCharCode(65 + i); });
    }
    return this.mode === 'conquest' ? this.flagsCache : [];
  }

  mcomList() { return this.mode === 'rush' ? this.mcomState : []; }

  /** on-foot soldiers to draw (own soldier included, from the predicted position) */
  soldiers() {
    if (this.playerCache) return this.playerCache;
    const list = [];
    const latest = this.snaps[this.snaps.length - 1];
    const ownId = this.alive && this.me && this.me.own && !this.me.veh ? this.you : 0;
    const myTeam = this.me ? (this.roster.get(this.me.id) || {}).tm : this.myTeam();
    if (latest) {
      for (const id of latest.players.keys()) {
        if (id === ownId) continue;
        const p = this.interpolated(id);
        if (!p) continue;
        p.team = this.teamOf(id);
        p.mate = p.team === myTeam && myTeam !== SPEC;
        list.push(p);
      }
    }
    if (ownId) {
      const v = this.viewer();
      const me = this.me;
      list.push({ id: ownId, x: v.x, y: v.y, a: this.angle, hp: me.hp, held: me.held, fl: (me.sc ? 1 : 0) | (me.sprot ? 32 : 0) | (this.pred.cf > 0.5 ? 64 : 0), cls: me.cls, speed: Math.hypot(this.pred.vx, this.pred.vy), z: this.pred.z, pitch: this.viewPitch(), cf: this.pred.cf, team: this.myTeam(), mate: true, own: true });
    }
    this.playerCache = list;
    return list;
  }

  vehiclesDrawn() {
    if (this.vehCache) return this.vehCache;
    const list = [];
    const latest = this.snaps[this.snaps.length - 1];
    const drv = this.inDriverSeat() && this.alive;
    if (latest) {
      for (const id of latest.veh.keys()) {
        const v = this.interpolatedVeh(id);
        if (!v) continue;
        if (drv && id === this.me.veh.id) {
          const e = this.viewerVeh();
          v.x = e.x; v.y = e.y; v.a = e.a; v.z = e.z; v.steer = this.predVeh.steer; v.yawRate = this.predVeh.yawRate; v.own = true; v.ta = this.turretAngle();
        }
        if (this.me?.own && v.id === this.me.veh?.id && this.vehDef().seats[this.me.veh.seat].aim === 'free') v.ga = this.gunnerAngle();
        if (VEHICLES[VEHICLE_LIST[v.ty]].kind !== 'air') v.z = VEHICLES[VEHICLE_LIST[v.ty]].kind === 'boat' ? 0 : this.map.heightAt(v.x, v.y);
        list.push(v);
      }
    }
    this.vehCache = list;
    return list;
  }

  gunnerAngle() {
    if (!this.me?.veh) return this.angle;
    const sd = this.vehDef().seats[this.me.veh.seat], key = `${this.me.veh.id}:${this.me.veh.seat}`;
    if (!this._gunAim || this._gunAim.key !== key) this._gunAim = { key, angle: this.me.veh.sa };
    return sd.aim === 'free' ? this._gunAim.angle : this.angle;
  }

  turretAngle() {
    const me = this.me;
    if (!me || !me.veh) return 0;
    const def = this.vehDef();
    const sd = def.seats[me.veh.seat];
    if (sd.aim === 'turret') {
      if (this._ta === undefined || this._taId !== me.veh.id) { this._ta = me.veh.ta; this._taId = me.veh.id; }
      return this._ta;
    }
    return me.veh.ta;
  }

  projectilesDrawn() {
    if (this.projCache) return this.projCache;
    const el = (performance.now() - (this.projRecv || 0)) / 1000;
    const out = [];
    for (const q of this.ents.pj) {
      const pr = PROJ[PROJ_LIST[q[1]]];
      const sp = q[7] ?? (pr ? pr.speed : 800);
      out.push({ id: q[0], idx: q[1], x: q[2] + Math.cos(q[4]) * sp * el, y: q[3] + Math.sin(q[4]) * sp * el, z: (q[5] ?? 17) + (q[6] || 0) * el, pitch: Math.atan2(q[6] || 0, sp), a: q[4] });
    }
    this.projCache = out;
    return out;
  }

  // ------------------------------------------------------------------ events from the server
  weaponOf(idx) { return WEAPON_LIST[idx]; }

  visiblePoint(x, y) {
    const v = this.viewer();
    if (!v || !this.fogOn) return true;
    return canSee(this.map, this.smokeCircles(), v.x, v.y, v.angle, v.view, x, y, 0, 6, v.eye);
  }

  smokeCircles() { return this.ents.sm.map((s) => ({ x: s[1], y: s[2], r: s[3] })); }

  processEvents(evs) {
    const fx = this.fx, now = performance.now();
    for (const e of evs) {
      switch (e[0]) {
        case 'shot': {
          const [, pid, widx, x, y, ang, len, kind, sub, supp, oz = 24, pit = 0] = e;
          const w = WEAPON_LIST[widx];
          const own = pid === this.you && !!this.me && this.me.own;
          const cp = Math.cos(pit), slope = Math.tan(pit);
          const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len, ez = Math.max(0, oz + slope * len);
          const seen = own || this.visiblePoint(x, y) || this.visiblePoint(ex, ey);
          if (!own && !sub) audio.shot(w.kind, { x, y }, !!supp);
          if (!own && !sub) this.muzzle.set(pid, now + 70);
          if (seen) {
            // tracers leave from the muzzle: below the eye, a little to the right for the local player
            const fwd = own ? 22 : 16, side = own ? 5 : 3;
            const sx = x + Math.cos(ang) * fwd - Math.sin(ang) * side, sy = y + Math.sin(ang) * fwd + Math.cos(ang) * side, sz = oz - 4;
            fx.tracer(sx, sy, sz, ex, ey, ez, own, w.kind === 'sniper');
            if (kind === 1) fx.sparks(ex, ey, ang, 4, ez);
            else if (kind === 2) fx.blood(ex, ey, ang, 7, ez);
            else if (kind === 3) fx.sparks(ex, ey, ang, 6, ez);
            if (!own && !sub && w.kind !== 'shotgun' && Math.random() < 0.6) fx.casing(x, y, ang, oz - 4);
          }
          void cp;
          break;
        }
        case 'vshot': {
          const [, , snd, x, y, ang, len, kind, , gz = 24, ez = gz] = e;
          const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
          const seen = this.visiblePoint(x, y) || this.visiblePoint(ex, ey);
          audio.vshot(snd, { x, y });
          if (seen && snd === 'lmg') {
            fx.tracer(x, y, gz, ex, ey, ez, false, true);
            if (kind === 1) fx.sparks(ex, ey, ang, 4, ez); else if (kind === 2) fx.blood(ex, ey, ang, 6, ez); else if (kind === 3) fx.sparks(ex, ey, ang, 7, ez);
          }
          if (seen) fx.muzzle(x - Math.cos(ang) * 10, y - Math.sin(ang) * 10, ang, gz);
          if (snd === 'cannon' && seen) { fx.addShake(2.5); fx.smokeTrail(x, y, 20); for (let i = 0; i < 5; i++) fx.smokeTrail(x + Math.cos(ang) * i * 8, y + Math.sin(ang) * i * 8, 20); }
          break;
        }
        case 'material': audio.material(e[1], { x: e[2], y: e[3], z: e[4] }, e[5]); break;
        case 'collapse': audio.collapse({ x: e[2], y: e[3], z: e[4] }); fx.addShake(2); break;
        case 'fracture': audio.material(e[1], { x: e[2], y: e[3], z: e[4] }, .55); break;
        case 'bounce': audio.bounce({ x: e[2], y: e[3], z: e[4] }); break;
        case 'flares': audio.flareBurst({ x: e[2], y: e[3] }); break;
        case 'launch': audio.launch(e[1], { x: e[2], y: e[3] }); break;
        case 'blast': fx.smokeTrail(e[1] - Math.cos(e[3]) * 14, e[2] - Math.sin(e[3]) * 14, 12); for (let i = 0; i < 4; i++) fx.smokeTrail(e[1] - Math.cos(e[3]) * (14 + i * 6), e[2] - Math.sin(e[3]) * (14 + i * 6), 12); break;
        case 'knife': audio.knife({ x: e[2], y: e[3] }, !!e[5]); this.muzzle.set(e[1], now + 120); break;
        case 'step': if (e[1] !== this.you) audio.step({ x: e[2], y: e[3] }); break;
        case 'rel': { const w = WEAPON_LIST[e[4]]; audio.reload(e[1] === this.you ? null : { x: e[2], y: e[3] }, w?.kind, w?.reload); break; }
        case 'nade': audio.throwNade({ x: e[2], y: e[3] }); break;
        case 'boom': this.onBoom(e[1], e[2], e[3], e[4], e[5] ?? this.map.heightAt(e[2], e[3])); break;
        case 'hurt': this.onHurt(e[1], e[2]); break;
        case 'hitm': this.hitMarker = now; this.hitKill = !!e[2]; this.hitHead = !!e[3]; audio.hitmarker(!!e[2], !!e[3]); break;
        case 'die': this.onDie(e); break;
        case 'vdie': fx.explosion(e[3], e[4], 170); audio.explosion('bomb', { x: e[3], y: e[4] }); fx.addShake(6); break;
        case 'vspawn': break;
        case 'score': this.onScore(e[1], e[2]); break;
        case 'defib': audio.defib({ x: e[2], y: e[3] }); break;
        case 'revived': audio.revive({ x: e[2], y: e[3] }); fx.ring(e[2], e[3], 6, 60, 0.6, 'rgba(93,255,154,0.9)', 4); break;
        case 'deploy': audio.deploy({ x: e[3], y: e[4] }); break;
        case 'enter': audio.doorOpen({ x: 0, y: 0 }, true); break;
        case 'exit': audio.doorOpen({ x: 0, y: 0 }, true); break;
        case 'crash': { const v = this.interpolatedVeh(e[1]); audio.crash(v ? { x: v.x, y: v.y, z: v.z } : null); break; }
        case 'flagcap': audio.flagCap(e[2] === this.myTeam() || this.myTeam() === SPEC ? 1 : 0); break;
        case 'beep': audio.beep({ x: e[1], y: e[2] }, e[3] < 10 ? 1 : 0); break;
        case 'repair': audio.repair({ x: e[1], y: e[2] }); break;
        case 'pickup': break;
        case 'empty': audio.empty(); break;
        case 'click': break;
        default: break;
      }
    }
  }

  onScore(pts, label) {
    const v = this.viewer();
    if (v) this.fx.floater(v.x, v.y - 44, `+${pts} ${label}`, '#ffe36a');
    audio.score();
    this.ui.onScore && this.ui.onScore(pts, label);
  }

  onBoom(kind, x, y, r, z = 0) {
    const fx = this.fx;
    const v = this.viewer();
    const d = v ? Math.hypot(v.x - x, v.y - y) : 9999;
    const size = r || 120;
    if (kind === 'flash') { fx.flashBurst(x, y, z); audio.flash({ x, y }); }
    else if (kind === 'smoke') { audio.smoke({ x, y }); for (let i = 0; i < 10; i++) fx.cube({ x, y, z: z + 6, vx: (Math.random() - 0.5) * 160, vy: (Math.random() - 0.5) * 160, vz: 30, life: 0.7, r: 8, k: 'puff', col: '#d2d2d2', a0: 0.4, grow: 22 }); }
    else if (kind === 'molo') { fx.molotovSplash(x, y, z); audio.molotov({ x, y }); }
    else {
      fx.explosion(x, y, size, z);
      audio.explosion(kind === 'c4' || kind === 'veh' || kind === 'shell' ? 'bomb' : 'he', { x, y, z });
      fx.addShake(clamp(size / 8 - d / 70, 0, 12));
    }
  }

  onHurt(dmg, from) {
    this.damageDirs.push({ a: from, t: performance.now(), d: dmg });
    this.fx.addShake(Math.min(6, 1 + dmg / 12));
    audio.hurt();
  }

  onDie(e) {
    const [, id, x, y, ang, team, corpse] = e;
    if (corpse) {
      this.corpses.push({ id, x, y, a: ang, team, cls: this.clsOf(id), t: performance.now() });
      if (this.corpses.length > 40) this.corpses.shift();
    }
    this.fx.corpseStain(x, y);
    audio.death({ x, y });
    if (id === this.you) this.ui.onDeath && this.ui.onDeath();
  }

  // ------------------------------------------------------------------ viewer (whose eyes are we looking through)
  viewerVeh() {
    return { x: this.predVeh.x + this.errX + (this.ext ? this.ext.x : 0), y: this.predVeh.y + this.errY + (this.ext ? this.ext.y : 0), a: this.predVeh.a, z: this.vehDef()?.kind === 'air' ? this.predVeh.flightZ + (this.errZ || 0) + (this.ext?.z || 0) : this.predVeh.chassisZ ?? this.map.heightAt(this.predVeh.x, this.predVeh.y) };
  }

  viewer() {
    if (!this.map) return null;
    let x, y, angle, scoped = false, scopeLvl = 0, view = null, air = false, z = 0, cf = 0, pit = null;
    if (this.alive && this.me && this.me.own) {
      angle = this.angle;
      if (this.me.veh) {
        const def = this.vehDef();
        if (this.me.veh.seat === 0) { const e = this.viewerVeh(); x = e.x; y = e.y; }
        else { const v = this.interpolatedVeh(this.me.veh.id); x = v ? v.x : this.me.veh.x; y = v ? v.y : this.me.veh.y; }
        view = def.view; air = !!def.view.air;
      } else {
        x = this.pred.x + this.errX + (this.ext ? this.ext.x : 0); y = this.pred.y + this.errY + (this.ext ? this.ext.y : 0);
        z = this.pred.z; cf = this.pred.cf;
        const prof = this.profile();
        scopeLvl = prof.can ? prof.scope : 0;
        scoped = !!(this.input.right && prof.can);
      }
    } else if (this.spec && !this.freecam) {
      if (this.me && this.me.veh) {
        const v = this.interpolatedVeh(this.me.veh.id);
        if (!v) return this._lastViewer || null;
        const def = VEHICLES[VEHICLE_LIST[v.ty]];
        x = v.x; y = v.y; angle = this.me.a; view = def.view; air = !!def.view.air;
      } else {
        const p = this.interpolated(this.spec);
        if (!p) return this._lastViewer || null;
        x = p.x; y = p.y; angle = p.a; z = p.z || 0; cf = p.cf || 0; pit = p.pitch || 0;
        const w = p.held < HELD_GREN_BASE ? WEAPON_LIST[p.held] : null;
        scopeLvl = w ? (this.me && this.me.mv ? this.me.mv[1] : w.scope) : 0; scoped = !!(p.fl & 1);
      }
    } else return this._lastViewer || null;
    if (this.me?.veh) z = this.alive && this.me.own && this.inDriverSeat() ? this.viewerVeh().z : this.interpolatedVeh(this.me.veh.id)?.z ?? this.me.veh.z;
    if (!view) view = viewParams(scoped, scopeLvl);
    const v = { x, y, angle, scoped, scopeLvl, view, air, z, cf, pitch: pit, eye: z + EYE_H + (EYE_H_CROUCH - EYE_H) * cf };
    this._lastViewer = v;
    return v;
  }

  /** Interpolated state of a remote soldier at render time. */
  interpolated(id) {
    const snaps = this.snaps;
    if (!snaps.length) return null;
    const rt = this.renderTime();
    let s1 = null, s0 = null;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].st <= rt) { s0 = snaps[i]; s1 = snaps[i + 1] || null; break; }
    }
    if (!s0) s0 = snaps[0];
    const a = s0.players.get(id);
    const b = s1 ? s1.players.get(id) : null;
    if (!a && !b) {
      for (let i = snaps.length - 1; i >= 0; i--) { const t = snaps[i].players.get(id); if (t) return this._tuple(t); }
      return null;
    }
    if (a && b && s1.st > s0.st) {
      const k = clamp((rt - s0.st) / (s1.st - s0.st), 0, 1);
      return { id, x: lerp(a[1], b[1], k), y: lerp(a[2], b[2], k), a: lerpAngle(a[3], b[3], k), hp: b[4], held: b[5], fl: b[6], cls: CLS[b[7]] || 'assault', speed: b[8], z: lerp(a[9] || 0, b[9] || 0, k), pitch: lerp(a[10] || 0, b[10] || 0, k), cf: lerp(a[11] || 0, b[11] || 0, k) };
    }
    return this._tuple(a || b);
  }

  _tuple(t) { return { id: t[0], x: t[1], y: t[2], a: t[3], hp: t[4], held: t[5], fl: t[6], cls: CLS[t[7]] || 'assault', speed: t[8], z: t[9] || 0, pitch: t[10] || 0, cf: t[11] || 0 }; }

  interpolatedVeh(id) {
    const snaps = this.snaps;
    if (!snaps.length) return null;
    const rt = this.renderTime();
    let s1 = null, s0 = null;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].st <= rt) { s0 = snaps[i]; s1 = snaps[i + 1] || null; break; }
    }
    if (!s0) s0 = snaps[0];
    const a = s0.veh.get(id), b = s1 ? s1.veh.get(id) : null;
    const pack = (t, x, y, ang, ta, ga, z = t[13], vz = t[14] || 0) => ({ id: t[0], ty: t[1], x, y, z, vz, a: ang, ta, ga, hp: t[7], team: t[8], occ: t[9], speed: t[10], pitch0: t[11] || 0, pitch1: t[12] || 0, steer: t[15] || 0, yawRate: t[16] || 0, throttle: t[17] || 0 });
    if (!a && !b) {
      for (let i = snaps.length - 1; i >= 0; i--) { const t = snaps[i].veh.get(id); if (t) return pack(t, t[2], t[3], t[4], t[5], t[6]); }
      return null;
    }
    if (a && b && s1.st > s0.st) {
      const k = clamp((rt - s0.st) / (s1.st - s0.st), 0, 1);
      return pack(b, lerp(a[2], b[2], k), lerp(a[3], b[3], k), lerpAngle(a[4], b[4], k), lerpAngle(a[5], b[5], k), lerpAngle(a[6], b[6], k), lerp(a[13], b[13], k), lerp(a[14] || 0, b[14] || 0, k));
    }
    const t = a || b;
    return pack(t, t[2], t[3], t[4], t[5], t[6]);
  }

  // ------------------------------------------------------------------ tile changes from the server
  applyTiles(list) { for (const [i, ch] of list) this.map.setTile(i % this.map.w, (i / this.map.w) | 0, ch); }

  // ------------------------------------------------------------------ input actions
  _bindInput() {
    const inp = this.input;
    const send = (a, extra) => this.net.send({ t: 'a', a, ...extra });
    const sw = (slot) => { if (this.alive && !this.inVehicle()) { send('sw', { slot }); audio.switchWeapon(); } };
    inp.on('reload', () => send('reload'));
    inp.on('flares', () => { if (this.playing() && this.inDriverSeat() && this.vehDef().kind === 'air') send('flares'); });
    inp.on('alt', () => { if (this.inVehicle()) return; send('alt'); audio.click(); });
    inp.on('last', () => send('sw', { slot: 'last' }));
    inp.wantLock = () => this.playing();
    // leaving pointer lock with Esc opens the menu (some browsers also deliver the Esc key press: ignore that duplicate)
    inp.on('unlock', () => { this._unlockAt = performance.now(); if (this.active && this.playing() && this.ui.toggleMenu) this.ui.toggleMenu(); });
    inp.on('spot', () => {
      const v = this.viewer(); if (!v || !this.alive) return;
      let w = this.crosshairWorld();
      // first person: mark whatever is under the crosshair (the soldier or vehicle closest to the screen centre)
      if (this.playing()) {
        const r = this.renderer, cx = r.W / 2, cy = r.H / 2;
        let best = null, bd = 110;
        for (const p of this.soldiers()) {
          if (p.own || p.team === this.myTeam()) continue;
          const s = r.project(p.x, p.y, (p.z || 0) + 15);
          if (s && Math.hypot(s.x - cx, s.y - cy) < bd) { bd = Math.hypot(s.x - cx, s.y - cy); best = p; }
        }
        for (const q of this.vehiclesDrawn()) {
          if (q.team === this.myTeam()) continue;
          const s = r.project(q.x, q.y, (q.z || 0) + 24);
          if (s && Math.hypot(s.x - cx, s.y - cy) < bd) { bd = Math.hypot(s.x - cx, s.y - cy); best = q; }
        }
        if (best) w = { x: best.x, y: best.y };
      }
      send('spot', { x: Math.round(w.x), y: Math.round(w.y) });
    });
    for (let i = 1; i <= 6; i++) {
      inp.on('slot' + i, () => {
        if (this.inVehicle()) { if (i <= 4) send('seat', { n: i - 1 }); return; }
        sw(['primary', 'secondary', 'gadget0', 'gadget1', 'grenade', 'knife'][i - 1]);
      });
    }
    inp.on('wheel', (d) => {
      if (!this.alive || !this.me || this.inVehicle()) return;
      const order = ['primary', 'secondary', 'gadget0', 'gadget1', 'grenade', 'knife'].filter((s) => (s === 'primary' ? this.me.pw >= 0 : s.startsWith('gadget') ? !!this.me.g[Number(s[6])] : true));
      const i = order.indexOf(this.me.sel);
      send('sw', { slot: order[(i + d + order.length) % order.length] }); audio.switchWeapon();
    });
    inp.on('ping', () => {
      if (this.inVehicle() && this.playing()) { this.vehicleCameraMode = this.renderer.vehicleFirst ? 'chase' : 'first'; return; }
      const v = this.viewer();
      if (!v) return;
      const w = this.crosshairWorld();
      send('ping',{ x: Math.round(w.x), y: Math.round(w.y) });
    });
    inp.on('next', () => { if (!this.alive && this.me) send('spec', { dir: 1 }); });
    inp.on('click', () => { if (!this.alive && this.me && !(this.ui.deployOpen && this.ui.deployOpen())) send('spec', { dir: 1 }); });
    inp.on('freecam', () => { if (this.myTeam() === SPEC) { this.freecam = !this.freecam; if (this.freecam && this.renderer.cam) { this.cam.x = this.renderer.cam.x; this.cam.y = this.renderer.cam.y; } } });
    inp.on('togglefog', () => { if (this.myTeam() === SPEC) this.fogOn = !this.fogOn; });
    inp.on('bigmap', () => { this.bigmap = !this.bigmap; });
    inp.on('deploy', () => this.ui.toggleDeploy && this.ui.toggleDeploy());
    inp.on('score', (d) => this.ui.showScore && this.ui.showScore(d));
    inp.on('menu', () => { if (performance.now() - (this._unlockAt || 0) < 100) return; this.ui.toggleMenu && this.ui.toggleMenu(); });
    inp.on('chatAll', () => this.ui.openChat && this.ui.openChat(false));
    inp.on('chatTeam', () => this.ui.openChat && this.ui.openChat(true));
  }

  screenToWorld(sx, sy) { return this.renderer.screenToWorld(sx, sy); }

  /** the ground point the crosshair (screen centre) is on; the mouse cursor while a menu or the spectator view is up */
  crosshairWorld() {
    if (this.playing() && this.renderer.aimGround) return this.renderer.aimGround;
    return this.screenToWorld(this.input.mx, this.input.my);
  }

  /** alive, in the field and no menu in the way: the mouse steers the camera */
  playing() { return !!(this.active && this.alive && this.me && this.me.own && !(this.ui.isOverlayOpen && this.ui.isOverlayOpen()) && !this.freecam); }

  /** mouse-look. On foot and in weapon seats the mouse sets the aim direction (yaw); drivers without a weapon steer with the
   *  keys and only glance around (the view swings back behind the vehicle). Spectators follow the watched player. */
  updateLook(dt) {
    const inp = this.input;
    const typing = this.ui.chatOpen || this.ui.pauseOpen;
    inp.lookEnabled = !!this.active && !typing && !(this.ui.isOverlayOpen && this.ui.isOverlayOpen());
    if (inp.locked && !inp.lookEnabled) inp.releaseLock();
    // back in the game after a menu / chat: take the mouse again while the click / key press that closed it still counts
    if (inp.lookEnabled && !inp.locked && !inp.lockDenied && this.playing() && navigator.userActivation && navigator.userActivation.isActive && performance.now() - (this._lockTry || 0) > 400) { this._lockTry = performance.now(); inp.requestLock(); }
    const look = inp.takeLook();
    const rc = this.recoil;
    // recoil settles quickly once the trigger is released
    if (rc.hot > 0) rc.hot -= dt;
    const decay = Math.exp(-(rc.hot > 0 ? 2.6 : 9) * dt);
    rc.p *= decay; rc.y *= decay;
    this.lookRate.y = 0; this.lookRate.p = 0;
    if (!inp.lookEnabled) return;
    const own = this.alive && this.me && this.me.own;
    // toggled aiming ends when you reload or start sprinting
    if (inp.adsToggle && inp.right && own && this.me && (this.me.rel > 0 || this.me.spr)) inp.right = false;
    let sens = this.sens;
    const v = this._lastViewer;
    // the mouse turns the view more slowly the more you are zoomed in
    if (v && v.scoped) sens *= this.zoomMul(v.scopeLvl);
    if (own && this.me.veh && inp.right && this.vehDef().seats[this.me.veh.seat].weapon) sens *= .55;
    const dx = look.dx * sens, dy = look.dy * sens * (this.invertY ? -1 : 1);
    this.lookRate.y = dx; this.lookRate.p = -dy;
    if (own && this.me.veh) {
      const def = this.vehDef(), sd = def.seats[this.me.veh.seat];
      const key = `${this.me.veh.id}:${this.me.veh.seat}`;
      const heading = this.inDriverSeat() ? this.predVeh.a : ((this.interpolatedVeh(this.me.veh.id) || {}).a || 0);
      const follow = !sd.weapon;
      if (this.lookKey !== key) {
        this.lookKey = key;
        this.vehicleCameraMode = 'auto';
        inp.right = false;
        this._gunAim = null;
        if (!this._lastVehicleId || this._lastVehicleId !== this.me.veh.id) this.vehiclePitch = -.08;
        this._lastVehicleId = this.me.veh.id;
        this.followYaw = heading;
        this.yaw = sd.aim === 'turret' ? this.me.veh.ta : sd.aim === 'free' ? this.me.veh.sa : heading;
      }
      // Driving keys steer the hull; free look stays where the player leaves it.
      if (follow) {
        let turn = heading - this.followYaw;
        while (turn > Math.PI) turn -= Math.PI * 2;
        while (turn < -Math.PI) turn += Math.PI * 2;
        this.yaw += turn;
      }
      this.followYaw = heading;
      this.yaw += dx;
      this.vehiclePitch = clamp(this.vehiclePitch - dy, sd.aim === 'free' ? -1.25 : -.75, sd.aim === 'free' ? 1.25 : .85);
    } else if (own || (!this.spec && !this.freecam) || this.freecam) {
      this.lookKey = '';
      this.yaw += dx;
      this.pitch = clamp(this.pitch - dy, -1.45, 1.45);
      this.elev = clamp(this.elev + dy * 0.8, 0.06, 1.25);
    } else {
      // spectating someone: look through their eyes
      this.lookKey = '';
      const vw = this.viewer();
      if (vw) { this.yaw = lerpAngle(this.yaw, vw.angle, 1 - Math.exp(-14 * dt)); this.pitch += ((vw.pitch || 0) - this.pitch) * (1 - Math.exp(-14 * dt)); }
    }
    while (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    while (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  /** field-of-view multiplier of the current aiming zoom (1 = none) */
  zoomMul(lvl) { return [0.78, 0.4, 0.22, 0.14][clamp(lvl || 0, 0, 3)]; }

  viewYaw() { return this.yaw + this.recoil.y; }
  viewPitch() { return clamp(this.pitch + this.recoil.p, -1.5, 1.5); }

  // ------------------------------------------------------------------ frame loop
  frame(nowMs) {
    this._raf = requestAnimationFrame(this.frame);
    if (!this.active) return;
    let dt = (nowMs - this.lastTime) / 1000;
    this.lastTime = nowMs;
    if (dt > 0.25) dt = 0.25;
    this.stats.frames++; this.stats.t += dt;
    if (this.stats.t >= 1) { this.stats.fps = Math.round(this.stats.frames / this.stats.t); this.stats.frames = 0; this.stats.t = 0; }
    this.playerCache = null; this.vehCache = null; this.projCache = null;

    this.updateLook(dt);
    this.fixedUpdate(dt);
    this.fx.update(dt);
    this.engineSounds(dt);
    audio.tick();
    this.renderer.render(dt, nowMs);
    if (this.alive) this.renderer.autoQuality(dt);
    this.ui.onFrame && this.ui.onFrame(this, dt);
  }

  /** engine loops: nearby vehicles that are actually moving (or any helicopter) make noise, louder when driven */
  engineSounds(dt) {
    const v = this.viewer();
    if (!v || !this.alive) return;
    const seen = new Set();
    for (const c of this.vehiclesDrawn()) {
      if (c.hp <= 0) continue;
      seen.add(c.id);
      const last = this._enginePos.get(c.id);
      this._enginePos.set(c.id, { x: c.x, y: c.y });
      if (Math.hypot(c.x - v.x, c.y - v.y) > 900) continue;
      const kind = VEHICLE_LIST[c.ty];
      // Snapshot corrections and map changes can jump position; they are not engine RPM.
      const speed = last && dt > 0 ? Math.min(VEHICLES[kind].maxSpeed * 1.1, Math.hypot(c.x - last.x, c.y - last.y) / dt) : 0;
      if (c.occ || speed > 12) audio.engine(kind, speed + (kind === 'heli' ? 0 : Math.abs(c.own ? this.predVeh.throttle || 0 : c.throttle || 0) * 50), { x: c.x, y: c.y, z: c.z + 16 }, c.id);
    }
    for (const id of this._enginePos.keys()) if (!seen.has(id)) this._enginePos.delete(id);
  }

  fixedUpdate(dt) {
    this.acc = Math.min(this.acc + dt, 0.1);
    // aim angle from the mouse, relative to where the player currently is on screen
    const v = this.viewer();
    if (v && this.alive && this.me && this.me.own) {
      const a = this.me.veh ? this.renderer.vehicleAim : this.renderer.aimGround;
      const freeGun = this.me.veh && this.vehDef().seats[this.me.veh.seat].aim === 'free';
      const origin = freeGun ? vehicleGunMount({ ...(this.interpolatedVeh(this.me.veh.id) || this.me.veh), x: v.x, y: v.y, z: v.z, def: this.vehDef() }, this.me.veh.seat) : v;
      this.angle = this.me.veh && a ? Math.atan2(a.y - origin.y, a.x - origin.x) : this.viewYaw();
      if (a) {
        const distance = Math.hypot(a.x - v.x, a.y - v.y);
        this.aimDist = clamp(distance, 1, 2000);
        this.aimHeight = a.z ?? 14;
      }
    }
    audio.setListener(v ? v.x : 0, v ? v.y : 0, this.viewYaw(), v?.eye ?? (v?.z || 0) + 26, this.map);
    // local turret slew (cosmetic; the server's value is the truth)
    if (this.me && this.me.veh && this.me.own) {
      const def = this.vehDef(), sd = def.seats[this.me.veh.seat];
      if (sd.aim === 'turret' && this._ta !== undefined) {
        let d = this.angle - this._ta; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
        this._ta += clamp(d, -sd.turn * dt, sd.turn * dt);
        const e = this.me.veh.ta; let dd = e - this._ta; while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2;
        this._ta += dd * Math.min(1, dt * 3);
      }
    }

    if (this.me?.own && this.me.veh && this.vehDef().seats[this.me.veh.seat].aim === 'free') {
      this.gunnerAngle();
      const sd = this.vehDef().seats[this.me.veh.seat], aim = this._gunAim;
      const d = Math.atan2(Math.sin(this.angle - aim.angle), Math.cos(this.angle - aim.angle));
      aim.angle += clamp(d, -sd.turn * dt, sd.turn * dt);
    }
    const batch = [];
    while (this.acc >= DT) {
      this.acc -= DT;
      if (!(this.alive && this.me && this.me.own && this.predValid)) continue;
      const keys = this.ui.inputBlocked && this.ui.inputBlocked() ? 0 : this.input.keys();
      const seq = ++this.seq;
      const cmd = [seq, keys, Math.round(this.angle * 1000) / 1000, Math.round(this.renderTime() * 1000) / 1000, Math.round(this.aimDist), Math.round(this.viewPitch() * 1000) / 1000, this.me.veh ? Math.round(this.aimHeight * 10) / 10 : null, this.me.veh ? this.renderer.vehicleAim?.x ?? null : null, this.me.veh ? this.renderer.vehicleAim?.y ?? null : null];
      if (this.inDriverSeat()) {
        stepVehicle(this.map, this.predVeh, this.vehDef(), keys, this.angle);
      } else if (!this.me.veh) {
        const prof = this.profile();
        const scoped = !!(keys & KEY.SCOPE) && prof.can;
        const walk = !!(keys & KEY.WALK) || this.pred.cf > 0.5;
        const sprint = !!(keys & KEY.SPRINT) && (keys & KEY.UP) !== 0 && !scoped && !walk && !(keys & KEY.FIRE);
        const [ax, ay] = relativeDir(keys, this.angle);
        const vz0 = this.pred.vz;
        stepMovement(this.map, this.pred, keys, maxSpeedFor(prof, walk, scoped, sprint), false, ax, ay);
        if (vz0 < -75 && this.pred.vz === 0) { this.landDip = Math.min(1, -vz0 / 300); audio.ownStep(true); }   // landing thump
        // your own footsteps (the server only sends everybody else's)
        const spd = Math.hypot(this.pred.vx, this.pred.vy);
        if (this.pred.z <= this.map.groundAt(this.pred.x, this.pred.y, 11, this.pred.z) + .01 && spd > 45 && this.pred.cf < 0.5 && !walk) { this.stepAcc = (this.stepAcc || 0) + spd * DT; if (this.stepAcc > 44) { this.stepAcc = 0; audio.ownStep(false); } }
        this.predictFire(keys, seq);
      }
      this.pending.push(cmd);
      batch.push(cmd);
    }
    if (batch.length) this.net.send({ t: 'in', c: batch });
    // sub-tick extrapolation keeps 144 Hz displays smooth
    this.ext = null;
    if (this.alive && this.predValid && this.map) {
      if (this.inDriverSeat()) {
        const pv = this.predVeh;
        if (pv.vx || pv.vy || pv.vz) { const def = this.vehDef(); const r = this.map.moveCircle(pv.x, pv.y, pv.vx * this.acc, pv.vy * this.acc, def.r, def.kind === 'air' ? this.map.aircraftMask(pv.flightZ) : def.kind === 'boat' ? this.map.blockBoat : this.map.blockInf); this.ext = { x: r.x - pv.x, y: r.y - pv.y, z: (pv.vz || 0) * this.acc }; }
      } else if (!this.me.veh && (this.pred.vx || this.pred.vy)) {
        const r = this.map.moveCircle(this.pred.x, this.pred.y, this.pred.vx * this.acc, this.pred.vy * this.acc, 11, this.map.blockFoot, this.pred.z);
        this.ext = { x: r.x - this.pred.x, y: r.y - this.pred.y };
      }
    }
    const k = Math.exp(-14 * dt);
    this.errX *= k; this.errY *= k; this.errZ *= k;
    if (this.shots.cd > 0) this.shots.cd -= dt;
  }

  /** Immediate local feedback for our own shots (muzzle flash, sound) — the server stays authoritative. */
  predictFire(keys, seq) {
    const fire = (keys & KEY.FIRE) !== 0;
    const edge = fire && !this.shots.prevFire;
    this.shots.prevFire = fire;
    const me = this.me;
    if (!fire) this.shots.throwing = false;
    if (fire && me?.hb) this.shots.throwing = true;
    if (!fire || !me || this.shots.throwing || me.hb || me.held >= HELD_GREN_BASE || me.pw < 0) return;
    const w = WEAPON_LIST[me.held];
    if (!w || w.kind === 'knife' || me.rel > 0 || this.shots.cd > 0 || me.spr) return;
    if (me.alt) return;
    if (!w.auto && !edge) return;
    if (this.predictedClip() <= 0) return;
    this.shots.cd = this.heldCd(me);
    this.shots.fired.push(seq);
    this.muzzle.set(this.you, performance.now() + 70);
    audio.shot(w.kind, null, this.heldSuppressed(me), true);
    // camera kick: up, with a little sideways wander; less when aiming down the sights
    const rw = this.heldWeapon(me) || w;
    const ads = (keys & KEY.SCOPE) !== 0;
    const kd = (0.16 + rw.kick * 0.22) * (ads ? 0.62 : 1) * Math.PI / 180;
    this.recoil.p = Math.min(0.045, this.recoil.p + kd * 0.45);   // vertical kick only: a random sideways swing made the aim feel loose
    this.recoil.hot = 0.16;
    this.shotKick = 1;
    const v = this.viewer();
    if (v) this.fx.casing(v.x, v.y, this.angle, v.eye - 4);
  }

  heldWeapon(me) {
    const lo = this.kit;
    if (!lo) return WEAPON_LIST[me.held];
    if (WEAPON_LIST[me.held] && lo.primary && WEAPON_LIST[me.held].id === lo.primary.id) return resolveWeapon(lo.primary.id, lo.primary.att);
    if (WEAPON_LIST[me.held] && lo.secondary && WEAPON_LIST[me.held].id === lo.secondary.id) return resolveWeapon(lo.secondary.id, lo.secondary.att);
    return WEAPON_LIST[me.held];
  }
  heldCd(me) { const w = this.heldWeapon(me); return w ? w.cd : 0.1; }
  heldSuppressed(me) { const w = this.heldWeapon(me); return !!(w && w.suppressed); }

  predictedClip() { return this.me ? this.me.clip - this.shots.fired.length : 0; }
}

function TILE_SOLID(ch) { return 'BXo=LGT#M'.includes(ch); }
export { GADGET_LIST, HELD_GADGET_BASE, TILE };
