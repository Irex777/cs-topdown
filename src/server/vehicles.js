// Vehicles: spawning, seats, driving, weapons, damage, wrecks and respawns.
import { DT, PLAYER_R, SPEC, RULES } from '../shared/constants.js';
import { VEHICLES, VWEAPONS, stepVehicle, exitSpot, wrapAngle } from '../shared/vehicles.js';
import { PROJ } from '../shared/weapons.js';
import { explode } from './world.js';
import { killPlayer, castRay, damagePlayer } from './combat.js';
import { spawnProjectile } from './projectiles.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const slew = (cur, target, step) => wrapAngle(cur + clamp(wrapAngle(target - cur), -step, step));

export class Vehicle {
  constructor(game, sp) {
    this.id = game.nextId++;
    this.spawn = sp;
    this.type = sp.type;
    this.def = VEHICLES[sp.type];
    this.homeTeam = sp.team;
    this.reset(game);
  }

  reset(game) {
    const sp = this.spawn;
    this.x = sp.x; this.y = sp.y; this.a = sp.a; this.vx = 0; this.vy = 0;
    this.ta = sp.a;
    this.seatAim = this.def.seats.map(() => sp.a);
    this.seats = this.def.seats.map(() => 0);
    this.hp = this.def.hp;
    this.team = sp.team;
    this.dead = false; this.deadAt = 0;
    this.idleT = 0;
    this.cd = this.def.seats.map(() => 0);
    this.ammo = this.def.seats.map((s) => (s.weapon && VWEAPONS[s.weapon].mag ? VWEAPONS[s.weapon].mag : 0));
    this.rel = this.def.seats.map(() => 0);
    this.dmgFrom = new Map();
    this.lastAttacker = 0;
    this.burn = 0;
    this.firePrev = this.def.seats.map(() => false);
    if (game) this.born = game.time;
  }

  get speed() { return Math.hypot(this.vx, this.vy); }
  occupants() { return this.seats.filter((s) => s > 0); }
  hasDriver() { return this.seats[0] > 0; }
}

export function initVehicles(game) {
  game.vehicles = [];
  if (!game.settings.vehicles) return;
  for (const sp of game.map.vehSpawns) {
    if (game.mode === 'tdm' && sp.type !== 'quad' && sp.type !== 'jeep') continue;
    game.vehicles.push(new Vehicle(game, sp));
  }
}

export function vehicleById(game, id) {
  for (const v of game.vehicles) if (v.id === id) return v;
  return null;
}

export function updateVehicles(game, dt) {
  const list = game.vehicles;
  for (const v of list) {
    if (v.dead) {
      if (game.time - v.deadAt >= v.def.respawn * (game.mode === 'rush' ? 0.8 : 1)) { v.reset(game); game.emit(['vspawn', v.id], v.x, v.y, 2500); }
      continue;
    }
    for (let s = 0; s < v.cd.length; s++) {
      if (v.cd[s] > 0) v.cd[s] -= dt;
      if (v.rel[s] > 0) { v.rel[s] -= dt; if (v.rel[s] <= 0) v.ammo[s] = VWEAPONS[v.def.seats[s].weapon].mag; }
    }
    // empty vehicles coast to a halt; abandoned ones go back to their spawn point after a while
    if (!v.hasDriver()) {
      if (v.speed > 1) stepVehicle(game.map, v, v.def, 0, v.a);
      else { v.vx = 0; v.vy = 0; }
    }
    if (v.occupants().length === 0) {
      v.idleT += dt;
      if (v.idleT > 80 && Math.hypot(v.x - v.spawn.x, v.y - v.spawn.y) > 200) { v.reset(game); v.deadAt = game.time - v.def.respawn + 8; v.dead = true; v.x = -999; v.y = -999; }
    } else v.idleT = 0;
    // seated players ride along
    for (const pid of v.seats) {
      if (!pid) continue;
      const p = game.players.get(pid);
      if (p) { p.x = v.x; p.y = v.y; p.vx = v.vx; p.vy = v.vy; }
    }
    if (v.speed > 95 && v.def.kind !== 'air') crushSoldiers(game, v);
  }
  collideVehicles(game);
}

