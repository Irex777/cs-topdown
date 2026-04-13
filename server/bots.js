// CS Top-Down Bot AI System
const C = require('../shared/constants');
const { isWall, lineOfSight } = require('../shared/map');
const { getNextWaypoint } = require('./pathfinding');

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
    skill: skillLevel,
    // AI state
    aiState: 'idle',
    aiTarget: null,
    aiWaypoint: null,
    aiLastSeen: null,
    aiStateTimer: 0,
    aiReactionTimer: 0.5 + Math.random() * 1.0,
    aiBurstCount: 0,
    aiSearchPoint: null,
    // Pathfinding
    _path: null,
    _pathIdx: 0,
    _pathTarget: null,
    _repathTimer: 0,
    // Player fields
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
  bot._repathTimer -= dt;

  // Reset input each frame
  bot.input.up = false;
  bot.input.down = false;
  bot.input.left = false;
  bot.input.right = false;
  bot.input.shoot = false;

  // Find nearest visible enemy
  const enemy = findNearestEnemy(bot, players, gameMap);
  const nearestEnemyPos = findNearestEnemyPosition(bot, players);

  if (enemy && bot.aiReactionTimer <= 0) {
    // Can see an enemy
    bot.aiLastSeen = { x: enemy.x, y: enemy.y, time: Date.now() / 1000 };
    bot.aiTarget = enemy.id;
    // Invalidate path since we're engaging
    bot._path = null;

    const dist = distance(bot, enemy);
    const angleToEnemy = Math.atan2(enemy.y - bot.y, enemy.x - bot.x);

    // Aim at enemy with skill-based inaccuracy
    const aimError = (1 - bot.skill) * 0.3;
    bot.angle = angleToEnemy + (Math.random() - 0.5) * aimError;

    if (dist < 600) {
      bot.aiState = 'attacking';
      handleCombat(bot, enemy, dist, dt);
    } else if (dist < 1000) {
      bot.aiState = 'attacking';
      navigateTo(bot, enemy.x, enemy.y, gameMap, dt);
      handleCombat(bot, enemy, dist, dt);
    } else {
      bot.aiState = 'chasing';
      navigateTo(bot, enemy.x, enemy.y, gameMap, dt);
    }
  } else if (bot.aiLastSeen && Date.now() / 1000 - bot.aiLastSeen.time < 5) {
    bot.aiState = 'chasing';
    navigateTo(bot, bot.aiLastSeen.x, bot.aiLastSeen.y, gameMap, dt);
    if (distance(bot, bot.aiLastSeen) < 50) {
      bot.aiLastSeen = null;
      bot._path = null;
    }
  } else {
    // No enemy visible - patrol/roam toward objectives
    bot.aiState = 'roaming';

    if (bot.team === 'T' && gameState === 'playing' && bombState && !bombState.planted) {
      // T bot: go to a bombsite
      if (!bot.aiSearchPoint || distance(bot, bot.aiSearchPoint) < 80) {
        const siteKeys = Object.keys(bombsites || {});
        const siteKey = siteKeys[Math.floor(Math.random() * siteKeys.length)];
        const site = bombsites[siteKey];
        if (site) {
          bot.aiSearchPoint = { x: site.centerX || site.x, y: site.centerY || site.y };
        }
      }
      if (bot.aiSearchPoint) navigateTo(bot, bot.aiSearchPoint.x, bot.aiSearchPoint.y, gameMap, dt);
    } else if (bot.team === 'CT' && gameState === 'playing' && bombState && bombState.planted) {
      // CT bot: go to bomb to defuse
      navigateTo(bot, bombState.x, bombState.y, gameMap, dt);
      if (distance(bot, bombState) < 60 && !bombState.defuser) {
        bot.aiState = 'defusing';
        const defuseTime = bot.hasDefuseKit ? 2.5 : 5;
        bombState.defuser = bot.id;
        bombState.defuseTimer = defuseTime;
      }
    } else {
      // Roam toward enemies or map center
      if (!bot.aiWaypoint || distance(bot, bot.aiWaypoint) < 80) {
        if (nearestEnemyPos && Math.random() < 0.7) {
          bot.aiWaypoint = {
            x: nearestEnemyPos.x + (Math.random() - 0.5) * 400,
            y: nearestEnemyPos.y + (Math.random() - 0.5) * 400,
          };
        } else if (Math.random() < 0.5) {
          const mapCenterX = gameMap[0].length * C.TILE_SIZE / 2;
          const mapCenterY = gameMap.length * C.TILE_SIZE / 2;
          bot.aiWaypoint = {
            x: mapCenterX + (Math.random() - 0.5) * 600,
            y: mapCenterY + (Math.random() - 0.5) * 600,
          };
        } else {
          bot.aiWaypoint = randomMapPoint(gameMap);
        }
        // Invalidate path when new waypoint set
        bot._path = null;
      }
      navigateTo(bot, bot.aiWaypoint.x, bot.aiWaypoint.y, gameMap, dt);
    }
  }

  // Auto reload when mag is low
  const wep = getCurrentWeapon(bot);
  if (wep && bot.ammo[wep.key] && bot.ammo[wep.key].mag <= Math.ceil(wep.data.magSize * 0.2) && !bot.reloading) {
    bot.input.reload = true;
  }
}

