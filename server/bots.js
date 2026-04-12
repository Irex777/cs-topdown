// CS Top-Down Bot AI System
const C = require('../shared/constants');
const { isWall, lineOfSight } = require('../shared/map');

const BOT_PREFIX = '[BOT] ';
const BOT_NAMES_T = ['Boris', 'Viktor', 'Dmitri', 'Alexei', 'Nikolai', 'Ivan', 'Sergei', 'Mikhail'];
const BOT_NAMES_CT = ['Smith', 'Johnson', 'Davis', 'Wilson', 'Miller', 'Anderson', 'Taylor', 'Moore'];

let botIdCounter = 0;
function nextBotId() { return 'bot_' + (++botIdCounter); }

function createBot(team, skillLevel = 0.5) {
  const names = team === 'T' ? BOT_NAMES_T : BOT_NAMES_CT;
  const name = BOT_PREFIX + names[Math.floor(Math.random() * names.length)];
  const id = nextBotId();
  return {
    id,
    name,
    team,
    isBot: true,
    skill: skillLevel, // 0-1 affects accuracy, reaction time, decision quality
    // AI state
    aiState: 'idle',      // idle, roaming, chasing, attacking, retreating, planting, defusing
    aiTarget: null,        // target player id
    aiWaypoint: null,      // {x, y} next movement target
    aiLastSeen: null,      // {x, y, time} last known enemy position
    aiStateTimer: 0,
    aiReactionTimer: 0.5 + Math.random() * 1.0,    // initial reaction delay 0.5-1.5s
    aiBurstCount: 0,       // shots fired in current burst
    aiSearchPoint: null,   // where to search for enemies
    // Player fields (same as real player)
    x: 0, y: 0,
    vx: 0, vy: 0,
    angle: 0,
    hp: C.PLAYER_MAX_HP,
    armor: 0,
    helmet: false,
    money: C.START_MONEY,
    alive: true,
    weapons: [],
    currentWeapon: -1,
    ammo: {},
    grenades: { he: 0, flash: 0, smoke: 0 },
    hasDefuseKit: false,
    kills: 0,
    deaths: 0,
    assists: 0,
    lastDamageBy: null,
    input: { up: false, down: false, left: false, right: false, shoot: false, reload: false },
    lastShot: 0,
    reloading: false,
    reloadTimer: 0,
    sprinting: false,
    connected: true,
    ping: 0,
  };
}

