// Shared object dimensions in world units (16 units/metre).
export const STOREY_H = 52;
const hash = (x, y) => (Math.imul(x + 17, 73856093) ^ Math.imul(y + 31, 19349663)) >>> 0;
export function buildingStoreys(map, building) {
  if (Number.isFinite(building.storeys)) return Math.max(1, Math.min(5, Math.round(building.storeys)));
  if (!map.def.elevation) return 1;
  const h = hash(building.x, building.y);
  if (map.id === 'harbor') return 2 + h % 3;
  if (map.id === 'dunes') return 1 + h % 2;
  if (map.id === 'riverside') return building.w >= 7 && h % 4 === 0 ? 2 : 1;
  return 1;
}
export const treeHeight = (x, y) => 112 + hash(x, y) % 65;
