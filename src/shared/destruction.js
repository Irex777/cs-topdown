import { TILE } from './constants.js';

// Permanent, networked heightfield edits. Water and occupied foundations retain their support plane.
export function crater(map, x, y, radius, depth) {
  const edits = []; const stride = map.w + 1;
  if (!map.terrainEdits) map.terrainEdits = new Map();
  for (let ty = Math.max(1, Math.floor((y - radius) / TILE)); ty <= Math.min(map.h - 1, Math.ceil((y + radius) / TILE)); ty++) {
    for (let tx = Math.max(1, Math.floor((x - radius) / TILE)); tx <= Math.min(map.w - 1, Math.ceil((x + radius) / TILE)); tx++) {
      const d = Math.hypot(tx * TILE - x, ty * TILE - y); if (d >= radius) continue;
      const neighbours = [[tx, ty], [tx - 1, ty], [tx, ty - 1], [tx - 1, ty - 1]];
      if (neighbours.some(([a, b]) => map.water[b * map.w + a] || map.solid[b * map.w + a] || map.buildings[map.roofByTile[b * map.w + a]]?.active)) continue;
      const i = ty * stride + tx, z = Math.round((map.elevation[i] - depth * (1 - d / radius) ** 2) * 100) / 100;
      // Repeated blasts deepen a crater only to two metres below its original terrain.
      if (!map.terrainOriginal) map.terrainOriginal = map.elevation.slice();
      const value = Math.max(map.terrainOriginal[i] - 32, z);
      if (value === map.elevation[i]) continue;
      map.elevation[i] = value; map.terrainEdits.set(i, value); edits.push([i, value]);
    }
  }
  return edits;
}
