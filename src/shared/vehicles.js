// Vehicle definitions and the deterministic driving step (server simulation + client prediction of the driver).
import { DT, PX_PER_M, KEY } from './constants.js';

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
    name: 'Quad Bike', kind: 'wheeled', wheelbase: 22, steerAngle: .62, steeringRate: 5.5, engineRate: 5.5, brakeForce: 280, r: 17, hp: 130, maxSpeed: 292, revSpeed: 88, accel: 178, drag: .28, grip: 8, turn: 3.4,
    resist: { bullet: 1.0, expl: 1.3 }, view: { range: 1000, fov: 165 * Math.PI / 180 },
    seats: [{ name: 'Driver' }, { name: 'Passenger' }], open: true, respawn: 40, size: [36, 25, 18], zr: [0, 22], pts: 60,
  },
  jeep: {
    name: 'Recon Jeep', kind: 'wheeled', wheelbase: 40, steerAngle: .58, steeringRate: 4, engineRate: 4.5, brakeForce: 260, r: 23, hp: 320, maxSpeed: 252, revSpeed: 82, accel: 112, drag: .24, grip: 7, turn: 2.6,
    resist: { bullet: 0.55, expl: 1.0 }, view: { range: 1080, fov: 165 * Math.PI / 180 },
    seats: [{ name: 'Driver' }, { name: 'Gunner', weapon: 'mg50', aim: 'free', turn: 7 }, { name: 'Passenger' }, { name: 'Passenger' }],
    respawn: 50, size: [74, 36, 29], zr: [0, 38], pts: 100,
  },
  apc: {
    name: 'APC', kind: 'wheeled', wheelbase: 77, steerAngle: .5, steeringRate: 3.2, engineRate: 3.4, brakeForce: 240, r: 26, hp: 700, maxSpeed: 180, revSpeed: 79, accel: 88, drag: .5, grip: 13, turn: 1.9, turretTurn: 3.2,
    resist: { bullet: 0.12, expl: 0.8 }, view: { range: 1100, fov: 165 * Math.PI / 180 },
    seats: [{ name: 'Driver', weapon: 'autocannon', aim: 'turret', turn: 3.2 }, { name: 'Gunner', weapon: 'coax', aim: 'free', turn: 6 }, { name: 'Passenger' }, { name: 'Passenger' }],
    respawn: 75, size: [114, 56, 44], zr: [0, 48], pts: 180,
  },
  tank: {
    name: 'Main Battle Tank', kind: 'tracked', steeringRate: 9, engineRate: 7, yawResponse: 9, brakeForce: 230, r: 27, hp: 1000, maxSpeed: 156, revSpeed: 70, accel: 120, drag: 1.4, grip: 30, turn: 1.6, turretTurn: 1.7,
    resist: { bullet: 0.035, expl: 0.65 }, view: { range: 1200, fov: 165 * Math.PI / 180 },
    seats: [{ name: 'Driver', weapon: 'cannon', aim: 'turret', turn: 1.7 }, { name: 'Gunner', weapon: 'coax', aim: 'free', turn: 5 }],
    respawn: 100, size: [114, 65, 43], zr: [0, 46], pts: 260, crush: true,
  },
  heli: {
    name: 'Attack Helicopter', kind: 'air', r: 32, hp: 560, maxSpeed: 265, accel: 1.7, turn: 3.0, alt: 192, climbSpeed: 80, verticalAccel: 4, ceiling: 960,
    resist: { bullet: 0.32, expl: 0.9 }, view: { range: 1150, fov: 360 * Math.PI / 180, air: true },
    seats: [{ name: 'Pilot', weapon: 'pod', aim: 'body' }, { name: 'Gunner', weapon: 'minigun', aim: 'free', turn: 5 }],
    respawn: 110, size: [145, 56, 49], zr: [0, 52], pts: 320,
  },
  boat: {
    name: 'Patrol Boat', kind: 'boat', r: 27, hp: 420, maxSpeed: 252, revSpeed: 74, accel: 222, drag: 0.9, grip: 2.2, turn: 2.0,
    resist: { bullet: 0.5, expl: 1.0 }, view: { range: 1100, fov: 165 * Math.PI / 180 },
    seats: [{ name: 'Driver' }, { name: 'Gunner', weapon: 'mg50', aim: 'free', turn: 7 }, { name: 'Passenger' }, { name: 'Passenger' }],
    respawn: 60, size: [132, 47, 40], zr: [0, 44], pts: 120,
  },
};
export const VEHICLE_LIST = Object.keys(VEHICLES);
// r remains the entry/aircraft clearance radius; ground movement uses the full oriented size. hr is the bullet/shell hit circle.
VEHICLE_LIST.forEach((id, i) => { const d = VEHICLES[id]; d.id = id; d.idx = i; d.hr = Math.max(d.r, Math.round(d.size[0] * 0.42)); });

