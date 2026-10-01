// Bot AI. Bots drive the exact same movement/combat code as humans and only know what they can see or hear.
// They play the objective (flags, M-COM stations), use every class's gadgets, revive and repair, and drive vehicles.
import { KEY, T, CT, SPEC, PHASE, TILE, RULES } from '../../shared/constants.js';
import { WEAPONS, CLASSES, CLASS_ORDER, SIDEARMS, attachOptions, normAtt, GADGETS } from '../../shared/weapons.js';
import { VEHICLES } from '../../shared/vehicles.js';
import { canSee, viewParams } from '../../shared/vision.js';
import { angleDiff, rayCircle } from '../../shared/gamemap.js';
import { startReload, selectSlot } from '../combat.js';

export const BOT_NAMES = [
  'Viper', 'Ghost', 'Rook', 'Nova', 'Blitz', 'Echo', 'Dagger', 'Hex', 'Raven', 'Tango', 'Sable', 'Onyx', 'Flint', 'Jinx',
  'Kilo', 'Mako', 'Orbit', 'Pixel', 'Quill', 'Rex', 'Slate', 'Talon', 'Umber', 'Vex', 'Wolf', 'Yeti', 'Zed', 'Bishop',
  'Cobra', 'Drift', 'Ember', 'Fable', 'Gizmo', 'Havoc', 'Iron', 'Joker',
];

// sigma = aim wander (rad), lag = how far behind a moving target the aim trails (s), kick = aim disturbance per shot (rad),
// turn = peak turn rate (rad/s). Bots are meant to miss, lose track of crossing targets and hesitate like people do.
const DIFF = {
  easy:   { sight: 520, react: 0.55, turn: 4.5, sigma: 0.070, burst: 0.55, aggr: 0.25, hold: 0.45, lag: 0.16, kick: 0.028 },
  normal: { sight: 700, react: 0.34, turn: 7,   sigma: 0.042, burst: 0.75, aggr: 0.45, hold: 0.7,  lag: 0.10, kick: 0.020 },
  hard:   { sight: 840, react: 0.24, turn: 10,  sigma: 0.032, burst: 0.9,  aggr: 0.6,  hold: 0.85, lag: 0.07, kick: 0.015 },
  expert: { sight: 980, react: 0.17, turn: 13,  sigma: 0.026, burst: 1.0,  aggr: 0.75, hold: 1.0,  lag: 0.05, kick: 0.012 },
};

const rnd = Math.random;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 1.15;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const norm = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

/** How far each weapon kind is worth firing at, in pixels. */
const RANGE = { pistol: 480, smg: 560, shotgun: 340, rifle: 820, lmg: 780, dmr: 1150, sniper: 2600, knife: 60 };

// ------------------------------------------------------------------------------------------------ team planning
export class TeamMind {
  constructor(game) {
    this.g = game;
    this.contact = [null, null];        // last enemy contact reported by each team: {x,y,t}
    this.squadTarget = new Map();       // "team:squad" -> { id, since }
    this.checkT = 0;
    this.classCount = [{}, {}];
  }

  update(dt) {
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = 2.5;
    const g = this.g;
    if (g.phase !== PHASE.LIVE) return;
    if (g.modeId === 'conquest') this.planConquest();
  }

  report(team, x, y) { this.contact[team] = { x, y, t: this.g.time }; }

  /** Each squad picks a flag: enemy/neutral flags near it are worth the most; contested own flags need defenders. */
  planConquest() {
    const g = this.g;
    for (const team of [T, CT]) {
      const squads = new Map();
      for (const p of g.players.values()) {
        if (p.team !== team || !p.alive || !p.bot) continue;
        if (!squads.has(p.squad)) squads.set(p.squad, []);
        squads.get(p.squad).push(p);
      }
      const load = new Map();
      const list = [...squads.entries()];
      list.sort((a, b) => a[0] - b[0]);
      for (const [sq, members] of list) {
        let cx = 0, cy = 0;
        for (const m of members) { cx += m.x; cy += m.y; }
        cx /= members.length; cy /= members.length;
        const key = `${team}:${sq}`;
        const cur = this.squadTarget.get(key);
        let best = null, bv = -1, curV = -1;
        for (const f of g.flags) {
          let need;
          if (f.owner === team) need = f.n[1 - team] > 0 ? 1.7 : (f.contested ? 1.5 : 0.18);
          else need = f.owner === -1 ? 1.0 : 1.15;
          const d = Math.hypot(f.x - cx, f.y - cy);
          const crowd = (load.get(f.id) || 0) * 0.55;
          const v = need / (1 + d / 1400) - crowd;
          if (cur && cur.id === f.id) curV = v;
          if (v > bv) { bv = v; best = f; }
        }
        let chosen = best;
        if (cur && curV >= 0 && curV * 1.35 >= bv) chosen = g.flags[cur.id];
        if (chosen) {
          load.set(chosen.id, (load.get(chosen.id) || 0) + 1);
          if (!cur || cur.id !== chosen.id) this.squadTarget.set(key, { id: chosen.id, since: g.time });
        }
      }
    }
  }

  /** The objective this bot should be working on: {x, y, r, kind, id} */
  targetFor(p) {
    const g = this.g;
    if (g.modeId === 'conquest') {
      const st = this.squadTarget.get(`${p.team}:${p.squad}`);
      const f = st ? g.flags[st.id] : g.flags[0];
      if (f) return { x: f.x, y: f.y, r: f.r * 0.75, kind: 'flag', id: f.id };
    } else if (g.modeId === 'rush') {
      const ms = g.mcoms.filter((m) => m.stage === g.stage && m.state !== 2);
      if (ms.length) {
        if (p.team === T) {
          const intact = ms.filter((m) => m.state === 0);
          const pool = intact.length ? intact : ms;
          let b = pool[0], bd = Infinity;
          for (const m of pool) { const d = Math.hypot(m.x - p.x, m.y - p.y) + (m.id % 2) * 40 * (p.id % 3); if (d < bd) { bd = d; b = m; } }
          return { x: b.x, y: b.y, r: b.state === 1 ? 260 : 46, kind: 'mcom', id: b.id, armed: b.state === 1 };
        }
        const armed = ms.filter((m) => m.state === 1);
        if (armed.length) {
          let b = armed[0], bd = Infinity;
          for (const m of armed) { const d = Math.hypot(m.x - p.x, m.y - p.y); if (d < bd) { bd = d; b = m; } }
          return { x: b.x, y: b.y, r: 40, kind: 'mcom', id: b.id, disarm: true };
        }
        const m = ms[(p.id + p.squad) % ms.length];
        return { x: m.x, y: m.y, r: 240, kind: 'mcom', id: m.id };
      }
    }
    // deathmatch (or nothing left to do): head for the last known enemy contact, else somewhere in the middle
    const c = this.contact[p.team === T ? CT : T] || this.contact[p.team];
    if (c && g.time - c.t < 20) return { x: c.x, y: c.y, r: 200, kind: 'hunt' };
    const e = g.map.spawnCenter[p.team === T ? CT : T];
    const me = g.map.spawnCenter[p.team];
    const k = 0.3 + ((p.id * 37) % 5) * 0.1;
    return { x: me.x + (e.x - me.x) * k, y: me.y + (e.y - me.y) * k, r: 260, kind: 'hunt' };
  }
}

// ------------------------------------------------------------------------------------------------ the brain
export class BotBrain {
  constructor(game, p, difficulty = 'normal') {
    this.g = game; this.p = p;
    this.setDifficulty(difficulty);
    this.sloppy = 0.75 + rnd() * 0.55;        // this bot's own steadiness: some are sharper than others, for good
    this.reset();
  }

  setDifficulty(d) { this.diff = d; this.d = DIFF[d] || DIFF.normal; }

