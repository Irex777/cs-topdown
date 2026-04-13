// Map generator - creates a Dust2-inspired tactical map
const C = require('../shared/constants');

const TILE_EMPTY = 0;
const TILE_WALL = 1;
const TILE_CRATE = 2;     // destructible
const TILE_BOMBSITE_A = 3;
const TILE_BOMBSITE_B = 4;
const TILE_T_SPAWN = 5;
const TILE_CT_SPAWN = 6;
const TILE_DOOR = 7;

function generateMap() {
  const W = C.MAP_WIDTH;
  const H = C.MAP_HEIGHT;
  const map = [];

  // Fill with empty
  for (let y = 0; y < H; y++) {
    map[y] = [];
    for (let x = 0; x < W; x++) {
      map[y][x] = TILE_EMPTY;
    }
  }

  // Border walls
  for (let x = 0; x < W; x++) { map[0][x] = TILE_WALL; map[H-1][x] = TILE_WALL; }
  for (let y = 0; y < H; y++) { map[y][0] = TILE_WALL; map[y][W-1] = TILE_WALL; }

  // === T SPAWN AREA (bottom-left) ===
  // Walls around T spawn
  buildRect(map, 2, 45, 18, 3, TILE_WALL);   // top wall of T spawn
  buildRect(map, 18, 45, 2, 13, TILE_WALL);   // right wall of T spawn
  buildRect(map, 2, 55, 18, 2, TILE_WALL);    // bottom wall
  // T spawn opening
  map[46][18] = TILE_EMPTY;
  map[47][18] = TILE_EMPTY;
  map[48][18] = TILE_EMPTY;
  // T spawn markers
  for (let y = 47; y <= 53; y++) {
    for (let x = 5; x <= 15; x++) {
      map[y][x] = TILE_T_SPAWN;
    }
  }

  // === CT SPAWN AREA (top-right) ===
  buildRect(map, 60, 2, 18, 3, TILE_WALL);    // top wall
  buildRect(map, 58, 2, 2, 13, TILE_WALL);     // left wall
  buildRect(map, 60, 12, 18, 2, TILE_WALL);    // bottom wall
  // CT spawn opening
  map[3][58] = TILE_EMPTY;
  map[4][58] = TILE_EMPTY;
  map[5][58] = TILE_EMPTY;
  // CT spawn markers
  for (let y = 4; y <= 10; y++) {
    for (let x = 62; x <= 75; x++) {
      map[y][x] = TILE_CT_SPAWN;
    }
  }

  // === MID AREA ===
  // Central corridor walls
  buildRect(map, 25, 25, 2, 25, TILE_WALL);    // left mid wall
  buildRect(map, 35, 20, 2, 30, TILE_WALL);    // right mid wall
  // Doors/openings in mid
  map[30][25] = TILE_DOOR;
  map[31][25] = TILE_DOOR;
  map[35][35] = TILE_DOOR;
  map[36][35] = TILE_DOOR;

  // Mid crates for cover
  map[28][28] = TILE_CRATE;
  map[28][29] = TILE_CRATE;
  map[33][31] = TILE_CRATE;
  map[33][32] = TILE_CRATE;
  map[38][27] = TILE_CRATE;
  map[38][28] = TILE_CRATE;

  // === BOMBSITE A (top-left area) ===
  buildRect(map, 15, 2, 2, 18, TILE_WALL);     // right wall of A
  buildRect(map, 2, 18, 15, 2, TILE_WALL);      // bottom wall of A
  // Opening to A from mid
  map[18][15] = TILE_EMPTY;
  map[18][16] = TILE_EMPTY;
  // A site boxes
  buildRect(map, 6, 6, 4, 3, TILE_CRATE);
  buildRect(map, 11, 10, 3, 3, TILE_CRATE);
  // A ramp/corridor
  buildRect(map, 2, 2, 4, 2, TILE_WALL);
  // Bombsite A markers
  for (let y = 5; y <= 15; y++) {
    for (let x = 4; x <= 13; x++) {
      if (map[y][x] === TILE_EMPTY) map[y][x] = TILE_BOMBSITE_A;
    }
  }

  // === BOMBSITE B (bottom-right area) ===
  buildRect(map, 45, 40, 2, 18, TILE_WALL);     // left wall of B
  buildRect(map, 45, 38, 30, 2, TILE_WALL);     // top wall of B
  // Opening to B
  map[42][45] = TILE_EMPTY;
  map[43][45] = TILE_EMPTY;
  map[38][55] = TILE_EMPTY;
  map[38][56] = TILE_EMPTY;
  // B site boxes
  buildRect(map, 55, 45, 4, 3, TILE_CRATE);
  buildRect(map, 65, 50, 3, 4, TILE_CRATE);
  buildRect(map, 50, 52, 3, 3, TILE_CRATE);
  // Bombsite B markers
  for (let y = 42; y <= 55; y++) {
    for (let x = 48; x <= 75; x++) {
      if (map[y][x] === TILE_EMPTY) map[y][x] = TILE_BOMBSITE_B;
    }
  }

  // === CORRIDORS & CONNECTORS ===
  // Long A corridor (from mid-top to A)
  buildRect(map, 15, 15, 10, 2, TILE_WALL);
  buildRect(map, 15, 20, 10, 2, TILE_WALL);
  // Catwalk to A
  buildRect(map, 22, 15, 2, 5, TILE_WALL);

  // B tunnels (from T spawn area to B site)
  buildRect(map, 20, 45, 25, 2, TILE_WALL);
  buildRect(map, 20, 42, 25, 2, TILE_WALL);
  // Opening from tunnels to B
  map[43][40] = TILE_EMPTY;
  map[44][40] = TILE_EMPTY;
  // Open corridor between tunnel walls so y=43-45 area is reachable
  // B tunnel upper wall is y=42-43, lower wall is y=45-46. Punch through BOTH rows.
  map[42][28] = TILE_EMPTY;
  map[43][28] = TILE_EMPTY;
  map[44][28] = TILE_EMPTY;
  map[45][28] = TILE_EMPTY;
  map[46][28] = TILE_EMPTY;
  map[44][27] = TILE_EMPTY;
  map[44][29] = TILE_EMPTY;
  map[44][30] = TILE_EMPTY;

  // Connector from mid to B (through upper corridor)
  buildRect(map, 35, 35, 10, 2, TILE_WALL);
  buildRect(map, 35, 38, 10, 2, TILE_WALL);
  map[36][40] = TILE_EMPTY;
  map[37][40] = TILE_EMPTY;
  // Punch through connector bottom wall (y=38-39, both rows) to reach corridor below
  map[38][37] = TILE_EMPTY;
  map[39][37] = TILE_EMPTY;
  map[38][38] = TILE_EMPTY;
  map[39][38] = TILE_EMPTY;
  map[38][39] = TILE_EMPTY;
  map[39][39] = TILE_EMPTY;
  map[38][40] = TILE_EMPTY;
  map[39][40] = TILE_EMPTY;
  map[38][41] = TILE_EMPTY;
  map[39][41] = TILE_EMPTY;
  map[38][42] = TILE_EMPTY;
  map[39][42] = TILE_EMPTY;

  // === ADDITIONAL COVER ===
  // More crates scattered around for tactical cover
  map[25][22] = TILE_CRATE;
  map[30][22] = TILE_CRATE;
  map[22][30] = TILE_CRATE;
  map[40][20] = TILE_CRATE;
  map[42][35] = TILE_CRATE;
  map[25][40] = TILE_CRATE;
  map[28][42] = TILE_CRATE;
  map[35][50] = TILE_CRATE;
  map[38][48] = TILE_CRATE;

  // Upper mid windows/doors
  map[25][30] = TILE_DOOR;
  map[26][30] = TILE_DOOR;

  // Lower corridor from T to B
  buildRect(map, 18, 50, 2, 6, TILE_WALL);
  map[52][18] = TILE_EMPTY;

  return map;
}

function buildRect(map, x, y, w, h, tile) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (y + dy < C.MAP_HEIGHT && x + dx < C.MAP_WIDTH) {
        map[y + dy][x + dx] = tile;
      }
    }
  }
}

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
  return t === TILE_WALL || t === TILE_CRATE || t === TILE_DOOR;
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

module.exports = { generateMap, getSpawnPoints, getBombsites, isWall, isOnBombsite, lineOfSight,
  TILE_EMPTY, TILE_WALL, TILE_CRATE, TILE_BOMBSITE_A, TILE_BOMBSITE_B, TILE_T_SPAWN, TILE_CT_SPAWN, TILE_DOOR };