// Blender mount positions in metres; keep shot effects at the visible barrels.
const GUN_MOUNTS = { tank: [-.2, .65, 2.2], apc: [-1, .9, 2.5], jeep: [-1.2, 0, 1.9], boat: [2.4, 0, 1.15], heli: [2.4, 0, .95] };
export function vehicleShot(v, seat, angle, range = 400, height = (v.z || 0) + 14, point = null) {
  const id = v.def.id, cannon = seat === 0 && (id === 'tank' || id === 'apc');
  const { x, y, z: gz } = vehicleGunMount(v, seat);
  const reach = (cannon ? id === 'tank' ? 4.5 : 2.4 : .82) * PX_PER_M;
  const minimum = Math.max(1, (x - v.x) * Math.cos(angle) + (y - v.y) * Math.sin(angle) + reach + 8);
  const aim = Math.max(minimum, range);
  const freeTarget = v.def.seats[seat]?.aim === 'free' && point;
  const distance = freeTarget ? Math.max(.1, Math.hypot(point.x - x, point.y - y)) : aim;
  const ax = (freeTarget ? x : v.x) + Math.cos(angle) * distance, ay = (freeTarget ? y : v.y) + Math.sin(angle) * distance;
  const yaw = Math.atan2(ay - y, ax - x), pitch = clamp(Math.atan2(height - gz, Math.hypot(ax - x, ay - y)), -1.3, 1.3);
  return { x: x + Math.cos(yaw) * Math.cos(pitch) * reach, y: y + Math.sin(yaw) * Math.cos(pitch) * reach, z: gz + Math.sin(pitch) * reach, yaw, pitch, target: { x: ax, y: ay, z: height } };
}
export function vehicleGunMount(v, seat) {
  const id = v.def.id, cannon = seat === 0 && (id === 'tank' || id === 'apc');
  const [f, r, z] = cannon ? (id === 'tank' ? [2.2, 0, 1.92] : [1.4, 0, 2.66]) : (GUN_MOUNTS[id] || [0, 0, 1.5]);
  const heading = cannon || id === 'tank' ? v.ta : v.a;
  return { x: v.x + (Math.cos(heading) * f - Math.sin(heading) * r) * PX_PER_M, y: v.y + (Math.sin(heading) * f + Math.cos(heading) * r) * PX_PER_M, z: (z + (cannon ? 0 : .27)) * PX_PER_M + vehicleBase(v, v.def) };
}
export function vehicleMuzzle(v, seat, angle) { return vehicleShot(v, seat, angle, 1e6, vehicleBase(v, v.def)); }
export function vehicleBase(v, def) { return Number.isFinite(v.z) ? v.z : Number.isFinite(v.flightZ) ? v.flightZ : def.kind === 'air' ? def.alt : 0; }

