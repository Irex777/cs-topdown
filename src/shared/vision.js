// Field-of-view / line-of-sight rules shared by the server (what to send) and the client (what to draw).
import { VISION, PLAYER_R } from './constants.js';
import { angleDiff } from './gamemap.js';

/** {range, fov}: scoped/aiming = holding right mouse; scopeLevel 0 = plain iron sights (still a tighter, longer view). Aircraft use the same height-aware sight lines as infantry */
export function viewParams(scoped, scopeLevel) {
  if (scoped && scopeLevel >= 1) return VISION.scopes[Math.min(3, scopeLevel)];
  if (scoped) return { range: VISION.aimRange, fov: VISION.aimFov };
  return { range: VISION.range, fov: VISION.fov };
}

/** Does the segment (x0,y0)-(x1,y1) pass through the smoke circle? */
export function segHitsCircle(x0, y0, x1, y1, cx, cy, r) {
  const dx = x1 - x0, dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((cx - x0) * dx + (cy - y0) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = x0 + dx * t - cx, py = y0 + dy * t - cy;
  return px * px + py * py < r * r;
}

/** Wall + smoke line of sight. smokes: [{x,y,r}] */
export function lineClear(map, smokes, x0, y0, x1, y1, z0, z1) {
  if (!map.los(x0, y0, x1, y1, z0, z1)) return false;
  for (let i = 0; i < smokes.length; i++) {
    const s = smokes[i];
    if (segHitsCircle(x0, y0, x1, y1, s.x, s.y, s.r * 0.92)) {
      // standing in the middle of your own smoke: you can still see the cloud's immediate surroundings
      const inside = Math.hypot(x0 - s.x, y0 - s.y) < s.r * 0.92;
      if (!inside || Math.hypot(x1 - x0, y1 - y0) > 42) return false;
    }
  }
  return true;
}

/**
 * Can an observer at (ox,oy) facing `angle` see a circular target at (tx,ty)?
 * view = {range, fov}; pad widens the cone (server uses it to hide latency pop-in).
 */
export function canSee(map, smokes, ox, oy, angle, view, tx, ty, pad = 0, radius = PLAYER_R, oz, tz) {
  const dx = tx - ox, dy = ty - oy;
  const dist = Math.hypot(dx, dy);
  if (dist > view.range + radius) return false;
  if (dist > VISION.near + radius) {
    const ad = Math.abs(angleDiff(Math.atan2(dy, dx), angle));
    const half = view.fov / 2 + pad + (dist > 1 ? Math.asin(Math.min(1, radius / dist)) : 0);
    if (ad > half) return false;
  }
  if (lineClear(map, smokes, ox, oy, tx, ty, oz, tz)) return true;
  if (dist < 1) return true;
  const nx = -dy / dist * radius * 0.85, ny = dx / dist * radius * 0.85;
  return lineClear(map, smokes, ox, oy, tx + nx, ty + ny, oz, tz) || lineClear(map, smokes, ox, oy, tx - nx, ty - ny, oz, tz);
}
