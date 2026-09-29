// Builds the per-client world snapshot: what this player is allowed to know right now.
import { SPEC, VISION, GREN_ORDER, RULES, BASE_SPEED } from '../shared/constants.js';
import { weaponSpread, GADGET_LIST, ALT } from '../shared/weapons.js';
import { VEHICLE_LIST, VWEAPONS } from '../shared/vehicles.js';
import { canSee, viewParams } from '../shared/vision.js';
import { PROJ_TYPES } from './projectiles.js';

const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** The sight of one soldier: their position, facing and view cone. */
function eyes(game, m) {
  if (m.veh) {
    const v = game.vehicleById(m.veh);
    if (v) return { x: v.x, y: v.y, a: m.angle, view: v.def.view, air: !!v.def.view.air };
  }
  const w = m.weapon();
  return { x: m.x, y: m.y, a: m.angle, view: viewParams(m.scoped, w && w.kind !== 'knife' ? w.scope : 0), air: false };
}

function teamVisibility(game, team) {
  if (!game._vis || game._vis.tick !== game.tick) game._vis = { tick: game.tick, sets: [null, null] };
  if (game._vis.sets[team]) return game._vis.sets[team];
  const seenP = new Set(), seenV = new Set();
  const mates = [];
  for (const p of game.players.values()) if (p.alive && p.team === team) mates.push(eyes(game, p));
  for (const e of game.players.values()) {
    if (!e.alive || e.team === SPEC || e.team === team || e.veh) continue;
    for (const m of mates) {
      if (canSee(game.map, game.smokes, m.x, m.y, m.a, m.view, e.x, e.y, VISION.serverFovPad)) { seenP.add(e.id); break; }
    }
  }
  for (const v of game.vehicles) {
    if (v.dead || v.team === team) continue;
    const air = v.def.kind === 'air';
    for (const m of mates) {
      const view = air ? { range: m.view.range, fov: m.view.fov, air: true } : m.view;
      if (canSee(game.map, game.smokes, m.x, m.y, m.a, view, v.x, v.y, VISION.serverFovPad, v.def.r)) { seenV.add(v.id); break; }
    }
  }
  game._vis.sets[team] = { p: seenP, v: seenV };
  return game._vis.sets[team];
}

export function resolveTarget(game, p) {
  if (p.alive) return p;
  const cur = game.players.get(p.specId);
  const ok = (q) => q && q.alive && q.team !== SPEC && (p.team === SPEC || q.team === p.team);
  if (ok(cur)) return cur;
  let pick = null;
  for (const q of game.players.values()) if (ok(q)) { pick = q; break; }
  if (!pick && p.team !== SPEC) for (const q of game.players.values()) if (q.alive && q.team !== SPEC) { pick = q; break; }
  p.specId = pick ? pick.id : 0;
  return pick;
}

export function cycleSpectate(game, p, dir) {
  const list = [];
  for (const q of game.players.values()) if (q.alive && q.team !== SPEC && (p.team === SPEC || q.team === p.team || game.aliveCount(p.team) === 0)) list.push(q);
  if (!list.length) return;
  let i = list.findIndex((q) => q.id === p.specId);
  i = (i + dir + list.length) % list.length;
  p.specId = list[i].id;
}

function playerTuple(q, full) {
  let fl = 0;
  if (q.scoped) fl |= 1;
  if (q.reloadT > 0) fl |= 2;
  if (q.walking) fl |= 4;
  if (q.sprinting) fl |= 8;
  if (q.reviveProg > 0) fl |= 16;
  if (q.spawnProt > 0) fl |= 32;
  if (q.cf > 0.5) fl |= 64;
  if (Math.abs(q.vz) > 1) fl |= 128;
  return [q.id, r1(q.x), r1(q.y), r3(q.angle), full ? Math.ceil(q.hp) : 0, q.heldCode(), fl, q.cls === 'assault' ? 0 : q.cls === 'engineer' ? 1 : q.cls === 'support' ? 2 : 3, r1(q.speed), r1(q.z), r3(q.pitch), Math.round(q.cf * 100) / 100];
}

function vehicleTuple(v) {
  let occ = 0;
  for (let s = 0; s < v.seats.length; s++) if (v.seats[s]) occ |= 1 << s;
  return [v.id, VEHICLE_LIST.indexOf(v.type), r1(v.x), r1(v.y), r3(v.a), r3(v.ta), r3(v.seatAim[1] === undefined ? v.a : v.seatAim[1]), Math.ceil(v.hp / v.def.hp * 100), v.team, occ, r1(v.speed)];
}

