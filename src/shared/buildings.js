// Building envelopes shared by ballistics and the rendered roofs.
import { TILE } from './constants.js';
import { buildingStoreys, STOREY_H } from './heights.js';

export function collectBuildings(map) {
  return (map.def.objects?.buildings || []).map((b, id) => {
    const supports = [];
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      if (x !== b.x && x !== b.x + b.w - 1 && y !== b.y && y !== b.y + b.h - 1) continue;
      const i = y * map.w + x;
      if (map.chars[i] === b.wall || map.chars[i] === 'G') supports.push(i);
    }
    const valid = supports.length >= (b.w + b.h - 2) * 1.1;
    const flat = b.roof === 'flat' || map.id === 'harbor';
    const axis = b.w >= b.h ? 'y' : 'x';
    const span = (axis === 'y' ? b.h : b.w) * TILE;
    const rise = flat ? 4 : Math.min(36, span * 0.2);
    const storeys = buildingStoreys(map, b), wallHeight = storeys * STOREY_H;
    const base = map.heightAt((b.x + b.w / 2) * TILE, (b.y + b.h / 2) * TILE);
    return { ...b, id, supports, valid, active: valid, flat, axis, rise, base, storeys, wallHeight, eave: base + wallHeight, ridge: base + wallHeight + rise, slope: flat ? 0 : rise / (span / 2), x0: b.x * TILE, y0: b.y * TILE, x1: (b.x + b.w) * TILE, y1: (b.y + b.h) * TILE };
  }).filter((b) => b.valid);
}

export function updateBuildingSupports(map, tx, ty) {
  for (const b of map.buildings) {
    if (tx < b.x || tx >= b.x + b.w || ty < b.y || ty >= b.y + b.h) continue;
    if (tx !== b.x && tx !== b.x + b.w - 1 && ty !== b.y && ty !== b.y + b.h - 1) continue;
    b.active = !b.collapsed && b.supports.filter((i) => map.chars[i] === b.wall || map.chars[i] === 'G').length >= b.supports.length * 0.7;
  }
}

// Clip a ray against a convex gabled/flat roof envelope, including its ceiling.
export function roofHit(buildings, ox, oy, oz, dx, dy, dz, range) {
  let hit = null, best = range;
  for (const b of buildings) {
    if (!b.active) continue;
    let enter = 0, leave = best;
    const axisY = b.axis === 'y', center = axisY ? (b.y0 + b.y1) / 2 : (b.x0 + b.x1) / 2;
    const planes = [[-1, 0, 0, -b.x0], [1, 0, 0, b.x1], [0, -1, 0, -b.y0], [0, 1, 0, b.y1], [0, 0, -1, -b.eave],
      [axisY ? 0 : b.slope, axisY ? b.slope : 0, 1, b.ridge + b.slope * center],
      [axisY ? 0 : -b.slope, axisY ? -b.slope : 0, 1, b.ridge - b.slope * center]];
    for (const [nx, ny, nz, c] of planes) {
      const distance = c - nx * ox - ny * oy - nz * oz, direction = nx * dx + ny * dy + nz * dz;
      if (Math.abs(direction) < 1e-9) { if (distance < 0) { leave = -1; break; } }
      else if (direction < 0) enter = Math.max(enter, distance / direction);
      else leave = Math.min(leave, distance / direction);
      if (enter > leave) break;
    }
    if (enter <= leave && enter < best && leave >= 0) { best = enter; hit = { d: enter, tx: Math.floor((ox + dx * enter) / TILE), ty: Math.floor((oy + dy * enter) / TILE) }; }
  }
  return hit;
}
