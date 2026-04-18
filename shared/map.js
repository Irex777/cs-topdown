// Hardcoded de_dust2 map layout
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

// ── de_dust2 hardcoded map ──────────────────────────────────────────────
//
//  80x60 tiles.  Orientation: North = top of screen.
//
//    ┌──────────────────────────────────────────────────────────────────┐
//    │  CT Spawn     │  CT→A corridor          │      A Site           │
//    │  (top-left)   │                         │  (top-right)          │
//    │               │  CT Mid  ──── Catwalk ──│                       │
//    ├───────────────┤         │               │                       │
//    │               │   Mid   │               │                       │
//    │  Long A       │  Corr.  │               │                       │
//    │  (vertical)   │         │               │                       │
//    │               │         ├───────────────│──────────┐            │
//    │               │         │               │ CT→B     │ B Site     │
//    │               │         │               │ corridor │(bot-right) │
//    ├───────────────┴──── T Spawn ────────────┤          │            │
//    │  Long A horiz ←  (bottom-center)  → B Tunnels     │            │
//    └──────────────────────────────────────────────────────────────────┘
//
//  Routes:
//    T → Long A doors → Long A → A approach → A Site
//    T → Mid → Catwalk → A Site (Short A)
//    T → Upper Tunnels → B Tunnels → B Site
//    CT → A Main → A Site
//    CT → CT Mid → Mid → Catwalk → A Site
//    CT → B Doors → B Site

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
  //  ROOMS / KEY AREAS
  // ════════════════════════════════════════════════════════════════════════

  // CT Spawn – top-left
  //   x:3-15  y:3-12
  carve(3, 3, 13, 10, TILE_CT_SPAWN);

  // T Spawn – bottom-center
  //   x:30-47  y:48-56
  carve(30, 48, 18, 9, TILE_T_SPAWN);

  // A Site – top-right (elevated bombsite)
  //   x:54-75  y:3-18
  carve(54, 3, 22, 16, TILE_BOMBSITE_A);

  // B Site – bottom-right
  //   x:62-76  y:42-55
  carve(62, 42, 15, 14, TILE_BOMBSITE_B);

  // ════════════════════════════════════════════════════════════════════════
  //  CORRIDORS
  // ════════════════════════════════════════════════════════════════════════

  // ── Long A ──────────────────────────────────────────────────────────
  //  T Spawn left exit → Long A doors → Long A yard → A approach → A Site
  //
  // Horizontal part: T Spawn left to Long A doors area
  //   x:7-30  y:50-54  (overlaps T Spawn at x:30)
  carve(7, 50, 24, 5, TILE_EMPTY);

  // Vertical part: Long A doors northward (the "long" corridor)
  //   x:7-11  y:17-50
  carve(7, 17, 5, 34, TILE_EMPTY);

  // Approach: turns east toward A Site
  //   x:10-55  y:14-18
  carve(10, 14, 46, 5, TILE_EMPTY);

  // ── Mid Corridor ────────────────────────────────────────────────────
  // T Spawn top exit → Mid → Top of Mid
  //   x:36-41  y:14-47  (overlaps T Spawn at y:48 via adjacency)
  carve(36, 14, 6, 34, TILE_EMPTY);

  // ── Short A / Catwalk ──────────────────────────────────────────────
  // Top of Mid east to A Site
  //   x:40-55  y:11-16  (overlaps Mid at x:40-41, y:14-16; overlaps A Site at x:54-55)
  carve(40, 11, 16, 6, TILE_EMPTY);

  // ── B Tunnels ──────────────────────────────────────────────────────
  // T Spawn right exit → B Site
  //   x:47-63  y:49-54  (overlaps T Spawn at x:47; overlaps B Site at x:62-63)
  carve(47, 49, 17, 6, TILE_EMPTY);

  // ── CT Mid ─────────────────────────────────────────────────────────
  // CT Spawn south, then east to top of Mid
  // Vertical:   x:10-14  y:10-25  (overlaps CT Spawn at x:10-14, y:10-12)
  carve(10, 10, 5, 16, TILE_EMPTY);
  // Horizontal: x:14-37  y:23-27  (overlaps Mid at x:36-37)
  carve(14, 23, 24, 5, TILE_EMPTY);

  // ── CT → A Site (A Main) ──────────────────────────────────────────
  // Direct route from CT Spawn east to A Site
  //   x:14-55  y:5-9  (overlaps CT Spawn at x:14-15; overlaps A Site at x:54-55)
  carve(14, 5, 42, 5, TILE_EMPTY);

  // ── CT → B (B Doors route) ────────────────────────────────────────
  // CT Spawn south, then east to B Site
  // Vertical:   x:14-18  y:10-42  (overlaps CT Spawn at x:14-15, y:10-12)
  carve(14, 10, 5, 33, TILE_EMPTY);
  // Horizontal: x:16-63  y:40-44  (overlaps B Site at x:62-63, y:42-44)
  carve(16, 40, 48, 5, TILE_EMPTY);

  // ════════════════════════════════════════════════════════════════════════
  //  STRUCTURAL WALLS (add chokepoints without blocking any corridor)
  // ════════════════════════════════════════════════════════════════════════

  // Wall separating Long A yard from upper area (partial – leaves gaps)
  //   y:19, x:12-33  (below Long A approach which ends at y:18)
  carve(12, 19, 22, 1, TILE_WALL);

  // Wall edge along Long A (creates narrow pit feel)
  //   y:15-17, x:12  (leaves gap at y:14 and y:18 for approach corridor)
  //   Skipped – would risk blocking the Long A approach

  // Partial wall below A Site (leaves gap at x:64-75 for approach)
  //   y:19, x:54-63
  carve(54, 19, 10, 1, TILE_WALL);

  // Wall between Mid and B Tunnels (mid doors feel)
  //   x:34-35, y:30-38
  carve(34, 30, 2, 9, TILE_WALL);
  // Re-carve a door opening at y:33-34
  carve(34, 33, 2, 2, TILE_EMPTY);

  // ════════════════════════════════════════════════════════════════════════
  //  CRATES / COVER
  // ════════════════════════════════════════════════════════════════════════

  // A Site crates (cover on the bombsite)
  carve(58, 6, 3, 3, TILE_CRATE);    // near A Site NW corner
  carve(65, 5, 3, 3, TILE_CRATE);    // near A Site NE area
  carve(58, 13, 4, 2, TILE_CRATE);   // near A Site SW area
  carve(71, 9, 2, 4, TILE_CRATE);    // near A Site east side

  // B Site crates (cover on the bombsite)
  carve(66, 45, 3, 3, TILE_CRATE);   // B Site NW
  carve(72, 46, 3, 3, TILE_CRATE);   // B Site NE
  carve(66, 51, 3, 2, TILE_CRATE);   // B Site SW

  // Mid corridor crates (cover)
  carve(37, 25, 2, 2, TILE_CRATE);   // mid lower
  carve(39, 35, 2, 2, TILE_CRATE);   // mid upper

  // Long A pit crate
  carve(9, 45, 2, 2, TILE_CRATE);    // pit cover

  // CT spawn area crate (cover)
  carve(6, 7, 2, 2, TILE_CRATE);

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
