// Procedural map generator - creates unique CS-style tactical maps every time
const C = require('../shared/constants');

const TILE_EMPTY = 0;
const TILE_WALL = 1;
const TILE_CRATE = 2;     // destructible
const TILE_BOMBSITE_A = 3;
const TILE_BOMBSITE_B = 4;
const TILE_T_SPAWN = 5;
const TILE_CT_SPAWN = 6;
const TILE_DOOR = 7;

// ── Helpers ──────────────────────────────────────────────────────────────

function buildRect(map, x, y, w, h, tile) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const py = y + dy;
      const px = x + dx;
      if (py >= 0 && py < C.MAP_HEIGHT && px >= 0 && px < C.MAP_WIDTH) {
        map[py][px] = tile;
      }
    }
  }
}

function fillArea(map, x, y, w, h, tile) {
  buildRect(map, x, y, w, h, tile);
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Carve a horizontal corridor (clear walls between two x positions at given y range)
function carveHCorridor(map, x1, x2, y, width) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const halfW = Math.floor(width / 2);
  for (let x = minX; x <= maxX; x++) {
    for (let dy = -halfW; dy <= halfW; dy++) {
      const py = y + dy;
      if (py > 0 && py < C.MAP_HEIGHT - 1 && x > 0 && x < C.MAP_WIDTH - 1) {
        if (map[py][x] === TILE_WALL) {
          map[py][x] = TILE_EMPTY;
        }
      }
    }
  }
}

// Carve a vertical corridor
function carveVCorridor(map, x, y1, y2, width) {
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const halfW = Math.floor(width / 2);
  for (let y = minY; y <= maxY; y++) {
    for (let dx = -halfW; dx <= halfW; dx++) {
      const px = x + dx;
      if (y > 0 && y < C.MAP_HEIGHT - 1 && px > 0 && px < C.MAP_WIDTH - 1) {
        if (map[y][px] === TILE_WALL) {
          map[y][px] = TILE_EMPTY;
        }
      }
    }
  }
}

// Carve an L-shaped corridor between two points
function carveLCorridor(map, x1, y1, x2, y2, width) {
  if (Math.random() < 0.5) {
    // Horizontal first, then vertical
    carveHCorridor(map, x1, x2, y1, width);
    carveVCorridor(map, x2, y1, y2, width);
  } else {
    // Vertical first, then horizontal
    carveVCorridor(map, x1, y1, y2, width);
    carveHCorridor(map, x1, x2, y2, width);
  }
}

// ── Room definition ──────────────────────────────────────────────────────

function createRoom(map, rx, ry, rw, rh, doorPositions) {
  // Build walls around the room
  buildRect(map, rx, ry, rw, 1, TILE_WALL);       // top
  buildRect(map, rx, ry + rh - 1, rw, 1, TILE_WALL); // bottom
  buildRect(map, rx, ry, 1, rh, TILE_WALL);        // left
  buildRect(map, rx + rw - 1, ry, 1, rh, TILE_WALL); // right

  // Clear interior
  fillArea(map, rx + 1, ry + 1, rw - 2, rh - 2, TILE_EMPTY);

  // Place doors
  for (const door of doorPositions) {
    const { side, pos } = door;
    switch (side) {
      case 'top':
        map[ry][rx + pos] = TILE_DOOR;
        break;
      case 'bottom':
        map[ry + rh - 1][rx + pos] = TILE_DOOR;
        break;
      case 'left':
        map[ry + pos][rx] = TILE_DOOR;
        break;
      case 'right':
        map[ry + pos][rx + rw - 1] = TILE_DOOR;
        break;
    }
  }
}

// ── BSP-based structure generation ───────────────────────────────────────

function bspSplit(x, y, w, h, depth, maxDepth) {
  if (depth >= maxDepth || w < 16 || h < 12) {
    return [{ x, y, w, h }];
  }

  const nodes = [];
  const splitH = Math.random() < (w > h * 1.5 ? 0.2 : h > w * 1.5 ? 0.8 : 0.5);

  if (splitH) {
    // Horizontal split (top/bottom)
    const splitY = randInt(Math.floor(h * 0.35), Math.floor(h * 0.65));
    nodes.push(...bspSplit(x, y, w, splitY, depth + 1, maxDepth));
    nodes.push(...bspSplit(x, y + splitY, w, h - splitY, depth + 1, maxDepth));
  } else {
    // Vertical split (left/right)
    const splitX = randInt(Math.floor(w * 0.35), Math.floor(w * 0.65));
    nodes.push(...bspSplit(x, y, splitX, h, depth + 1, maxDepth));
    nodes.push(...bspSplit(x + splitX, y, w - splitX, h, depth + 1, maxDepth));
  }

  return nodes;
}