// Navigate using A* pathfinding
function navigateTo(bot, tx, ty, gameMap, dt) {
  const targetKey = `${Math.round(tx)},${Math.round(ty)}`;

  // Repath periodically or when target changes significantly
  if (bot._repathTimer <= 0 || !bot._pathTarget || bot._pathTarget !== targetKey) {
    const result = getNextWaypoint(gameMap, bot.x, bot.y, tx, ty, null, 0);
    bot._path = result.path;
    bot._pathIdx = result.index;
    bot._pathTarget = targetKey;
    bot._repathTimer = 1.0; // Repath every second
  } else {
    const result = getNextWaypoint(gameMap, bot.x, bot.y, tx, ty, bot._path, bot._pathIdx);
    bot._path = result.path;
    bot._pathIdx = result.index;
  }

  // Get current waypoint to move toward
  if (bot._path && bot._pathIdx < bot._path.length) {
    const wp = bot._path[bot._pathIdx];
    setMovementToward(bot, wp.x, wp.y);
  } else {
    // Direct fallback
    setMovementToward(bot, tx, ty);
  }
}

// Set WASD input toward a point (separate from facing angle)
function setMovementToward(bot, tx, ty) {
  const dx = tx - bot.x;
  const dy = ty - bot.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 5) return;

  const moveAngle = Math.atan2(dy, dx);
  const mx = Math.cos(moveAngle);
  const my = Math.sin(moveAngle);

  if (Math.abs(mx) > 0.3) {
    if (mx > 0) bot.input.right = true;
    else bot.input.left = true;
  }
  if (Math.abs(my) > 0.3) {
    if (my > 0) bot.input.down = true;
    else bot.input.up = true;
  }
}

function handleCombat(bot, enemy, dist, dt) {
  const wep = getCurrentWeapon(bot);
  if (!wep) return;

  if (bot.aiReactionTimer > 0) return;

  const angleToEnemy = Math.atan2(enemy.y - bot.y, enemy.x - bot.x);
  const angleDiff = Math.abs(normalizeAngle(bot.angle - angleToEnemy));

  if (angleDiff < 0.3 + bot.skill * 0.2) {
    bot.aiBurstCount++;
    const maxBurst = Math.floor(3 + bot.skill * 8);

    if (bot.aiBurstCount <= maxBurst) {
      bot.input.shoot = true;
    } else if (bot.aiBurstCount > maxBurst + Math.floor((1 - bot.skill) * 5)) {
      bot.aiBurstCount = 0;
    }
  }

  // Strafe during combat
  if (Math.random() < 0.02 + bot.skill * 0.03) {
    const strafeAngle = angleToEnemy + Math.PI / 2 * (Math.random() > 0.5 ? 1 : -1);
    const strafeDist = 100 + Math.random() * 100;
    bot.aiWaypoint = {
      x: bot.x + Math.cos(strafeAngle) * strafeDist,
      y: bot.y + Math.sin(strafeAngle) * strafeDist,
    };
    bot._path = null; // Force repath
  }
}

function findNearestEnemy(bot, players, gameMap) {
  let nearest = null;
  let nearestDist = Infinity;

  for (const p of Object.values(players)) {
    if (!p.alive || p.team === bot.team || p.team === C.TEAM_SPEC) continue;
    const dist = distance(bot, p);
    if (dist < 1800 && dist < nearestDist) {
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

function randomMapPoint(gameMap) {
  const H = gameMap.length;
  const W = gameMap[0].length;
  for (let attempts = 0; attempts < 50; attempts++) {
    const x = (10 + Math.random() * (W - 20)) * C.TILE_SIZE;
    const y = (10 + Math.random() * (H - 20)) * C.TILE_SIZE;
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
  for (let i = 0; i < count; i++) {
    const skill = 0.3 + Math.random() * 0.4;
    const bot = createBot(team, skill);
    bots.push(bot);
  }
  return bots;
}

function addBotBuyLogic(bot) {
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
  randomMapPoint,
};
