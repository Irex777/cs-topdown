// A* pathfinding on the tile grid
const C = require('../shared/constants');
const { isWall } = require('../shared/map');

// Cache for path requests
const pathCache = new Map();
const CACHE_TTL = 800; // ms

function findPath(gameMap, startX, startY, endX, endY) {
  const TS = C.TILE_SIZE;
  const sx = Math.floor(startX / TS);
  const sy = Math.floor(startY / TS);
  const ex = Math.floor(endX / TS);
  const ey = Math.floor(endY / TS);

  const H = gameMap.length;
  const W = gameMap[0].length;

  const clamp = (v, max) => Math.max(0, Math.min(max - 1, v));
  const csx = clamp(sx, W), csy = clamp(sy, H);
  const cex = clamp(ex, W), cey = clamp(ey, H);

  // Same tile? Return direct
  if (csx === cex && csy === cey) {
    return [{ x: endX, y: endY }];
  }

  const now = Date.now();

  // Check cache
  const key = `${csx},${csy}->${cex},${cey}`;
  const cached = pathCache.get(key);
  if (cached && now - cached.time < CACHE_TTL) return cached.path;

  // Find nearest open tile if start/end is in wall
  const findOpen = (tx, ty) => {
    if (tx >= 0 && tx < W && ty >= 0 && ty < H && !isWall(gameMap, (tx + 0.5) * TS, (ty + 0.5) * TS)) {
      return { x: tx, y: ty };
    }
    for (let r = 1; r < 15; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          const nx = tx + dx, ny = ty + dy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H && !isWall(gameMap, (nx + 0.5) * TS, (ny + 0.5) * TS)) {
            return { x: nx, y: ny };
          }
        }
      }
    }
    return { x: tx, y: ty };
  };

  const start = findOpen(csx, csy);
  const end = findOpen(cex, cey);

  if (start.x === end.x && start.y === end.y) {
    return [{ x: endX, y: endY }];
  }

  // A* with Manhattan heuristic
  const heuristic = (x, y) => Math.abs(x - end.x) + Math.abs(y - end.y);

  // Use a simple priority queue (array sorted by f-score)
  // For our small maps (80x60=4800 tiles), this is fine
  const openSet = new Map(); // key -> { x, y, g, f, parent }
  const closedSet = new Set();

  const sk = `${start.x},${start.y}`;
  openSet.set(sk, { x: start.x, y: start.y, g: 0, f: heuristic(start.x, start.y), parent: null });

  const dirs = [
    { dx: 1, dy: 0, cost: 1 }, { dx: -1, dy: 0, cost: 1 },
    { dx: 0, dy: 1, cost: 1 }, { dx: 0, dy: -1, cost: 1 },
    { dx: 1, dy: 1, cost: 1.41 }, { dx: -1, dy: 1, cost: 1.41 },
    { dx: 1, dy: -1, cost: 1.41 }, { dx: -1, dy: -1, cost: 1.41 },
  ];

  let iterations = 0;
  const MAX_ITER = 12000;

  while (openSet.size > 0 && iterations < MAX_ITER) {
    iterations++;

    // Find node with lowest f-score
    let bestKey = null, bestF = Infinity;
    for (const [k, node] of openSet) {
      if (node.f < bestF) { bestF = node.f; bestKey = k; }
    }

    const current = openSet.get(bestKey);
    openSet.delete(bestKey);

    // Found target?
    if (current.x === end.x && current.y === end.y) {
      // Reconstruct path
      const tilePath = [];
      let node = current;
      while (node) {
        tilePath.unshift({ x: node.x, y: node.y });
        node = node.parent;
      }

      // Convert to pixel waypoints
      const pixelPath = tilePath.map(t => ({ x: (t.x + 0.5) * TS, y: (t.y + 0.5) * TS }));
      pixelPath[pixelPath.length - 1] = { x: endX, y: endY };

      const simplified = simplifyPath(pixelPath);
      pathCache.set(key, { path: simplified, time: now });
      return simplified;
    }

    closedSet.add(`${current.x},${current.y}`);

    for (const dir of dirs) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      const nk = `${nx},${ny}`;

      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      if (closedSet.has(nk)) continue;
      if (isWall(gameMap, (nx + 0.5) * TS, (ny + 0.5) * TS)) continue;

      // Diagonal: check adjacent tiles aren't walls (prevent corner cutting)
      if (dir.dx !== 0 && dir.dy !== 0) {
        if (isWall(gameMap, (current.x + dir.dx + 0.5) * TS, (current.y + 0.5) * TS)) continue;
        if (isWall(gameMap, (current.x + 0.5) * TS, (current.y + dir.dy + 0.5) * TS)) continue;
      }

      const g = current.g + dir.cost;
      const existing = openSet.get(nk);
      if (existing && g >= existing.g) continue;

      openSet.set(nk, { x: nx, y: ny, g, f: g + heuristic(nx, ny), parent: current });
    }
  }

  // No path found - return direct line
  return [{ x: endX, y: endY }];
}

function simplifyPath(path) {
  if (path.length <= 2) return path;
  const result = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = result[result.length - 1];
    const next = path[i + 1];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const px = path[i].x - prev.x;
    const py = path[i].y - prev.y;
    const cross = dx * py - dy * px;
    if (Math.abs(cross) > 5) {
      result.push(path[i]);
    }
  }
  result.push(path[path.length - 1]);
  return result;
}

// Clean cache periodically
let lastClean = 0;
function cleanCache() {
  const now = Date.now();
  if (now - lastClean < 2000) return;
  lastClean = now;
  for (const [key, val] of pathCache) {
    if (now - val.time > CACHE_TTL * 2) pathCache.delete(key);
  }
}

// Get next waypoint from bot's current position toward target
function getNextWaypoint(gameMap, botX, botY, targetX, targetY, currentPath, pathIndex) {
  if (currentPath && pathIndex < currentPath.length) {
    const wp = currentPath[pathIndex];
    const dx = wp.x - botX;
    const dy = wp.y - botY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 30) {
      return { path: currentPath, index: pathIndex + 1 };
    }
    return { path: currentPath, index: pathIndex };
  }

  const path = findPath(gameMap, botX, botY, targetX, targetY);
  cleanCache();
  return { path, index: 0 };
}

module.exports = { findPath, getNextWaypoint, cleanCache };
