import { GameMap } from '../gamemap.js';
import riverside from './riverside.js';
import harbor from './harbor.js';
import dunes from './dunes.js';
import dust from './dust.js';
import warehouse from './warehouse.js';
import pit from './pit.js';
import foundry from './foundry.js';

// The four close-quarters maps from the original game are adapted for team deathmatch: wall faces become destructible
// brick, bombsite letters become plain floor and the old theme colours map onto the voxel palette.
function adaptLegacy(def) {
  const rows = def.rows.map((r) => r.replace(/[ab]/g, '.'));
  const H = rows.length, Wd = rows[0].length;
  const at = (x, y) => (rows[y] && rows[y][x]) || '#';
  const out = rows.map((r, y) => [...r].map((c, x) => {
    if (c !== '#' || x < 2 || y < 2 || x > Wd - 3 || y > H - 3) return c;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (at(x + dx, y + dy) !== '#') return 'B';
    return c;
  }).join(''));
  const t = def.theme || {};
  return {
    ...def, rows: out, modes: ['tdm'],
    theme: {
      grass: t.floor, grass2: t.floor2, concrete: t.floor, road: t.floor2, brick: t.wallTop, rock: t.wall, crate: t.crate, accent: t.accent, fog: t.fog,
      sand: t.floor, metal: t.crate, tree: '#3f7f3a', legacy: true,
    },
  };
}

export const MAP_DEFS = [riverside, harbor, dunes, adaptLegacy(dust), adaptLegacy(warehouse), adaptLegacy(foundry), adaptLegacy(pit)];
const cache = new Map();

const defOf = (id) => MAP_DEFS.find((m) => m.id === id) || MAP_DEFS[0];

/** Shared, never-destroyed instance for previews, validation and lobby thumbnails. */
export function getMap(id) {
  const def = defOf(id);
  if (!cache.has(def.id)) cache.set(def.id, new GameMap(def));
  return cache.get(def.id);
}

/** A fresh instance for one match (tiles can be destroyed in it). */
export function createMap(id) { return new GameMap(defOf(id)); }

export const mapList = () => MAP_DEFS.map((m) => ({ id: m.id, name: m.name, desc: m.desc, size: m.size, best: m.best, modes: m.modes }));
