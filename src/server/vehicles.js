// Vehicles: spawning, seats, driving, weapons, damage, wrecks and respawns.
import { DT, PLAYER_R, SPEC, RULES } from '../shared/constants.js';
import { VEHICLES, VWEAPONS, stepVehicle, exitSpot, wrapAngle, vehicleShot, vehicleGunMount, vehicleDistance, hullContact } from '../shared/vehicles.js';
import { PROJ, AIR_DEFENSE } from '../shared/weapons.js';
import { explode } from './world.js';
import { killPlayer, castRay, damagePlayer, lagTick } from './combat.js';
import { spawnProjectile } from './projectiles.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const slew = (cur, target, step) => wrapAngle(cur + clamp(wrapAngle(target - cur), -step, step));

export class Vehicle {
  constructor(game, sp) {
    this.id = game.nextId++;
    this.spawn = sp;
    this.map = game.map;
    this.type = sp.type;
    this.def = VEHICLES[sp.type];
    this.homeTeam = sp.team;
    this.reset(game);
  }

  reset(game) {
    const sp = this.spawn;
    this.x = sp.x; this.y = sp.y; this.a = sp.a; this.vx = 0; this.vy = 0;
    if (this.def.kind !== 'air') {
      const mask = this.def.kind === 'boat' ? game.map.blockBoat : game.map.blockInf;
      const clear = game.map.moveHull(this.x, this.y, 0, 0, this.def.size[0], this.def.size[1], this.a, mask);
      this.x = clear.x; this.y = clear.y;
    }
    this.chassisZ = game.map.heightAt(this.x, this.y);
    this.steer = this.yawRate = this.throttle = 0;
    this.flightZ = game.map.landingHeight(this.x, this.y, this.def.r * .7) + 2; this.vz = 0;
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
    this.flareAmmo = this.def.kind === 'air' ? AIR_DEFENSE.flareCharges : 0;
    this.flareCd = 0; this.flareUntil = 0;
    if (game) this.born = game.time;
  }

  get z() { return this.def.kind === 'air' ? this.flightZ : this.def.kind === 'boat' ? 0 : this.chassisZ ?? this.map.heightAt(this.x, this.y); }

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
    v.flareCd = Math.max(0, v.flareCd - dt);
    // empty vehicles coast to a halt; abandoned ones go back to their spawn point after a while
    if (!v.hasDriver()) {
      if (v.speed > 1 || Math.abs(v.vz) > .01) stepVehicle(game.map, v, v.def, 0, v.a);
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
      if (p) { p.x = v.x; p.y = v.y; p.z = v.z; p.vz = v.vz || 0; p.vx = v.vx; p.vy = v.vy; }
    }
    if (v.speed > 70 && v.def.kind !== 'air') crushSoldiers(game, v);
  }
  collideVehicles(game);
}