// Generate internal walls from BSP to create rooms and chokepoints
function generateInternalWalls(map, regions) {
  const walls = [];

  for (const region of regions) {
    const { x, y, w, h } = region;
    // Don't put internal walls in very small regions
    if (w < 12 || h < 10) continue;

    // Add some random internal wall segments to create rooms/chokepoints
    const numWalls = randInt(1, 3);

    for (let i = 0; i < numWalls; i++) {
      const horizontal = Math.random() < 0.5;

      if (horizontal && w > 14) {
        // Horizontal wall with gap (door)
        const wallY = y + randInt(Math.floor(h * 0.25), Math.floor(h * 0.75));
        const gapPos = randInt(2, w - 5);
        const gapWidth = randInt(2, 4);
        const startX = x + 1;
        const endX = x + w - 2;

        for (let wx = startX; wx <= endX; wx++) {
          if (wx >= x + gapPos && wx < x + gapPos + gapWidth) continue;
          if (wallY > 1 && wallY < C.MAP_HEIGHT - 2 && wx > 0 && wx < C.MAP_WIDTH - 1) {
            map[wallY][wx] = TILE_WALL;
            walls.push({ x: wx, y: wallY });
          }
        }

        // Place door in gap
        for (let d = 0; d < gapWidth; d++) {
          const dx = x + gapPos + d;
          if (dx > 0 && dx < C.MAP_WIDTH - 1 && wallY > 1 && wallY < C.MAP_HEIGHT - 2) {
            map[wallY][dx] = TILE_DOOR;
          }
        }
      } else if (!horizontal && h > 10) {
        // Vertical wall with gap (door)
        const wallX = x + randInt(Math.floor(w * 0.25), Math.floor(w * 0.75));
        const gapPos = randInt(2, h - 5);
        const gapWidth = randInt(2, 4);
        const startY = y + 1;
        const endY = y + h - 2;

        for (let wy = startY; wy <= endY; wy++) {
          if (wy >= y + gapPos && wy < y + gapPos + gapWidth) continue;
          if (wy > 1 && wy < C.MAP_HEIGHT - 2 && wallX > 0 && wallX < C.MAP_WIDTH - 1) {
            map[wy][wallX] = TILE_WALL;
            walls.push({ x: wallX, y: wy });
          }
        }

        // Place door in gap
        for (let d = 0; d < gapWidth; d++) {
          const dy = y + gapPos + d;
          if (dy > 1 && dy < C.MAP_HEIGHT - 2 && wallX > 0 && wallX < C.MAP_WIDTH - 1) {
            map[dy][wallX] = TILE_DOOR;
          }
        }
      }
    }
  }

  return walls;
}

// Scatter crates for cover in open areas
function scatterCrates(map, zones) {
  for (const zone of zones) {
    const { x, y, w, h, density } = zone;
    const numCrates = Math.floor((w * h) * density);

    for (let i = 0; i < numCrates; i++) {
      const cx = randInt(x + 1, x + w - 2);
      const cy = randInt(y + 1, y + h - 2);

      // Only place crates on empty tiles (not walls, doors, spawn areas, bombsites)
      const tile = map[cy][cx];
      if (tile === TILE_EMPTY) {
        // Small chance of cluster
        const clusterW = Math.random() < 0.3 ? randInt(2, 3) : 1;
        const clusterH = Math.random() < 0.3 ? randInt(2, 3) : 1;
        buildRect(map, cx, cy, clusterW, clusterH, TILE_CRATE);
      }
    }
  }
}

// ── Connectivity validation (flood fill) ─────────────────────────────────

