// Client-side game controller: snapshot buffer, interpolation, prediction, events, per-frame loop.
import { DT, PHASE, KEY, SPEC } from '../../../shared/constants.js';
import { WEAPON_LIST, HELD_GREN_BASE, maxSpeedFor } from '../../../shared/weapons.js';
import { getMap } from '../../../shared/maps/index.js';
import { stepMovement } from '../../../shared/movement.js';
import { canSee, viewParams } from '../../../shared/vision.js';
import { audio } from '../audio.js';
import { FX } from './fx.js';
import { Input } from './input.js';
import { buildMapArt } from './mapart.js';
import { Renderer } from './render.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

export class ClientGame {
  constructor(canvas, net, ui) {
    this.canvas = canvas;
    this.net = net;
    this.ui = ui;
    this.input = new Input(canvas);
    this.fx = new FX();
    this.renderer = new Renderer(canvas, this);
    this.active = false;
    this.roster = new Map();
    this.you = 0;
    this.snaps = [];
    this.offset = 0;                 // serverTime - localTime
    this.haveOffset = false;
    this.reset();
    this._bindInput();
    this._last = 0;
    this._raf = 0;
    this.frame = this.frame.bind(this);
  }

  reset() {
    this.map = null; this.art = null;
    this.mode = 'defuse';
    this.phase = PHASE.FREEZE; this.timer = 0; this.timerRecv = 0; this.freezeEnd = 0;
    this.round = 0; this.score = [0, 0]; this.target = 9;
    this.snaps.length = 0;
    this.me = null;                   // latest server-side own (or spectated) state
    this.pred = { x: 0, y: 0, vx: 0, vy: 0 };
    this.predValid = false;
    this.errX = 0; this.errY = 0;     // visual smoothing of prediction corrections
    this.pending = [];
    this.seq = 0;
    this.acc = 0;
    this.alive = false;
    this.rc = -1;
    this.angle = 0;
    this.aimDist = 300;
    this.ents = { g: [], sm: [], fi: [], dr: [], bb: null };
    this.corpses = [];
    this.muzzle = new Map();          // player id -> flash-until (ms)
    this.spotted = new Map();         // enemy id -> {x,y,t} for the radar
    this.hitMarker = 0; this.hitKill = false;
    this.damageDirs = [];             // {a, t}
    this.flashRecv = 0; this.flashLeft = 0; this.flashFull = 0;
    this.shots = { cd: 0, fired: [], prevFire: false };
    this.cam = { x: 0, y: 0 };
    this.freecam = false;
    this.fogOn = true;
    this.pings = [];
    this.bombInfo = null;
    this.lastBeep = 0;
    this.msgBanner = null;
    this.money = 0;
    this.lastMoney = 0;
    this.buyOpen = false;
    this.scoreOpen = false;
    this.bigmap = false;
    this.deathInfo = null;
    this.spec = 0;
    this.smokeSeed = new Map();
    this.introT = 0;
    this.vision = null;
    this.stats = { fps: 0, frames: 0, t: 0 };
    this.recvAt = 0;
    this.lastTimerBeep = -1;
  }

  // ------------------------------------------------------------------ lifecycle
  startMatch(info) {
    this.reset();
    this.mode = info.mode;
    this.map = getMap(info.map);
    this.art = buildMapArt(this.map);
    this.fx.initMap(this.map);
    this.renderer.setMap(this.map, this.art);
    this.score = info.score || [0, 0];
    this.target = info.target || 9;
    this.round = info.round || 0;
    this.phase = info.phase ?? PHASE.FREEZE;
    this.active = true;
    this.input.enabled = true;
    this.lastTime = performance.now();
    if (!this._raf) this._raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.active = false;
    this.input.enabled = false;
    cancelAnimationFrame(this._raf); this._raf = 0;
  }

  teamOf(id) { const r = this.roster.get(id); return r ? r.tm : -1; }
  myTeam() { return this.teamOf(this.you); }
  nameOf(id) { const r = this.roster.get(id); return r ? r.n : '?'; }

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
    this.freezeEnd = s.fe || 0;
    this.respawnIn = s.rs !== undefined ? s.rs : -1;
    if (s.sc) this.score = s.sc;
    this.timer = s.rt; this.timerRecv = now;
    const players = new Map();
    for (const t of s.p) players.set(t[0], t);
    const snap = { st, recv: now, players, tk: s.tk };
    this.snaps.push(snap);
    if (this.snaps.length > 30) this.snaps.shift();

