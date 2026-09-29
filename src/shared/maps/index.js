import { GameMap } from '../gamemap.js';
import dust from './dust.js';
import warehouse from './warehouse.js';
import pit from './pit.js';

export const MAP_DEFS = [dust, warehouse, pit];
const cache = new Map();

export function getMap(id) {
  if (!cache.has(id)) {
    const def = MAP_DEFS.find((m) => m.id === id) || MAP_DEFS[0];
    cache.set(def.id, new GameMap(def));
  }
  return cache.get(id) || cache.get(MAP_DEFS[0].id);
}
export const mapList = () => MAP_DEFS.map((m) => ({ id: m.id, name: m.name, desc: m.desc, size: m.size, best: m.best }));