  reset() {
    const p = this.p;
    this.aim = p.angle || 0;
    this.path = null; this.pathIdx = 0; this.goal = null; this.pathT = 0; this.pathAge = 0;
    this.target = null; this.targetSince = 0; this.visible = false; this.lastSeen = null;
    this.heard = null;
    this.strafeDir = rnd() < 0.5 ? -1 : 1; this.strafeT = 0; this.strafeMove = false;
    this.errA = 0; this.errT = 0; this.av = 0; this.kickA = 0; this.kickP = 0; this.reactJ = 1;
    this.noFireT = 0; this.stuckT = 0; this.travel = 0; this.moveWant = 0; this.lastTX = p.x; this.lastTY = p.y; this.nudgeT = 0; this.nudgeDir = 1;
    this.burstLeft = 4; this.burstPause = 0; this.pulse = false; this.lastClip = 99;
    this.flashedUntil = 0; this.hitBy = null; this.danger = null;
    this.retreat = null; this.retreatCd = 0; this.peek = null; this.peekCd = 0; this.nade = null; this.nadeCd = 4 + rnd() * 6; this.coverCache = null;
    this.percT = 0; this.holdPos = null; this.holdT = 0;
    this.job = null; this.jobCd = 4 + rnd() * 6;
    this.wantVeh = 0; this.vehWait = 0; this.vehStuck = 0; this.vehRev = 0;
    this.searchUntil = 0; this.usedBeacon = false; this.spawnedAt = this.g.time;
    this.usePulse = 0;
  }

  // ---------------------------------------------------------------- events from the game
  onSpawn() {
    this.reset();
    this.deployT = undefined;
    this.aim = this.p.angle;
    this.considerVehicle();
  }
  /** somebody shot us: turn to them at once (even from behind) instead of being killed by an enemy we never noticed */
  onHurt(attacker) {
    if (!attacker || attacker.team === this.p.team || !attacker.alive) return;
    this.hitBy = { id: attacker.id, t: this.g.time };
    this.heard = { x: attacker.x, y: attacker.y, t: this.g.time, kind: 'hit', d: Math.hypot(attacker.x - this.p.x, attacker.y - this.p.y) };
    this.g.mind.report(this.p.team, attacker.x, attacker.y);
    this.percT = 0;
  }
  onFlashed(dur) { this.flashedUntil = Math.max(this.flashedUntil, this.g.time + dur * 0.8); }
  /** a soldier died nearby: a teammate's killer is where the danger is, so remember that spot and approach it carefully */
  onDeathSeen(v, attacker) {
    const p = this.p;
    if (p.team !== v.team || Math.hypot(v.x - p.x, v.y - p.y) > 900) return;
    const from = attacker && attacker.team !== p.team && attacker.alive ? attacker : null;
    const spot = from ? { x: from.x + (rnd() - 0.5) * 90, y: from.y + (rnd() - 0.5) * 90 } : { x: v.x, y: v.y };
    this.danger = { x: spot.x, y: spot.y, t: this.g.time };
    if (!this.visible) this.heard = { x: spot.x, y: spot.y, t: this.g.time };
  }
  hear(x, y, kind) {
    if (this.visible) return;
    const d = Math.hypot(x - this.p.x, y - this.p.y);
    this.heard = { x, y, t: this.g.time, kind, d };
    this.g.mind.report(this.p.team, x, y);
  }

  // ---------------------------------------------------------------- deploying
  pickLoadout() {
    const g = this.g, p = this.p;
    // keep the team's class mix healthy: everyone gets a class, engineers only matter when there are vehicles
    const mate = [...g.players.values()].filter((q) => q.team === p.team && q !== p);
    const count = { assault: 0, engineer: 0, support: 0, recon: 0 };
    for (const q of mate) if (q.cls) count[q.cls]++;
    const weights = { assault: 3, engineer: g.settings.vehicles ? 2 : 1, support: 2.2, recon: 1.2 };
    for (const k of CLASS_ORDER) weights[k] = Math.max(0.15, weights[k] - count[k] * 0.35);
    let sum = 0; for (const k of CLASS_ORDER) sum += weights[k];
    let r = rnd() * sum, cls = 'assault';
    for (const k of CLASS_ORDER) { r -= weights[k]; if (r <= 0) { cls = k; break; } }
    const c = CLASSES[cls];
    const pid = pick(c.primaries);
    const w = WEAPONS[pid];
    const choose = (slot, wp, banned = []) => { const opts = attachOptions(wp, slot).filter((o) => !banned.includes(o)); return opts.length ? pick(opts) : undefined; };
    const att = {
      optic: w.kind === 'sniper' ? 'sniper' : pick(attachOptions(w, 'optic')),
      barrel: choose('barrel', w), under: choose('under', w), mag: choose('mag', w),
    };
    const sid = pick(SIDEARMS);
    const gadgets = c.gadgets.map((list) => {
      if (list.includes('rpg') && rnd() < 0.7) return 'rpg';
      return pick(list.filter((x) => x !== 'stinger'));
    });
    this.loadout = {
      cls, primary: { id: pid, att: normAtt(w, att) }, secondary: { id: sid, att: normAtt(WEAPONS[sid], { optic: rnd() < 0.3 ? 'reddot' : 'iron' }) },
      gadgets, gren: cls === 'recon' ? 'smoke' : pick(['he', 'he', 'he', 'flash', 'smoke']),
    };
    return this.loadout;
  }

  deployNow() {
    const g = this.g, p = this.p;
    if (this.deployT === undefined) this.deployT = g.time + 0.4 + rnd() * 2.2;
    if (g.time < this.deployT) return;
    p.loadout = this.pickLoadout();
    const opts = g.spawnOptions(p).filter((o) => o.ok);
    if (!opts.length) return;
    let choice = null;
    const squadVeh = opts.filter((o) => o.k === 'squad' && o.veh);
    if (squadVeh.length && rnd() < 0.85) choice = pick(squadVeh);
    if (!choice) {
      const tgt = g.mind.targetFor(p);
      let bd = Infinity;
      for (const o of opts) {
        let d = Math.hypot(o.x - tgt.x, o.y - tgt.y);
        if (o.k === 'squad') d *= 0.8;
        if (o.k === 'base') d += 260;
        if (d < bd) { bd = d; choice = o; }
      }
    }
    g.deploy(p, { k: choice.k, id: choice.id, loadout: p.loadout });
  }

  // ---------------------------------------------------------------- vehicles
  considerVehicle() {
    const g = this.g, p = this.p;
    if (!g.settings.vehicles || p.veh || g.vehicles.length === 0) return;
    let best = null, bd = 300;
    for (const v of g.vehicles) {
      if (v.dead || v.def.kind === 'air' || v.def.kind === 'boat') continue;
      if (v.team !== -1 && v.team !== p.team) continue;
      const d = Math.hypot(v.x - p.x, v.y - p.y);
      if (d > bd) continue;
      const occ = v.occupants();
      const driverOk = !v.seats[0] && !this.g.players.get(v.seats[0]);
      const gunnerSeat = v.seats.findIndex((s, i) => i > 0 && !s && v.def.seats[i].weapon);
      const seatOk = driverOk ? 0 : (v.team === p.team && v.seats[0] && this.g.players.get(v.seats[0]) && gunnerSeat > 0 ? gunnerSeat : -1);
      if (seatOk < 0) continue;
      if (occ.length && v.team !== p.team) continue;
      bd = d; best = { v, seat: seatOk };
    }
    if (!best) return;
    const kindP = best.v.def.kind === 'tracked' ? 0.75 : best.v.type === 'quad' ? 0.35 : 0.55;
    if (rnd() > kindP) return;
    this.wantVeh = best.v.id; this.wantSeat = best.seat;
  }

