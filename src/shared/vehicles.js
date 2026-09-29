// Vehicle definitions and the deterministic driving step (server simulation + client prediction of the driver).
import { DT } from './constants.js';

// ---- vehicle weapons -----------------------------------------------------------------------------------------------
// kind 'bullet' = hitscan tracer, 'proj' = physical projectile (see PROJ in weapons.js)
export const VWEAPONS = {
  mg50:    { name: '.50 Cal HMG', kind: 'bullet', dmg: 24, rpm: 540, spread: 0.9, range: 1500, rangeMod: 0.985, veh: 0.5, sound: 'lmg' },
  coax:    { name: 'Coaxial MG', kind: 'bullet', dmg: 22, rpm: 720, spread: 0.8, range: 1300, rangeMod: 0.985, veh: 0.4, sound: 'lmg' },
  minigun: { name: 'Chin Minigun', kind: 'bullet', dmg: 15, rpm: 1150, spread: 1.7, range: 1200, rangeMod: 0.98, veh: 0.45, sound: 'lmg' },
  cannon:  { name: '120 mm Cannon', kind: 'proj', proj: 'cannon', cd: 2.2, sound: 'cannon' },
  pod:     { name: 'Rocket Pod', kind: 'proj', proj: 'hrocket', cd: 0.3, mag: 12, reload: 4, sound: 'rocket' },
  autocannon: { name: '30 mm Autocannon', kind: 'proj', proj: 'apcgun', cd: 0.13, mag: 40, reload: 3.6, sound: 'cannon2' },
};

// ---- vehicle types -------------------------------------------------------------------------------------------------
// resist: multipliers applied to incoming damage by type. size = [length, width, height] px, used by the renderer.
export const VEHICLES = {
  quad: {
    name: 'Quad Bike', kind: 'wheeled', r: 12, hp: 130, maxSpeed: 292, revSpeed: 88, accel: 381, drag: 1.5, grip: 7, turn: 3.4,
    resist: { bullet: 1.0, expl: 1.3 }, view: { range: 1000, fov: 165 * Math.PI / 180 },
    seats: [{ name: 'Driver' }, { name: 'Passenger' }], open: true, respawn: 40, size: [24, 14, 12], zr: [0, 14], pts: 60,
  },
  jeep: {
    name: 'Recon Jeep', kind: 'wheeled', r: 16, hp: 320, maxSpeed: 252, revSpeed: 82, accel: 299, drag: 1.2, grip: 5.2, turn: 2.6,
    resist: { bullet: 0.55, expl: 1.0 }, view: { range: 1080, fov: 165 * Math.PI / 180 },
    seats: [{ name: 'Driver' }, { name: 'Gunner', weapon: 'mg50', aim: 'free', turn: 7 }, { name: 'Passenger' }, { name: 'Passenger' }],
    respawn: 50, size: [40, 24, 16], zr: [0, 26], pts: 100,
  },
  apc: {
    name: 'APC', kind: 'tracked', r: 21, hp: 700, maxSpeed: 180, revSpeed: 79, accel: 173, drag: 2.2, grip: 12, turn: 1.9, turretTurn: 3.2,
    resist: { bullet: 0.12, expl: 0.8 }, view: { range: 1100, fov: 165 * Math.PI / 180 },
    seats: [{ name: 'Driver', weapon: 'autocannon', aim: 'turret', turn: 3.2 }, { name: 'Gunner', weapon: 'coax', aim: 'free', turn: 6 }, { name: 'Passenger' }, { name: 'Passenger' }],
    respawn: 75, size: [50, 28, 20], zr: [0, 30], pts: 180,
  },
  tank: {
    name: 'Main Battle Tank', kind: 'tracked', r: 24, hp: 1000, maxSpeed: 156, revSpeed: 70, accel: 148, drag: 2.4, grip: 14, turn: 1.6, turretTurn: 1.7,
    resist: { bullet: 0.035, expl: 0.65 }, view: { range: 1200, fov: 165 * Math.PI / 180 },
    seats: [{ name: 'Driver', weapon: 'cannon', aim: 'turret', turn: 1.7 }, { name: 'Gunner', weapon: 'coax', aim: 'free', turn: 5 }],
    respawn: 100, size: [56, 32, 22], zr: [0, 28], pts: 260, crush: true,
  },
  heli: {
    name: 'Attack Helicopter', kind: 'air', r: 24, hp: 560, maxSpeed: 265, accel: 1.7, turn: 3.0, alt: 44,
    resist: { bullet: 0.32, expl: 0.9 }, view: { range: 1150, fov: 360 * Math.PI / 180, air: true },
    seats: [{ name: 'Pilot', weapon: 'pod', aim: 'body' }, { name: 'Gunner', weapon: 'minigun', aim: 'free', turn: 5 }],
    respawn: 110, size: [52, 20, 20], zr: [34, 72], pts: 320,
  },
  boat: {
    name: 'Patrol Boat', kind: 'boat', r: 19, hp: 420, maxSpeed: 252, revSpeed: 74, accel: 222, drag: 0.9, grip: 2.2, turn: 2.0,
    resist: { bullet: 0.5, expl: 1.0 }, view: { range: 1100, fov: 165 * Math.PI / 180 },
    seats: [{ name: 'Driver' }, { name: 'Gunner', weapon: 'mg50', aim: 'free', turn: 7 }, { name: 'Passenger' }, { name: 'Passenger' }],
    respawn: 60, size: [52, 24, 14], zr: [0, 22], pts: 120,
  },
};
export const VEHICLE_LIST = Object.keys(VEHICLES);
VEHICLE_LIST.forEach((id, i) => { VEHICLES[id].id = id; VEHICLES[id].idx = i; });