    // world entities
    this.ents = { g: s.g || [], sm: s.sm || [], fi: s.fi || [], dr: s.dr || [], bb: s.bb || null };
    this.bombInfo = s.bb || null;

    // own / spectated state
    if (s.me) {
      const wasAlive = this.alive;
      this.me = s.me;
      this.spec = s.spec;
      this.alive = !!s.al;
      this.money = s.me.money ?? this.money;
      if (s.me.own) this.reconcile(s, wasAlive);
      this.flashRecv = now; this.flashLeft = s.me.fl; this.flashFull = s.me.ff;
      if (s.me.fl > 0.05 && !this._flashing) { this._flashing = true; audio.flashRing(); }
      if (s.me.fl <= 0.05) this._flashing = false;
    } else { this.me = null; this.alive = !!s.al; }

    if (s.ev) this.processEvents(s.ev);
    this.ui.onSnapshot && this.ui.onSnapshot(this, s);
  }

  reconcile(s, wasAlive) {
    const me = s.me;
    if (!this.predValid || me.rc !== this.rc || !wasAlive) {
      this.rc = me.rc;
      this.pred = { x: me.x, y: me.y, vx: me.vx, vy: me.vy };
      this.pending.length = 0;
      this.shots.fired.length = 0;
      this.errX = this.errY = 0;
      this.predValid = true;
      if (this.alive) { this.fx.clearRound && me.rc !== this._lastRc && this.onRespawn(); this._lastRc = me.rc; }
      return;
    }
    // drop acknowledged commands, replay the rest on top of the authoritative state
    while (this.pending.length && this.pending[0][0] <= s.ack) this.pending.shift();
    this.shots.fired = this.shots.fired.filter((q) => q > s.ack);
    const st = { x: me.x, y: me.y, vx: me.vx, vy: me.vy };
    const w = me.held < HELD_GREN_BASE ? WEAPON_LIST[me.held] : null;
    for (const c of this.pending) {
      const keys = c[1];
      const frozen = this.isFrozenAt(c[3]);
      const scoped = !!(keys & KEY.SCOPE) && !!w && w.kind !== 'knife';
      stepMovement(this.map, st, keys, maxSpeedFor(w, !!(keys & KEY.WALK), scoped), frozen);
    }
    const ex = this.pred.x - st.x, ey = this.pred.y - st.y;
    if (Math.hypot(ex, ey) > 70) { this.errX = this.errY = 0; }
    else { this.errX += ex; this.errY += ey; }
    this.pred.x = st.x; this.pred.y = st.y; this.pred.vx = st.vx; this.pred.vy = st.vy;
  }

  /** Same rule the server applies to a command stamped `vt` (render time): movement is locked until freezeEnd. */
  isFrozenAt(vt) {
    if (this.mode !== 'defuse' || !this.freezeEnd) return false;
    return Math.round((vt + 0.1) * 1000) / 1000 < this.freezeEnd;
  }

  onRespawn() {
    this.deathInfo = null;
    this.ui.onRespawn && this.ui.onRespawn();
  }

  // ------------------------------------------------------------------ events from the server
  weaponOf(idx) { return WEAPON_LIST[idx]; }

  visiblePoint(x, y) {
    const v = this.viewer();
    if (!v || !this.fogOn) return true;
    return canSee(this.map, this.smokeCircles(), v.x, v.y, v.angle, v.view, x, y, 0, 6);
  }

  smokeCircles() { return this.ents.sm.map((s) => ({ x: s[1], y: s[2], r: s[3] })); }

  processEvents(evs) {
    const fx = this.fx, now = performance.now();
    for (const e of evs) {
      switch (e[0]) {
        case 'shot': {
          const [, pid, widx, x, y, ang, len, kind, sub, supp] = e;
          const w = WEAPON_LIST[widx];
          const own = pid === this.you && !!this.me && this.me.own;
          const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
          const seen = own || this.visiblePoint(x, y) || this.visiblePoint(ex, ey);
          if (!own && !sub) audio.shot(w.kind, { x, y }, !!supp);
          if (!own && !sub) this.muzzle.set(pid, now + 70);
          if (seen) {
            fx.tracer(x + Math.cos(ang) * 14, y + Math.sin(ang) * 14, ex, ey, own, w.kind === 'sniper');
            if (kind === 1) fx.sparks(ex, ey, ang, 4);
            else if (kind === 2) fx.blood(ex, ey, ang, 7);
            if (!own && !sub && w.kind !== 'shotgun' && Math.random() < 0.6) fx.casing(x, y, ang);
          }
          break;
        }
        case 'knife': audio.knife({ x: e[2], y: e[3] }, !!e[5]); this.muzzle.set(e[1], now + 120); break;
        case 'step': { const t = e[4]; if (e[1] !== this.you) audio.step({ x: e[2], y: e[3] }); void t; break; }
        case 'rel': if (e[1] !== this.you) audio.reload({ x: e[2], y: e[3] }); break;
        case 'nade': audio.throwNade({ x: e[2], y: e[3] }); break;
        case 'boom': this.onBoom(e[1], e[2], e[3]); break;
        case 'hurt': this.onHurt(e[1], e[2]); break;
        case 'hitm': this.hitMarker = now; this.hitKill = !!e[2]; audio.hitmarker(!!e[2]); break;
        case 'die': this.onDie(e); break;
        case 'plant_start': audio.plantTick({ x: e[2], y: e[3] }); break;
        case 'defuse_start': audio.plantTick({ x: e[2], y: e[3] }); break;
        case 'planted': audio.planted({ x: e[2], y: e[3] }); break;
        case 'defused': audio.defused(); break;
        case 'beep': {
          const left = e[3];
          audio.beep({ x: e[1], y: e[2] }, left < 10 ? 1 : 0);
          if (left < 6) setTimeout(() => audio.beep({ x: e[1], y: e[2] }, 1), 250);
          if (left < 3) setTimeout(() => audio.beep({ x: e[1], y: e[2] }, 1), 500);
          break;
        }
        case 'pickup': if (e[1] !== this.you) audio.pickup({ x: e[2], y: e[3] }); else audio.pickup(null); break;
        case 'buy': if (e[1] === this.you) audio.buy(); break;
        case 'empty': audio.empty(); break;
        default: break;
      }
    }
  }

  onBoom(kind, x, y) {
    const fx = this.fx;
    const v = this.viewer();
    const d = v ? Math.hypot(v.x - x, v.y - y) : 9999;
    if (kind === 'he') { fx.explosion(x, y, false); audio.explosion('he', { x, y }); fx.addShake(clamp(12 - d / 60, 0, 10)); }
    else if (kind === 'bomb') { fx.explosion(x, y, true); audio.explosion('bomb', { x, y }); fx.addShake(clamp(24 - d / 90, 2, 14)); }
    else if (kind === 'flash') { fx.flashBurst(x, y); audio.flash({ x, y }); }
    else if (kind === 'smoke') { audio.smoke({ x, y }); for (let i = 0; i < 10; i++) fx.parts.push({ k: 'puff', x, y, vx: (Math.random() - 0.5) * 160, vy: (Math.random() - 0.5) * 160, life: 0.7, t: 0, r: 8, grow: 22, col: '210,210,210', a0: 0.3 }); }
    else if (kind === 'molo') { fx.molotovSplash(x, y); audio.molotov({ x, y }); }
  }

  onHurt(dmg, from) {
    this.damageDirs.push({ a: from, t: performance.now(), d: dmg });
    this.fx.addShake(Math.min(6, 1 + dmg / 12));
    audio.hurt();
  }

  onDie(e) {
    const [, id, x, y, ang, team] = e;
    this.corpses.push({ id, x, y, a: ang, team, t: performance.now() });
    if (this.corpses.length > 30) this.corpses.shift();   // deathmatch never clears them
    this.fx.corpseStain(x, y);
    audio.death({ x, y });
    if (id === this.you) this.ui.onDeath && this.ui.onDeath();
  }

  // ------------------------------------------------------------------ viewer (whose eyes are we looking through)
  viewer() {
    if (!this.map) return null;
    let x, y, angle, scoped = false, scopeLvl = 0;
    if (this.alive && this.me && this.me.own) {
      // predicted position, advanced by the fraction of a tick that has elapsed so 144 Hz displays stay smooth
      x = this.pred.x + this.errX + (this.ext ? this.ext.x : 0); y = this.pred.y + this.errY + (this.ext ? this.ext.y : 0); angle = this.angle;
      const w = this.me.held < HELD_GREN_BASE ? WEAPON_LIST[this.me.held] : null;
      scopeLvl = w ? w.scope : 0;
      scoped = !!(this.input.right && w && w.kind !== 'knife');
    } else if (this.spec && !this.freecam) {
      const p = this.interpolated(this.spec);
      if (!p) return this._lastViewer || null;
      x = p.x; y = p.y; angle = p.a;
      const w = p.held < HELD_GREN_BASE ? WEAPON_LIST[p.held] : null;
      scopeLvl = w ? w.scope : 0; scoped = !!(p.fl & 1);
    } else return this._lastViewer || null;
    const v = { x, y, angle, scoped, scopeLvl, view: viewParams(scoped, scopeLvl) };
    this._lastViewer = v;
    return v;
  }

  /** Interpolated state of a remote player at render time. */
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
      // fall back to the latest snapshot that has this player (they may have just become visible)
      for (let i = snaps.length - 1; i >= 0; i--) { const t = snaps[i].players.get(id); if (t) return this._tuple(t); }
      return null;
    }
    if (a && b && s1.st > s0.st) {
      const k = clamp((rt - s0.st) / (s1.st - s0.st), 0, 1);
      return { id, x: lerp(a[1], b[1], k), y: lerp(a[2], b[2], k), a: lerpAngle(a[3], b[3], k), hp: b[4], held: b[5], fl: b[6], ar: b[7] };
    }
    return this._tuple(a || b);
  }

  _tuple(t) { return { id: t[0], x: t[1], y: t[2], a: t[3], hp: t[4], held: t[5], fl: t[6], ar: t[7] }; }

  // ------------------------------------------------------------------ input actions
  _bindInput() {
    const inp = this.input;
    const send = (a, extra) => this.net.send({ t: 'a', a, ...extra });
    inp.on('reload', () => send('reload'));
    inp.on('drop', () => send('drop'));
    inp.on('last', () => send('sw', { slot: 'last' }));
    inp.on('slot1', () => { if (this.alive) { send('sw', { slot: 'primary' }); audio.switchWeapon(); } });
    inp.on('slot2', () => { if (this.alive) { send('sw', { slot: 'secondary' }); audio.switchWeapon(); } });
    inp.on('slot3', () => { if (this.alive) { send('sw', { slot: 'knife' }); audio.switchWeapon(); } });
    inp.on('slot4', () => { if (this.alive) { send('sw', { slot: 'grenade' }); audio.switchWeapon(); } });
    inp.on('wheel', (d) => {
      if (!this.alive || !this.me) return;
      const order = ['primary', 'secondary', 'knife'];
      const cur = this.me.sel === 'grenade' ? 'knife' : this.me.sel;
      let i = order.indexOf(cur);
      for (let n = 0; n < 3; n++) {
        i = (i + d + 3) % 3;
        if (order[i] === 'primary' && this.me.pri < 0) continue;
        break;
      }
      send('sw', { slot: order[i] }); audio.switchWeapon();
    });
    inp.on('rebuy', () => send('rebuy'));
    inp.on('ping', () => {
      const v = this.viewer();
      if (!v) return;
      const w = this.screenToWorld(inp.mx, inp.my);
      send('ping', { x: Math.round(w.x), y: Math.round(w.y) });
    });
    inp.on('next', () => { if (!this.alive) send('spec', { dir: 1 }); });
    inp.on('click', () => { if (!this.alive && this.me) send('spec', { dir: 1 }); });
    inp.on('freecam', () => { if (this.myTeam() === SPEC) { this.freecam = !this.freecam; if (this.freecam && this.renderer.cam) { this.cam.x = this.renderer.cam.x; this.cam.y = this.renderer.cam.y; } } });
    inp.on('togglefog', () => { if (this.myTeam() === SPEC) this.fogOn = !this.fogOn; });
    inp.on('bigmap', () => { this.bigmap = !this.bigmap; });
    inp.on('buy', () => this.ui.toggleBuy && this.ui.toggleBuy());
    inp.on('score', (d) => this.ui.showScore && this.ui.showScore(d));
    inp.on('menu', () => this.ui.toggleMenu && this.ui.toggleMenu());
    inp.on('chatAll', () => this.ui.openChat && this.ui.openChat(false));
    inp.on('chatTeam', () => this.ui.openChat && this.ui.openChat(true));
  }

  screenToWorld(sx, sy) { return this.renderer.screenToWorld(sx, sy); }

  // ------------------------------------------------------------------ frame loop
  frame(nowMs) {
    this._raf = requestAnimationFrame(this.frame);
    if (!this.active) return;
    let dt = (nowMs - this.lastTime) / 1000;
    this.lastTime = nowMs;
    if (dt > 0.25) dt = 0.25;
    this.stats.frames++; this.stats.t += dt;
    if (this.stats.t >= 1) { this.stats.fps = Math.round(this.stats.frames / this.stats.t); this.stats.frames = 0; this.stats.t = 0; }

    this.fixedUpdate(dt);
    this.fx.update(dt);
    this.renderer.render(dt, nowMs);
    this.ui.onFrame && this.ui.onFrame(this, dt);
  }

  fixedUpdate(dt) {
    this.acc = Math.min(this.acc + dt, 0.1);
    // aim angle from the mouse, relative to where the player currently is on screen
    const v = this.viewer();
    if (v && this.alive && this.me && this.me.own) {
      const ps = this.renderer.worldToScreen(v.x, v.y);
      this.angle = Math.atan2(this.input.my - ps.y, this.input.mx - ps.x);
      const wm = this.screenToWorld(this.input.mx, this.input.my);
      this.aimDist = Math.hypot(wm.x - v.x, wm.y - v.y);
    }
    audio.setListener(v ? v.x : 0, v ? v.y : 0);

    const batch = [];
    while (this.acc >= DT) {
      this.acc -= DT;
      if (!(this.alive && this.me && this.me.own && this.predValid)) continue;
      const keys = this.ui.inputBlocked && this.ui.inputBlocked() ? 0 : this.input.keys();
      const seq = ++this.seq;
      const cmd = [seq, keys, Math.round(this.angle * 1000) / 1000, Math.round(this.renderTime() * 1000) / 1000, Math.round(this.aimDist)];
      const w = this.me.held < HELD_GREN_BASE ? WEAPON_LIST[this.me.held] : null;
      const scoped = !!(keys & KEY.SCOPE) && !!w && w.kind !== 'knife';
      const frozen = this.isFrozenAt(cmd[3]);
      stepMovement(this.map, this.pred, keys, maxSpeedFor(w, !!(keys & KEY.WALK), scoped), frozen);
      this.pending.push(cmd);
      batch.push(cmd);
      this.predictFire(keys, w, seq);
    }
    if (batch.length) this.net.send({ t: 'in', c: batch });
    if (this.alive && this.predValid && this.map && (this.pred.vx || this.pred.vy) && !this.isFrozenAt(this.renderTime())) {
      const r = this.map.moveCircle(this.pred.x, this.pred.y, this.pred.vx * this.acc, this.pred.vy * this.acc, 11);
      this.ext = { x: r.x - this.pred.x, y: r.y - this.pred.y };
    } else this.ext = null;
    // decay the visual smoothing offset
    const k = Math.exp(-14 * dt);
    this.errX *= k; this.errY *= k;
    if (this.shots.cd > 0) this.shots.cd -= dt;
  }

  /** Immediate local feedback for our own shots (muzzle flash, sound) — the server stays authoritative. */
  predictFire(keys, w, seq) {
    const fire = (keys & KEY.FIRE) !== 0;
    const edge = fire && !this.shots.prevFire;
    this.shots.prevFire = fire;
    if (!fire || !w || w.kind === 'knife' || !this.me || this.phase === PHASE.POST) return;
    if (this.me.rel > 0 || this.shots.cd > 0) return;
    if (!w.auto && !edge) return;
    if (this.predictedClip() <= 0) return;
    this.shots.cd = w.cd;
    this.shots.fired.push(seq);
    this.muzzle.set(this.you, performance.now() + 70);
    const v = this.viewer();
    audio.shot(w.kind, null, w.suppressed, true);
    this.fx.addShake(w.kick * 0.5);
    if (v) { this.fx.casing(v.x, v.y, this.angle); }
  }

  predictedClip() { return this.me ? this.me.clip - this.shots.fired.length : 0; }
}
