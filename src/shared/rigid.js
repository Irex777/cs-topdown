// Compact network body tuples use game axes (x,y horizontal; z up).
export function bodyBounds(t) {
  const [, , x, y, z, qx, qy, qz, qw, sx, sy, sz] = t;
  const a = Math.abs(1 - 2 * (qy * qy + qz * qz)) * sx / 2 + Math.abs(2 * (qx * qy - qz * qw)) * sy / 2 + Math.abs(2 * (qx * qz + qy * qw)) * sz / 2;
  const b = Math.abs(2 * (qx * qy + qz * qw)) * sx / 2 + Math.abs(1 - 2 * (qx * qx + qz * qz)) * sy / 2 + Math.abs(2 * (qy * qz - qx * qw)) * sz / 2;
  const c = Math.abs(2 * (qx * qz - qy * qw)) * sx / 2 + Math.abs(2 * (qy * qz + qx * qw)) * sy / 2 + Math.abs(1 - 2 * (qx * qx + qy * qy)) * sz / 2;
  return { id: t[0], ch: t[1], x0: x - a, x1: x + a, y0: y - b, y1: y + b, z0: z - c, z1: z + c, tuple: t };
}
export function rayBody(t, ox, oy, oz, dx, dy, dz, range) {
  const [, , x, y, z, qx, qy, qz, qw, sx, sy, sz] = t;
  const rotate = (x, y, z) => {
    const tx = 2 * (-qy * z + qz * y), ty = 2 * (-qz * x + qx * z), tz = 2 * (-qx * y + qy * x);
    return [x + qw * tx - qy * tz + qz * ty, y + qw * ty - qz * tx + qx * tz, z + qw * tz - qx * ty + qy * tx];
  };
  const o = rotate(ox - x, oy - y, oz - z), d = rotate(dx, dy, dz), h = [sx / 2, sy / 2, sz / 2];
  let enter = 0, leave = range;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) { if (Math.abs(o[i]) > h[i]) return Infinity; }
    else { const a = (-h[i] - o[i]) / d[i], b = (h[i] - o[i]) / d[i]; enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b)); if (enter > leave) return Infinity; }
  }
  return enter;
}