  thinkVehicle(dt) {
    const g = this.g, p = this.p;
    const v = g.vehicleById(p.veh);
    const cmd = { keys: 0, angle: this.aim, aimDist: 300, ax: 0, ay: 0 };
    if (!v) return cmd;
    const seat = p.seat, sd = v.def.seats[seat];
    const eyes = { x: v.x, y: v.y };
    // ---- target selection from the vehicle's sight
    this.percT -= dt;
    if (this.percT <= 0) {
      this.percT = 0.1;
      let best = null, bd = Infinity;
      const view = { range: Math.min(v.def.view.range, 980), fov: v.def.view.fov, air: !!v.def.view.air };
      for (const q of g.players.values()) {
        if (!q.alive || q.veh || q.team === p.team || q.team === SPEC) continue;
        const d = Math.hypot(q.x - v.x, q.y - v.y);
        if (d >= bd) continue;
        if (canSee(g.map, g.smokes, v.x, v.y, this.aim, view, q.x, q.y, 0, PLAYER_RADIUS, v.z + 26, q.eyeZ)) { best = { x: q.x, y: q.y, vx: q.vx, vy: q.vy, r: PLAYER_RADIUS, soft: 1, z: q.z + 18 }; bd = d; }
      }
      for (const q of g.vehicles) {
        if (q.dead || q.team === p.team || q.team < 0 || !q.occupants().length) continue;
        const d = Math.hypot(q.x - v.x, q.y - v.y);
        if (d >= bd) continue;
        if (canSee(g.map, g.smokes, v.x, v.y, this.aim, { ...view, air: q.def.kind === 'air' }, q.x, q.y, 0, q.def.r, v.z + 26, q.z + (q.def.zr[0] + q.def.zr[1]) / 2)) { best = { x: q.x, y: q.y, vx: q.vx, vy: q.vy, r: q.def.r, soft: q.def.resist.bullet, z: q.z + (q.def.zr[0] + q.def.zr[1]) / 2 }; bd = d; }
      }
      this.vTarget = best;
      if (best) g.mind.report(p.team, best.x, best.y);
    }
    const tq = this.vTarget;
    const wantFire = !!(tq && sd.weapon);
    if (sd.weapon) {
      const want = tq ? Math.atan2(tq.y + tq.vy * 0.3 - v.y, tq.x + tq.vx * 0.3 - v.x) : (seat === 1 ? v.a : this.aim);
      this.aim = norm(this.aim + clamp(norm(want - this.aim), -6 * dt, 6 * dt));
      cmd.angle = this.aim;
      if (tq) { cmd.aimHeight = tq.z; cmd.aimDist = Math.hypot(tq.x - v.x, tq.y - v.y); }
      const cur = sd.aim === 'turret' ? v.ta : sd.aim === 'body' ? v.a : v.seatAim[seat];
      const armed = !tq || tq.soft > 0.2 || sd.weapon === 'cannon' || sd.weapon === 'pod' || sd.weapon === 'autocannon';
      if (wantFire && armed && Math.abs(norm(want - cur)) < 0.14 && Math.hypot(tq.x - v.x, tq.y - v.y) < 1000) cmd.keys |= KEY.FIRE;
    }
    if (seat !== 0) {
      // gunners and passengers: leave once the driver has parked or is gone
      const driver = g.players.get(v.seats[0]);
      if (!sd.weapon) cmd.angle = v.a;
      const tgt = g.mind.targetFor(p);
      const d = Math.hypot(tgt.x - v.x, tgt.y - v.y);
      if ((!driver && v.speed < 10) || (v.speed < 25 && d < tgt.r + 220 && !sd.weapon && this.vehWait > 2)) cmd.keys |= this.usePulseKey();
      this.vehWait += dt;
      return cmd;
    }
    // ---- driver
    if (v.def.kind === 'air') {
      const cruise = g.map.landingHeight(v.x, v.y, v.def.r) + v.def.alt;
      if (v.z < cruise - 10) cmd.keys |= KEY.SPRINT;
      else if (v.z > cruise + 20) cmd.keys |= KEY.CROUCH;
    }
    this.vehWait += dt;
    const tgt = g.mind.targetFor(p);
    const inside = Math.hypot(tgt.x - v.x, tgt.y - v.y) < tgt.r;
    const dtgt = Math.hypot(tgt.x - v.x, tgt.y - v.y);
    if (v.def.kind !== 'tracked' && inside && v.speed < 40) { cmd.keys |= this.usePulseKey(); return cmd; }   // troop carriers drop everyone off at the objective
    if (v.hp < v.def.hp * 0.2 && v.speed < 30) { cmd.keys |= this.usePulseKey(); return cmd; }
    if (this.vehWait < 4.5 && v.def.seats.length > 1 && v.seats.filter((s) => s).length < Math.min(2, v.seats.length)) return cmd;   // wait a moment for passengers
    if (!sd.weapon || sd.aim === 'body') { /* aim stays on the heading */ }
    // steer along a path (vehicles need wide corridors)
    this.pathT -= dt; this.pathAge += dt;
    if (!this.path || this.pathT <= 0 || this.pathAge > 5 || !this.goal || Math.hypot(this.goal.x - tgt.x, this.goal.y - tgt.y) > 120) {
      this.goal = { x: tgt.x, y: tgt.y };
      this.path = g.nav.findPath(v.x, v.y, tgt.x, tgt.y, true, 1);
      this.pathIdx = 0; this.pathT = this.path ? 1.5 : 3 + rnd() * 2; this.pathAge = 0;
    }
    let wx = tgt.x, wy = tgt.y;
    if (this.path) {
      while (this.pathIdx < this.path.length - 1 && Math.hypot(this.path[this.pathIdx].x - v.x, this.path[this.pathIdx].y - v.y) < 60) this.pathIdx++;
      wx = this.path[this.pathIdx].x; wy = this.path[this.pathIdx].y;
    }
    if (v.def.kind === 'tracked' && inside) {
      // armour parks inside the objective and shoots whatever shows up
      if (!this.holdPos || Math.hypot(v.x - this.holdPos.x, v.y - this.holdPos.y) < 50) this.holdPos = g.nav.openSpot(tgt.x, tgt.y, 0, tgt.r * 0.8);
      wx = this.holdPos.x; wy = this.holdPos.y;
      if (Math.hypot(v.x - wx, v.y - wy) < 60) { cmd.angle = this.aim; return cmd; }
    }
    const desired = Math.atan2(wy - v.y, wx - v.x);
    const err = norm(desired - v.a);
    // unstick: reverse out when wedged
    if (v.speed < 12) this.vehStuck += dt; else this.vehStuck = 0;
    if (this.vehStuck > 1.6) { this.vehRev = 1.1; this.vehStuck = 0; this.path = null; }
    if (this.vehRev > 0) {
      this.vehRev -= dt;
      cmd.keys |= KEY.DOWN | (err > 0 ? KEY.LEFT : KEY.RIGHT);
      return cmd;
    }
    if (Math.abs(err) > 2.1) { cmd.keys |= KEY.DOWN | (err > 0 ? KEY.LEFT : KEY.RIGHT); }
    else {
      const slow = Math.abs(err) > 0.9 && v.speed > 150;
      if (!slow) cmd.keys |= KEY.UP;
      if (Math.abs(err) > 0.1) cmd.keys |= err > 0 ? KEY.RIGHT : KEY.LEFT;
    }
    void eyes; void dtgt;
    return cmd;
  }

  usePulseKey() { this.usePulse = (this.usePulse + 1) % 12; return this.usePulse < 3 ? KEY.USE : 0; }