function crushSoldiers(game, v) {
  const driver = game.players.get(v.seats[0]) || null;
  for (const p of game.players.values()) {
    if (!p.alive || p.veh || p.team === SPEC || p.spawnProt > 0) continue;
    if (Math.abs(p.x - v.x) > v.def.r + 20 || Math.abs(p.y - v.y) > v.def.r + 20) continue;
    if (Math.hypot(p.x - v.x, p.y - v.y) > v.def.r + PLAYER_R - 3) continue;
    if (driver && driver.team === p.team && !game.ff) continue;
    if (!driver && v.team === p.team) continue;
    const dmg = v.speed > 150 ? 999 : v.speed * 0.7;
    const owner = driver || game.players.get(v.lastAttacker) || null;
    damagePlayer(game, p, owner, dmg, 'vehicle', { expl: true, roadkill: true });
  }
}

function collideVehicles(game) {
  const l = game.vehicles;
  for (let i = 0; i < l.length; i++) {
    const a = l[i];
    if (a.dead) continue;
    for (let j = i + 1; j < l.length; j++) {
      const b = l[j];
      if (b.dead) continue;
      if ((a.def.kind === 'air') !== (b.def.kind === 'air')) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const min = a.def.r + b.def.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), push = (min - d) / 2;
      const nx = dx / d, ny = dy / d;
      const ma = a.def.hp, mb = b.def.hp;
      const wa = mb / (ma + mb), wb = ma / (ma + mb);
      const res = (v, sx, sy) => { const r = game.map.moveCircle(v.x, v.y, sx, sy, v.def.r, v.def.kind === 'air' ? null : (v.def.kind === 'boat' ? game.map.blockBoat : game.map.blockInf)); v.x = r.x; v.y = r.y; };
      res(a, -nx * push * 2 * wa, -ny * push * 2 * wa);
      res(b, nx * push * 2 * wb, ny * push * 2 * wb);
      const rel = Math.hypot(a.vx - b.vx, a.vy - b.vy);
      if (rel > 130 && game.time - (a.lastBump || 0) > 0.4) {
        a.lastBump = game.time;
        const base = (rel - 130) * 0.55;
        damageVehicle(game, a, base * wa * 2 * 0.5, game.players.get(b.seats[0]) || null, 'ram', 'ram');
        damageVehicle(game, b, base * wb * 2 * 0.5, game.players.get(a.seats[0]) || null, 'ram', 'ram');
        a.vx *= 0.5; a.vy *= 0.5; b.vx *= 0.5; b.vy *= 0.5;
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------ seats
export function nearestVehicle(game, p, extra = 34) {
  let best = null, bd = Infinity;
  for (const v of game.vehicles) {
    if (v.dead) continue;
    const d = Math.hypot(v.x - p.x, v.y - p.y) - v.def.r;
    if (d < extra && d < bd) { bd = d; best = v; }
  }
  return best;
}

export function canEnter(v, p) {
  const occ = v.occupants();
  if (occ.length && v.team !== p.team) return false;
  return true;
}

export function freeSeat(v, want = -1) {
  if (want >= 0 && want < v.seats.length && !v.seats[want]) return want;
  for (let s = 0; s < v.seats.length; s++) if (!v.seats[s]) return s;
  return -1;
}

export function enterVehicle(game, p, v, seat = -1) {
  if (!p.alive || p.veh || v.dead || !canEnter(v, p)) return false;
  const s = freeSeat(v, seat);
  if (s < 0) return false;
  if (!v.occupants().length) v.team = p.team;
  v.seats[s] = p.id;
  v.idleT = 0;
  p.veh = v.id; p.seat = s;
  p.scoped = false; p.vx = 0; p.vy = 0; p.x = v.x; p.y = v.y;
  p.useT = 0; p.reviveProg = 0; p.reloadT = 0;
  if (s === 0) { v.ta = v.a; }
  v.seatAim[s] = p.angle;
  game.emit(['enter', p.id, v.id, s], v.x, v.y, 700);
  return true;
}

export function switchSeat(game, p, seat) {
  const v = vehicleById(game, p.veh);
  if (!v || seat < 0 || seat >= v.seats.length || v.seats[seat]) return false;
  v.seats[p.seat] = 0;
  v.seats[seat] = p.id;
  p.seat = seat;
  v.seatAim[seat] = p.angle;
  return true;
}

export function exitVehicle(game, p) {
  const v = vehicleById(game, p.veh);
  const seat = p.seat;
  p.veh = 0; p.seat = 0;
  if (!v) return;
  if (v.seats[seat] === p.id) v.seats[seat] = 0;
  const spot = exitSpot(game.map, v, v.def, seat);
  p.x = spot.x; p.y = spot.y; p.vx = 0; p.vy = 0;
  p.drawT = 0.4;
  game.emit(['exit', p.id, v.id], v.x, v.y, 700);
}

// ------------------------------------------------------------------------------------------------ driving & shooting
/** One input command from a seated player. Returns nothing; everything lands in vehicle / player state. */
export function vehicleCmd(game, p, keys, angle, vt, aimDist) {
  const v = vehicleById(game, p.veh);
  if (!v || v.dead) { p.veh = 0; return; }
  const seat = p.seat, sd = v.def.seats[seat];
  p.angle = angle;
  p.lastKeys = keys;
  const fire = (keys & 16) !== 0;
  if (seat === 0) {
    const before = stepVehicle(game.map, v, v.def, keys, angle);
    const after = v.def.kind === 'air' ? Math.hypot(v.vx, v.vy) : Math.abs(v.vx * Math.cos(v.a) + v.vy * Math.sin(v.a));
    if (v.def.kind !== 'air' && Math.abs(before) - after > 150 && game.time - (v.lastWall || 0) > 0.25) {
      v.lastWall = game.time;
      damageVehicle(game, v, (Math.abs(before) - after - 150) * 0.32, null, 'crash', 'crash');
      game.emit(['crash', v.id], v.x, v.y, 900);
    }
    if (sd.aim === 'turret') v.ta = slew(v.ta, angle, sd.turn * DT);
  } else if (sd.weapon && sd.aim === 'free') v.seatAim[seat] = slew(v.seatAim[seat], angle, sd.turn * DT);
  p.x = v.x; p.y = v.y;
  if (sd.weapon) vehicleFire(game, v, seat, p, fire, vt);
  v.firePrev[seat] = fire;
}

function seatAngle(v, seat) {
  const sd = v.def.seats[seat];
  return sd.aim === 'turret' ? v.ta : sd.aim === 'body' ? v.a : v.seatAim[seat];
}

export function vehicleFire(game, v, seat, p, fire, vt) {
  const sd = v.def.seats[seat], wp = VWEAPONS[sd.weapon];
  if (!fire || v.cd[seat] > 0 || v.rel[seat] > 0) return;
  if (wp.mag && v.ammo[seat] <= 0) { v.rel[seat] = wp.reload; return; }
  const ang = seatAngle(v, seat);
  const off = sd.aim === 'free' ? v.def.r * 0.3 : v.def.r * 1.35;
  const ox = v.x + Math.cos(ang) * off, oy = v.y + Math.sin(ang) * off;
  v.cd[seat] = wp.cd || 60 / wp.rpm;
  if (wp.mag) { v.ammo[seat]--; if (v.ammo[seat] <= 0) v.rel[seat] = wp.reload; }
  if (wp.kind === 'proj') {
    const pr = PROJ[wp.proj];
    const spread = wp.proj === 'hrocket' ? (Math.random() - 0.5) * 0.09 : (Math.random() - 0.5) * 0.012;
    spawnProjectile(game, { type: wp.proj, owner: p, veh: v, x: ox, y: oy, ang: ang + spread, air: v.def.kind === 'air' });
    game.emit(['vshot', v.id, wp.sound, Math.round(ox), Math.round(oy), Math.round((ang + spread) * 1000) / 1000, Math.round(pr.speed * pr.life), 0, v.team], ox, oy, 2400);
    return;
  }
  // hitscan machine gun
  const spread = (wp.spread * Math.PI / 180);
  const a2 = ang + (Math.random() + Math.random() - 1) * spread;
  const r = castRay(game, ox, oy, a2, { range: wp.range, shooter: p, ignoreVeh: v, tf: 0, air: v.def.kind === 'air' });
  let kind = r.tile ? 1 : 0;
  if (r.target) {
    kind = 2;
    const dmg = wp.dmg * Math.pow(wp.rangeMod, r.dist / 345);
    damagePlayer(game, r.target, p, dmg, wp.id || wp.name, { angle: a2, vgun: true });
  } else if (r.veh) {
    kind = 3;
    const dmg = wp.dmg * Math.pow(wp.rangeMod, r.dist / 345) * wp.veh * r.veh.def.resist.bullet;
    damageVehicle(game, r.veh, dmg, p, wp.name, 'bullet');
  }
  if ((r.target || r.veh) && p.conn) game.emit(['hitm', 1, 0], 0, 0, 0, p.id);
  game.emit(['vshot', v.id, wp.sound, Math.round(ox), Math.round(oy), Math.round(a2 * 1000) / 1000, Math.round(r.dist), kind, v.team], ox, oy, 2400);
}

// ------------------------------------------------------------------------------------------------ damage
export function damageVehicle(game, v, dmg, attacker, wid, type) {
  if (v.dead || dmg <= 0) return;
  if (attacker && attacker.team === v.team && attacker !== game.players.get(v.seats[0]) && !game.ff && v.team >= 0 && type !== 'crash') return;
  if (attacker && attacker.team === v.team && v.occupants().length && !game.ff && type !== 'crash' && type !== 'ram') return;
  v.hp -= dmg;
  if (attacker) {
    v.lastAttacker = attacker.id;
    if (attacker.team !== v.team) v.dmgFrom.set(attacker.id, (v.dmgFrom.get(attacker.id) || 0) + dmg);
  }
  // open vehicles expose their crew
  if (v.def.open && type === 'bullet') for (const pid of v.seats) { const q = game.players.get(pid); if (q) damagePlayer(game, q, attacker, dmg * 0.9, wid, {}); }
  if (v.hp <= 0) destroyVehicle(game, v, attacker, wid);
}

export function repairVehicle(v, amount) {
  const before = v.hp;
  v.hp = Math.min(v.def.hp, v.hp + amount);
  return v.hp - before;
}

export function destroyVehicle(game, v, attacker, wid) {
  if (v.dead) return;
  v.dead = true; v.deadAt = game.time; v.hp = 0;
  const wasEnemy = attacker && attacker.team !== v.team && v.team >= 0;
  game.emit(['vdie', v.id, v.type, Math.round(v.x), Math.round(v.y), Math.round(v.a * 100) / 100], v.x, v.y, 6000);
  explode(game, { x: v.x, y: v.y, radius: 90 + v.def.r, dmg: 110, veh: 0, tile: 260, owner: attacker, wid: 'vehicle', kind: 'veh' });
  for (const pid of v.seats) {
    const p = game.players.get(pid);
    if (!p) continue;
    p.veh = 0;
    if (p.alive) killPlayer(game, p, attacker, 'vehicle', { noCorpse: true });
  }
  v.seats = v.seats.map(() => 0);
  if (wasEnemy) {
    game.addScore(attacker, RULES.score.vehicle, `Destroyed ${v.def.name}`);
    attacker.stats.vehicleKills++;
    for (const [id, d] of v.dmgFrom) {
      if (id === attacker.id || d < v.def.hp * 0.25) continue;
      const a = game.players.get(id);
      if (a && a.team !== v.team) game.addScore(a, RULES.score.vehicle / 2, 'Vehicle assist');
    }
    game.broadcast({ t: 'kill', k: attacker.id, v: 0, w: wid, a: 0, tk: 0, vt: v.type, vtm: v.team });
  }
  v.x = v.spawn.x; v.y = v.spawn.y;   // park the (invisible) wreck at the spawn so nothing can collide with it
  v.vx = v.vy = 0;
}
