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
//  Authentic de_dust2 layout based on CS:GO radar overview:
//
//    ┌──────────────────────────────────────────────────────────────────┐
//    │                                                                 │
//    │    CT Spawn (northwest)                                         │
//    │    x:28-42  y:2-10                                             │
//    │       │          \              CT→B corridor                  │
//    │    CT Mid         \───────────────────────┐                    │
//    │       │                                │                      │
//    │  ┌────┼──── Mid ────┐  Catwalk         │   B Site             │
//    │  │    │  x:28-42    │  (Short A)       │   x:56-76            │
//    │  │    │  y:14-36    │──→ A Site        │   y:28-48            │
//    │  │    │             │    x:3-27         │       ↑              │
//    │  │    │  Mid Doors  │    y:12-30        │   B Tunnels          │
//    │  │    │  (choke)    │                   │   x:58-63            │
//    │  │    └─────┬───────┘                   │   y:30-50            │
//    │  │          │                           │       │              │
//    │  │      T Ramp                         Upper B │              │
//    │  │      x:32-38                         x:48-62│              │
//    │  │      y:38-50                                │              │
//    │  │          │           T Spawn ───────────────┘              │
//    │  │          │        x:28-48  y:50-57                          │
//    │  │          │           │                                     │
//    │  │      Long A ←────────┘                                     │
//    │  │   (L-shape west then north)                                │
//    │  └──────────────────────────────────────────────────────────── │
//    └──────────────────────────────────────────────────────────────────┘
//
//  Key spatial relationships:
//    A Site = WEST (left),  B Site = EAST (right)
//    CT Spawn = NORTHWEST,  T Spawn = SOUTH CENTER
//    Long A: T→west→north→east into A (L-shape along west edge)
//    B Tunnels: T→east→north into B (L-shape along east edge)
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

  // ── CT Spawn (northwest, top-left area) ────────────────────────────────
  //   x:28-42, y:2-10  (15x9)
  carve(28, 2, 15, 9, TILE_CT_SPAWN);

  // ── T Spawn (south center) ─────────────────────────────────────────────
  //   x:28-48, y:50-57  (21x8)
  //   3 exits: LEFT (x:28) to Long A, UP (y:50) to T Ramp, RIGHT (x:48) to B Tunnels
  carve(28, 50, 21, 8, TILE_T_SPAWN);

  // ── A Site (west side of map) ──────────────────────────────────────────
  //   x:3-27, y:12-30  (25x19)
  //   Large bombsite on the WEST (left) side
  carve(3, 12, 25, 19, TILE_BOMBSITE_A);

  // ── B Site (east side of map) ──────────────────────────────────────────
  //   x:56-76, y:28-48  (21x21)
  //   Large bombsite on the EAST (right) side
  carve(56, 28, 21, 21, TILE_BOMBSITE_B);

  // ════════════════════════════════════════════════════════════════════════
  //  CORRIDORS & CONNECTORS
  // ════════════════════════════════════════════════════════════════════════

  // ── T RAMP (T Spawn north to Mid Doors) ────────────────────────────────
  //   x:32-38, y:38-50  (7x13)  – 6-tile wide vertical corridor
  carve(32, 38, 7, 13, TILE_EMPTY);

  // ── MID AREA (center, large north-south corridor) ──────────────────────
  //   x:28-42, y:14-36  (15x23)
  //   The central artery of the map
  carve(28, 14, 15, 23, TILE_EMPTY);

  // ── CT MID (connector from Mid top to CT Spawn) ────────────────────────
  //   x:30-40, y:10-14  (11x5)
  carve(30, 10, 11, 5, TILE_EMPTY);

  // ── CATWALK / SHORT A (from Mid going WEST into A Site) ────────────────
  //   x:25-32, y:24-30  (8x7)  – 6 tiles wide
  //   Connects Mid (x:28-32) to A Site (x:25-27)
  carve(25, 24, 8, 7, TILE_EMPTY);

  // ── LONG A CORRIDOR (L-shaped: west from T, north along west edge) ─────
  //
  // First leg – horizontal from T Spawn going WEST:
  //   x:8-28, y:50-55  (21x6) – along the bottom of the map
  carve(8, 50, 21, 6, TILE_EMPTY);

  // Second leg – going NORTH along the west edge (the iconic long sightline):
  //   x:8-14, y:10-55  (7x46) – 7 tiles wide, ~45 tiles long!
  carve(8, 10, 7, 46, TILE_EMPTY);

  // Third turn – going EAST into A Site entrance:
  //   x:14-28, y:12-16  (15x5)
  carve(14, 12, 15, 5, TILE_EMPTY);

  // Pit alcove (small side room off Long A):
  //   x:14-18, y:35-38  (5x4)
  carve(14, 35, 5, 4, TILE_EMPTY);

  // ── B TUNNELS (L-shaped: east from T, north into B Site) ───────────────
  //
  // First leg – horizontal from T Spawn going EAST (Upper Tunnels):
  //   x:48-62, y:50-55  (15x6)
  carve(48, 50, 15, 6, TILE_EMPTY);

  // Second leg – going NORTH into B Site:
  //   x:58-63, y:30-50  (6x21) – 6 tiles wide
  carve(58, 30, 6, 21, TILE_EMPTY);

  // ── CT → B CORRIDOR ────────────────────────────────────────────────────
  // Horizontal from CT Spawn area going EAST:
  //   x:42-56, y:8-14  (15x7)
  carve(42, 8, 15, 7, TILE_EMPTY);

  // Then turns SOUTH to reach B Site north entrance:
  //   x:52-56, y:14-28  (5x15)
  carve(52, 14, 5, 15, TILE_EMPTY);

  // ════════════════════════════════════════════════════════════════════════
  //  CHOKEPOINTS (walls with gaps)
  // ════════════════════════════════════════════════════════════════════════

  // ── MID DOORS (THE iconic chokepoint between T Ramp and Mid) ───────────
  //   Wall at y:36-38 from x:28 to x:38 with 3-tile gap at x:33-35
  carve(28, 36, 11, 3, TILE_WALL);   // full wall x:28-38, y:36-38
  carve(33, 36, 3, 3, TILE_EMPTY);   // gap x:33-35, y:36-38

  // ── LONG A DOORS (chokepoint on Long A first leg) ──────────────────────
  //   Wall at x:14-16, y:50-55 with narrow gap
  carve(14, 50, 3, 6, TILE_WALL);    // full wall x:14-16, y:50-55
  carve(15, 51, 1, 4, TILE_EMPTY);   // gap x:15, y:51-54 (narrow doorway)

  // ════════════════════════════════════════════════════════════════════════
  //  INTERNAL STRUCTURES (cover within corridors)
  // ════════════════════════════════════════════════════════════════════════

  // ── Mid cover structure ────────────────────────────────────────────────
  //   x:33-37, y:22-26 with gap at x:35, y:23-25
  carve(33, 22, 5, 5, TILE_WALL);    // x:33-37, y:22-26
  carve(35, 23, 1, 3, TILE_EMPTY);   // gap x:35, y:23-25

  // ════════════════════════════════════════════════════════════════════════
  //  CRATES / COVER
  // ════════════════════════════════════════════════════════════════════════

  // ── A Site cover (iconic box clusters on the platform) ─────────────────
  carve(8, 16, 3, 3, TILE_CRATE);    // NW boxes  x:8-10,  y:16-18
  carve(14, 22, 3, 3, TILE_CRATE);   // SW boxes  x:14-16, y:22-24
  carve(20, 15, 3, 3, TILE_CRATE);   // NE boxes  x:20-22, y:15-17

  // ── B Site cover ───────────────────────────────────────────────────────
  carve(62, 34, 3, 3, TILE_CRATE);   // west boxes   x:62-64, y:34-36
  carve(68, 38, 3, 3, TILE_CRATE);   // center boxes x:68-70, y:38-40
  carve(72, 30, 3, 3, TILE_CRATE);   // NE boxes     x:72-74, y:30-32

  // ── Long A "car" position (near A Site entrance) ──────────────────────
  carve(17, 13, 3, 2, TILE_CRATE);   // x:17-19, y:13-14

  // ── Long A pit cover ──────────────────────────────────────────────────
  carve(15, 36, 2, 2, TILE_CRATE);   // x:15-16, y:36-37

  // ── Mid corridor cover ────────────────────────────────────────────────
  carve(29, 16, 2, 2, TILE_CRATE);   // top of mid box
  carve(40, 32, 2, 2, TILE_CRATE);   // lower mid box

  // ── Catwalk / Short A cover ───────────────────────────────────────────
  carve(27, 26, 2, 2, TILE_CRATE);   // short A corner box

  // ── CT spawn cover ────────────────────────────────────────────────────
  carve(32, 4, 2, 2, TILE_CRATE);    // CT spawn box

  // ── B tunnels cover ───────────────────────────────────────────────────
  carve(59, 40, 2, 2, TILE_CRATE);   // tunnels box

  // ── CT→B corridor cover ───────────────────────────────────────────────
  carve(48, 10, 2, 2, TILE_CRATE);   // corridor box

  // ════════════════════════════════════════════════════════════════════════
  //  VALIDATE
  // ════════════════════════════════════════════════════════════════════════

  if (!validateMap(map)) {
    console.warn('[map.js] Warning: de_dust2 map validation failed!');
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