// ==================== BOT AI UPDATE ====================
function updateBot(bot, dt, players, gameMap, gameState, bombState, bombsites) {
  if (!bot.alive || bot.team === C.TEAM_SPEC) return;

  bot.aiStateTimer -= dt;
  bot.aiReactionTimer -= dt;

  // Reset input each frame
  bot.input.up = false;
  bot.input.down = false;
  bot.input.left = false;
  bot.input.right = false;
  bot.input.shoot = false;

  // Find nearest visible enemy
  const enemy = findNearestEnemy(bot, players, gameMap);
  
  // Always know where enemies roughly are (radar awareness)
  const nearestEnemyPos = findNearestEnemyPosition(bot, players);
  
  if (enemy && bot.aiReactionTimer <= 0) {
    // Can see an enemy
    bot.aiLastSeen = { x: enemy.x, y: enemy.y, time: Date.now() / 1000 };
    bot.aiTarget = enemy.id;

    const dist = distance(bot, enemy);
    const angleToEnemy = Math.atan2(enemy.y - bot.y, enemy.x - bot.x);
    
    // Aim at enemy with skill-based inaccuracy
    const aimError = (1 - bot.skill) * 0.3;
    bot.angle = angleToEnemy + (Math.random() - 0.5) * aimError;

    if (dist < 600) {
      // Close range - engage
      bot.aiState = 'attacking';
      handleCombat(bot, enemy, dist, dt);
    } else if (dist < 1000) {
      // Medium range - move closer while shooting
      bot.aiState = 'attacking';
      moveToward(bot, enemy.x, enemy.y, dt);
      handleCombat(bot, enemy, dist, dt);
    } else {
      // Far - chase
      bot.aiState = 'chasing';
      moveToward(bot, enemy.x, enemy.y, dt);
    }
  } else if (bot.aiLastSeen && Date.now() / 1000 - bot.aiLastSeen.time < 5) {
    // Lost sight but know where they were - go there
    bot.aiState = 'chasing';
    moveToward(bot, bot.aiLastSeen.x, bot.aiLastSeen.y, dt);
    
    // Clear if we reached the spot
    if (distance(bot, bot.aiLastSeen) < 50) {
      bot.aiLastSeen = null;
    }
  } else {
    // No enemy visible - patrol/roam
    bot.aiState = 'roaming';
    
    // Handle special objectives
    if (bot.team === 'T' && gameState === 'playing' && bombState && !bombState.planted) {
      // T bot: go to a bombsite
      if (!bot.aiSearchPoint || distance(bot, bot.aiSearchPoint) < 80) {
        const site = bombsites[Math.floor(Math.random() * bombsites.length)];
        bot.aiSearchPoint = { x: site.x * C.TILE_SIZE + C.TILE_SIZE / 2, y: site.y * C.TILE_SIZE + C.TILE_SIZE / 2 };
      }
      moveToward(bot, bot.aiSearchPoint.x, bot.aiSearchPoint.y, dt);
    } else if (bot.team === 'CT' && gameState === 'playing' && bombState && bombState.planted) {
      // CT bot: go to bomb to defuse
      moveToward(bot, bombState.x, bombState.y, dt);
      if (distance(bot, bombState) < 40) {
        // Return defuse signal
        bot.aiState = 'defusing';
      }
    } else {
      // Roam: prefer moving toward known enemy positions
      if (!bot.aiWaypoint || distance(bot, bot.aiWaypoint) < 80) {
        if (nearestEnemyPos && Math.random() < 0.7) {
          // Move toward nearest enemy (rough direction)
          bot.aiWaypoint = {
            x: nearestEnemyPos.x + (Math.random() - 0.5) * 400,
            y: nearestEnemyPos.y + (Math.random() - 0.5) * 400,
          };
        } else if (Math.random() < 0.5) {
          // Go toward map center
          const mapCenterX = gameMap[0].length * C.TILE_SIZE / 2;
          const mapCenterY = gameMap.length * C.TILE_SIZE / 2;
          bot.aiWaypoint = {
            x: mapCenterX + (Math.random() - 0.5) * 600,
            y: mapCenterY + (Math.random() - 0.5) * 600,
          };
        } else {
          bot.aiWaypoint = randomMapPoint(gameMap);
        }
      }
      moveToward(bot, bot.aiWaypoint.x, bot.aiWaypoint.y, dt);
    }
  }

  // Auto reload when mag is low
  const wep = getCurrentWeapon(bot);
  if (wep && bot.ammo[wep.key] && bot.ammo[wep.key].mag <= Math.ceil(wep.data.magSize * 0.2) && !bot.reloading) {
    bot.input.reload = true;
  }
}

function handleCombat(bot, enemy, dist, dt) {
  const wep = getCurrentWeapon(bot);
  if (!wep) return;

  // Skill-based reaction delay
  if (bot.aiReactionTimer > 0) return;

  // Shoot if facing enemy (with skill tolerance)
  const angleToEnemy = Math.atan2(enemy.y - bot.y, enemy.x - bot.x);
  const angleDiff = Math.abs(normalizeAngle(bot.angle - angleToEnemy));

  if (angleDiff < 0.3 + bot.skill * 0.2) {
    // Burst fire logic based on skill
    bot.aiBurstCount++;
    const maxBurst = Math.floor(3 + bot.skill * 8);
    
    if (bot.aiBurstCount <= maxBurst) {
      bot.input.shoot = true;
    } else if (bot.aiBurstCount > maxBurst + Math.floor((1 - bot.skill) * 5)) {
      bot.aiBurstCount = 0;
    }
  }

  // Strafe during combat (higher skill = more strafing)
  if (Math.random() < 0.02 + bot.skill * 0.03) {
    const strafeAngle = angleToEnemy + Math.PI / 2 * (Math.random() > 0.5 ? 1 : -1);
    bot.input.up = true; // dummy, movement handled by strafe
    // Apply strafe via waypoint override
    const strafeDist = 100 + Math.random() * 100;
    bot.aiWaypoint = {
      x: bot.x + Math.cos(strafeAngle) * strafeDist,
      y: bot.y + Math.sin(strafeAngle) * strafeDist,
    };
  }
}

function findNearestEnemy(bot, players, gameMap) {
  let nearest = null;
  let nearestDist = Infinity;
  
  for (const p of Object.values(players)) {
    if (!p.alive || p.team === bot.team || p.team === C.TEAM_SPEC) continue;
    const dist = distance(bot, p);
    if (dist < 1800 && dist < nearestDist) { // bots have good awareness
      if (lineOfSight(gameMap, bot.x, bot.y, p.x, p.y)) {
        nearest = p;
        nearestDist = dist;
      }
    }
  }
  return nearest;
}

