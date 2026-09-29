// Validates every map: bases, flags and vehicle spawns must be reachable, and prints a small overview.
// Usage: npm run maps [mapId]   (a map id also prints the full ASCII)
import { MAP_DEFS, createMap } from '../src/shared/maps/index.js';
import { TILE } from '../src/shared/constants.js';
import { VEHICLES } from '../src/shared/vehicles.js';
import { NavGrid } from '../src/server/bot/nav.js';

function flood(map, sx, sy, blocked) {
  const seen = new Uint8Array(map.w * map.h);
  const q = [[sx, sy]]; seen[sy * map.w + sx] = 1;
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h || blocked[ny * map.w + nx] || seen[ny * map.w + nx]) continue;
      seen[ny * map.w + nx] = 1; q.push([nx, ny]);
    }
  }
  return seen;
}

let bad = 0;
for (const def of MAP_DEFS) {
  const map = createMap(def.id);
  if (process.argv[2] === def.id) console.log(`\n== ${def.name} ${map.w}x${map.h}\n` + map.chars.reduce((acc, c, i) => acc + c + ((i + 1) % map.w === 0 ? '\n' : ''), ''));
  const problems = [];
  const t = map.spawns[0][0], ct = map.spawns[1][0];
  const tx = (p) => Math.floor(p.x / TILE), ty = (p) => Math.floor(p.y / TILE);
  const seen = flood(map, tx(t), ty(t), map.blockInf);
  const reach = (p) => seen[ty(p) * map.w + tx(p)] === 1;
  if (!reach(ct)) problems.push('blue base unreachable from red base');
  for (const f of map.flags) if (!reach(f)) problems.push(`flag ${f.name} unreachable`);
  let orphan = 0;
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (!map.blockInf[y * map.w + x] && !seen[y * map.w + x]) orphan++;
  if (orphan && map.modes.includes('conquest')) problems.push(`${orphan} orphan floor tiles`);
  for (let k = 0; k < 2; k++) for (const s of map.spawns[k]) if (map.isBlockedAt(s.x, s.y)) problems.push('spawn inside solid');
  // vehicles: the spawn must be free and a tank-sized route must exist from its base to the map centre
  const nav = new NavGrid(map);
  let vehOk = 0;
  for (const v of map.vehSpawns) {
    const def2 = VEHICLES[v.type];
    if (!def2) { problems.push(`unknown vehicle ${v.type}`); continue; }
    const mask = def2.kind === 'air' ? null : def2.kind === 'boat' ? map.blockBoat : map.blockInf;
    if (mask && mask[ty(v) * map.w + tx(v)]) { problems.push(`${v.type} at ${tx(v)},${ty(v)} is inside an obstacle`); continue; }
    if (def2.kind === 'wheeled' || def2.kind === 'tracked') {
      const target = map.flags[0] || ct;
      const path = nav.findPath(v.x, v.y, target.x, target.y, false, 1);
      if (!path && map.modes.includes('conquest')) problems.push(`${v.type} at ${tx(v)},${ty(v)} cannot drive to ${map.flags[0] ? map.flags[0].name : 'the enemy'}`);
      else vehOk++;
    }
  }
  const counts = {};
  for (const c of map.chars) counts[c] = (counts[c] || 0) + 1;
  const pct = (c) => Math.round(((counts[c] || 0) / map.chars.length) * 100);
  console.log(`${def.name}: ${map.w}x${map.h} modes=${map.modes.join('/')} flags=${map.flags.length} vehicles=${map.vehSpawns.length} (${vehOk} drivable) walls=${pct('B') + pct('#')}% water=${pct('~') + pct('w')}%  ${problems.length ? 'PROBLEMS: ' + problems.join('; ') : 'ok'}`);
  bad += problems.length;
}
process.exit(bad ? 1 : 0);
