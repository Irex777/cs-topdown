// Visibility polygon for the local (or spectated) player: exact against tile walls, circles for smokes.
import { VISION } from '../../../shared/constants.js';
import { rayCircle } from '../../../shared/gamemap.js';

const TAU = Math.PI * 2;
const norm = (a) => { while (a > Math.PI) a -= TAU; while (a <= -Math.PI) a += TAU; return a; };

const cornerBuf = [];
let angBuf = new Float64Array(2048);
let out = new Float32Array(4096);

/**
 * Returns {pts: Float32Array [x0,y0,x1,y1...], n} of the visible region around (ox,oy).
 * view = {range, fov}; the region is a cone plus a small full circle (VISION.near).
 */
export function computeVision(map, smokes, ox, oy, facing, view) {
  const range = view.range, half = view.fov / 2, near = VISION.near;
  const maxR = range + 8;
  map.cornersNear(ox, oy, maxR, cornerBuf);
  let n = 0;
  const push = (a) => { if (n >= angBuf.length) { const nb = new Float64Array(angBuf.length * 2); nb.set(angBuf); angBuf = nb; } angBuf[n++] = norm(a - facing); };
  // regular samples give smooth arcs
  const steps = 160;
  for (let i = 0; i < steps; i++) push(facing + (i / steps) * TAU);
  const eps = 0.00035;
  push(facing - half - eps); push(facing - half + eps); push(facing + half - eps); push(facing + half + eps);
  for (let k = 0; k < cornerBuf.length; k += 2) {
    const a = Math.atan2(cornerBuf[k + 1] - oy, cornerBuf[k] - ox);
    push(a - eps); push(a); push(a + eps);
  }
  // extra rays around smokes so their silhouette is sharp
  let inSmoke = false;
  for (const s of smokes) {
    const d = Math.hypot(s.x - ox, s.y - oy);
    if (d < s.r * 0.92) { inSmoke = true; continue; }
    if (d > range + s.r) continue;
    const base = Math.atan2(s.y - oy, s.x - ox), spread = Math.asin(Math.min(1, (s.r * 0.92) / d));
    for (let i = -6; i <= 6; i++) push(base + (i / 6) * spread * 1.02);
  }
  const arr = angBuf.subarray(0, n).sort();
  if (out.length < n * 2 + 4) out = new Float32Array(n * 2 + 64);
  let m = 0;
  let last = -99;
  for (let i = 0; i < n; i++) {
    const rel = arr[i];
    if (rel - last < 1e-7) continue;
    last = rel;
    const a = facing + rel;
    const dx = Math.cos(a), dy = Math.sin(a);
    let lim = Math.abs(rel) <= half ? range : near;
    if (inSmoke) lim = Math.min(lim, 44);
    let d = map.castDist(ox, oy, dx, dy, lim);
    if (d > 0) {
      for (const s of smokes) {
        if (Math.hypot(s.x - ox, s.y - oy) < s.r * 0.92) continue;
        const t = rayCircle(ox, oy, dx, dy, s.x, s.y, s.r * 0.92);
        if (t >= 0 && t < d) d = t;
      }
    }
    out[m++] = ox + dx * d;
    out[m++] = oy + dy * d;
  }
  return { pts: out, n: m / 2 };
}
