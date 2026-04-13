// Find unreachable tiles and fix map connectivity
const C = require('./shared/constants');
const { generateMap, isWall } = require('./shared/map');

const gameMap = generateMap();
const TS = C.TILE_SIZE;
const H = gameMap.length, W = gameMap[0].length;

// BFS from T spawn to find all reachable tiles
const tSpawnTile = { x: 10, y: 50 };
const visited = new Set();
const queue = [tSpawnTile];
visited.add(`${tSpawnTile.x},${tSpawnTile.y}`);
while (queue.length > 0) {
  const curr = queue.shift();
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
    const nx = curr.x + dx, ny = curr.y + dy;
    const k = `${nx},${ny}`;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H || visited.has(k)) continue;
    if (isWall(gameMap, (nx+0.5)*TS, (ny+0.5)*TS)) continue;
    visited.add(k);
    queue.push({x: nx, y: ny});
  }
}

// Find all open but unreachable tiles
const unreachable = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (!isWall(gameMap, (x+0.5)*TS, (y+0.5)*TS) && !visited.has(`${x},${y}`)) {
      unreachable.push({x, y, tile: gameMap[y][x]});
    }
  }
}

console.log('Unreachable tiles:', unreachable.length);
for (const t of unreachable) {
  console.log(`  (${t.x},${t.y}) tile=${t.tile}`);
}

// Show the unreachable areas in context
// Group by proximity
const groups = [];
const assigned = new Set();
for (const t of unreachable) {
  if (assigned.has(`${t.x},${t.y}`)) continue;
  const group = [];
  const q = [t];
  assigned.add(`${t.x},${t.y}`);
  while (q.length > 0) {
    const c = q.shift();
    group.push(c);
    for (const t2 of unreachable) {
      if (!assigned.has(`${t2.x},${t2.y}`) && Math.abs(t2.x-c.x) <= 2 && Math.abs(t2.y-c.y) <= 2) {
        assigned.add(`${t2.x},${t2.y}`);
        q.push(t2);
      }
    }
  }
  groups.push(group);
}

console.log('\nUnreachable groups:');
for (let i = 0; i < groups.length; i++) {
  const g = groups[i];
  const xs = g.map(t => t.x), ys = g.map(t => t.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  console.log(`\nGroup ${i}: ${g.length} tiles, bounds (${minX},${minY})-(${maxX},${maxY})`);
  
  // Print area
  for (let y = minY-1; y <= maxY+1; y++) {
    let row = '';
    for (let x = minX-1; x <= maxX+1; x++) {
      if (x < 0 || y < 0 || y >= H || x >= W) { row += '?'; continue; }
      const isUnreach = g.some(t => t.x === x && t.y === y);
      const w = isWall(gameMap, (x+0.5)*TS, (y+0.5)*TS);
      if (isUnreach) row += '!';
      else row += w ? '#' : '.';
    }
    console.log(`  y=${y} ${row}`);
  }
  
  // Find nearest reachable tile and suggest connection
  let nearestReach = null, nearestDist = Infinity;
  for (let y = minY-3; y <= maxY+3; y++) {
    for (let x = minX-3; x <= maxX+3; x++) {
      if (x < 0 || y < 0 || y >= H || x >= W) continue;
      if (visited.has(`${x},${y}`)) {
        const d = Math.min(...g.map(t => Math.abs(t.x-x) + Math.abs(t.y-y)));
        if (d < nearestDist) {
          nearestDist = d;
          nearestReach = {x, y};
        }
      }
    }
  }
  console.log(`  Nearest reachable: (${nearestReach?.x},${nearestReach?.y}) dist=${nearestDist}`);
}