function validateMap(map) {
  // Find all key positions
  const keyTypes = [TILE_T_SPAWN, TILE_CT_SPAWN, TILE_BOMBSITE_A, TILE_BOMBSITE_B];
  const keyPositions = {};

  for (let y = 1; y < C.MAP_HEIGHT - 1; y++) {
    for (let x = 1; x < C.MAP_WIDTH - 1; x++) {
      const t = map[y][x];
      if (keyTypes.includes(t) && !keyPositions[t]) {
        keyPositions[t] = { x, y };
      }
    }
  }

  // Check all key areas exist
  for (const type of keyTypes) {
    if (!keyPositions[type]) return false;
  }

  // Flood fill from T spawn to check all areas are reachable
  const visited = new Set();
  const queue = [keyPositions[TILE_T_SPAWN]];
  visited.add(`${queue[0].x},${queue[0].y}`);

  while (queue.length > 0) {
    const { x, y } = queue.shift();
    const neighbors = [
      { x: x - 1, y }, { x: x + 1, y },
      { x, y: y - 1 }, { x, y: y + 1 },
    ];

    for (const n of neighbors) {
      const key = `${n.x},${n.y}`;
      if (n.x < 0 || n.x >= C.MAP_WIDTH || n.y < 0 || n.y >= C.MAP_HEIGHT) continue;
      if (visited.has(key)) continue;
      const tile = map[n.y][n.x];
      // Can walk through empty, spawn, bombsite, and door tiles
      if (tile === TILE_WALL || tile === TILE_CRATE) continue;
      visited.add(key);
      queue.push(n);
    }
  }

  // Check that CT spawn, bombsite A, and bombsite B are all reachable from T spawn
  for (const type of [TILE_CT_SPAWN, TILE_BOMBSITE_A, TILE_BOMBSITE_B]) {
    const pos = keyPositions[type];
    if (!visited.has(`${pos.x},${pos.y}`)) return false;
  }

  return true;
}

// ── Main map generator ──────────────────────────────────────────────────