function crushSoldiers(game, v) {
  const driver = game.players.get(v.seats[0]) || null;
  for (const p of game.players.values()) {
    if (!p.alive || p.veh || p.team === SPEC || p.spawnProt > 0) continue;
    if (Math.abs(p.x - v.x) > v.def.r + 20 || Math.abs(p.y - v.y) > v.def.r + 20) continue;
    if (Math.hypot(p.x - v.x, p.y - v.y) > v.def.r + PLAYER_R - 3 || p.z > v.z + v.def.zr[1] || p.z + 29 < v.z) continue;
    if (driver && driver.team === p.team && !game.ff) continue;
    if (!driver && v.team === p.team) continue;
    const dmg = v.speed > 105 ? 999 : v.speed * 1.0;
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
      if (a.z > b.z + b.def.zr[1] || b.z > a.z + a.def.zr[1]) continue;
      const contact = hullContact(a, b); if (!contact) continue;
      const push = contact.depth / 2, nx = contact.nx, ny = contact.ny;
      const masses = { tank: 55000, apc: 18000, jeep: 3800, quad: 350, heli: 5000, boat: 1700 };
      const ma = masses[a.type], mb = masses[b.type];
      const wa = mb / (ma + mb), wb = ma / (ma + mb);
      const res = (v, sx, sy) => { const r = game.map.moveCircle(v.x, v.y, sx, sy, v.def.r, v.def.kind === 'air' ? game.map.aircraftMask(v.z) : (v.def.kind === 'boat' ? game.map.blockBoat : game.map.blockInf)); v.x = r.x; v.y = r.y; };
      res(a, -nx * push * 2 * wa, -ny * push * 2 * wa);
      res(b, nx * push * 2 * wb, ny * push * 2 * wb);
      const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (closing > 0) {
        const impulse = closing * 1.12 / (1 / ma + 1 / mb);
        a.vx -= impulse / ma * nx; a.vy -= impulse / ma * ny; b.vx += impulse / mb * nx; b.vy += impulse / mb * ny;
      }
      const rel = Math.max(0, closing);
      if (rel > 130 && game.time - (a.lastBump || 0) > 0.4) {
        a.lastBump = game.time;
        const base = (rel - 130) * 0.55;
        damageVehicle(game, a, base * wa * 2 * 0.5, game.players.get(b.seats[0]) || null, 'ram', 'ram');
        damageVehicle(game, b, base * wb * 2 * 0.5, game.players.get(a.seats[0]) || null, 'ram', 'ram');
        game.emit(['crash', a.id], a.x, a.y, 1200);
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------ seats
export function nearestVehicle(game, p, extra = 34) {
  let best = null, bd = Infinity;
  for (const v of game.vehicles) {
    if (v.dead || Math.abs(v.z - p.z) > 48) continue;
    const d = vehicleDistance(v, p.x, p.y);
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
  p.scoped = false; p.vx = 0; p.vy = 0; p.x = v.x; p.y = v.y; p.z = v.z; p.vz = v.vz || 0;
  p.useT = 0; p.reviveProg = 0; p.reloadT = 0; p.lockTarget = 0; p.lockT = 0;
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
  p.x = spot.x; p.y = spot.y; p.z = v.def.kind === 'air' ? v.z + 8 : game.map.heightAt(p.x, p.y); p.vz = v.def.kind === 'air' ? v.vz : 0; p.vx = 0; p.vy = 0;
  p.drawT = 0.4;
  game.emit(['exit', p.id, v.id], v.x, v.y, 700);
}

// ------------------------------------------------------------------------------------------------ driving & shooting
/** One input command from a seated player. Returns nothing; everything lands in vehicle / player state. */
export function vehicleCmd(game, p, keys, angle, vt, aimDist, aimHeight = null, aimPoint = null) {
  const v = vehicleById(game, p.veh);
  if (!v || v.dead) { p.veh = 0; return; }
  const seat = p.seat, sd = v.def.seats[seat];
  if (aimPoint) { const origin = sd.aim === 'free' ? vehicleGunMount(v, seat) : v; angle = Math.atan2(aimPoint.y - origin.y, aimPoint.x - origin.x); aimDist = Math.hypot(aimPoint.x - v.x, aimPoint.y - v.y); }
  p.angle = angle;
  p.lastKeys = keys;
  const fire = (keys & 16) !== 0;
  if (seat === 0) {
    game.physics?.pushProps(v, true);
    const before = stepVehicle(game.map, v, v.def, keys, angle);
    const after = v.def.kind === 'air' ? Math.hypot(v.vx, v.vy) : Math.abs(v.vx * Math.cos(v.a) + v.vy * Math.sin(v.a));
    if (Math.abs(before) - after > 105 && game.time - (v.lastWall || 0) > 0.25) {
      v.lastWall = game.time;
      damageVehicle(game, v, (Math.abs(before) - after - 105) * 0.45, null, 'crash', 'crash');
      game.emit(['crash', v.id], v.x, v.y, 900);
    }
    if (aimPoint) angle = Math.atan2(aimPoint.y - v.y, aimPoint.x - v.x);
    if (sd.aim === 'turret') v.ta = slew(v.ta, angle, sd.turn * DT);
  } else if (sd.weapon && sd.aim === 'free') v.seatAim[seat] = slew(v.seatAim[seat], angle, sd.turn * DT);
  p.x = v.x; p.y = v.y; p.z = v.z; p.vz = v.vz || 0;
  if (aimPoint) aimDist = Math.hypot(aimPoint.x - v.x, aimPoint.y - v.y);
  if (sd.weapon) {
    if (!Number.isFinite(aimHeight)) aimHeight = game.map.heightAt(v.x + Math.cos(angle) * (aimDist || 400), v.y + Math.sin(angle) * (aimDist || 400)) + 14;
    v.seatPitch ||= v.def.seats.map(() => 0);
    v.seatPitch[seat] = vehicleShot(v, seat, seatAngle(v, seat), aimDist || 400, aimHeight, aimPoint).pitch;
    vehicleFire(game, v, seat, p, fire, vt, aimDist, aimHeight, aimPoint);
  }
  v.firePrev[seat] = fire;
}

function seatAngle(v, seat) {
  const sd = v.def.seats[seat];
  return sd.aim === 'turret' ? v.ta : sd.aim === 'body' ? v.a : v.seatAim[seat];
}

export function vehicleFire(game, v, seat, p, fire, vt, aimDist = 400, aimHeight = null, aimPoint = null) {
  const sd = v.def.seats[seat], wp = VWEAPONS[sd.weapon];
  if (!fire || v.cd[seat] > 0 || v.rel[seat] > 0) return;
  if (wp.mag && v.ammo[seat] <= 0) { v.rel[seat] = wp.reload; return; }
  const ang = seatAngle(v, seat);
  const targetZ = Number.isFinite(aimHeight) ? aimHeight : game.map.heightAt(v.x + Math.cos(ang) * aimDist, v.y + Math.sin(ang) * aimDist) + 14;
  const muzzle = vehicleShot(v, seat, ang, aimDist || 400, targetZ, aimPoint);
  const ox = muzzle.x, oy = muzzle.y, gz = muzzle.z;
  v.cd[seat] = wp.cd || 60 / wp.rpm;
  if (wp.mag) { v.ammo[seat]--; if (v.ammo[seat] <= 0) v.rel[seat] = wp.reload; }
  const shotAngle = muzzle.yaw, pitch = muzzle.pitch;
  v.seatPitch ||= v.def.seats.map(() => 0); v.seatPitch[seat] = pitch;
  if (wp.kind === 'proj') {
    const pr = PROJ[wp.proj];
    const spread = wp.proj === 'hrocket' ? (Math.random() - 0.5) * 0.09 : (Math.random() - 0.5) * 0.012;
    spawnProjectile(game, { type: wp.proj, owner: p, veh: v, x: ox, y: oy, ang: shotAngle + spread, z: gz, pitch, air: v.def.kind === 'air' });
    game.emit(['vshot', v.id, wp.sound, Math.round(ox), Math.round(oy), Math.round((shotAngle + spread) * 1000) / 1000, Math.round(pr.speed * pr.life), 0, v.team, Math.round(gz), Math.round(gz)], ox, oy, 2400);
    return;
  }
  // hitscan machine gun
  const spread = (wp.spread * Math.PI / 180);
  const a2 = shotAngle + (Math.random() + Math.random() - 1) * spread;
  // Aim down from the real gun height to the crosshair's ground distance.
  const r = castRay(game, ox, oy, gz, a2, pitch, { range: wp.range, shooter: p, ignoreVeh: v, tf: lagTick(game, vt), air: v.def.kind === 'air' });
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
  if (r.rigid) { game.physics?.hit(r.rigid, wp.dmg, a2, pitch, p); kind = 1; }
  else if (r.tile && r.tx >= 0) {
    const ch = game.map.charAt(r.tx, r.ty), light = ['X', 'o', 'G', '='].includes(ch);
    const destroyed = game.map.damageTile(r.tx, r.ty, wp.dmg * (light ? 1 : .12));
    if (destroyed && ch === 'o') explode(game, { x: (r.tx + .5) * 32, y: (r.ty + .5) * 32, radius: 95, dmg: 70, veh: 60, tile: 150, owner: p, wid: 'barrel', kind: 'barrel' });
  }
  if ((r.target || r.veh) && p.conn) game.emit(['hitm', 1, 0], 0, 0, 0, p.id);
  game.emit(['vshot', v.id, wp.sound, Math.round(ox), Math.round(oy), Math.round(a2 * 1000) / 1000, Math.round(r.dist), kind, v.team, Math.round(gz), Math.round(r.z)], ox, oy, 2400);
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
  explode(game, { x: v.x, y: v.y, z: v.z + (v.def.zr[0] + v.def.zr[1]) / 2, radius: 90 + v.def.r, dmg: 110, veh: 0, tile: 260, owner: attacker, wid: 'vehicle', kind: 'veh' });
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
