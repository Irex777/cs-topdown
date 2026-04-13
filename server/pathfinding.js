// Simple A* pathfinding on the tile grid
const C = require('../shared/constants');
const { isWall } = require('../shared/map');

// Cache for path requests - avoids computing same path every frame
const pathCache = new Map();
const CACHE_TTL = 500; // ms
let cacheCleanupTimer = 0;

function findPath(gameMap, startX, startY, endX, endY) {
  const TS = C.TILE_SIZE;
  // Convert pixel coords to tile coords
  const sx = Math.floor(startX / TS);
  const sy = Math.floor(startY / TS);
  const ex = Math.floor(endX / TS);
  const ey = Math.floor(endY / TS);

  const H = gameMap.length;
  const W = gameMap[0].length;

  // Clamp to map bounds
  const clamp = (v, max) => Math.max(0, Math.min(max - 1, v));
  const csx = clamp(sx, W), csy = clamp(sy, H);
  const cex = clamp(ex, W), cey = clamp(ey, H);

  // Check cache
  const key = `${csx},${csy}->${cex},${cey}`;
  const now = Date.now();
  const cached = pathCache.get(key);
  if (cached && now - cached.time < CACHE_TTL) return cached.path;

  // Check if start or end is in a wall - if so, find nearest open tile
  const findOpen = (tx, ty) => {
    if (tx >= 0 && tx < W && ty >= 0 && ty < H && !isWall(gameMap, (tx + 0.5) * TS, (ty + 0.5) * TS)) {
      return { x: tx, y: ty };
    }
    // Search spiral outward
    for (let r = 1; r < 10; r++) {
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

  // BFS (faster than A* for short distances, good enough for our tile grid)
  const visited = new Set();
  const queue = [{ x: start.x, y: start.y, path: [{ x: start.x, y: start.y }] }];
  visited.add(`${start.x},${start.y}`);

  // 8-directional movement
  const dirs = [
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    { dx: 1, dy: 1 }, { dx: -1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: -1 },
  ];

  let iterations = 0;
  const MAX_ITER = 2000;

  while (queue.length > 0 && iterations < MAX_ITER) {
    iterations++;
    const current = queue.shift();

    if (current.x === end.x && current.y === end.y) {
      // Convert tile path to pixel waypoints (center of tiles)
      const pixelPath = current.path.map(t => ({
        x: (t.x + 0.5) * TS,
        y: (t.y + 0.5) * TS,
      }));
      // Last waypoint is the actual target
      pixelPath[pixelPath.length - 1] = { x: endX, y: endY };

      // Simplify path: remove redundant waypoints (straight lines)
      const simplified = simplifyPath(pixelPath);

      pathCache.set(key, { path: simplified, time: now });
      return simplified;
    }

    for (const dir of dirs) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      const nk = `${nx},${ny}`;

      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      if (visited.has(nk)) continue;

      // Check wall (with margin for diagonal movement)
      const px = (nx + 0.5) * TS;
      const py = (ny + 0.5) * TS;
      if (isWall(gameMap, px, py)) continue;

      // For diagonal movement, check both adjacent tiles too
      if (dir.dx !== 0 && dir.dy !== 0) {
        const adj1x = current.x + dir.dx, adj1y = current.y;
        const adj2x = current.x, adj2y = current.y + dir.dy;
        if (isWall(gameMap, (adj1x + 0.5) * TS, (adj1y + 0.5) * TS) ||
            isWall(gameMap, (adj2x + 0.5) * TS, (adj2y + 0.5) * TS)) continue;
      }

      visited.add(nk);
      queue.push({
        x: nx, y: ny,
        path: [...current.path, { x: nx, y: ny }],
      });
    }
  }

  // No path found - return direct line (will use stuck avoidance)
  return [{ x: endX, y: endY }];
}

// Remove redundant waypoints in straight lines
function simplifyPath(path) {
  if (path.length <= 2) return path;
  const result = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = result[result.length - 1];
    const next = path[i + 1];
    // Check if current point is on the line between prev and next
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const px = path[i].x - prev.x;
    const py = path[i].y - prev.y;
    // Cross product to check collinearity
    const cross = dx * py - dy * px;
    if (Math.abs(cross) > 5) { // Not collinear - keep this waypoint
      result.push(path[i]);
    }
  }
  result.push(path[path.length - 1]);
  return result;
}

// Clean cache periodically
function cleanCache() {
  const now = Date.now();
  for (const [key, val] of pathCache) {
    if (now - val.time > CACHE_TTL * 2) pathCache.delete(key);
  }
}

// Get next waypoint from bot's current position toward target
function getNextWaypoint(gameMap, botX, botY, targetX, targetY, currentPath, pathIndex) {
  // If we have a valid path and haven't reached the end, return next waypoint
  if (currentPath && pathIndex < currentPath.length) {
    const wp = currentPath[pathIndex];
    const dx = wp.x - botX;
    const dy = wp.y - botY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 40) {
      // Reached this waypoint, move to next
      return { path: currentPath, index: pathIndex + 1 };
    }
    return { path: currentPath, index: pathIndex };
  }

  // Need new path
  const path = findPath(gameMap, botX, botY, targetX, targetY);
  cleanCache();
  return { path, index: 0 };
}

module.exports = { findPath, getNextWaypoint, cleanCache };