export const isAir = (def) => def.kind === 'air';

/** Collision mask on the map for this vehicle: null for aircraft. */
export function maskFor(map, def) {
  if (def.kind === 'air') return null;
  return def.kind === 'boat' ? map.blockBoat : map.blockInf;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
export { wrap as wrapAngle };

/**
 * Advances s = {x,y,a,vx,vy} by one tick. keys is the input bit mask, aim the pilot's aim angle.
 * Returns the forward speed before collision (used by the server for impact damage).
 */
export function stepVehicle(map, s, def, keys, aim, dt = DT) {
  const up = (keys & 1) ? 1 : 0, down = (keys & 2) ? 1 : 0, left = (keys & 4) ? 1 : 0, right = (keys & 8) ? 1 : 0;
  const brake = (keys & 512) !== 0;
  let before = 0;
  if (def.kind === 'air') {
    // third-person controls: W flies toward where the pilot looks (aim), A/D strafe
    const fw = up - down, sd = right - left, ca = Math.cos(aim), sa = Math.sin(aim);
    let ix = fw * ca - sd * sa, iy = fw * sa + sd * ca;
    const len = Math.hypot(ix, iy);
    if (len > 1) { ix /= len; iy /= len; }
    const k = 1 - Math.exp(-(len > 0 ? def.accel : def.accel * 0.6) * dt);
    s.vx += (ix * def.maxSpeed - s.vx) * k;
    s.vy += (iy * def.maxSpeed - s.vy) * k;
    if (brake) { s.vx *= Math.exp(-3 * dt); s.vy *= Math.exp(-3 * dt); }
    const d = wrap(aim - s.a);
    s.a = wrap(s.a + clamp(d, -def.turn * dt, def.turn * dt));
    before = Math.hypot(s.vx, s.vy);
    const r = map.moveCircle(s.x, s.y, s.vx * dt, s.vy * dt, def.r, null);
    s.x = r.x; s.y = r.y;
    return before;
  }
  const c = Math.cos(s.a), sn = Math.sin(s.a);
  let sf = s.vx * c + s.vy * sn;            // forward speed
  let sl = -s.vx * sn + s.vy * c;           // sideways speed
  const thr = up - down;
  const water = def.kind === 'boat';
  if (thr !== 0) {
    const target = thr > 0 ? def.maxSpeed : -def.revSpeed;
    const braking = (thr > 0 && sf < -10) || (thr < 0 && sf > 10);
    const step = def.accel * dt * (braking ? 2.4 : 1);
    sf += clamp(target - sf, -step, step);
  } else sf *= Math.exp(-def.drag * dt);
  if (brake) { sf *= Math.exp(-3.2 * dt); sl *= Math.exp(-1.6 * dt); }
  sl *= Math.exp(-(brake ? def.grip * 0.3 : def.grip) * dt);
  const steer = right - left;
  if (steer) {
    if (def.kind === 'tracked') s.a = wrap(s.a + steer * def.turn * dt * (thr !== 0 ? 0.75 : 1));
    else s.a = wrap(s.a + steer * def.turn * clamp(sf / (def.maxSpeed * 0.32), -1, 1) * dt * (water ? 1 : 1));
  }
  const c2 = Math.cos(s.a), s2 = Math.sin(s.a);
  s.vx = c2 * sf - s2 * sl;
  s.vy = s2 * sf + c2 * sl;
  before = sf;
  const ox = s.x, oy = s.y;
  const r = map.moveCircle(s.x, s.y, s.vx * dt, s.vy * dt, def.r, maskFor(map, def));
  s.x = r.x; s.y = r.y;
  // velocity follows what really happened, so hitting a wall stops the vehicle instead of storing phantom speed
  s.vx = (s.x - ox) / dt; s.vy = (s.y - oy) / dt;
  return before;
}

/** Position where a passenger appears when leaving a vehicle (first free spot around it). */
export function exitSpot(map, v, def, seat) {
  const ang = v.a + (seat % 2 === 0 ? Math.PI / 2 : -Math.PI / 2);
  for (let k = 0; k < 8; k++) {
    const a = ang + k * 0.8 * (k % 2 ? 1 : -1) * 0.5;
    const d = def.r + 16 + k * 3;
    const x = v.x + Math.cos(a) * d, y = v.y + Math.sin(a) * d;
    if (!map.isBlockedAt(x, y)) return { x, y };
  }
  return map.nearestFree(v.x, v.y);
}
