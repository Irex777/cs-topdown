// Builds the per-client world snapshot: what this player is allowed to know right now.
import { SPEC, T, CT, PHASE, VISION, GREN_ORDER, RULES } from '../shared/constants.js';
import { WEAPONS, maxSpeedFor, weaponSpread } from '../shared/weapons.js';
import { canSee, viewParams } from '../shared/vision.js';

const r1 = (v) => Math.round(v * 10) / 10;
const BOMB_CODE = { none: 0, carried: 1, dropped: 2, planted: 3, defused: 4, exploded: 5 };

function teamVisibility(game, team) {
  if (!game._vis || game._vis.tick !== game.tick) game._vis = { tick: game.tick, sets: [null, null] };
  if (game._vis.sets[team]) return game._vis.sets[team];
  const seen = new Set();
  const mates = [], enemies = [];
  for (const p of game.players.values()) {
    if (!p.alive || p.team === SPEC) continue;
    (p.team === team ? mates : enemies).push(p);
  }
  for (const e of enemies) {
    for (const m of mates) {
      const w = m.weapon();
      const view = viewParams(m.scoped, w ? w.scope : 0);
      if (canSee(game.map, game.smokes, m.x, m.y, m.angle, view, e.x, e.y, VISION.serverFovPad)) { seen.add(e.id); break; }
    }
  }
  game._vis.sets[team] = seen;
  return seen;
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
  if (q.planting > 0 || q.defusing > 0) fl |= 8;
  if (full && q.hasBomb) fl |= 16;
  return [q.id, r1(q.x), r1(q.y), Math.round(q.angle * 1000) / 1000, full ? Math.ceil(q.hp) : 0, q.heldCode(), fl, full ? Math.ceil(q.armor) : 0];
}

export function buildSnapshot(game, p) {
  const target = resolveTarget(game, p);
  const pureSpec = p.team === SPEC;
  const viewTeam = target ? target.team : (pureSpec ? -1 : p.team);
  const vis = viewTeam >= 0 ? teamVisibility(game, viewTeam) : null;

  const players = [];
  for (const q of game.players.values()) {
    if (!q.alive || q.team === SPEC) continue;
    if (pureSpec && !target) { players.push(playerTuple(q, true)); continue; }
    if (q.team === viewTeam || pureSpec) players.push(playerTuple(q, true));
    else if (vis.has(q.id)) players.push(playerTuple(q, false));
  }

  const snap = {
    k: 's', tk: game.tick, ack: p.lastSeq, ph: game.phase, rt: Math.max(0, Math.round(game.timer * 10) / 10),
    p: players,
  };

  // own / followed player's detailed state
  const t = target;
  if (t) {
    const w = t.weapon();
    const am = w ? t.ammoOf(w) : { clip: 0, reserve: 0 };
    snap.me = {
      id: t.id, own: t === p ? 1 : 0,
      x: r1(t.x), y: r1(t.y), vx: r1(t.vx), vy: r1(t.vy), a: Math.round(t.angle * 1000) / 1000,
      hp: Math.ceil(t.hp), ar: Math.ceil(t.armor), hm: t.helmet ? 1 : 0, kit: t.kit ? 1 : 0, bomb: t.hasBomb ? 1 : 0,
      pri: t.primary ? WEAPONS[t.primary].idx : -1, sec: t.secondary ? WEAPONS[t.secondary].idx : -1,
      gr: GREN_ORDER.map((k) => t.grenades[k]), sel: t.sel, gsel: GREN_ORDER.indexOf(t.gsel), held: t.heldCode(),
      clip: am.clip, res: am.reserve,
      rel: t.reloadT > 0 ? Math.round((1 - t.reloadT / (t.reloadTotal || 1)) * 100) / 100 : 0,
      sp: Math.round(weaponSpread(w || WEAPONS.knife, t.speed, t.burst, t.scoped) * 10000) / 10000,
      spd: Math.round(maxSpeedFor(w, t.walking, t.scoped) * 10) / 10,
      pl: t.planting > 0 ? Math.round(t.planting / RULES.plantTime * 100) / 100 : 0,
      df: t.defusing > 0 ? Math.round(t.defusing / (t.kit ? RULES.defuseTimeKit : RULES.defuseTime) * 100) / 100 : 0,
      fl: Math.max(0, r1(t.flashUntil - game.time)), ff: Math.max(0, r1(t.flashFullUntil - game.time)),
      rc: t.respawnCounter, sc: t.scoped ? 1 : 0, dbuy: 0,
    };
    if (t === p) { snap.me.money = p.money; snap.me.buy = game.canBuy(p) ? 1 : 0; }
    else if (t.team === p.team || pureSpec) snap.me.money = t.money;
  }
  snap.al = p.alive ? 1 : 0;
  snap.spec = target ? target.id : 0;

  // world entities
  if (game.grenades.length) snap.g = game.grenades.map((g) => [g.id, GREN_ORDER.indexOf(g.type), r1(g.x), r1(g.y), g.team]);
  if (game.smokes.length) snap.sm = game.smokes.map((s) => [s.id, r1(s.x), r1(s.y), r1(s.r), r1(game.time - s.t0)]);
  if (game.fires.length) snap.fi = game.fires.map((f) => [f.id, r1(f.x), r1(f.y), f.r, r1(game.time - f.t0)]);
  if (game.drops.length) snap.dr = game.drops.map((d) => [d.id, WEAPONS[d.wid].idx, r1(d.x), r1(d.y)]);
  const b = game.bomb;
  const seeBombLoose = pureSpec || viewTeam === T;
  if (b.state === 'planted') snap.bb = [3, r1(b.x), r1(b.y), r1(b.timer), b.defuser ? 1 : 0, b.site];
  else if (b.state === 'dropped' && seeBombLoose) snap.bb = [2, r1(b.x), r1(b.y), 0, 0, -1];
  else if (b.state === 'defused') snap.bb = [4, r1(b.x), r1(b.y), 0, 0, b.site];

  // events near the viewer (or addressed to them)
  const vx = t ? t.x : 0, vy = t ? t.y : 0;
  const ev = [];
  for (const e of game.events) {
    if (e.to) { if (e.to === p.id) ev.push(e.p); continue; }
    if (pureSpec && !t) { ev.push(e.p); continue; }
    if (e.r >= 4000 || (t && Math.hypot(e.x - vx, e.y - vy) <= e.r)) ev.push(e.p);
  }
  if (ev.length) snap.ev = ev;
  return snap;
}
