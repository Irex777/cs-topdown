// Hardcoded de_dust2 map layout – faithful recreation
const C = require('../shared/constants');

const TILE_EMPTY = 0;
const TILE_WALL = 1;
const TILE_CRATE = 2;     // destructible
const TILE_BOMBSITE_A = 3;
const TILE_BOMBSITE_B = 4;
const TILE_T_SPAWN = 5;
const TILE_CT_SPAWN = 6;
const TILE_DOOR = 7;

// ── Connectivity validation (flood fill) ─────────────────────────────────

function validateMap(map) {
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

  for (const type of keyTypes) {
    if (!keyPositions[type]) return false;
  }

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
      if (tile === TILE_WALL || tile === TILE_CRATE) continue;
      visited.add(key);
      queue.push(n);
    }
  }

  for (const type of [TILE_CT_SPAWN, TILE_BOMBSITE_A, TILE_BOMBSITE_B]) {
    const pos = keyPositions[type];
    if (!visited.has(`${pos.x},${pos.y}`)) return false;
  }

  return true;
}

// ── de_dust2 hardcoded map ──────────────────────────────────────────────
//
//  80x60 tiles. Orientation: North = top of screen.
//
//  Authentic de_dust2 layout based on overhead tactical view:
//
//    ┌──────────────────────────────────────────────────────────────────┐
//    │                                                                 │
//    │  CT Spawn ── CT Ramp ────────────────────── A Site              │
//    │  (top-left)     │                          (top-right)          │
//    │                 │  Catwalk ────────────────┘                    │
//    │                 │  (Short A)                                  │
//    │             Top of Mid                                        │
//    │                 │                                              │
//    │                 │                                              │
//    │  Long A ────────┼─────────────────── A Site (west entrance)    │
//    │  (long horiz    │                                   │          │
//    │   corridor,     Mid (vertical)                       │          │
//    │   36 tiles)     │                                   │          │
//    │                 │                                   │          │
//    │                 Mid Doors                           │          │
//    │                 │                                   │          │
//    │   Long Doors    │                            B Tunnels─ B Site │
//    │       │         │                              (bottom-right)  │
//    │       └──── T Spawn ────┘                                      │
//    │           (bottom-center)                                      │
//    └──────────────────────────────────────────────────────────────────┘
//
//  Corridor widths: 5-6 tiles for good gameplay.