/** Signed distance to the visible hull's footprint for entry prompts and use. */
export function vehicleDistance(v, x, y) {
  const dx = x - v.x, dy = y - v.y, c = Math.cos(v.a), s = Math.sin(v.a);
  const a = Math.abs(dx * c + dy * s) - v.def.size[0] / 2;
  const b = Math.abs(-dx * s + dy * c) - v.def.size[1] / 2;
  return Math.hypot(Math.max(0, a), Math.max(0, b)) + Math.min(0, Math.max(a, b));
}

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
    if (!Number.isFinite(s.flightZ)) s.flightZ = (map.heightAt?.(s.x, s.y) || 0) + def.alt;
    if (!Number.isFinite(s.vz)) s.vz = 0;
    const climb = ((keys & KEY.SPRINT) ? 1 : 0) - ((keys & KEY.CROUCH) ? 1 : 0);
    const vk = 1 - Math.exp(-def.verticalAccel * dt);
    s.vz += ((brake ? 0 : climb * def.climbSpeed) - s.vz) * vk;
    s.flightZ += s.vz * dt;
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
    const ox = s.x, oy = s.y;
    const r = map.moveCircle(s.x, s.y, s.vx * dt, s.vy * dt, def.r, map.aircraftMask?.(s.flightZ) || null);
    s.x = r.x; s.y = r.y; s.vx = (s.x - ox) / dt; s.vy = (s.y - oy) / dt;
    const floor = (map.landingHeight?.(s.x, s.y, def.r * .7) ?? map.heightAt?.(s.x, s.y) ?? 0) + 2;
    if (s.flightZ < floor) { s.flightZ = floor; s.vz = Math.max(0, s.vz); }
    if (s.flightZ > def.ceiling) { s.flightZ = def.ceiling; s.vz = Math.min(0, s.vz); }
    return before;
  }
  const c = Math.cos(s.a), sn = Math.sin(s.a);
  let sf = s.vx * c + s.vy * sn;
  const sl = -s.vx * sn + s.vy * c, thr = up - down, water = def.kind === 'boat';
  const tracked = def.kind === 'tracked';
  const ground = map.charAt?.(Math.floor(s.x / 32), Math.floor(s.y / 32));
  const traction = water || tracked ? 1 : ground === ':' ? .64 : ground === '.' || ground === ',' ? .8 : ground === 'r' || ground === 'd' ? .72 : 1;
  s.steer = (s.steer || 0) + (right - left - (s.steer || 0)) * (1 - Math.exp(-(def.steeringRate || 3) * dt));
  s.throttle = (s.throttle || 0) + ((brake ? 0 : thr) - (s.throttle || 0)) * (1 - Math.exp(-(def.engineRate || 4) * dt));
  const grade = water ? { x: 0, y: 0 } : map.gradientAt?.(s.x, s.y) || { x: 0, y: 0 };
  const along = grade.x * c + grade.y * sn;
  const opposing = thr && sf * thr < -2;
  if (opposing) sf -= Math.sign(sf) * Math.min(Math.abs(sf), (def.brakeForce || 210) * dt);
  else if (thr && !brake) {
    const target = (thr > 0 ? def.maxSpeed : -def.revSpeed) * Math.max(.65, 1 - Math.max(0, along * thr) * .65);
    const force = def.accel * Math.abs(s.throttle) * traction * Math.max(.22, 1 - Math.pow(Math.abs(sf) / Math.abs(target), 2));
    sf += thr * force * dt;
    sf = clamp(sf, -def.revSpeed, def.maxSpeed);
  }
  // Coasting keeps momentum; rolling resistance and slopes gradually remove it.
  sf *= Math.exp(-((thr && !opposing ? .05 : def.drag) + Math.abs(sf) * .0002) * dt);
  if (Math.abs(sf) > 2 || thr) sf -= along * (tracked ? 55 : 75) * dt;
  if (brake) sf -= Math.sign(sf) * Math.min(Math.abs(sf), (def.brakeForce || 250) * dt);
  if (!thr && Math.abs(sf) < 1.5) sf = 0;
  const ratio = Math.min(1, Math.abs(sf) / def.maxSpeed);
  let targetYaw;
  if (tracked) targetYaw = s.steer * def.turn * (.9 - ratio * .38) * (brake ? .2 : 1);
  else if (water) targetYaw = s.steer * def.turn * clamp(sf / (def.maxSpeed * .4), -1, 1);
  else targetYaw = clamp(sf * Math.tan(s.steer * def.steerAngle / (1 + ratio * ratio * 2.5)) / def.wheelbase, -def.turn, def.turn) * traction;
  s.yawRate = (s.yawRate || 0) + (targetYaw - (s.yawRate || 0)) * (1 - Math.exp(-(tracked ? def.yawResponse || 3 : 6) * dt));
  if (!tracked && Math.abs(sf) < 1) s.yawRate = 0;
  s.a = wrap(s.a + s.yawRate * dt);
  if (tracked) sf *= Math.exp(-Math.abs(s.yawRate) * .12 * dt);
  // Preserve the world velocity while steering; tires/tracks pull it toward the new heading.
  const wx = c * sf - sn * sl, wy = sn * sf + c * sl, c2 = Math.cos(s.a), s2 = Math.sin(s.a);
  const forward = wx * c2 + wy * s2;
  const side = (-wx * s2 + wy * c2) * Math.exp(-(def.grip * traction * (brake && !tracked ? .8 : 1) + (brake ? 3 : 0)) * dt);
  s.vx = c2 * forward - s2 * side; s.vy = s2 * forward + c2 * side;
  before = sf;
  const ox = s.x, oy = s.y;
  const r = map.moveHull ? map.moveHull(s.x, s.y, s.vx * dt, s.vy * dt, def.size[0], def.size[1], s.a, maskFor(map, def)) : map.moveCircle(s.x, s.y, s.vx * dt, s.vy * dt, def.r, maskFor(map, def));
  s.x = r.x; s.y = r.y;
  // velocity follows what really happened, so hitting a wall stops the vehicle instead of storing phantom speed
  s.vx = (s.x - ox) / dt; s.vy = (s.y - oy) / dt;
  if (r.nx || r.ny) {
    const normalSpeed = s.vx * r.nx + s.vy * r.ny;
    if (normalSpeed < 0) { s.vx -= normalSpeed * r.nx; s.vy -= normalSpeed * r.ny; }
    s.yawRate *= .8;
  }
  if (!water && map.heightAt) {
    const cx = Math.cos(s.a), cy = Math.sin(s.a), wheelbase = def.wheelbase || def.size[0] * .65, track = def.size[1] * .75;
    let support = 0;
    for (const f of [-1, 1]) for (const side of [-1, 1]) support += map.heightAt(s.x + cx * wheelbase / 2 * f - cy * track / 2 * side, s.y + cy * wheelbase / 2 * f + cx * track / 2 * side) / 4;
    support = Math.max(support, map.heightAt(s.x, s.y));
    if (!Number.isFinite(s.chassisZ)) { s.chassisZ = map.heightAt(s.x, s.y); s.vz = 0; }
    const airborne = s.chassisZ > support + 8;
    const acceleration = airborne ? -156.96 : (support - s.chassisZ) * 110 - (s.vz || 0) * 19;
    s.vz = (s.vz || 0) + acceleration * dt; s.chassisZ += s.vz * dt;
    s.landingSpeed = 0;
    if (s.chassisZ < support) { s.landingSpeed = Math.max(0, -s.vz); s.chassisZ = support; s.vz = Math.max(0, s.vz) * .15; }
  }
  return before;
}

