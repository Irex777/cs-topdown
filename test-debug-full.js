const C = require('./shared/constants');
const { generateMap, isWall } = require('./shared/map');
const { findPath } = require('./server/pathfinding');

const map = generateMap();
const TS = C.TILE_SIZE;

// Print T spawn area
console.log('=== T SPAWN AREA (y=44 to y=57, x=0 to x=20) ===');
for (let y = 44; y <= 57; y++) {
  let row = '';
  for (let x = 0; x <= 20; x++) {
    const t = map[y]?.[x];
    const c = t === 1 ? '#' : t === 5 ? '@' : t === 7 ? 'D' : '.';
    row += c;
  }
  console.log('y=' + String(y).padStart(2) + ' ' + row);
}

console.log('\nT spawn exit at (18,46):', map[46][18], '(0=empty)');
console.log('T spawn exit at (18,47):', map[47][18]);
console.log('T spawn exit at (18,48):', map[48][18]);

// Check the corridor from T spawn exit
console.log('\n=== CORRIDOR FROM T SPAWN (y=40 to y=57, x=18 to x=26) ===');
for (let y = 40; y <= 57; y++) {
  let row = '';
  for (let x = 18; x <= 26; x++) {
    const t = map[y]?.[x];
    const c = t === 1 ? '#' : t === 5 ? '@' : t === 7 ? 'D' : t === 2 ? 'X' : '.';
    row += c;
  }
  console.log('y=' + String(y).padStart(2) + ' ' + row);
}

// Test pathfinding from T spawn to CT spawn
const tSpawnX = 10 * TS, tSpawnY = 50 * TS;
const ctSpawnX = 68 * TS, ctSpawnY = 7 * TS;

console.log('\n=== PATHFINDING TEST ===');
console.log('T spawn pixel:', tSpawnX, tSpawnY);
console.log('CT spawn pixel:', ctSpawnX, ctSpawnY);

const t0 = Date.now();
const path = findPath(map, tSpawnX, tSpawnY, ctSpawnX, ctSpawnY);
const elapsed = Date.now() - t0;
console.log('Path found in', elapsed, 'ms, waypoints:', path.length);
if (path.length <= 5) {
  console.log('PATH:', JSON.stringify(path));
}

// Verify each waypoint is not in a wall
let wallHits = 0;
for (let i = 0; i < path.length; i++) {
  const wp = path[i];
  const inWall = isWall(map, wp.x, wp.y);
  if (inWall) {
    console.log('WAYPOINT', i, 'IS IN A WALL!', wp.x, wp.y);
    wallHits++;
  }
}
if (wallHits === 0) console.log('All waypoints are on walkable tiles');

// Test path from various T spawn positions
const tSpawnPositions = [
  [5*TS, 47*TS], [8*TS, 49*TS], [12*TS, 51*TS], [15*TS, 53*TS],
  [10*TS, 50*TS], // center
];
for (const [sx, sy] of tSpawnPositions) {
  const p = findPath(map, sx, sy, ctSpawnX, ctSpawnY);
  console.log(`From (${sx/TS},${sy/TS}) to CT: ${p.length} waypoints, first: (${p[0]?.x?.toFixed(0)},${p[0]?.y?.toFixed(0)}), last: (${p[p.length-1]?.x?.toFixed(0)},${p[p.length-1]?.y?.toFixed(0)})`);
}

// Test a simple path: T spawn to open area just outside
console.log('\n=== SHORT PATH TEST: T spawn to just outside ===');
const justOutsideX = 20 * TS, justOutsideY = 50 * TS;
console.log('Is outside tile walkable?', !isWall(map, justOutsideX, justOutsideY));
const shortPath = findPath(map, tSpawnX, tSpawnY, justOutsideX, justOutsideY);
console.log('Short path waypoints:', shortPath.length);
for (const wp of shortPath) {
  console.log('  wp:', wp.x.toFixed(0), wp.y.toFixed(0), 'wall:', isWall(map, wp.x, wp.y));
}

// Check tiles around the T spawn exit
console.log('\n=== TILES AROUND T SPAWN EXIT (x=17-19, y=44-49) ===');
for (let y = 44; y <= 49; y++) {
  for (let x = 17; x <= 19; x++) {
    const t = map[y][x];
    console.log(`  (${x},${y}) = ${t} walkable=${!isWall(map, (x+0.5)*TS, (y+0.5)*TS)}`);
  }
}