export function buildSnapshot(game, p) {
  const target = resolveTarget(game, p);
  const pureSpec = p.team === SPEC;
  const viewTeam = target ? target.team : (pureSpec ? -1 : p.team);
  const vis = viewTeam >= 0 ? teamVisibility(game, viewTeam) : null;
  const t = target;
  const tx = t ? t.x : 0, ty = t ? t.y : 0;

  const players = [];
  const spotted = [];
  for (const q of game.players.values()) {
    if (!q.alive || q.team === SPEC || q.veh) continue;
    if (pureSpec && !target) { players.push(playerTuple(q, true)); continue; }
    if (q.team === viewTeam || pureSpec) players.push(playerTuple(q, true));
    else if (vis.p.has(q.id)) players.push(playerTuple(q, false));
    else if (q.spotUntil > game.time) spotted.push([q.id, r1(q.x), r1(q.y), 0]);
  }

  const veh = [];
  for (const v of game.vehicles) {
    if (v.dead) continue;
    if (pureSpec && !target) { veh.push(vehicleTuple(v)); continue; }
    if (v.team === viewTeam || pureSpec) veh.push(vehicleTuple(v));
    else if (v.team === -1 && !v.occupants().length) { if (Math.hypot(v.x - tx, v.y - ty) < 2400 || (vis && vis.v.has(v.id))) veh.push(vehicleTuple(v)); }
    else if (vis && vis.v.has(v.id)) veh.push(vehicleTuple(v));
    else if (v.spotUntil > game.time) spotted.push([v.id, r1(v.x), r1(v.y), 1]);
  }

  const snap = {
    t: 's', tk: game.tick, ack: p.lastSeq, ph: game.phase, rt: Math.max(0, Math.round(game.timer * 10) / 10),
    p: players,
  };
  game.mode.snapshot(game, snap, p);
  if (veh.length) snap.v = veh;
  if (spotted.length) snap.sp = spotted;

  // own / followed player's detailed state
  if (t) {
    const w = t.weapon();
    const gun = w && w.kind !== 'knife';
    const am = w ? t.ammoOf(w) : { clip: 0, reserve: 0 };
    const g = t.gadget();
    const held = t.heldCode();
    let clip = am.clip, res = am.reserve;
    if (g && g.def.kind === 'launcher') { clip = g.loaded ? 1 : 0; res = g.charges; } else if (g) { clip = g.charges; res = 0; }
    snap.me = {
      id: t.id, own: t === p ? 1 : 0,
      x: r1(t.x), y: r1(t.y), vx: r1(t.vx), vy: r1(t.vy), a: r3(t.angle), z: r2(t.z), vz: r1(t.vz), cf: Math.round(t.cf * 1000) / 1000, pt: r3(t.pitch),
      hp: Math.ceil(t.hp), cls: t.cls,
      pw: t.primaryW ? t.primaryW.idx : -1, sw: t.secondaryW ? t.secondaryW.idx : -1,
      gr: GREN_ORDER.map((k) => t.grenades[k]), sel: t.sel, gsel: GREN_ORDER.indexOf(t.gsel), held,
      g: t.gadgets.map((x) => (x ? [x.def.idx, x.charges, x.loaded ? 1 : 0] : null)),
      clip, res, alt: t.altMode ? 1 : 0, altc: t.primaryW && t.primaryW.alt ? [t.am.alt.clip, t.am.alt.reserve] : null,
      rel: t.reloadT > 0 ? Math.round((1 - t.reloadT / (t.reloadTotal || 1)) * 100) / 100 : 0,
      sp: Math.round(weaponSpread(w || { kind: 'knife' }, t.speed, t.burst, t.scoped, t.cf, Math.abs(t.vz) > 1) * 10000) / 10000,
      mv: gun ? [r1(w.speedPx), w.scope, Math.round((w.adsSpeed || 1) * 1000) / 1000, 1] : [BASE_SPEED, 0, 1, 0],
      pl: 0, plk: '',
      fl: Math.max(0, r1(t.flashUntil - game.time)), ff: Math.max(0, r1(t.flashFullUntil - game.time)),
      rc: t.respawnCounter, sc: t.scoped ? 1 : 0, spr: t.sprinting ? 1 : 0, sprot: t.spawnProt > 0 ? 1 : 0,
    };
    if (t.reviveProg > 0) { snap.me.pl = Math.round(t.reviveProg / RULES.reviveTime * 100) / 100; snap.me.plk = 'revive'; }
    else if (t.useT > 0) {
      const need = t.useKind === 'disarm' ? RULES.mcomDisarmTime : RULES.mcomArmTime;
      snap.me.pl = Math.round(t.useT / need * 100) / 100; snap.me.plk = t.useKind;
    }
    if (t.lockTarget) snap.me.lk = [t.lockTarget, Math.min(1, Math.round(t.lockT / 1.4 * 100) / 100)];
    if (t.veh) {
      const v = game.vehicleById(t.veh);
      if (v) {
        const sd = v.def.seats[t.seat], wp = sd.weapon ? VWEAPONS[sd.weapon] : null;
        snap.me.veh = {
          id: v.id, ty: VEHICLE_LIST.indexOf(v.type), seat: t.seat, x: r1(v.x), y: r1(v.y), a: r3(v.a), vx: r1(v.vx), vy: r1(v.vy), ta: r3(v.ta),
          hp: Math.ceil(v.hp), mhp: v.def.hp, seats: v.seats.slice(), wn: wp ? wp.name : '', ammo: v.ammo[t.seat] || 0,
          mag: wp && wp.mag ? wp.mag : 0, rel: v.rel[t.seat] > 0 ? Math.round((1 - v.rel[t.seat] / (wp.reload || 1)) * 100) / 100 : 0,
          cd: Math.max(0, Math.round(v.cd[t.seat] * 100) / 100), sa: r3(v.seatAim[t.seat] || 0),
        };
        snap.me.x = r1(v.x); snap.me.y = r1(v.y);
      }
    }
  }
  snap.al = p.alive ? 1 : 0;
  snap.spec = target ? target.id : 0;
  if (!p.alive && p.team !== SPEC) {
    snap.rsp = Math.max(0, Math.round((p.respawnAt - game.time) * 10) / 10);
    if (game.tick % 15 === 0 || p._needSp) {
      p._needSp = false;
      snap.sps = game.spawnOptions(p).map((o) => [o.k, o.id, o.name, Math.round(o.x), Math.round(o.y), o.ok ? 1 : 0, o.why || '', o.veh ? 1 : 0]);
    }
    const rev = game.corpses.find((c) => c.pid === p.id);
    if (rev) snap.rev = Math.max(0, Math.round((RULES.reviveWindow - (game.time - rev.t)) * 10) / 10);
  }

  // world entities
  if (game.grenades.length) snap.g = game.grenades.map((g) => [g.id, GREN_ORDER.indexOf(g.type), r1(g.x), r1(g.y), g.team]);
  if (game.smokes.length) snap.sm = game.smokes.map((s) => [s.id, r1(s.x), r1(s.y), r1(s.r), r1(game.time - s.t0)]);
  if (game.fires.length) snap.fi = game.fires.map((f) => [f.id, r1(f.x), r1(f.y), f.r, r1(game.time - f.t0)]);
  if (game.projectiles.length) {
    const pj = [];
    for (const q of game.projectiles) if (pureSpec || Math.hypot(q.x - tx, q.y - ty) < 1700 || q.team === viewTeam) pj.push([q.id, q.idx, r1(q.x), r1(q.y), r3(q.a)]);
    if (pj.length) snap.pj = pj;
  }
  if (game.gadgets.length) {
    const gd = [];
    for (const g of game.gadgets) {
      if (g.team === viewTeam || pureSpec) gd.push([g.id, GADGET_LIST.findIndex((d) => d.id === g.type), r1(g.x), r1(g.y), r3(g.a), g.team, game.time - g.t0 >= g.arm ? 1 : 0, g.life ? Math.max(0, Math.round((1 - (game.time - g.t0) / g.life) * 100) / 100) : 1]);
    }
    if (gd.length) snap.gd = gd;
  }
  if (game.corpses.length) {
    const cp = [];
    for (const c of game.corpses) if ((c.team === viewTeam || pureSpec) && Math.hypot(c.x - tx, c.y - ty) < 1200) cp.push([c.pid, Math.round(c.x), Math.round(c.y), Math.round(RULES.reviveWindow - (game.time - c.t))]);
    if (cp.length) snap.cp = cp;
  }

  // events near the viewer (or addressed to them)
  const ev = [];
  for (const e of game.events) {
    if (e.to) { if (e.to === p.id) ev.push(e.p); continue; }
    if (pureSpec && !t) { ev.push(e.p); continue; }
    if (e.r >= 4000 || (t && Math.hypot(e.x - tx, e.y - ty) <= e.r)) ev.push(e.p);
  }
  if (ev.length) snap.ev = ev;
  return snap;
}

export { PROJ_TYPES, ALT };