  // ---------------------------------------------------------------- main entry
  think(dt) {
    const g = this.g, p = this.p;
    if (p.veh) return this.thinkVehicle(dt);
    const now = g.time;
    const cmd = { keys: 0, angle: this.aim, aimDist: 300, ax: 0, ay: 0 };
    const flashed = now < this.flashedUntil;

    this.percT -= dt;
    if (this.percT <= 0) { this.percT = 0.066; if (!flashed) this.perceive(); else this.visible = false; }

    const w = p.weapon();
    const tq = this.visible && this.target ? this.resolveTarget() : null;
    const engaged = !!tq;
    if (!engaged) this.aimZ = undefined;

    let mv = { mode: 'stop' };
    let fire = false, aimAt = null, use = false, walk = false, scope = false, crouch = false, look, sprint = false, altUse = false;

    let forceSprint = false;
    const surv = !p.veh ? this.survive(tq, w, now, dt) : null;
    if (surv) {
      mv = surv.mv || mv; fire = !!surv.fire; aimAt = surv.aimAt || null; scope = !!surv.scope; crouch = !!surv.crouch; forceSprint = !!surv.sprint;
      if (this.job) this.job = null;
    } else if (this.job && !engaged) {
      const r = this.runJob(dt);
      if (r) { mv = r.mv || mv; aimAt = r.aimAt || null; use = !!r.use; if (r.fire) fire = true; }
    } else if (engaged) {
      if (this.job) this.job = null;
      // rocket launchers at armoured vehicles, otherwise the regular gun fight
      const res = this.fight(tq, w, dt);
      fire = res.fire; aimAt = res.aimAt; scope = res.scope; crouch = !!res.crouch;
      if (res.mv) mv = res.mv;
      else {
        const obj = this.objective(dt);
        if (obj) { mv = obj.goal ? { mode: 'path', goal: obj.goal } : { mode: 'stop' }; use = !!obj.use; }
      }
    } else {
      if (this.lastSeen && now - this.lastSeen.t < 1.4) aimAt = { x: this.lastSeen.x, y: this.lastSeen.y };
      else if (this.heard && now - this.heard.t < 1.6) aimAt = { x: this.heard.x, y: this.heard.y };
      const obj = this.objective(dt);
      if (obj) {
        mv = obj.goal ? { mode: 'path', goal: obj.goal } : { mode: 'stop' };
        use = !!obj.use; walk = !!obj.walk; look = obj.look; sprint = !!obj.sprint;
        if (obj.aimAt && !aimAt) aimAt = obj.aimAt;
      }
      if (w && w.kind !== 'knife' && !p.reloadT && p.ammoOf(w).clip < w.mag * 0.45 && p.ammoOf(w).reserve > 0) startReload(g, p);
      if (p.sel !== 'primary' && p.drawT <= 0 && !this.job) selectSlot(g, p, 'primary');
      this.jobCd -= dt;
      if (this.jobCd <= 0) { this.jobCd = 3 + rnd() * 4; this.pickJob(); }
    }
    if (flashed) mv = { mode: 'stop' };

    // ---- movement
    let mx = 0, my = 0;
    if (mv.mode === 'manual') { mx = mv.ax; my = mv.ay; }
    else if (mv.mode === 'path') { const d = this.pathDir(mv.goal, dt); if (d) { mx = d.x; my = d.y; } }
    else this.path = null;
    this.stuckT += dt;
    if (mx || my) this.moveWant += dt;
    this.travel += Math.hypot(p.x - this.lastTX, p.y - this.lastTY);
    this.lastTX = p.x; this.lastTY = p.y;
    if (this.stuckT > 0.5) {
      if (this.moveWant > 0.4 && this.travel < 6) { this.path = null; this.nudgeT = 0.5; this.nudgeDir = rnd() < 0.5 ? -1 : 1; this.pathT = 0; }
      this.stuckT = 0; this.travel = 0; this.moveWant = 0;
    }
    if (this.nudgeT > 0) {
      this.nudgeT -= dt;
      const a = Math.atan2(my, mx) + Math.PI / 2 * this.nudgeDir;
      mx = mx * 0.4 + Math.cos(a) * 0.9; my = my * 0.4 + Math.sin(a) * 0.9;
    }
    // do not walk in a tight clump: a grenade or one burst would kill the whole squad
    if (mx || my) {
      for (const q of g.players.values()) {
        if (q === p || !q.alive || q.veh || q.team !== p.team) continue;
        const sx = p.x - q.x, sy = p.y - q.y, sd = Math.hypot(sx, sy);
        if (sd < 46 && sd > 0.5) { const k = (1 - sd / 46) * 0.9; mx += sx / sd * k; my += sy / sd * k; }
      }
      const ml = Math.hypot(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
    }
    cmd.ax = mx; cmd.ay = my;

    // ---- aiming
    let desired;
    if (aimAt) {
      let tx = aimAt.x, ty = aimAt.y;
      if (engaged && tq && aimAt.x === tq.x && aimAt.y === tq.y) {           // a person aims where the target was a moment ago, not where it is now
        const lag = this.d.lag * this.sloppy;
        tx -= tq.vx * lag; ty -= tq.vy * lag;
      }
      desired = Math.atan2(ty - p.y, tx - p.x);
      if (engaged) {
        // wandering aim error: bigger at range and while the target crosses the view, plus the pull of recent recoil
        const range = Math.hypot(tx - p.x, ty - p.y);
        const across = tq ? Math.abs(-tq.vx * Math.sin(desired) + tq.vy * Math.cos(desired)) : 0;
        const sig = this.d.sigma * this.sloppy * (1 + 0.6 * Math.min(1, range / 900)) * (1 + Math.min(1, across / 220));
        const th = 3.5;                                                        // error correlation, 1/s
        this.errA += -this.errA * th * dt + sig * Math.sqrt(2 * th * dt) * gauss() * 1.74;
        desired += this.errA + this.kickA;
      }
    } else if (look !== undefined && look !== null && !(mx || my)) desired = look;
    else if (mx || my) desired = Math.atan2(my, mx);
    else desired = this.aim;
    const turn = this.d.turn * (engaged ? 1 : 0.55) * (flashed ? 0.15 : 1);
    // the aim has momentum: it accelerates toward the target, overshoots a little and settles, instead of snapping on
    const err = norm(desired - this.aim);
    const wantV = clamp(err * 16, -turn, turn);
    const acc = turn * 7;
    this.av += clamp(wantV - this.av, -acc * dt, acc * dt);
    this.aim = norm(this.aim + this.av * dt);
    const decay = Math.exp(-5 * dt);
    this.kickA *= decay; this.kickP *= decay;
    // vertical aim: at the height clearShot() picked when engaged, level otherwise
    let wantPitch = 0;
    if (engaged && aimAt && this.aimZ !== undefined) wantPitch = Math.atan2(this.aimZ - p.eyeZ, Math.max(30, Math.hypot(aimAt.x - p.x, aimAt.y - p.y))) + this.kickP + this.errA * 0.4;
    this.pitch = (this.pitch || 0) + clamp(wantPitch - (this.pitch || 0), -turn * dt, turn * dt);

    // ---- output
    let keys = 0;
    if (fire && !flashed) {
      if (w && !w.auto && w.kind !== 'knife' && !this.job) { this.pulse = !this.pulse; if (this.pulse) keys |= KEY.FIRE; }
      else keys |= KEY.FIRE;
    }
    if (walk) keys |= KEY.WALK;
    if (use) keys |= KEY.USE;
    if (scope) keys |= KEY.SCOPE;
    if (crouch) keys |= KEY.CROUCH;
    if (sprint && !fire && (mx || my) && !engaged) keys |= KEY.SPRINT;
    if (forceSprint && !fire && (mx || my)) keys |= KEY.SPRINT;
    if (this.wantVeh) keys |= this.boardKeys();
    if (this.job && this.job.rmb) keys |= KEY.SCOPE;
    cmd.keys = keys;
    cmd.angle = this.aim;
    cmd.pitch = this.pitch;
    cmd.aimDist = this.nade ? this.nade.dist : (this.job && this.job.dist ? this.job.dist : 300);
    void altUse;
    return cmd;
  }

  /** walk to the wanted vehicle and press use when close */
  boardKeys() {
    const g = this.g, p = this.p;
    const v = g.vehicleById(this.wantVeh);
    if (!v || v.dead || p.veh) { this.wantVeh = 0; return 0; }
    if (Math.hypot(v.x - p.x, v.y - p.y) - v.def.r < 30) { const k = this.usePulseKey(); if (this.wantSeat > 0 && k) g.seatRequest(p, this.wantSeat); return this.wantSeat > 0 ? 0 : k; }
    return 0;
  }

  resolveTarget() {
    const g = this.g, t = this.target;
    if (!t) return null;
    if (t.kind === 'p') { const q = g.players.get(t.id); return q && q.alive && !q.veh ? { x: q.x, y: q.y, vx: q.vx, vy: q.vy, speed: q.speed, veh: null, soft: 1, z: q.z, h: q.bodyH } : null; }
    const v = g.vehicleById(t.id);
    const zr = v && v.def.zr ? v.def.zr : [0, 26];
    return v && !v.dead ? { x: v.x, y: v.y, vx: v.vx, vy: v.vy, speed: v.speed, veh: v, soft: v.def.resist.bullet, z: v.z + zr[0], h: zr[1] - zr[0] } : null;
  }

  // ---------------------------------------------------------------- jobs (class abilities)
  pickJob() {
    const g = this.g, p = this.p;
    if (this.visible || p.veh) return;
    const slotOf = (kind) => (p.gadgets[0] && p.gadgets[0].def.kind === kind ? 'gadget0' : p.gadgets[1] && p.gadgets[1].def.kind === kind ? 'gadget1' : null);
    const slotId = (id) => (p.gadgets[0] && p.gadgets[0].def.id === id ? 'gadget0' : p.gadgets[1] && p.gadgets[1].def.id === id ? 'gadget1' : null);
    // revive a fallen squadmate (or anyone from the team) when it is quiet
    const defib = slotId('defib');
    if (defib) {
      let best = null, bd = 800;
      for (const c of g.corpses) {
        if (c.team !== p.team) continue;
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) { this.job = { kind: 'revive', c: best, slot: defib, t: 0, stage: 0 }; return; }
    }
    // repair a damaged vehicle
    const rep = slotOf('repair');
    if (rep) {
      let best = null, bd = 700;
      for (const v of g.vehicles) {
        if (v.dead || v.team !== p.team || v.hp >= v.def.hp * 0.85) continue;
        const d = Math.hypot(v.x - p.x, v.y - p.y);
        if (d < bd) { bd = d; best = v; }
      }
      if (best) { this.job = { kind: 'repair', v: best, slot: rep, t: 0 }; return; }
    }
    // shoot rockets at a nearby enemy vehicle we can see
    const lau = slotOf('launcher');
    if (lau && lau) {
      const g0 = p.gadgets[lau === 'gadget0' ? 0 : 1];
      if (g0.def.id !== 'stinger' && (g0.loaded || g0.charges > 0)) {
        for (const v of g.vehicles) {
          if (v.dead || v.team === p.team || v.team < 0 || !v.occupants().length || v.def.kind === 'air') continue;
          const d = Math.hypot(v.x - p.x, v.y - p.y);
          if (d < 900 && d > 150 && g.map.los(p.x, p.y, v.x, v.y)) { this.job = { kind: 'rocket', v, slot: lau, t: 0 }; return; }
        }
      }
    }
    // drop supplies / medkits / beacons when standing at the objective
    const tgt = g.mind.targetFor(p);
    const at = Math.hypot(tgt.x - p.x, tgt.y - p.y) < tgt.r + 60;
    const med = slotId('medkit');
    if (med && p.gadgets[med === 'gadget0' ? 0 : 1].charges > 0) {
      let hurt = 0;
      for (const q of g.players.values()) if (q.alive && q.team === p.team && !q.veh && q.hp < 75 && Math.hypot(q.x - p.x, q.y - p.y) < 110) hurt++;
      if (hurt >= 1 && (hurt >= 2 || p.hp < 60)) { this.job = { kind: 'drop', slot: med, t: 0 }; return; }
    }
    const ammo = slotId('ammo');
    if (ammo && at && p.gadgets[ammo === 'gadget0' ? 0 : 1].charges > 0 && !g.gadgets.some((q) => q.owner === p.id && q.type === 'ammo')) { this.job = { kind: 'drop', slot: ammo, t: 0 }; return; }
    const bcn = slotId('beacon');
    if (bcn && at && !this.usedBeacon && p.gadgets[bcn === 'gadget0' ? 0 : 1].charges > 0) { this.usedBeacon = true; this.job = { kind: 'drop', slot: bcn, t: 0, still: true }; return; }
    const sen = slotId('sensor');
    if (sen && at && p.gadgets[sen === 'gadget0' ? 0 : 1].charges > 0 && !g.gadgets.some((q) => q.owner === p.id && q.type === 'sensor')) { this.job = { kind: 'drop', slot: sen, t: 0 }; return; }
    const mine = slotId('mine') || slotId('claymore');
    if (mine && at && p.gadgets[mine === 'gadget0' ? 0 : 1].charges > 0 && g.gadgets.filter((q) => q.owner === p.id).length < 2) this.job = { kind: 'drop', slot: mine, t: 0 };
  }

  runJob(dt) {
    const g = this.g, p = this.p, job = this.job;
    job.t += dt;
    if (job.t > 12) { this.job = null; return null; }
    const ensure = () => { if (p.sel !== job.slot) { if (((g.tick + p.id) & 7) === 0) selectSlot(g, p, job.slot); return false; } return p.drawT <= 0; };
    switch (job.kind) {
      case 'revive': {
        if (!g.corpses.includes(job.c)) { this.job = null; return null; }
        const d = Math.hypot(job.c.x - p.x, job.c.y - p.y);
        if (d > 34) return { mv: { mode: 'path', goal: { x: job.c.x, y: job.c.y } } };
        if (!ensure()) return { mv: { mode: 'stop' } };
        return { mv: { mode: 'stop' }, fire: true, aimAt: { x: job.c.x, y: job.c.y } };
      }
      case 'repair': {
        const v = job.v;
        if (v.dead || v.hp >= v.def.hp) { this.job = null; return null; }
        const d = Math.hypot(v.x - p.x, v.y - p.y) - v.def.r;
        if (d > 40) return { mv: { mode: 'path', goal: { x: v.x, y: v.y } } };
        if (!ensure()) return { mv: { mode: 'stop' } };
        return { mv: { mode: 'stop' }, fire: true, aimAt: { x: v.x, y: v.y } };
      }
      case 'rocket': {
        const v = job.v;
        const gd = p.gadget();
        if (v.dead || !v.occupants().length || (gd && !gd.loaded && gd.charges <= 0)) { this.job = null; selectSlot(g, p, 'primary'); return null; }
        const d = Math.hypot(v.x - p.x, v.y - p.y);
        if (d > 950 || !g.map.los(p.x, p.y, v.x, v.y)) { this.job = null; selectSlot(g, p, 'primary'); return null; }
        if (!ensure()) return { mv: { mode: 'stop' } };
        const lead = 0.35 + d / 900;
        const ax = v.x + v.vx * lead, ay = v.y + v.vy * lead;
        const err = Math.abs(norm(Math.atan2(ay - p.y, ax - p.x) - this.aim));
        if (gd && !gd.loaded && p.reloadT <= 0) startReload(g, p);
        return { mv: { mode: 'stop' }, aimAt: { x: ax, y: ay }, fire: err < 0.06 && !!gd && gd.loaded };
      }
      case 'drop': {
        if (job.still && p.speed > 30) return { mv: { mode: 'stop' } };
        if (!ensure()) return { mv: { mode: 'stop' } };
        const before = p.gadget() ? p.gadget().charges : 0;
        if (job.fired && (p.gadget() ? p.gadget().charges : 0) < before + 1 && job.t > job.fired + 0.4) { this.job = null; selectSlot(g, p, 'primary'); return null; }
        if (!job.fired) job.fired = job.t;
        return { mv: { mode: 'stop' }, fire: ((g.tick & 3) === 0) };
      }
      default: this.job = null; return null;
    }
  }

  // ---------------------------------------------------------------- combat
  fight(tq, w, dt) {
    const g = this.g, p = this.p, now = g.time;
    const dx = tq.x - p.x, dy = tq.y - p.y;
    const dist = Math.hypot(dx, dy);
    const toEnemy = Math.atan2(dy, dx);
    // armoured targets: only launchers hurt them, everybody else keeps out of the way
    if (tq.veh && tq.soft < 0.2) {
      const gadgetSlot = (p.gadgets[0] && p.gadgets[0].def.kind === 'launcher') ? 'gadget0' : (p.gadgets[1] && p.gadgets[1].def.kind === 'launcher') ? 'gadget1' : null;
      const gd = gadgetSlot ? p.gadgets[gadgetSlot === 'gadget0' ? 0 : 1] : null;
      if (gd && gd.def.id !== 'stinger' && (gd.loaded || gd.charges > 0) && dist < 900) {
        if (p.sel !== gadgetSlot) { if (p.drawT <= 0 || ((g.tick + p.id) & 7) === 0) selectSlot(g, p, gadgetSlot); return { fire: false, aimAt: { x: tq.x, y: tq.y }, scope: false, mv: { mode: 'stop' } }; }
        if (!gd.loaded && p.reloadT <= 0) startReload(g, p);
        const lead = 0.3 + dist / 900;
        const ax = tq.x + tq.vx * lead, ay = tq.y + tq.vy * lead;
        const err = Math.abs(norm(Math.atan2(ay - p.y, ax - p.x) - this.aim));
        return { fire: err < 0.07 && gd.loaded && p.drawT <= 0, aimAt: { x: ax, y: ay }, scope: false, mv: { mode: 'stop' } };
      }
      // nothing to fight it with: run for cover from the objective's direction
      return { fire: false, aimAt: { x: tq.x, y: tq.y }, scope: false, mv: dist < 500 ? { mode: 'manual', ax: -Math.cos(toEnemy), ay: -Math.sin(toEnemy) } : null };
    }
    if (p.sel !== 'primary' && p.sel !== 'secondary' && p.drawT <= 0) selectSlot(g, p, 'primary');
    const kind = w ? w.kind : 'knife';
    const maxEff = (RANGE[kind] || 700) * (w && w.scope && p.scoped ? 1.15 : 1);
    const tooFarForMoving = kind !== 'sniper' && dist > 480 && tq.speed > 90;
    const outOfRange = dist >= maxEff;
    const reacted = now - this.targetSince >= this.d.react * this.reactJ * this.sloppy;
    const ammo = w ? p.ammoOf(w) : { clip: 0, reserve: 0 };
    // aim down the sights whenever the fight is beyond hip-fire range (a scoped weapon only when it is really far)
    const scope = !!(w && kind !== 'knife' && kind !== 'shotgun' && this.d.hold > 0.4 && dist > (w.scope > 0 ? 380 : 170));
    if (ammo.clip < this.lastClip) {
      this.burstLeft--;
      // every shot disturbs the aim (recoil); the bot has to pull it back down
      const k = this.d.kick * this.sloppy * (kind === 'sniper' ? 2.2 : kind === 'shotgun' ? 1.6 : kind === 'pistol' ? 0.8 : 1);
      this.kickP = Math.min(0.2, this.kickP + k * (0.6 + rnd() * 0.8));
      this.kickA = clamp(this.kickA + (rnd() - 0.5) * k * 1.8, -0.12, 0.12);
      if (this.burstLeft <= 0) { this.burstPause = 0.25 + rnd() * 0.55 * (1.7 - this.d.burst); this.burstLeft = 2 + Math.floor(rnd() * (2 + this.d.burst * 3)); }
    }
    this.lastClip = ammo.clip;
    if (this.burstPause > 0) this.burstPause -= dt;
    const angErr = Math.abs(angleDiff(toEnemy, this.aim));
    const tol = Math.atan2(16 * (tq.veh ? tq.veh.def.r / 12 : 1), Math.max(60, dist)) + 0.045;      // people squeeze the trigger before the aim is perfect
    let fire = false;
    this.why = !reacted ? 'react' : !w ? 'noweapon' : angErr >= tol ? 'aim' : p.drawT > 0 ? 'draw' : p.reloadT > 0 ? 'reload' : p.spawnProt > 0 ? 'prot' : ammo.clip <= 0 ? 'empty' : dist >= maxEff ? 'range' : tooFarForMoving ? 'moving' : (w.auto && dist > 120 && this.burstPause > 0) ? 'burst' : 'fire';
    if (reacted && w && angErr < tol && p.drawT <= 0 && p.reloadT <= 0 && p.spawnProt <= 0) {
      if (kind === 'knife') fire = dist < 56;
      else if (ammo.clip > 0 && dist < maxEff && !tooFarForMoving) fire = !(w.auto && dist > 120 && this.burstPause > 0);
    }
    if (w && kind !== 'knife' && ammo.clip <= 0) {
      if (ammo.reserve > 0) { if (dist > 200 || p.sel !== 'primary') startReload(g, p); }
      else if (p.sel === 'primary') selectSlot(g, p, 'secondary');
      else if (p.sel !== 'knife') selectSlot(g, p, 'knife');
    }
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = 0.3 + rnd() * 0.6;
      if (rnd() < 0.55) this.strafeDir = -this.strafeDir;
      this.strafeMove = rnd() > this.d.hold * 0.85;
    }
    let perp = toEnemy + Math.PI / 2 * this.strafeDir;
    if (!g.map.clearLineR(p.x, p.y, p.x + Math.cos(perp) * 38, p.y + Math.sin(perp) * 38, 11)) {
      this.strafeDir = -this.strafeDir;
      perp = toEnemy + Math.PI / 2 * this.strafeDir;
    }
    let mv;
    if (kind === 'knife' || (kind === 'shotgun' && dist > 90)) mv = { mode: 'path', goal: { x: tq.x, y: tq.y } };
    else if (kind === 'sniper' || kind === 'dmr' || dist > 480) mv = this.strafeMove ? { mode: 'manual', ax: Math.cos(perp) * 0.8, ay: Math.sin(perp) * 0.8 } : { mode: 'stop' };
    else if (dist > 220) {
      if (fire && this.d.hold > 0.5) mv = { mode: 'stop' };
      else mv = { mode: 'manual', ax: Math.cos(perp) * 0.9 + Math.cos(toEnemy) * 0.15, ay: Math.sin(perp) * 0.9 + Math.sin(toEnemy) * 0.15 };
    } else mv = { mode: 'manual', ax: Math.cos(perp), ay: Math.sin(perp) };
    if (mv.mode === 'stop' && !fire && this.d.aggr > 0.55 && dist > maxEff * 0.95 && p.hp > 60 && kind !== 'sniper') mv = { mode: 'path', goal: { x: tq.x, y: tq.y } };
    if (fire && !tq.veh && !this.clearShot(tq, toEnemy, dist)) { fire = false; this.why = 'blocked'; }
    if (tq.veh) this.aimZ = tq.z + tq.h * 0.5;
    this.noFireT = fire ? 0 : this.noFireT + dt;
    // dig in: standing still at range behind a steady rifle is worth crouching for (tighter spread, smaller target)
    const crouch = mv.mode === 'stop' && dist > 260 && (kind === 'rifle' || kind === 'lmg' || kind === 'dmr' || kind === 'sniper') && this.d.hold > 0.6;
    return { mv: outOfRange || (this.noFireT > 1.4 && dist > 300) ? null : mv, fire, aimAt: { x: tq.x, y: tq.y }, scope, crouch };
  }