export function hullContact(a, b) {
  const ca = Math.cos(a.a), sa = Math.sin(a.a), cb = Math.cos(b.a), sb = Math.sin(b.a), dx = b.x - a.x, dy = b.y - a.y;
  let depth = Infinity, nx = 0, ny = 0;
  for (const [x, y] of [[ca, sa], [-sa, ca], [cb, sb], [-sb, cb]]) {
    const ra = a.def.size[0] / 2 * Math.abs(ca * x + sa * y) + a.def.size[1] / 2 * Math.abs(-sa * x + ca * y);
    const rb = b.def.size[0] / 2 * Math.abs(cb * x + sb * y) + b.def.size[1] / 2 * Math.abs(-sb * x + cb * y);
    const overlap = ra + rb - Math.abs(dx * x + dy * y);
    if (overlap <= 0) return null;
    if (overlap < depth) { depth = overlap; const sign = dx * x + dy * y < 0 ? -1 : 1; nx = x * sign; ny = y * sign; }
  }
  return { nx, ny, depth };
}

/** Position where a passenger appears when leaving a vehicle (first free spot around it). */
export function exitSpot(map, v, def, seat) {
  const ang = v.a + (seat % 2 === 0 ? Math.PI / 2 : -Math.PI / 2);
  for (let k = 0; k < 8; k++) {
    const a = ang + k * 0.8 * (k % 2 ? 1 : -1) * 0.5;
    const relative = a - v.a;
    const hull = Math.min(def.size[0] / 2 / Math.max(.001, Math.abs(Math.cos(relative))), def.size[1] / 2 / Math.max(.001, Math.abs(Math.sin(relative))));
    const d = Math.max(def.r, hull) + 16 + k * 3;
    const x = v.x + Math.cos(a) * d, y = v.y + Math.sin(a) * d;
    if (!map.isBlockedAt(x, y)) return { x, y };
  }
  return map.nearestFree(v.x, v.y);
}
