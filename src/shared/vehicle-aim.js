import { vehicleBase } from './vehicles.js';
import { BODY_H, BODY_H_CROUCH, PLAYER_R } from './constants.js';

// Height-aware targeting shared by vehicle cameras and physical vehicle rounds.
export function cylinderHit(ox, oy, oz, dx, dy, slope, cx, cy, radius, low, high, range) {
  const fx = cx - ox, fy = cy - oy, along = fx * dx + fy * dy;
  const across2 = fx * fx + fy * fy - along * along;
  if (across2 > radius * radius) return -1;
  const half = Math.sqrt(Math.max(0, radius * radius - across2));
  let enter = Math.max(0, along - half), leave = Math.min(range, along + half);
  if (Math.abs(slope) < 1e-8) { if (oz < low || oz > high) return -1; }
  else { const a = (low - oz) / slope, b = (high - oz) / slope; enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b)); }
  return enter <= leave ? enter : -1;
}

export function vehicleAimPoint(map, origin, direction, players, vehicles, ownId, definitions, range = 2400, centerRange = false) {
  const horizontal = Math.max(1e-6, Math.hypot(direction.x, direction.y));
  const dx = direction.x / horizontal, dy = direction.y / horizontal, slope = direction.z / horizontal;
  const own = vehicles.find((v) => v.id === ownId);
  if (own && centerRange) { const x = origin.x - own.x, y = origin.y - own.y, along = x * dx + y * dy; range = Math.max(1, -along + Math.sqrt(Math.max(0, range * range - x * x - y * y + along * along))); }
  let distance = map.castBullet(origin.x, origin.y, origin.z, dx, dy, slope, range).d;
  for (const p of players) {
    const height = BODY_H + (BODY_H_CROUCH - BODY_H) * (p.cf || 0);
    const d = cylinderHit(origin.x, origin.y, origin.z, dx, dy, slope, p.x, p.y, PLAYER_R, p.z || 0, (p.z || 0) + height, distance);
    if (d >= 0) distance = d;
  }
  for (const v of vehicles) {
    if (v.id === ownId) continue;
    const def = definitions[v.ty];
    if (!def) continue;
    const d = cylinderHit(origin.x, origin.y, origin.z, dx, dy, slope, v.x, v.y, def.hr * .92, vehicleBase(v, def) + def.zr[0], vehicleBase(v, def) + def.zr[1], distance);
    if (d >= 0) distance = d;
  }
  return { x: origin.x + dx * distance, y: origin.y + dy * distance, z: Math.max(0, origin.z + slope * distance) };
}