  /** Is there a line for a bullet to the chest (or failing that the head) over any low cover? Remembers the height to aim at. */
  clearShot(tq, ang, dist) {
    const p = this.p, map = this.g.map;
    const eye = p.eyeZ, c = Math.cos(ang), sn = Math.sin(ang);
    for (const f of [0.6, 0.9, 0.3]) {
      const zt = tq.z + tq.h * f;
      const r = map.castBullet(p.x, p.y, eye, c, sn, (zt - eye) / Math.max(1, dist), dist);
      if (r.d >= dist - 14) { this.aimZ = zt; return true; }
    }
    this.aimZ = tq.z + tq.h * 0.6;
    return false;
  }


  // ---------------------------------------------------------------- survival: cover, retreat, peeking, grenades
  /** a nearby spot that hides a crouched soldier from `from` (bullet-proof against the 3D shot test), scored by distance */
  findCover(from, maxR = 230) {
    const g = this.g, p = this.p, map = g.map;
    const cc = this.coverCache;
    if (cc && g.time - cc.t < 0.7 && Math.hypot(cc.fx - from.x, cc.fy - from.y) < 60) return cc.spot;
    const curD = Math.hypot(p.x - from.x, p.y - from.y);
    let best = null, bs = 1e9;
    const eye = (from.z || map.heightAt(from.x, from.y)) + 26;
    for (const r of [45, 80, 120, 165, 210]) {
      if (r > maxR) break;
      const a0 = rnd() * 0.4;
      for (let k = 0; k < 16; k++) {
        const a = a0 + k * Math.PI / 8;
        const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
        if (map.isBlockedTile(Math.floor(x / TILE), Math.floor(y / TILE))) continue;
        if (!map.clearLineR(p.x, p.y, x, y, 10)) continue;
        const dth = Math.hypot(x - from.x, y - from.y);
        if (dth < 60) continue;
        const c = Math.cos(Math.atan2(y - from.y, x - from.x)), sn = Math.sin(Math.atan2(y - from.y, x - from.x));
        const hit = map.castBullet(from.x, from.y, eye, c, sn, (map.heightAt(x, y) + 12 - eye) / Math.max(1, dth), dth);
        if (hit.d >= dth - 12) continue;                       // the enemy can still see this spot
        const sc = r + Math.max(0, curD - dth) * 0.9 + (this.wantSpot ? Math.hypot(x - this.wantSpot.x, y - this.wantSpot.y) * 0.05 : 0);
        if (sc < bs) { bs = sc; best = { x, y }; }
      }
      if (best && bs < r * 1.15) break;
    }
    this.coverCache = { t: g.time, fx: from.x, fy: from.y, spot: best };
    return best;
  }