function findNearestEnemyPosition(bot, players) {
  let nearest = null;
  let nearestDist = Infinity;
  for (const p of Object.values(players)) {
    if (!p.alive || p.team === bot.team || p.team === C.TEAM_SPEC) continue;
    const dist = distance(bot, p);
    if (dist < nearestDist) {
      nearest = p;
      nearestDist = dist;
    }
  }
  return nearest;
}

function moveToward(bot, tx, ty, dt) {
  const dx = tx - bot.x;
  const dy = ty - bot.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 5) return;

  // Set angle toward target
  bot.angle = Math.atan2(dy, dx);

  // Wall avoidance - if stuck, try different angles
  if (bot._stuckCounter === undefined) bot._stuckCounter = 0;
  if (bot._lastX !== undefined) {
    const moved = Math.abs(bot.x - bot._lastX) + Math.abs(bot.y - bot._lastY);
    if (moved < 2) {
      bot._stuckCounter++;
    } else {
      bot._stuckCounter = 0;
    }
  }
  bot._lastX = bot.x;
  bot._lastY = bot.y;

  // If stuck for multiple frames, try perpendicular/alternate directions
  let moveAngle = Math.atan2(dy, dx);
  if (bot._stuckCounter > 5) {
    // Try 90 degree offsets to find a clear path
    const offsets = [Math.PI/2, -Math.PI/2, Math.PI/4, -Math.PI/4, Math.PI*3/4, -Math.PI*3/4];
    const offset = offsets[bot._stuckCounter % offsets.length];
    moveAngle = moveAngle + offset;
    bot.angle = moveAngle; // also face the new direction
    if (bot._stuckCounter > 30) bot._stuckCounter = 0; // reset cycle
  }

  const mx = Math.cos(moveAngle);
  const my = Math.sin(moveAngle);
  
  // Set movement input based on angle
  if (Math.abs(mx) > 0.3) {
    if (mx > 0) bot.input.right = true;
    else bot.input.left = true;
  }
  if (Math.abs(my) > 0.3) {
    if (my > 0) bot.input.down = true;
    else bot.input.up = true;
  }
}

function randomMapPoint(gameMap) {
  const H = gameMap.length;
  const W = gameMap[0].length;
  for (let attempts = 0; attempts < 20; attempts++) {
    const x = (5 + Math.random() * (W - 10)) * C.TILE_SIZE;
    const y = (5 + Math.random() * (H - 10)) * C.TILE_SIZE;
    if (!isWall(gameMap, x, y)) return { x, y };
  }
  return { x: W * C.TILE_SIZE / 2, y: H * C.TILE_SIZE / 2 };
}

// ==================== HELPERS ====================
function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function getCurrentWeapon(p) {
  if (p.currentWeapon < 0 || p.currentWeapon >= p.weapons.length) return null;
  const key = p.weapons[p.currentWeapon];
  const data = C.WEAPONS[key];
  return data ? { key, data } : null;
}

// ==================== BOT MANAGEMENT ====================
function spawnBotsForTeam(existingPlayers, team, count) {
  const bots = [];
  const teamPlayers = Object.values(existingPlayers).filter(p => p.team === team);
  const startIndex = teamPlayers.length;
  
  for (let i = 0; i < count; i++) {
    const skill = 0.3 + Math.random() * 0.4; // 0.3-0.7 skill range
    const bot = createBot(team, skill);
    bots.push(bot);
  }
  return bots;
}

function addBotBuyLogic(bot) {
  // Bots buy weapons during freeze time based on money
  if (bot.money >= 2700 && bot.team === 'T') return 'ak47';
  if (bot.money >= 3100 && bot.team === 'CT') return 'm4a4';
  if (bot.money >= 1800 && bot.team === 'T') return 'galil';
  if (bot.money >= 2050 && bot.team === 'CT') return 'famas';
  if (bot.money >= 1250 && bot.team === 'CT') return 'mp9';
  if (bot.money >= 1050 && bot.team === 'T') return 'mac10';
  if (bot.money >= 1000) return 'helmet';
  if (bot.money >= 650) return 'kevlar';
  return null;
}

module.exports = {
  createBot,
  updateBot,
  spawnBotsForTeam,
  addBotBuyLogic,
  getCurrentWeapon,
  BOT_PREFIX,
  nextBotId,
};
