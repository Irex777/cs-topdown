// Prints each map as ASCII and validates connectivity (spawns <-> both sites).  Usage: npm run maps
import { MAP_DEFS, getMap } from '../../src/cs/shared/maps/index.js';
import { TILE } from '../../src/cs/shared/constants.js';

function flood(map, sx, sy) {
  const seen = new Uint8Array(map.w * map.h);
  const q = [[sx, sy]]; seen[sy * map.w + sx] = 1;
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (map.isSolidTile(nx, ny) || seen[ny * map.w + nx]) continue;
      seen[ny * map.w + nx] = 1; q.push([nx, ny]);
    }
  }
  return seen;
}

let bad = 0;
for (const def of MAP_DEFS) {
  const map = getMap(def.id);
  if (process.argv.includes('--ascii') || process.argv[2] === def.id) console.log(`\n== ${def.name} ${map.w}x${map.h}\n` + def.rows.join('\n'));
  const t = map.spawns[0][0], ct = map.spawns[1][0];
  const seen = flood(map, Math.floor(t.x / TILE), Math.floor(t.y / TILE));
  const reach = (p) => seen[Math.floor(p.y / TILE) * map.w + Math.floor(p.x / TILE)] === 1;
  const problems = [];
  if (!reach(ct)) problems.push('CT spawn unreachable from T spawn');
  for (const s of map.sites) {
    if (!s) { problems.push('missing site'); continue; }
    let ok = false;
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (map.site[y * map.w + x] === s.id + 1 && seen[y * map.w + x]) ok = true;
    if (!ok) problems.push(`site ${s.name} unreachable`);
  }
  // any walkable pocket not connected to spawn?
  let orphan = 0;
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (!map.isSolidTile(x, y) && !seen[y * map.w + x]) orphan++;
  if (orphan) problems.push(`${orphan} orphan floor tiles`);
  for (let t2 = 0; t2 < 2; t2++) for (const s of map.spawns[t2]) if (map.isSolidAt(s.x, s.y)) problems.push('spawn inside solid');
  console.log(`${def.name}: ${map.w}x${map.h}  spawns T=${map.spawns[0].length} CT=${map.spawns[1].length}  sites=${map.sites.map((s) => s && s.name).join(',')}  ${problems.length ? 'PROBLEMS: ' + problems.join('; ') : 'ok'}`);
  bad += problems.length;
}
process.exit(bad ? 1 : 0);