  survive(tq, w, now, dt) {
    const g = this.g, p = this.p;
    if (this.retreatCd > 0) this.retreatCd -= dt;
    if (this.peekCd > 0) this.peekCd -= dt;
    if (this.nadeCd > 0) this.nadeCd -= dt;
    const kind = w ? w.kind : 'knife';
    const attacker = this.hitBy && now - this.hitBy.t < 5 ? g.players.get(this.hitBy.id) : null;
    const threat = tq ? { x: tq.x, y: tq.y } : (attacker && attacker.alive ? { x: attacker.x, y: attacker.y } : (this.lastSeen && now - this.lastSeen.t < 4 ? { x: this.lastSeen.x, y: this.lastSeen.y } : null));

    // ---- a grenade in flight of thought: pick it, throw it once, go back to the gun
    if (this.nade) {
      const n = this.nade; n.t += dt;
      if (n.t > 2.2 || p.grenades.he + p.grenades.flash + p.grenades.smoke + p.grenades.molo <= 0) { this.nade = null; selectSlot(g, p, 'primary'); return null; }
      if (p.sel !== 'grenade') { if (((g.tick + p.id) & 7) === 0) selectSlot(g, p, 'grenade'); return { mv: { mode: 'stop' }, aimAt: n.at }; }
      if (p.drawT > 0) return { mv: { mode: 'stop' }, aimAt: n.at };
      if (!n.thrown) { n.thrown = n.t; return { mv: { mode: 'stop' }, aimAt: n.at, fire: true }; }
      if (n.t > n.thrown + 0.45) { this.nade = null; selectSlot(g, p, 'primary'); }
      return { mv: { mode: 'stop' }, aimAt: n.at };
    }

    // ---- start a retreat: badly hurt, or shot by somebody we cannot see
    const lowHp = p.hp < 45, hurtRecent = now - p.lastHurt < 1.6;
    if (!this.retreat && this.retreatCd <= 0 && threat && (lowHp || (hurtRecent && !tq && p.hp < 80))) {
      const c = this.findCover(threat);
      if (c) { this.retreat = { x: c.x, y: c.y, from: threat, until: now + 4.5 + rnd() * 3, arrived: false }; this.peek = null; }
      else this.retreatCd = 1.5;
    }
    if (this.retreat) {
      const r = this.retreat;
      if (!p.alive || p.hp >= 92 || (now > r.until && p.hp >= 60) || now > r.until + 8) { this.retreat = null; this.retreatCd = 4; return null; }
      const d = Math.hypot(r.x - p.x, r.y - p.y);
      if (d > 28 && !r.arrived) return { mv: { mode: 'path', goal: { x: r.x, y: r.y } }, aimAt: r.from, sprint: !tq || d > 90, crouch: false };
      r.arrived = true;
      if (tq) { const f = this.fight(tq, w, dt); return { ...f, mv: { mode: 'stop' }, crouch: true, sprint: false }; }
      return { mv: { mode: 'stop' }, aimAt: r.from, crouch: true, fire: false, scope: false };
    }

    // ---- peek and hide: never trade fire in the open when cover is at hand
    if (this.peek && this.peek.phase === 'hide') {
      const pk = this.peek;
      if (now > pk.until) { pk.phase = 'expose'; pk.until = now + 1.3 + rnd() * 1.4; }
      else {
        const d = Math.hypot(pk.cover.x - p.x, pk.cover.y - p.y);
        if (d > 22) return { mv: { mode: 'path', goal: pk.cover }, aimAt: pk.from2, sprint: false, crouch: false };
        return { mv: { mode: 'stop' }, aimAt: pk.from2, crouch: true, fire: false };
      }
    }
    if (tq && !tq.veh) {
      const dist = Math.hypot(tq.x - p.x, tq.y - p.y);
      // throw a grenade at somebody sitting behind cover
      const ng = p.grenades.he + p.grenades.molo;
      if (ng > 0 && this.nadeCd <= 0 && dist > 200 && dist < 520 && p.spawnProt <= 0 && this.why === 'blocked' && p.sel !== 'gadget0' && p.sel !== 'gadget1') {
        this.nadeCd = 10 + rnd() * 8;
        this.nade = { t: 0, dist: dist, at: { x: tq.x, y: tq.y } };
        if (p.grenades.he <= 0) p.gsel = 'molo'; else p.gsel = 'he';
        return { mv: { mode: 'stop' }, aimAt: { x: tq.x, y: tq.y } };
      }
      if (this.d.hold > 0.5 && dist > 230 && kind !== 'shotgun' && kind !== 'knife' && kind !== 'sniper') {
        if (!this.peek) { if (this.peekCd <= 0) this.peek = { phase: 'expose', until: now + 1.6 + rnd() * 1.6, from2: null, cover: null }; }
        else if (this.peek.phase === 'expose' && now > this.peek.until) {
          const c = this.findCover({ x: tq.x, y: tq.y }, 140);
          if (c) { this.peek = { phase: 'hide', until: now + 1.0 + rnd() * 1.3, from2: { x: tq.x, y: tq.y }, cover: c }; return { mv: { mode: 'path', goal: c }, aimAt: { x: tq.x, y: tq.y } }; }
          this.peek.until = now + 1.2;
        }
      }
    } else if (this.peek && this.peek.phase === 'expose' && !tq && now > this.peek.until + 2) { this.peek = null; this.peekCd = 1.5; }
    return null;
  }