function generateMapInternal() {
  const W = C.MAP_WIDTH;
  const H = C.MAP_HEIGHT;
  const map = [];

  // Initialize: fill everything with walls
  for (let y = 0; y < H; y++) {
    map[y] = [];
    for (let x = 0; x < W; x++) {
      map[y][x] = TILE_WALL;
    }
  }

  // Carve out playable area (inside border walls)
  fillArea(map, 1, 1, W - 2, H - 2, TILE_EMPTY);

  // ── 1. Define key room positions with randomization ──────────────────

  // T Spawn: bottom-left quadrant (roughly x:2-20, y:42-57)
  const tSpawnX = randInt(2, 5);
  const tSpawnY = randInt(H - 18, H - 14);
  const tSpawnW = randInt(12, 18);
  const tSpawnH = randInt(10, 14);
  const tSpawnCX = tSpawnX + Math.floor(tSpawnW / 2);
  const tSpawnCY = tSpawnY + Math.floor(tSpawnH / 2);

  // CT Spawn: top-right quadrant (roughly x:58-78, y:2-14)
  const ctSpawnX = randInt(W - 22, W - 18);
  const ctSpawnY = randInt(2, 5);
  const ctSpawnW = randInt(12, 18);
  const ctSpawnH = randInt(10, 14);
  const ctSpawnCX = ctSpawnX + Math.floor(ctSpawnW / 2);
  const ctSpawnCY = ctSpawnY + Math.floor(ctSpawnH / 2);

  // Bombsite A: top-left / top-center area
  const siteAX = randInt(8, 20);
  const siteAY = randInt(3, 8);
  const siteAW = randInt(12, 18);
  const siteAH = randInt(10, 14);
  const siteACX = siteAX + Math.floor(siteAW / 2);
  const siteACY = siteAY + Math.floor(siteAH / 2);

  // Bombsite B: bottom-right / bottom-center area
  const siteBX = randInt(W - 30, W - 20);
  const siteBY = randInt(H - 22, H - 16);
  const siteBW = randInt(12, 18);
  const siteBH = randInt(10, 14);
  const siteBCX = siteBX + Math.floor(siteBW / 2);
  const siteBCY = siteBY + Math.floor(siteBH / 2);

  // Mid area: center of map
  const midX = Math.floor(W / 2) + randInt(-5, 5);
  const midY = Math.floor(H / 2) + randInt(-5, 5);

  // ── 2. Place key rooms ──────────────────────────────────────────────

  // T Spawn room
  createRoom(map, tSpawnX, tSpawnY, tSpawnW, tSpawnH, [
    { side: 'top', pos: randInt(2, tSpawnW - 3) },
    { side: 'right', pos: randInt(2, tSpawnH - 3) },
  ]);

  // Mark T spawn tiles
  fillArea(map, tSpawnX + 1, tSpawnY + 1, tSpawnW - 2, tSpawnH - 2, TILE_T_SPAWN);

  // CT Spawn room
  createRoom(map, ctSpawnX, ctSpawnY, ctSpawnW, ctSpawnH, [
    { side: 'bottom', pos: randInt(2, ctSpawnW - 3) },
    { side: 'left', pos: randInt(2, ctSpawnH - 3) },
  ]);

  // Mark CT spawn tiles
  fillArea(map, ctSpawnX + 1, ctSpawnY + 1, ctSpawnW - 2, ctSpawnH - 2, TILE_CT_SPAWN);

  // Bombsite A room
  createRoom(map, siteAX, siteAY, siteAW, siteAH, [
    { side: 'bottom', pos: randInt(2, siteAW - 3) },
    { side: 'right', pos: randInt(2, siteAH - 3) },
  ]);

  // Mark bombsite A tiles
  for (let y = siteAY + 1; y < siteAY + siteAH - 1; y++) {
    for (let x = siteAX + 1; x < siteAX + siteAW - 1; x++) {
      if (map[y][x] === TILE_EMPTY) map[y][x] = TILE_BOMBSITE_A;
    }
  }

  // Bombsite B room
  createRoom(map, siteBX, siteBY, siteBW, siteBH, [
    { side: 'top', pos: randInt(2, siteBW - 3) },
    { side: 'left', pos: randInt(2, siteBH - 3) },
  ]);

  // Mark bombsite B tiles
  for (let y = siteBY + 1; y < siteBY + siteBH - 1; y++) {
    for (let x = siteBX + 1; x < siteBX + siteBW - 1; x++) {
      if (map[y][x] === TILE_EMPTY) map[y][x] = TILE_BOMBSITE_B;
    }
  }

  // ── 3. Connect key areas with corridors ──────────────────────────────

  const corridorWidth = 4;

  // Route 1: T Spawn -> Mid (Long A approach)
  carveLCorridor(map, tSpawnCX, tSpawnY, midX, midY, corridorWidth);

  // Route 2: Mid -> Bombsite A (Long A)
  carveLCorridor(map, midX, midY, siteACX, siteAY + siteAH - 1, corridorWidth);

  // Route 3: T Spawn -> Bombsite B (B tunnels)
  carveLCorridor(map, tSpawnX + tSpawnW - 1, tSpawnCY, siteBX, siteBCY, corridorWidth);

  // Route 4: Mid -> Bombsite B (Short B)
  carveLCorridor(map, midX, midY, siteBX, siteBCY, corridorWidth);

  // Route 5: Mid -> CT Spawn (Short A)
  carveLCorridor(map, midX, midY, ctSpawnX, ctSpawnCY, corridorWidth);

  // Route 6: CT Spawn -> Bombsite A (CT approach to A)
  carveLCorridor(map, ctSpawnX, ctSpawnCY, siteACX, siteAY + siteAH - 1, corridorWidth);

  // Route 7: Bombsite A <-> Bombsite B (cross map)
  carveLCorridor(map, siteACX, siteACY, siteBX, siteBCY, corridorWidth);

  // ── 4. BSP internal structure ───────────────────────────────────────

  // Generate BSP regions in the open play area
  const bspDepth = randInt(2, 3);
  const regions = bspSplit(2, 2, W - 4, H - 4, 0, bspDepth);
  generateInternalWalls(map, regions);

  // Ensure corridors are still open after BSP walls by re-carving key routes
  carveHCorridor(map, tSpawnCX, midX, tSpawnY - 1, corridorWidth);
  carveVCorridor(map, midX, tSpawnY, midY, corridorWidth);
  carveHCorridor(map, midX, siteACX, midY, corridorWidth);
  carveVCorridor(map, siteACX, midY, siteAY + siteAH - 1, corridorWidth);
  carveHCorridor(map, tSpawnX + tSpawnW - 1, siteBX, tSpawnCY, corridorWidth);
  carveVCorridor(map, siteBX, tSpawnCY, siteBCY, corridorWidth);
  carveHCorridor(map, midX, siteBX, midY, corridorWidth);
  carveVCorridor(map, siteBX, midY, siteBCY, corridorWidth);

  // ── 5. Scatter crates for cover ─────────────────────────────────────

  scatterCrates(map, [
    { x: siteAX, y: siteAY, w: siteAW, h: siteAH, density: 0.04 },
    { x: siteBX, y: siteBY, w: siteBW, h: siteBH, density: 0.04 },
    { x: midX - 6, y: midY - 6, w: 12, h: 12, density: 0.06 },
    { x: 20, y: 15, w: W - 40, h: H - 30, density: 0.005 },
  ]);

  // Ensure spawn areas don't have crates
  fillArea(map, tSpawnX + 1, tSpawnY + 1, tSpawnW - 2, tSpawnH - 2, TILE_T_SPAWN);
  fillArea(map, ctSpawnX + 1, ctSpawnY + 1, ctSpawnW - 2, ctSpawnH - 2, TILE_CT_SPAWN);

  return map;
}

