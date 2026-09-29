// Deterministic player movement step, shared by the server and by client-side prediction.
import { DT, ACCEL, FRICTION, PLAYER_R, KEY } from './constants.js';

/**
 * Movement keys are relative to where the player is looking (third-person controls): W walks toward the aim direction,
 * A/D strafe. Returns the analogue direction (ax, ay) in world space for stepMovement.
 */
export function relativeDir(keys, angle) {
  const f = ((keys & KEY.UP) ? 1 : 0) - ((keys & KEY.DOWN) ? 1 : 0);
  const r = ((keys & KEY.RIGHT) ? 1 : 0) - ((keys & KEY.LEFT) ? 1 : 0);
  if (!f && !r) return [0, 0];
  const c = Math.cos(angle), s = Math.sin(angle);
  return [f * c - r * s, f * s + r * c];
}

/**
 * Advances s = {x,y,vx,vy} by one tick for the given key mask. maxSpeed already includes walk/scope modifiers.
 * Bots may pass an analogue direction (ax, ay in -1..1) instead of using the key bits.
 */
export function stepMovement(map, s, keys, maxSpeed, frozen, ax, ay) {
  let ix, iy;
  if (ax !== undefined) { ix = ax; iy = ay; }
  else {
    ix = ((keys & KEY.RIGHT) ? 1 : 0) - ((keys & KEY.LEFT) ? 1 : 0);
    iy = ((keys & KEY.DOWN) ? 1 : 0) - ((keys & KEY.UP) ? 1 : 0);
  }
  if (frozen) { ix = 0; iy = 0; }
  const len = Math.hypot(ix, iy);
  if (len > 1) { ix /= len; iy /= len; }
  const k = 1 - Math.exp(-(len > 0 ? ACCEL : FRICTION) * DT);
  s.vx += (ix * maxSpeed - s.vx) * k;
  s.vy += (iy * maxSpeed - s.vy) * k;
  if (frozen) { s.vx = 0; s.vy = 0; return; }
  if (Math.abs(s.vx) < 0.05) s.vx = 0;
  if (Math.abs(s.vy) < 0.05) s.vy = 0;
  const ox = s.x, oy = s.y;
  const r = map.moveCircle(s.x, s.y, s.vx * DT, s.vy * DT, PLAYER_R);
  s.x = r.x; s.y = r.y;
  // velocity follows what actually happened, so sliding along walls doesn't build up phantom speed
  s.vx = (s.x - ox) / DT;
  s.vy = (s.y - oy) / DT;
}