  // ---------------------------------------------------------------- perception
  perceive() {
    const g = this.g, p = this.p;
    const w = p.weapon();
    const full = viewParams(p.scoped, w && w.kind !== 'knife' ? w.scope : 0);
    const view = { range: Math.min(full.range, Math.max(this.d.sight, p.scoped ? full.range * 0.85 : 0)), fov: full.fov * 0.9 };
    let best = null, bd = Infinity, cur = null, curD = Infinity;
    const keep = this.target && this.target.kind === 'p' ? this.target.id : -1;
    for (const q of g.players.values()) {
      if (!q.alive || q.veh || q.team === p.team || q.team === SPEC) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (!(d < bd || q.id === keep)) continue;
      if (canSee(g.map, g.smokes, p.x, p.y, this.aim, view, q.x, q.y, 0, PLAYER_RADIUS, p.eyeZ, q.eyeZ)) {
        const c = { kind: 'p', id: q.id, x: q.x, y: q.y, vx: q.vx, vy: q.vy };
        if (q.id === keep) { cur = c; curD = d; }
        if (d < bd) { best = c; bd = d; }
      }
    }
    // stick with the enemy we are already fighting unless another one is clearly closer (no re-acquiring every few frames)
    if (cur && best !== cur && bd > curD * 0.6) { best = cur; bd = curD; }
    // whoever just shot us is noticed even outside our field of view, as long as we can be seen by them
    if (this.hitBy && g.time - this.hitBy.t < 2.5) {
      const q = g.players.get(this.hitBy.id);
      if (q && q.alive && !q.veh && q.team !== p.team) {
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bd && d < 900 && g.map.los(p.x, p.y, q.x, q.y)) { best = { kind: 'p', id: q.id, x: q.x, y: q.y, vx: q.vx, vy: q.vy }; bd = d; }
      }
    }
    // enemy vehicles: a soldier with a rocket launcher wants them; everyone else notices them but only shoots the soft ones
    for (const v of g.vehicles) {
      if (v.dead || v.team === p.team || v.team < 0 || !v.occupants().length) continue;
      const d = Math.hypot(v.x - p.x, v.y - p.y);
      if (d >= bd + 80) continue;
      if (canSee(g.map, g.smokes, p.x, p.y, this.aim, { ...view, air: v.def.kind === 'air' }, v.x, v.y, 0, v.def.r, p.eyeZ, v.z + (v.def.zr[0] + v.def.zr[1]) / 2)) {
        if (v.def.kind === 'air' && v.def.resist.bullet < 0.2) continue;
        best = { kind: 'v', id: v.id, x: v.x, y: v.y, vx: v.vx, vy: v.vy }; bd = d;
      }
    }
    if (best) {
      const id = best.kind + best.id;
      if (!this.target || this.target.kind + this.target.id !== id || !this.visible) {
        if (!this.target || this.target.kind + this.target.id !== id) { this.targetSince = this.visible ? g.time - this.d.react * 0.7 : g.time; this.reactJ = 0.8 + rnd() * 0.8; }   // switching between visible enemies is quick
        else if (!this.visible && this.lastSeen && g.time - this.lastSeen.t > 0.6) this.targetSince = g.time;
      }
      this.target = best;
      this.visible = true;
      this.lastSeen = { x: best.x, y: best.y, t: g.time, vx: best.vx, vy: best.vy };
      g.mind.report(p.team, best.x, best.y);
      this.searchUntil = g.time + 3 + rnd() * 2;
    } else {
      if (this.visible) this.targetSince = g.time;
      this.visible = false;
    }
  }

  // ---------------------------------------------------------------- objectives
  /** Returns {goal, use, look, aimAt, walk, sprint} or null to idle. */
  objective(dt) {
    const g = this.g, p = this.p, now = g.time;
    if (g.phase !== PHASE.LIVE) return null;
    // just lost sight of somebody: pre-aim the spot, then maybe go and look
    if (this.lastSeen && !this.visible && now - this.lastSeen.t < 2.4) {
      const age = now - this.lastSeen.t;
      const s = { x: this.lastSeen.x, y: this.lastSeen.y };
      if (age < 0.9) return { aimAt: s };
      if (this.d.aggr > 0.6 && p.hp > 60 && now < this.searchUntil) return { goal: s, aimAt: s };
    }
    if (this.wantVeh) {
      const v = g.vehicleById(this.wantVeh);
      if (v && !v.dead && !p.veh) return { goal: { x: v.x, y: v.y }, sprint: true };
    }
    const tgt = g.mind.targetFor(p);
    // known danger ahead (a teammate just died there): keep going, but walking, weapon up and pointed at the spot
    if (this.danger && now - this.danger.t < 14 && !this.visible) {
      const dd = Math.hypot(this.danger.x - p.x, this.danger.y - p.y);
      if (dd < 520 && dd > 60 && (tgt.kind === 'mcom' || d0(tgt, p) > 90)) return { goal: { x: tgt.x, y: tgt.y }, walk: dd < 380, aimAt: { x: this.danger.x, y: this.danger.y }, sprint: false };
    }
    const d = Math.hypot(tgt.x - p.x, tgt.y - p.y);
    // M-COM work
    if (tgt.kind === 'mcom' && d < 44) {
      if ((p.team === T && !tgt.armed) || (p.team === CT && tgt.disarm)) return { use: true, look: Math.atan2(tgt.y - p.y, tgt.x - p.x) };
    }
    if (d > tgt.r) return { goal: { x: tgt.x, y: tgt.y }, sprint: d > 350 && !this.heard };
    // arrived: move around inside the objective so the whole area is covered
    this.holdT -= dt;
    if (!this.holdPos || this.holdT <= 0 || Math.hypot(p.x - this.holdPos.x, p.y - this.holdPos.y) < 24) {
      this.holdPos = g.nav.openSpot(tgt.x, tgt.y, 0, Math.max(60, tgt.r * 0.9));
      this.holdT = 3 + rnd() * 6;
    }
    if (Math.hypot(p.x - this.holdPos.x, p.y - this.holdPos.y) < 30) return { look: this.aim + Math.sin(g.time + p.id) * 0.02 };
    return { goal: this.holdPos, walk: false };
  }

  // ---------------------------------------------------------------- navigation
  pathDir(goal, dt) {
    const p = this.p, nav = this.g.nav;
    this.pathT -= dt; this.pathAge += dt;
    const goalChanged = !this.goal || Math.hypot(this.goal.x - goal.x, this.goal.y - goal.y) > 30;
    if (goalChanged || (!this.path && this.pathT <= 0) || this.pathAge > 4) {
      this.goal = { x: goal.x, y: goal.y };
      this.path = nav.findPath(p.x, p.y, goal.x, goal.y);
      this.pathIdx = 0;
      this.pathT = this.path ? 0.4 : 1.5 + rnd(); this.pathAge = 0;
    }
    if (!this.path) return null;
    while (this.pathIdx < this.path.length - 1 && Math.hypot(this.path[this.pathIdx].x - p.x, this.path[this.pathIdx].y - p.y) < 18) this.pathIdx++;
    const wp = this.path[this.pathIdx];
    const d = Math.hypot(wp.x - p.x, wp.y - p.y);
    if (d < 10 && this.pathIdx >= this.path.length - 1) return null;
    return { x: (wp.x - p.x) / d, y: (wp.y - p.y) / d };
  }
}

const PLAYER_RADIUS = 11;
function d0(t, p) { return Math.hypot(t.x - p.x, t.y - p.y); }
export { VEHICLES, RULES, TILE, rayCircle, GADGETS };