function generateMap() {
  const MAX_ATTEMPTS = 10;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const map = generateMapInternal();

    if (validateMap(map)) {
      return map;
    }
  }

  // Fallback: return last generated map even if not perfect
  // (shouldn't happen often with the corridor approach)
  console.warn('[map.js] Warning: Could not generate a fully validated map after 10 attempts, using last attempt');
  return generateMapInternal();
}

// ── Public helper functions (preserved interface) ────────────────────────

function getSpawnPoints(map, team) {
  const tile = team === 'T' ? TILE_T_SPAWN : TILE_CT_SPAWN;
  const spawns = [];
  for (let y = 0; y < C.MAP_HEIGHT; y++) {
    for (let x = 0; x < C.MAP_WIDTH; x++) {
      if (map[y][x] === tile) {
        spawns.push({ x: x * C.TILE_SIZE + C.TILE_SIZE / 2, y: y * C.TILE_SIZE + C.TILE_SIZE / 2 });
      }
    }
  }
  return spawns;
}

function getBombsites(map) {
  const sites = {};
  for (let y = 0; y < C.MAP_HEIGHT; y++) {
    for (let x = 0; x < C.MAP_WIDTH; x++) {
      if (map[y][x] === TILE_BOMBSITE_A) {
        if (!sites.A) sites.A = { x: x * C.TILE_SIZE, y: y * C.TILE_SIZE, tiles: [] };
        sites.A.tiles.push({ x, y });
      }
      if (map[y][x] === TILE_BOMBSITE_B) {
        if (!sites.B) sites.B = { x: x * C.TILE_SIZE, y: y * C.TILE_SIZE, tiles: [] };
        sites.B.tiles.push({ x, y });
      }
    }
  }
  // Center of bombsite
  for (const key of Object.keys(sites)) {
    const s = sites[key];
    const cx = s.tiles.reduce((a, t) => a + t.x, 0) / s.tiles.length;
    const cy = s.tiles.reduce((a, t) => a + t.y, 0) / s.tiles.length;
    s.centerX = cx * C.TILE_SIZE + C.TILE_SIZE / 2;
    s.centerY = cy * C.TILE_SIZE + C.TILE_SIZE / 2;
  }
  return sites;
}

function isWall(map, px, py) {
  const tx = Math.floor(px / C.TILE_SIZE);
  const ty = Math.floor(py / C.TILE_SIZE);
  if (tx < 0 || tx >= C.MAP_WIDTH || ty < 0 || ty >= C.MAP_HEIGHT) return true;
  const t = map[ty][tx];
  // DOOR is walkable (not solid), everything else solid is wall/crate
  return t === TILE_WALL || t === TILE_CRATE;
}

function isOnBombsite(map, px, py, site) {
  const tx = Math.floor(px / C.TILE_SIZE);
  const ty = Math.floor(py / C.TILE_SIZE);
  if (tx < 0 || tx >= C.MAP_WIDTH || ty < 0 || ty >= C.MAP_HEIGHT) return false;
  const target = site === 'A' ? TILE_BOMBSITE_A : TILE_BOMBSITE_B;
  return map[ty][tx] === target;
}

function lineOfSight(map, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(dist / (C.TILE_SIZE / 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + dx * t;
    const y = y1 + dy * t;
    if (isWall(map, x, y)) return false;
  }
  return true;
}

module.exports = {
  generateMap,
  getSpawnPoints,
  getBombsites,
  isWall,
  isOnBombsite,
  lineOfSight,
  validateMap,
  TILE_EMPTY,
  TILE_WALL,
  TILE_CRATE,
  TILE_BOMBSITE_A,
  TILE_BOMBSITE_B,
  TILE_T_SPAWN,
  TILE_CT_SPAWN,
  TILE_DOOR,
};