function generateMap() {
  const W = C.MAP_WIDTH;   // 80
  const H = C.MAP_HEIGHT;  // 60
  const map = [];

  // Initialize: fill everything with walls
  for (let y = 0; y < H; y++) {
    map[y] = [];
    for (let x = 0; x < W; x++) {
      map[y][x] = TILE_WALL;
    }
  }

  // ── Local carve helper ──────────────────────────────────────────────
  function carve(x, y, w, h, tile) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const py = y + dy;
        const px = x + dx;
        if (py >= 0 && py < H && px >= 0 && px < W) {
          map[py][px] = tile;
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  KEY AREAS / ROOMS
  // ════════════════════════════════════════════════════════════════════════

  // ── CT Spawn (top-left corner) ────────────────────────────────────
  //   x:3-14, y:3-9  (12x7)
  carve(3, 3, 12, 7, TILE_CT_SPAWN);

  // ── A Site (top-right, large open bombsite) ───────────────────────
  //   x:50-76, y:3-18  (27x16 - the biggest open area)
  carve(50, 3, 27, 16, TILE_BOMBSITE_A);

  // ── T Spawn (bottom-center) ───────────────────────────────────────
  //   x:28-44, y:49-56  (17x8)
  carve(28, 49, 17, 8, TILE_T_SPAWN);

  // ── B Site (bottom-right) ─────────────────────────────────────────
  //   x:62-76, y:40-56  (15x17)
  carve(62, 40, 15, 17, TILE_BOMBSITE_B);

  // ════════════════════════════════════════════════════════════════════════
  //  CORRIDORS
  // ════════════════════════════════════════════════════════════════════════

  // ── LONG A (the iconic long corridor, must be 25+ tiles) ──────────
  // Runs horizontally across the upper-left portion of the map.
  // In real de_dust2, Long A is the longest sightline on the map.
  //
  // Long A corridor (horizontal): x:5-49, y:22-27  (45 tiles long, 6 wide!)
  carve(5, 22, 45, 6, TILE_EMPTY);

  // Long A approach (widening near A Site entrance): x:48-52, y:19-28
  carve(48, 19, 5, 10, TILE_EMPTY);

  // Long A Pit (small depression south of the corridor)
  //   x:15-21, y:28-33
  carve(15, 28, 7, 6, TILE_EMPTY);

  // Long A Doors area (L-shaped: from Long A west end, turns south to T spawn)
  // Vertical corridor going south: x:5-10, y:27-48
  carve(5, 27, 6, 22, TILE_EMPTY);
  // Small room at Long Doors (widening): x:5-13, y:43-48
  carve(5, 43, 9, 6, TILE_EMPTY);

  // ── MID (central vertical corridor) ────────────────────────────────
  // Runs roughly north-south through center of map
  //   x:34-40, y:13-48  (7 wide, 36 tall)
  carve(34, 13, 7, 36, TILE_EMPTY);

  // ── MID DOORS (wall with gap, chokepoint) ─────────────────────────
  // Wall across mid at y:43-45, gap at x:36-38
  carve(34, 43, 7, 3, TILE_WALL);
  // Re-carve the door gap (mid doors opening)
  carve(36, 43, 3, 3, TILE_EMPTY);

  // ── CATWALK / SHORT A (top of Mid eastward to A Site) ─────────────
  // Short horizontal corridor from top of mid to A Site
  //   x:40-51, y:13-18  (12 wide, 6 tall)
  carve(40, 13, 12, 6, TILE_EMPTY);

  // ── CT RAMP (CT Spawn east to A Site) ─────────────────────────────
  // The direct CT route to A. Runs east from CT spawn.
  //   x:14-51, y:5-9  (38 wide, 5 tall)
  carve(14, 5, 38, 5, TILE_EMPTY);

  // ── CT MID (CT Spawn south to Mid) ────────────────────────────────
  // South from CT spawn, then turns east to reach top of mid
  // Vertical: x:10-14, y:9-18  (5 wide)
  carve(10, 9, 5, 10, TILE_EMPTY);
  // Horizontal to mid: x:14-35, y:17-21  (6 wide)
  carve(14, 17, 22, 5, TILE_EMPTY);

  // ── B TUNNELS (T Spawn east to B Site) ────────────────────────────
  // Real de_dust2: T exits right, goes through upper tunnels,
  // then B tunnels (narrow corridor) into B Site
  //
  // Upper tunnels (horizontal, wide): x:44-60, y:49-55
  carve(44, 49, 17, 7, TILE_EMPTY);
  // B tunnels corridor (vertical, going north then west to B Site):
  //   x:55-62, y:40-49  (8 wide, 10 tall)
  carve(55, 40, 8, 10, TILE_EMPTY);

  // ── CT → B CORRIDOR (via mid, then east) ──────────────────────────
  // CT goes south through mid area, then east to reach B site
  // Vertical: x:22-27, y:21-39  (6 wide, 19 tall)
  carve(22, 21, 6, 19, TILE_EMPTY);
  // Horizontal: x:27-62, y:37-42  (36 wide, 6 tall)
  carve(27, 37, 36, 6, TILE_EMPTY);

  // ════════════════════════════════════════════════════════════════════════
  //  STRUCTURAL WALLS (chokepoints & definition)
  // ════════════════════════════════════════════════════════════════════════

  // Wall at south edge of A Site (creates site platform boundary)
  // y:19, x:54-76  (leaves gap at x:50-53 for Long A approach entrance)
  carve(54, 19, 23, 1, TILE_WALL);

  // ════════════════════════════════════════════════════════════════════════
  //  CRATES / COVER
  // ════════════════════════════════════════════════════════════════════════

  // A Site cover (the iconic boxes on A platform)
  carve(55, 6, 3, 3, TILE_CRATE);     // A site boxes (west side)
  carve(62, 5, 3, 3, TILE_CRATE);     // A site center boxes
  carve(70, 7, 3, 4, TILE_CRATE);     // A site east boxes (ninja)
  carve(57, 13, 4, 2, TILE_CRATE);    // A site SW boxes
  carve(65, 12, 2, 3, TILE_CRATE);    // A site south boxes
  carve(73, 13, 2, 2, TILE_CRATE);    // A site far corner

  // B Site cover
  carve(66, 43, 3, 3, TILE_CRATE);    // B site NW boxes
  carve(72, 44, 3, 3, TILE_CRATE);    // B site NE boxes
  carve(66, 51, 4, 2, TILE_CRATE);    // B site SW (back site)
  carve(73, 51, 2, 2, TILE_CRATE);    // B site SE corner

  // Long A car position (cover near A entrance)
  carve(46, 23, 2, 3, TILE_CRATE);

  // Long A pit cover
  carve(16, 29, 2, 2, TILE_CRATE);

  // Mid corridor cover
  carve(36, 20, 2, 2, TILE_CRATE);    // Top of mid box
  carve(38, 33, 2, 2, TILE_CRATE);    // Mid lower box

  // Catwalk cover
  carve(44, 15, 2, 2, TILE_CRATE);    // Short A box

  // CT spawn cover
  carve(6, 5, 2, 2, TILE_CRATE);

  // B tunnels cover
  carve(52, 51, 2, 2, TILE_CRATE);

  // ════════════════════════════════════════════════════════════════════════
  //  VALIDATE
  // ════════════════════════════════════════════════════════════════════════

  if (!validateMap(map)) {
    console.warn('[map.js] Warning: de_dust2 hardcoded map validation failed!');
  } else {
    console.log('[map.js] de_dust2 map validated successfully');
  }

  return map;
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
