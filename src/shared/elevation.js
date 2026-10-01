// Authored terrain profiles. Shared by the server, browser collision and rendered triangles.
import { TILE } from './constants.js';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hill = (u, v, x, y, rx, ry, h) => h * Math.exp(-(((u - x) / rx) ** 2 + ((v - y) / ry) ** 2));
export const ELEVATION_PROFILES = {
  riverside: { name: 'River valley / farm hills', height: (u, v) => 12 + 112 * Math.abs(2 * u - 1) ** 1.5 + hill(u, v, .27, .19, .15, .18, 90) + hill(u, v, .73, .19, .15, .18, 90) + hill(u, v, .27, .81, .14, .16, 64) + hill(u, v, .73, .81, .14, .16, 64) },
  harbor: { name: 'Upper city / sloping streets / sea-level quays', height: (u, v) => 10 + 58 * (1 - smooth(.15, .6, v)) + 34 * (1 - smooth(.64, .88, v)) + hill(u, v, .5, .28, .18, .23, 38) },
  dunes: { name: 'Dune ridges / mesa foothills / oasis basin', height: (u, v) => 24 + 95 * (.5 + .5 * Math.cos(u * Math.PI * 8)) * (.3 + .7 * Math.sin(v * Math.PI) ** 2) + hill(u, v, .34, .24, .12, .18, 98) + hill(u, v, .66, .24, .12, .18, 98) + hill(u, v, .34, .76, .12, .18, 75) + hill(u, v, .66, .76, .12, .18, 75) },
  dust: { name: 'Raised market / sunken central lanes', height: (u, v) => 12 + hill(u, v, .2, .25, .3, .32, 58) + hill(u, v, .8, .75, .3, .32, 58) },
  warehouse: { name: 'Loading ramps / raised storage yards', height: (u, v) => 10 + 46 * smooth(.18, .48, v) * (1 - smooth(.63, .9, v)) + 12 * Math.sin(u * Math.PI) ** 2 },
  foundry: { name: 'Upper furnace yard / lower service lanes', height: (u, v) => 12 + 58 * smooth(.15, .5, u) * (1 - smooth(.65, .94, u)) + hill(u, v, .5, .2, .3, .2, 24) },
  pit: { name: 'Central depression / raised perimeter', height: (u, v) => 10 + 48 * (1 - Math.exp(-(((u - .5) / .32) ** 2 + ((v - .5) / .32) ** 2))) },
};

export function buildElevation(map, enabled) {
  const stride = map.w + 1, rows = map.h + 1, heights = new Float32Array(stride * rows);
  const profile = enabled && ELEVATION_PROFILES[map.id];
  if (!profile) return heights;
  const fixed = new Uint8Array(heights.length);
  for (let y = 0; y < rows; y++) for (let x = 0; x < stride; x++) heights[y * stride + x] = profile.height(x / map.w, y / map.h);
  // Water is a continuous horizontal surface. Banks grade up from its shared vertices.
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (map.water[y * map.w + x]) {
    for (const i of [y * stride + x, y * stride + x + 1, (y + 1) * stride + x, (y + 1) * stride + x + 1]) { heights[i] = 0; fixed[i] = 1; }
  }
  const limit = TILE * .25;
  const waterDistance = new Float32Array(heights.length); waterDistance.fill(Infinity);
  const queue = new Int32Array(heights.length); let head = 0, tail = 0;
  for (let i = 0; i < fixed.length; i++) if (fixed[i] === 1) { waterDistance[i] = 0; queue[tail++] = i; }
  while (head < tail) {
    const i = queue[head++], x = i % stride, y = Math.floor(i / stride);
    for (const j of [x ? i - 1 : -1, x < map.w ? i + 1 : -1, y ? i - stride : -1, y < map.h ? i + stride : -1]) {
      if (j < 0 || waterDistance[j] <= waterDistance[i] + 1) continue;
      waterDistance[j] = waterDistance[i] + 1; queue[tail++] = j;
    }
  }
  const pads = (map.def.objects?.buildings || []).filter((b) => {
    let supports = 0;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      if (x !== b.x && y !== b.y && x !== b.x + b.w - 1 && y !== b.y + b.h - 1) continue;
      const ch = map.chars[y * map.w + x]; if (ch === b.wall || ch === 'G') supports++;
    }
    return supports >= (b.w + b.h - 2) * 1.1;
  }).map((b) => {
    let z = profile.height((b.x + b.w / 2) / map.w, (b.y + b.h / 2) / map.h);
    for (let y = b.y; y <= b.y + b.h; y++) for (let x = b.x; x <= b.x + b.w; x++) z = Math.min(z, waterDistance[y * stride + x] * limit);
    return { ...b, z };
  });
  // Bound differences between nearby level foundations by the room available for the connecting ramp.
  for (let pass = 0; pass < pads.length; pass++) for (let i = 0; i < pads.length; i++) for (let j = i + 1; j < pads.length; j++) {
    const a = pads[i], b = pads[j];
    const distance = Math.max(0, a.x - b.x - b.w, b.x - a.x - a.w) + Math.max(0, a.y - b.y - b.h, b.y - a.y - a.h);
    if (a.z > b.z + distance * limit) a.z = b.z + distance * limit;
    if (b.z > a.z + distance * limit) b.z = a.z + distance * limit;
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < stride; x++) {
    const i = y * stride + x;
    let lo = 0, hi = waterDistance[i] * limit;
    for (const b of pads) {
      const distance = Math.max(0, b.x - x, x - b.x - b.w) + Math.max(0, b.y - y, y - b.y - b.h);
      lo = Math.max(lo, b.z - distance * limit); hi = Math.min(hi, b.z + distance * limit);
    }
    heights[i] = clamp(heights[i], lo, hi);
  }
  return heights;
}

// Exact interpolation on the same two triangles used by the ground mesh (diagonal x+y=1).
export function terrainHeight(map, x, y) {
  if (!map.elevation) return 0;
  const gx = clamp(x / TILE, 0, map.w - 1e-7), gy = clamp(y / TILE, 0, map.h - 1e-7);
  const tx = Math.floor(gx), ty = Math.floor(gy), u = gx - tx, v = gy - ty, s = map.w + 1, i = ty * s + tx, h = map.elevation;
  return u + v <= 1 ? h[i] + (h[i + 1] - h[i]) * u + (h[i + s] - h[i]) * v : h[i + s + 1] + (h[i + s] - h[i + s + 1]) * (1 - u) + (h[i + 1] - h[i + s + 1]) * (1 - v);
}

export function terrainGradient(map, x, y) {
  const d = 2;
  return { x: (terrainHeight(map, x + d, y) - terrainHeight(map, x - d, y)) / (2 * d), y: (terrainHeight(map, x, y + d) - terrainHeight(map, x, y - d)) / (2 * d) };
}
