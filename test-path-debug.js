const C = require('./shared/constants');
const { generateMap, isWall } = require('./shared/map');
const { findPath } = require('./server/pathfinding');

const gameMap = generateMap();
const TS = C.TILE_SIZE;

// Test the exact path the bot tries
const startX = 320, startY = 1600;  // T spawn
const endX = 1198, endY = 1251;     // random waypoint

console.log('Start tile:', Math.floor(startX/TS), Math.floor(startY/TS));
console.log('End tile:', Math.floor(endX/TS), Math.floor(endY/TS));
console.log('Start walkable:', !isWall(gameMap, startX, startY));
console.log('End walkable:', !isWall(gameMap, endX, endY));

// Test findPath directly
const path = findPath(gameMap, startX, startY, endX, endY);
console.log('\nPath result:', path.length, 'waypoints');
for (const wp of path) {
  console.log('  wp:', wp.x.toFixed(0), wp.y.toFixed(0), 'wall:', isWall(gameMap, wp.x, wp.y));
}

// Now test from the stuck position
const stuckX = 499, stuckY = 1520;
console.log('\nStuck tile:', Math.floor(stuckX/TS), Math.floor(stuckY/TS));
const path2 = findPath(gameMap, stuckX, stuckY, endX, endY);
console.log('Path from stuck:', path2.length, 'waypoints');
for (const wp of path2) {
  console.log('  wp:', wp.x.toFixed(0), wp.y.toFixed(0), 'wall:', isWall(gameMap, wp.x, wp.y));
}

// Test a known good path
const path3 = findPath(gameMap, stuckX, stuckY, 18*TS, 46*TS);
console.log('\nPath to exit (18,46):', path3.length, 'waypoints');
for (const wp of path3) {
  console.log('  wp:', wp.x.toFixed(0), wp.y.toFixed(0), 'wall:', isWall(gameMap, wp.x, wp.y));
}

// Let me check what's at the end tile
const endTileX = Math.floor(endX/TS);
const endTileY = Math.floor(endY/TS);
console.log('\n=== End tile area ===');
for (let y = endTileY - 2; y <= endTileY + 2; y++) {
  let row = '';
  for (let x = endTileX - 2; x <= endTileX + 2; x++) {
    if (x < 0 || y < 0 || y >= C.MAP_HEIGHT || x >= C.MAP_WIDTH) { row += '?'; continue; }
    const t = gameMap[y][x];
    const w = isWall(gameMap, (x+0.5)*TS, (y+0.5)*TS);
    if (x === endTileX && y === endTileY) row += 'E';
    else row += w ? '#' : '.';
  }
  console.log('y=' + y + ' ' + row);
}

// Manually trace A* to find why it fails
console.log('\n=== Manual A* trace ===');
const sx = Math.floor(startX / TS);
const sy = Math.floor(startY / TS);
const ex = Math.floor(endX / TS);
const ey = Math.floor(endY / TS);
console.log('A* from', sx, sy, 'to', ex, ey);

// Count open tiles and check connectivity
let openCount = 0;
const H = gameMap.length, W = gameMap[0].length;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (!isWall(gameMap, (x+0.5)*TS, (y+0.5)*TS)) openCount++;
  }
}
console.log('Open tiles:', openCount, '/', W*H);

// BFS from start to see how many tiles are reachable
const visited = new Set();
const queue = [{x: sx, y: sy}];
visited.add(`${sx},${sy}`);
while (queue.length > 0) {
  const curr = queue.shift();
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const nx = curr.x + dx, ny = curr.y + dy;
    const k = `${nx},${ny}`;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H || visited.has(k)) continue;
    if (isWall(gameMap, (nx+0.5)*TS, (ny+0.5)*TS)) continue;
    visited.add(k);
    queue.push({x: nx, y: ny});
  }
}
console.log('Reachable from start:', visited.size, 'tiles');
console.log('Target reachable:', visited.has(`${ex},${ey}`));

// Check the corridor from T spawn
console.log('\n=== Detailed corridor check ===');
for (let y = 44; y <= 48; y++) {
  for (let x = 15; x <= 20; x++) {
    const w = isWall(gameMap, (x+0.5)*TS, (y+0.5)*TS);
    console.log(`  (${x},${y}): tile=${gameMap[y][x]} wall=${w}`);
  }
}
