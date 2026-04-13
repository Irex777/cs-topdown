// Simulate actual bot movement through the game loop
const C = require('./shared/constants');
const { generateMap, isWall } = require('./shared/map');
const { createBot, updateBot, spawnBotsForTeam, getCurrentWeapon, randomMapPoint } = require('./server/bots');
const { findPath } = require('./server/pathfinding');

const gameMap = generateMap();
const TS = C.TILE_SIZE;

// Create a bot at T spawn
const bot = createBot('T', 0.5);
bot.team = 'T';
bot.weapons = ['glock'];
bot.ammo = { glock: { mag: 20, reserve: 120 } };
bot.currentWeapon = 0;

// Spawn at T spawn center
bot.x = 10 * TS;
bot.y = 50 * TS;
bot.hp = 100;
bot.alive = true;

console.log('Bot starting at:', bot.x, bot.y, 'tile:', Math.floor(bot.x/TS), Math.floor(bot.y/TS));

// Target: bombsite A area
const targetX = 9 * TS;
const targetY = 10 * TS;

// First find a path to verify it exists
const path = findPath(gameMap, bot.x, bot.y, targetX, targetY);
console.log('Path waypoints:', path.length);
for (const wp of path) {
  console.log('  wp:', wp.x.toFixed(0), wp.y.toFixed(0), 'wall:', isWall(gameMap, wp.x, wp.y));
}

// Now simulate 300 game ticks
const players = { [bot.id]: bot };
const dt = 1/30;
let lastPos = { x: bot.x, y: bot.y };
let stuckCount = 0;

for (let tick = 0; tick < 300; tick++) {
  // Save pre-tick position
  const preX = bot.x, preY = bot.y;
  
  // Run bot AI
  updateBot(bot, dt, players, gameMap, 'playing', null, {});
  
  // Apply movement (same as server)
  let dx = 0, dy = 0;
  if (bot.input.up) dy -= 1;
  if (bot.input.down) dy += 1;
  if (bot.input.left) dx -= 1;
  if (bot.input.right) dx += 1;
  
  if (dx !== 0 || dy !== 0) {
    const len = Math.sqrt(dx*dx + dy*dy);
    dx /= len; dy /= len;
    const speed = C.PLAYER_SPEED;
    const newX = bot.x + dx * speed * dt;
    const newY = bot.y + dy * speed * dt;
    const r = C.PLAYER_RADIUS;
    
    if (!isWall(gameMap, newX - r, bot.y) && !isWall(gameMap, newX + r, bot.y)) {
      bot.x = newX;
    }
    if (!isWall(gameMap, bot.x, newY - r) && !isWall(gameMap, bot.x, newY + r)) {
      bot.y = newY;
    }
  }
  
  // Check if stuck
  const moveDist = Math.sqrt((bot.x - preX)**2 + (bot.y - preY)**2);
  if (moveDist < 0.1) stuckCount++;
  else stuckCount = 0;
  
  // Log every 30 ticks or when stuck
  if (tick % 30 === 0 || stuckCount > 10) {
    console.log(`Tick ${tick}: pos=(${bot.x.toFixed(0)}, ${bot.y.toFixed(0)}) tile=(${Math.floor(bot.x/TS)},${Math.floor(bot.y/TS)}) input=U:${bot.input.up} D:${bot.input.down} L:${bot.input.left} R:${bot.input.right} moved=${moveDist.toFixed(2)} aiState=${bot.aiState}`);
    if (bot._path) {
      console.log(`  path: idx=${bot._pathIdx}/${bot._path.length} waypoint=(${bot._path[bot._pathIdx]?.x?.toFixed(0)},${bot._path[bot._pathIdx]?.y?.toFixed(0)})`);
    }
    if (bot.aiSearchPoint) {
      console.log(`  searchPoint=(${bot.aiSearchPoint.x.toFixed(0)}, ${bot.aiSearchPoint.y.toFixed(0)})`);
    }
  }
  
  if (stuckCount > 30) {
    console.log(`\nBOT STUCK at (${bot.x.toFixed(0)}, ${bot.y.toFixed(0)}) for 30 ticks!`);
    // Check surrounding tiles
    const tx = Math.floor(bot.x / TS);
    const ty = Math.floor(bot.y / TS);
    console.log('Surrounding tiles:');
    for (let dy2 = -2; dy2 <= 2; dy2++) {
      let row = '';
      for (let dx2 = -2; dx2 <= 2; dx2++) {
        const nx = tx + dx2, ny = ty + dy2;
        if (nx < 0 || ny < 0 || ny >= C.MAP_HEIGHT || nx >= C.MAP_WIDTH) {
          row += '?';
        } else {
          const t = gameMap[ny][nx];
          const walkable = !isWall(gameMap, (nx+0.5)*TS, (ny+0.5)*TS);
          if (dx2 === 0 && dy2 === 0) row += 'B';
          else row += walkable ? '.' : '#';
        }
      }
      console.log(`  y=${ty+dy2}: ${row}`);
    }
    
    // Try to find a path from current position
    const newPath = findPath(gameMap, bot.x, bot.y, targetX, targetY);
    console.log('New path from stuck pos:', newPath.length, 'waypoints');
    if (newPath.length > 0) {
      console.log('First waypoint:', newPath[0].x.toFixed(0), newPath[0].y.toFixed(0));
      console.log('Can we move toward first wp?');
      const dx3 = newPath[0].x - bot.x;
      const dy3 = newPath[0].y - bot.y;
      const d = Math.sqrt(dx3*dx3 + dy3*dy3);
      const step = 5;
      const testX = bot.x + (dx3/d) * step;
      const testY = bot.y + (dy3/d) * step;
      console.log('Test move to:', testX.toFixed(0), testY.toFixed(0));
      const r = C.PLAYER_RADIUS;
      console.log('X- wall:', isWall(gameMap, testX-r, bot.y), 'X+ wall:', isWall(gameMap, testX+r, bot.y));
      console.log('Y- wall:', isWall(gameMap, bot.x, testY-r), 'Y+ wall:', isWall(gameMap, bot.x, testY+r));
    }
    break;
  }
}

console.log('\nFinal position:', bot.x.toFixed(0), bot.y.toFixed(0));
