// Deterministic player movement step, shared by the server and by client-side prediction.
import { DT, ACCEL, FRICTION, PLAYER_R, KEY, GRAVITY, JUMP_V, CROUCH_SPEED, AIR_CONTROL, STEP_H, BODY_H, BODY_H_CROUCH } from './constants.js';

/**
 * Movement keys are relative to where the player is looking: W walks toward the aim direction, A/D strafe.
 * Returns the analogue direction (ax, ay) in world space for stepMovement.
 */
export function relativeDir(keys, angle) {
  const f = ((keys & KEY.UP) ? 1 : 0) - ((keys & KEY.DOWN) ? 1 : 0);
  const r = ((keys & KEY.RIGHT) ? 1 : 0) - ((keys & KEY.LEFT) ? 1 : 0);
  if (!f && !r) return [0, 0];
  const c = Math.cos(angle), s = Math.sin(angle);
  return [f * c - r * s, f * s + r * c];
}

/**
 * Advances s = {x,y,vx,vy,z,vz,cf} by one tick for the given key mask. maxSpeed already includes weapon / scope / sprint
 * modifiers; crouching slows further. Bots may pass an analogue direction (ax, ay in -1..1) instead of using the key bits.
 * Vertical: gravity, jumping (only from the ground, not while crouched) and standing on low tiles (sandbags, fences...).
 */
export function stepMovement(map, s, keys, maxSpeed, frozen, ax, ay) {
  if (s.z === undefined) { s.z = map.heightAt(s.x, s.y); s.vz = 0; s.cf = 0; }
  let ix, iy;
  if (ax !== undefined) { ix = ax; iy = ay; }
  else {
    ix = ((keys & KEY.RIGHT) ? 1 : 0) - ((keys & KEY.LEFT) ? 1 : 0);
    iy = ((keys & KEY.DOWN) ? 1 : 0) - ((keys & KEY.UP) ? 1 : 0);
  }
  if (frozen) { ix = 0; iy = 0; }
  // crouch height eases in and out
  const wantCrouch = !frozen && (keys & KEY.CROUCH) !== 0;
  s.cf += ((wantCrouch ? 1 : 0) - s.cf) * (1 - Math.exp(-13 * DT));
  if (s.cf < 0.002) s.cf = 0; else if (s.cf > 0.998) s.cf = 1;
  maxSpeed *= 1 - (1 - CROUCH_SPEED) * s.cf;
  const floor0 = map.groundAt(s.x, s.y, PLAYER_R, s.z);
  const grounded = s.z <= floor0 + 0.01 && s.vz <= 0;
  const swim = map.waterAt(s.x, s.y) === 2;      // deep water: wading pace, no jumping or sprinting
  if (swim) maxSpeed = Math.min(maxSpeed, 58 * (1 - 0.35 * s.cf));
  if (grounded && !frozen && !swim && (keys & KEY.JUMP) && s.cf < 0.35) s.vz = JUMP_V;
  const len = Math.hypot(ix, iy);
  if (len > 1) { ix /= len; iy /= len; }
  let k = 1 - Math.exp(-(len > 0 ? ACCEL : FRICTION) * DT);
  if (!grounded && s.vz !== JUMP_V) k *= AIR_CONTROL;      // little steering in mid-air
  s.vx += (ix * maxSpeed - s.vx) * k;
  s.vy += (iy * maxSpeed - s.vy) * k;
  if (frozen) { s.vx = 0; s.vy = 0; }
  if (Math.abs(s.vx) < 0.05) s.vx = 0;
  if (Math.abs(s.vy) < 0.05) s.vy = 0;
  const ox = s.x, oy = s.y;
  const r = map.moveCircle(s.x, s.y, s.vx * DT, s.vy * DT, PLAYER_R, map.blockFoot, s.z);
  s.x = r.x; s.y = r.y;
  // velocity follows what actually happened, so sliding along walls doesn't build up phantom speed
  s.vx = (s.x - ox) / DT;
  s.vy = (s.y - oy) / DT;
  // vertical motion
  const floor = map.groundAt(s.x, s.y, PLAYER_R, s.z);
  s.vz -= GRAVITY * DT;
  s.landingSpeed = 0;
  let nz = s.z + s.vz * DT;
  if (grounded && s.vz <= 0 && Math.abs(floor - floor0) <= STEP_H) { nz = floor; s.vz = 0; }
  const body = BODY_H + (BODY_H_CROUCH - BODY_H) * s.cf, ceiling = map.ceilingAt(s.x, s.y, s.z);
  if (s.vz > 0 && s.z + body <= ceiling && nz + body > ceiling) { nz = ceiling - body; s.vz = 0; }
  if (nz <= floor) { if (!grounded) s.landingSpeed = Math.max(0, -s.vz); nz = floor; s.vz = 0; }
  s.z = nz;
}
