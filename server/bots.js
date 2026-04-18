// CS Top-Down Bot AI System
const C = require('../shared/constants');
const { isWall, isOnBombsite, lineOfSight } = require('../shared/map');
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
    aiBurstPauseTimer: 0,
    aiSearchPoint: null,
    aiGrenadeCooldown: 0,
    aiHoldSite: null,
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
    input: { up: false, down: false, left: false, right: false, shoot: false, reload: false, sprint: false, use: false },
    lastShot: 0,
    shotsFired: 0,
    lastShotTime: 0,
    prevShoot: false,
    reloading: false,
    reloadTimer: 0,
    sprinting: false,
    crouching: false,
    crouchTransition: 0,
    plantingBomb: false,
    plantProgress: 0,
    defusingBomb: false,
    defuseProgress: 0,
    footstepTimer: 0,
    connected: true,
    ping: 0,
    specTarget: null,
    specX: 0,
    specY: 0,
  };
}

// ==================== BOT AI UPDATE ====================
function updateBot(bot, dt, players, gameMap, gameState, bombState, bombsites, smokeGrenades) {
  if (!bot.alive || bot.team === C.TEAM_SPEC) return;

  bot.aiStateTimer -= dt;
  bot.aiReactionTimer -= dt;
  bot._repathTimer -= dt;
  bot.aiGrenadeCooldown = Math.max(0, (bot.aiGrenadeCooldown || 0) - dt);
  bot.aiBurstPauseTimer = Math.max(0, (bot.aiBurstPauseTimer || 0) - dt);

  // Initialize strafe direction if not set
  if (!bot._strafeDir) bot._strafeDir = Math.random() > 0.5 ? 1 : -1;
  if (!bot._strafeTimer) bot._strafeTimer = 0;

  // Reset input each frame
  bot.input.up = false;
  bot.input.down = false;
  bot.input.left = false;
  bot.input.right = false;
  bot.input.shoot = false;
  bot.input.use = false;
  bot.input.sprint = false;
  bot.input.crouch = false;

  // Stuck detection - if position hasn't changed, increment stuck counter
  if (!bot._lastPos) bot._lastPos = { x: bot.x, y: bot.y, stuck: 0 };
  const moved = Math.abs(bot.x - bot._lastPos.x) + Math.abs(bot.y - bot._lastPos.y);
  if (moved < 1) {
    bot._lastPos.stuck++;
  } else {
    bot._lastPos.stuck = 0;
    bot._lastPos.x = bot.x;
    bot._lastPos.y = bot.y;
  }

  // If stuck for too long, pick a completely new random target away from current position
  if (bot._lastPos.stuck > 30) { // 30 ticks = ~0.5s — faster recovery
    bot._path = null;
    bot._pathIdx = 0;
    bot.aiSearchPoint = null;
    bot.aiWaypoint = null;
    bot.aiHoldSite = null;
    bot._lastPos.stuck = 0;
    // Pick a new random target far from current position
    const angle = Math.random() * Math.PI * 2;
    const dist = 200 + Math.random() * 400;
    const mapW = gameMap[0].length * C.TILE_SIZE;
    const mapH = gameMap.length * C.TILE_SIZE;
    bot.aiWaypoint = {
      x: Math.max(C.TILE_SIZE * 3, Math.min(mapW - C.TILE_SIZE * 3, bot.x + Math.cos(angle) * dist)),
      y: Math.max(C.TILE_SIZE * 3, Math.min(mapH - C.TILE_SIZE * 3, bot.y + Math.sin(angle) * dist)),
    };
  }

  // Auto-switch from knife-only / empty weapon to something that shoots
  pickBestWeapon(bot);

  // Find nearest visible enemy
  const enemy = findNearestEnemy(bot, players, gameMap, smokeGrenades);
  const nearestEnemyPos = findNearestEnemyPosition(bot, players);

  // Reset burst count when losing sight of enemy
  if (!enemy && bot.aiBurstCount > 0) bot.aiBurstCount = 0;

  // Retreat when low HP (< 30) — move away from nearest enemy toward spawn
  if (bot.hp < 30 && bot.hp > 0 && nearestEnemyPos) {
    bot.aiState = 'retreating';
    const dx = bot.x - nearestEnemyPos.x;
    const dy = bot.y - nearestEnemyPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 1) {
      const fleeX = bot.x + (dx / dist) * 300;
      const fleeY = bot.y + (dy / dist) * 300;
      setMovementToward(bot, fleeX, fleeY);
      bot.input.sprint = true;
    }
    // Still aim at enemy while retreating
    const angleToEnemy = Math.atan2(nearestEnemyPos.y - bot.y, nearestEnemyPos.x - bot.x);
    const aimError = (1 - bot.skill) * 0.2;
    bot.angle = angleToEnemy + (Math.random() - 0.5) * aimError;
    // Shoot if we have line of sight (panic fire)
    if (enemy && dist < 500) {
      handleCombat(bot, enemy, distance(bot, enemy), players, dt);
    }
    // Clear any pathfinding
    bot._path = null;
    return; // Skip normal behavior while retreating
  }

  if (enemy) {
    // Set reaction timer when first spotting an enemy
    if (!bot._wasTrackingEnemy) {
      bot.aiReactionTimer = 0.2 + (1 - bot.skill) * 0.4; // 200-600ms reaction
      bot._wasTrackingEnemy = true;
      botSay(bot, 'enemySpotted', null); // call out contact
    }
    if (bot.aiReactionTimer > 0) {
      // During reaction time, aim toward enemy but don't shoot yet
      const angleToEnemy = Math.atan2(enemy.y - bot.y, enemy.x - bot.x);
      bot.angle += normalizeAngle(angleToEnemy - bot.angle) * 0.05; // slowly turn toward
      navigateTo(bot, bot.aiLastSeen ? bot.aiLastSeen.x : enemy.x, bot.aiLastSeen ? bot.aiLastSeen.y : enemy.y, gameMap, dt);
      return;
    }
    // Can see an enemy
    bot.aiLastSeen = { x: enemy.x, y: enemy.y, time: Date.now() / 1000 };
    bot.aiTarget = enemy.id;
    // Invalidate path since we're engaging
    bot._path = null;

    const dist = distance(bot, enemy);
    const angleToEnemy = Math.atan2(enemy.y - bot.y, enemy.x - bot.x);

    // Human-like aim with spread system
    const aimPoint = getAimPoint(bot, enemy);
    bot.angle = Math.atan2(aimPoint.y - bot.y, aimPoint.x - bot.x);

    // Try to throw a grenade if it makes sense
    if (tryThrowGrenade(bot, enemy, dist, players, gameMap)) {
      // thrown — skip combat this tick
    } else if (dist < 700) {
      bot.aiState = 'attacking';
      // Stop and shoot when in range — clear movement, use strafe instead
      bot.input.up = false;
      bot.input.down = false;
      bot.input.left = false;
      bot.input.right = false;
      handleCombat(bot, enemy, dist, players, dt);
      // Add strafe behavior during combat
      addCombatStrafe(bot, angleToEnemy, dt);
    } else if (dist < 1100) {
      bot.aiState = 'attacking';
      // Close the gap while firing — but slow approach
      navigateTo(bot, enemy.x, enemy.y, gameMap, dt);
      handleCombat(bot, enemy, dist, players, dt);
    } else {
      bot.aiState = 'chasing';
      navigateTo(bot, enemy.x, enemy.y, gameMap, dt);
      bot.input.sprint = true;
    }
  } else if (bot.aiLastSeen && Date.now() / 1000 - bot.aiLastSeen.time < 5) {
    bot._wasTrackingEnemy = false;
    bot.aiState = 'chasing';
    navigateTo(bot, bot.aiLastSeen.x, bot.aiLastSeen.y, gameMap, dt);
    if (distance(bot, bot.aiLastSeen) < 50) {
      bot.aiLastSeen = null;
      bot._path = null;
    }
  } else {
    bot._wasTrackingEnemy = false;
    // No enemy visible - patrol/roam toward objectives
    bot.aiState = 'roaming';
    handleRoaming(bot, dt, players, gameMap, gameState, bombState, bombsites, nearestEnemyPos);
  }

  // When roaming/idle, periodically scan around to detect enemies
  if (bot.aiState === 'roaming' && !enemy) {
    if (!bot._scanTimer) bot._scanTimer = 0;
    bot._scanTimer -= dt;
    if (bot._scanTimer <= 0) {
      bot._scanTimer = 1.5 + Math.random() * 2; // scan every 1.5-3.5s
      bot.angle = Math.random() * Math.PI * 2; // look in random direction
    }
  }

  // Auto reload when mag is low and not actively engaging
  const wep = getCurrentWeapon(bot);
  if (wep && bot.ammo[wep.key] && !bot.reloading) {
    const lowMag = bot.ammo[wep.key].mag <= Math.ceil(wep.data.magSize * 0.25);
    const emptyMag = bot.ammo[wep.key].mag === 0;
    // Reload when empty always; reload when low only out of combat
    if (emptyMag || (lowMag && !enemy)) {
      bot.input.reload = true;
    }
  }
}

// ==================== BOT OBJECTIVE / ROAM ====================
function handleRoaming(bot, dt, players, gameMap, gameState, bombState, bombsites, nearestEnemyPos) {
  const bombPlanted = bombState && bombState.planted;

  // T — plant the bomb if carrying it & on a site, else push a site
  if (bot.team === 'T' && gameState === 'playing' && !bombPlanted) {
    let currentSite = null;
    if (bombsites) {
      if (isOnBombsite(gameMap, bot.x, bot.y, 'A')) currentSite = 'A';
      else if (isOnBombsite(gameMap, bot.x, bot.y, 'B')) currentSite = 'B';
    }
    if (currentSite) {
      // On site — plant by asserting 'use'
      bot.input.use = true;
      return;
    }
    // Not on site yet — choose and push a site
    if (!bot.aiSearchPoint || distance(bot, bot.aiSearchPoint) < 80) {
      const siteKeys = Object.keys(bombsites || {});
      if (siteKeys.length) {
        const siteKey = siteKeys[Math.floor(Math.random() * siteKeys.length)];
        const site = bombsites[siteKey];
        bot.aiSearchPoint = { x: site.centerX || site.x, y: site.centerY || site.y };
        botSay(bot, 'rushing', { site: siteKey });
      }
    }
    if (bot.aiSearchPoint) navigateTo(bot, bot.aiSearchPoint.x, bot.aiSearchPoint.y, gameMap, dt);
    return;
  }

  // CT — when bomb is planted, ALL CTs rotate to defuse
  if (bot.team === 'CT' && bombPlanted) {
    // Sprint to bomb site when planted
    navigateTo(bot, bombState.x, bombState.y, gameMap, dt);
    bot.input.sprint = true;
    const distToBomb = distance(bot, bombState);
    if (distToBomb < 80) {
      bot.input.use = true;
      bot.input.sprint = false;
      bot.input.crouch = true; // Crouch for better defuse speed with kit
    }
    return;
  }

  // CT — hold or rotate between bombsites when no enemies / bomb not planted
  if (bot.team === 'CT' && gameState === 'playing') {
    if (!bot.aiHoldSite || !bot.aiSearchPoint || distance(bot, bot.aiSearchPoint) < 90) {
      const siteKeys = Object.keys(bombsites || {});
      if (siteKeys.length) {
        // Pick site — prefer staying if already assigned
        const siteKey = bot.aiHoldSite && Math.random() < 0.6
          ? bot.aiHoldSite
          : siteKeys[Math.floor(Math.random() * siteKeys.length)];
        const site = bombsites[siteKey];
        if (site) {
          bot.aiHoldSite = siteKey;
          bot.aiSearchPoint = {
            x: (site.centerX || site.x) + (Math.random() - 0.5) * 160,
            y: (site.centerY || site.y) + (Math.random() - 0.5) * 160,
          };
          bot._path = null;
          botSay(bot, 'siteHolding', { site: siteKey });
        }
      }
    }
    if (bot.aiSearchPoint) navigateTo(bot, bot.aiSearchPoint.x, bot.aiSearchPoint.y, gameMap, dt);
    // Face toward likely enemy approach (center of map)
    if (!nearestEnemyPos) {
      const toCenterX = gameMap[0].length * C.TILE_SIZE / 2 - bot.x;
      const toCenterY = gameMap.length * C.TILE_SIZE / 2 - bot.y;
      bot.angle = Math.atan2(toCenterY, toCenterX) + (Math.random() - 0.5) * 1.0;
    }
    return;
  }

  // Fallback roam (non-playing / SPEC / edge cases)
  if (!bot.aiWaypoint || distance(bot, bot.aiWaypoint) < 80) {
    if (nearestEnemyPos && Math.random() < 0.5) {
      bot.aiWaypoint = {
        x: nearestEnemyPos.x + (Math.random() - 0.5) * 400,
        y: nearestEnemyPos.y + (Math.random() - 0.5) * 400,
      };
    } else {
      bot.aiWaypoint = randomMapPoint(gameMap);
    }
    bot._path = null;
  }
  navigateTo(bot, bot.aiWaypoint.x, bot.aiWaypoint.y, gameMap, dt);
}

// Select a proper weapon if bot has nothing held (e.g., after respawn)
function pickBestWeapon(bot) {
  const wep = getCurrentWeapon(bot);
  if (wep && bot.ammo[wep.key] && (bot.ammo[wep.key].mag > 0 || bot.ammo[wep.key].reserve > 0)) return;
  // Find the best weapon by type priority: rifle > sniper > smg > shotgun > pistol
  const priority = { rifle: 5, sniper: 4, smg: 3, shotgun: 2, pistol: 1 };
  let bestIdx = -1, bestScore = -1;
  for (let i = 0; i < bot.weapons.length; i++) {
    const data = C.WEAPONS[bot.weapons[i]];
    if (!data) continue;
    const ammo = bot.ammo[bot.weapons[i]];
    if (!ammo || (ammo.mag === 0 && ammo.reserve === 0)) continue;
    const score = priority[data.type] || 0;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  if (bestIdx >= 0 && bestIdx !== bot.currentWeapon) {
    bot.currentWeapon = bestIdx;
    bot.reloading = false;
  }
}

// Try to throw a grenade at the enemy (HE/flash). Returns true if thrown.
function tryThrowGrenade(bot, enemy, dist, players, gameMap) {
  if (bot.aiGrenadeCooldown > 0) return false;
  // Skill gate — lower skill rarely uses grenades
  if (Math.random() > bot.skill * 0.4) return false;
  // Only at mid range where nades are most effective
  if (dist < 250 || dist > 800) return false;

  // Prefer HE if we have it and enemy is in the open
  if (bot.grenades.he > 0) {
    bot.grenades.he--;
    spawnGrenadeFromBot(bot, enemy, 'he');
    bot.aiGrenadeCooldown = 6 + Math.random() * 4;
    return true;
  }
  return false;
}

// Create a grenade thrown by a bot (mirrors the server 'throw_grenade' socket handler).
function spawnGrenadeFromBot(bot, target, type) {
  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const throwSpeed = Math.min(C.GRENADE_THROW_SPEED, Math.max(450, dist * 1.6));
  const angle = Math.atan2(dy, dx);
  const g = {
    type,
    x: bot.x + Math.cos(angle) * 20,
    y: bot.y + Math.sin(angle) * 20,
    vx: Math.cos(angle) * throwSpeed,
    vy: Math.sin(angle) * throwSpeed,
    owner: bot.id,
    timer: type === 'smoke' ? 1.5 : (type === 'flash' ? 1.0 : 1.5),
    team: bot.team,
  };
  // Stash on bot for server-side pickup next tick
  if (!bot._pendingGrenades) bot._pendingGrenades = [];
  bot._pendingGrenades.push(g);
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

  // Use low threshold so bot always moves in both needed directions
  if (Math.abs(mx) > 0.1) {
    if (mx > 0) bot.input.right = true;
    else bot.input.left = true;
  }
  if (Math.abs(my) > 0.1) {
    if (my > 0) bot.input.down = true;
    else bot.input.up = true;
  }
}

// Combat strafing: bots alternate left/right movement while shooting
function addCombatStrafe(bot, angleToEnemy, dt) {
  // Only strafe if skill is high enough and bot has a gun (not knife)
  if (bot.skill < 0.3) return;
  const wep = getCurrentWeapon(bot);
  if (!wep || wep.key === 'knife') return;

  bot._strafeTimer -= dt;
  if (bot._strafeTimer <= 0) {
    // Switch strafe direction
    bot._strafeDir *= -1;
    bot._strafeTimer = 0.3 + Math.random() * 0.8; // Change direction every 0.3-1.1s
  }

  // Apply perpendicular movement
  const strafeAngle = angleToEnemy + Math.PI / 2 * bot._strafeDir;
  const strafeAmount = bot.skill * 0.7; // Higher skill = more strafing
  if (Math.random() < strafeAmount) {
    const sx = Math.cos(strafeAngle);
    const sy = Math.sin(strafeAngle);
    if (Math.abs(sx) > 0.3) {
      if (sx > 0) bot.input.right = true;
      else bot.input.left = true;
    }
    if (Math.abs(sy) > 0.3) {
      if (sy > 0) bot.input.down = true;
      else bot.input.up = true;
    }
  }
}

// ==================== AIM SYSTEM ====================
function getAimPoint(bot, target) {
  if (!bot._aimOffset) {
    bot._aimOffset = { x: 0, y: 0 };
    bot._aimWanderPhase = Math.random() * Math.PI * 2;
    bot._recoilAccum = 0;
  }

  const dt = 1/60; // approximate
  const dist = distance(bot, target);

  // Base spread depends on skill
  const baseSpread = 40 - (bot.skill * 30); // skill 0.3: 31px, skill 0.7: 19px, skill 0.9: 13px

  // Movement penalty
  const isMoving = Math.abs(bot.vx || 0) > 10 || Math.abs(bot.vy || 0) > 10;
  let spread = baseSpread;
  if (isMoving) spread += 20 + (1 - bot.skill) * 15;
  if (bot.crouching) spread -= 8;

  // Distance penalty
  if (dist > 400) spread += (dist - 400) * 0.04;

  // Recoil accumulation
  spread += bot._recoilAccum;
  // Recoil recovery (decay over 400ms)
  bot._recoilAccum = Math.max(0, bot._recoilAccum - dt * 60);

  // Aim wander (sine wave drift)
  bot._aimWanderPhase += dt * (1.5 + (1 - bot.skill));
  const wanderX = Math.sin(bot._aimWanderPhase) * spread * 0.3;
  const wanderY = Math.cos(bot._aimWanderPhase * 0.7) * spread * 0.3;

  // Random offset within spread circle
  const randAngle = Math.random() * Math.PI * 2;
  const randDist = Math.random() * spread * 0.7;

  return {
    x: target.x + wanderX + Math.cos(randAngle) * randDist,
    y: target.y + wanderY + Math.sin(randAngle) * randDist,
  };
}

function handleCombat(bot, enemy, dist, players, dt) {
  const wep = getCurrentWeapon(bot);
  if (!wep) return;
  if (bot.reloading) return;                        // wait out reload
  if (bot.ammo[wep.key] && bot.ammo[wep.key].mag === 0) {
    bot.input.reload = true;
    return;
  }
  if (bot.aiReactionTimer > 0) return;
  if (bot.aiBurstPauseTimer > 0) return;            // controlled bursts

  const angleToEnemy = Math.atan2(enemy.y - bot.y, enemy.x - bot.x);
  const angleDiff = Math.abs(normalizeAngle(bot.angle - angleToEnemy));

  // Don't shoot if a teammate is in the line of fire
  if (teammateInLineOfFire(bot, enemy, players)) return;

  // Require tighter aim alignment for long-range shots
  const aimTolerance = 0.18 + (1 - bot.skill) * 0.2;
  if (angleDiff < aimTolerance) {
    bot.aiBurstCount++;
    // Burst length depends on weapon type & skill
    const isAuto = (wep.data.fireMode || 'auto') === 'auto';
    const maxBurst = isAuto
      ? Math.floor(2 + bot.skill * 6)
      : Math.floor(1 + bot.skill * 2);
    if (bot.aiBurstCount <= maxBurst) {
      bot.input.shoot = true;
      // Add recoil per shot
      if (!bot._recoilAccum) bot._recoilAccum = 0;
      bot._recoilAccum = Math.min(40, bot._recoilAccum + 3 + (1 - bot.skill) * 5);
    } else {
      bot.aiBurstCount = 0;
      // Short pause to let recoil reset — smarter bots pause less
      bot.aiBurstPauseTimer = 0.12 + (1 - bot.skill) * 0.18;
    }
  }

  // Strafe during combat — higher-skill bots strafe more
  if (Math.random() < 0.015 + bot.skill * 0.04) {
    const strafeAngle = angleToEnemy + Math.PI / 2 * (Math.random() > 0.5 ? 1 : -1);
    const strafeDist = 100 + Math.random() * 100;
    bot.aiWaypoint = {
      x: bot.x + Math.cos(strafeAngle) * strafeDist,
      y: bot.y + Math.sin(strafeAngle) * strafeDist,
    };
    bot._path = null;
  }
}

// Returns true if any teammate is within PLAYER_RADIUS*3 of the bullet line
// between bot and target (dot product projection).
function teammateInLineOfFire(bot, target, players) {
  const bx = target.x - bot.x;
  const by = target.y - bot.y;
  const lenSq = bx * bx + by * by;
  if (lenSq < 1) return false;
  const rad = C.PLAYER_RADIUS + 8;
  for (const p of Object.values(players)) {
    if (!p.alive || p.team !== bot.team || p.id === bot.id) continue;
    const dx = p.x - bot.x;
    const dy = p.y - bot.y;
    // Project teammate onto line segment
    const t = (dx * bx + dy * by) / lenSq;
    if (t <= 0 || t >= 1) continue;
    const px = bot.x + bx * t;
    const py = bot.y + by * t;
    const distSq = (p.x - px) ** 2 + (p.y - py) ** 2;
    if (distSq < rad * rad) return true;
  }
  return false;
}

function findNearestEnemy(bot, players, gameMap, smokeGrenades) {
  let nearest = null;
  let nearestDist = Infinity;
  const now = Date.now() / 1000;

  for (const p of Object.values(players)) {
    if (!p.alive || p.team === bot.team || p.team === C.TEAM_SPEC) continue;
    const dist = distance(bot, p);

    // Sound detection: if enemy recently shot (last 2s), detect from further
    const enemyRecentShot = p.lastShotTime && (now - p.lastShotTime) < 2;
    const maxDist = enemyRecentShot ? 1000 : 700;
    const fovRequired = enemyRecentShot ? Math.PI * 2 : (140 * Math.PI / 180); // 360° for sound, 140° for vision

    if (dist > maxDist) continue;

    // FOV cone check (skip for sound detection)
    if (!enemyRecentShot) {
      const angleToEnemy = Math.atan2(p.y - bot.y, p.x - bot.x);
      let angleDiff = angleToEnemy - bot.angle;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      if (Math.abs(angleDiff) > fovRequired / 2) continue;
    }

    // Line of sight check
    if (lineOfSight(gameMap, bot.x, bot.y, p.x, p.y) && !lineBlockedBySmoke(bot.x, bot.y, p.x, p.y, smokeGrenades)) {
      if (dist < nearestDist) {
        nearest = p;
        nearestDist = dist;
      }
    }
  }

  // Update last known position
  if (nearest) {
    bot.aiLastSeen = { x: nearest.x, y: nearest.y, time: now };
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
    const skill = 0.2 + Math.random() * 0.5; // 0.2-0.7 range for more variety
    const bot = createBot(team, skill);
    bots.push(bot);
  }
  return bots;
}

// Returns an ordered list of items the bot wants to buy this freeze period.
// The caller should try to buy each in sequence (buys may fail on money).
function addBotBuyLogic(bot) {
  const items = [];
  const money = bot.money;

  // ---- Primary weapon ----
  // ~10% of rich bots splurge on an AWP
  if (money >= 4750 && Math.random() < 0.1) {
    items.push('awp');
  } else if (bot.team === 'T') {
    if (money >= 2700) items.push('ak47');
    else if (money >= 1800) items.push('galil');
    else if (money >= 1700) items.push('ssg08');
    else if (money >= 1050) items.push('mac10');
    else if (money >= 700) items.push('deagle');
  } else { // CT
    if (money >= 3100) items.push('m4a4');
    else if (money >= 2050) items.push('famas');
    else if (money >= 1700) items.push('ssg08');
    else if (money >= 1250) items.push('mp9');
    else if (money >= 700) items.push('deagle');
  }

  // ---- Armor ----
  // Estimate money left after primary
  const primary = items[0];
  const primaryCost = primary ? (C.WEAPONS[primary]?.price || 0) : 0;
  let budget = money - primaryCost;
  if (budget >= 1000) {
    items.push('helmet'); budget -= 1000;
  } else if (budget >= 650) {
    items.push('kevlar'); budget -= 650;
  }

  // ---- Defuse kit (CT only) ----
  if (bot.team === 'CT' && !bot.hasDefuseKit && budget >= 400) {
    items.push('defuse_kit'); budget -= 400;
  }

  // ---- Grenades ----
  // Prioritize HE, then flash, then smoke
  if (budget >= 300) { items.push('he_grenade'); budget -= 300; }
  if (budget >= 200) { items.push('flashbang'); budget -= 200; }
  if (budget >= 300) { items.push('smoke'); budget -= 300; }
  if (budget >= 200) { items.push('flashbang'); budget -= 200; } // second flash

  return items;
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
  lineBlockedBySmoke,
  botSay,
};

// ==================== BOT COMMUNICATION ====================
const BOT_MESSAGES = {
  // T messages
  bombPlanting: ['Planting at {site}!', 'Planting bomb!', 'Bomb going down!'],
  rushing: ['Rushing {site}!', 'Push {site}!', 'Let\'s go {site}!'],
  // CT messages
  bombPlanted: ['Bomb planted at {site}!', 'They planted {site}!', 'Bomb down {site}!'],
  defusing: ['Defusing!', 'Defusing the bomb!', 'Kit out, defusing!'],
  enemySpotted: ['Enemy spotted!', 'Contact!', 'I see one!'],
  siteHolding: ['Holding {site}', 'Watching {site}', '{site} is covered'],
  needBackup: ['Need backup!', 'Help {site}!', 'They\'re pushing {site}!'],
  lowHp: ['I\'m low!', 'Taking damage!', 'Need healing!'],
};

function botSay(bot, category, replacements) {
  if (!bot._chatCooldown) bot._chatCooldown = 0;
  const now = Date.now() / 1000;
  if (now - bot._chatCooldown < 5) return; // 5 second cooldown between messages
  bot._chatCooldown = now;

  const messages = BOT_MESSAGES[category];
  if (!messages || messages.length === 0) return;

  let msg = messages[Math.floor(Math.random() * messages.length)];
  if (replacements) {
    for (const [key, val] of Object.entries(replacements)) {
      msg = msg.replace(`{${key}}`, val);
    }
  }

  if (!bot._pendingChat) bot._pendingChat = [];
  bot._pendingChat.push({ message: msg, teamOnly: true });
}

// ==================== SMOKE LINE OF SIGHT CHECK ====================
// Check if a line from (x1,y1) to (x2,y2) passes through any smoke grenade
function lineBlockedBySmoke(x1, y1, x2, y2, smokeGrenades) {
  if (!smokeGrenades || smokeGrenades.length === 0) return false;
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return false;
  const len = Math.sqrt(lenSq);

  for (const g of smokeGrenades) {
    if (g.type !== 'smoke') continue;
    // Find closest point on line segment to smoke center
    const t = Math.max(0, Math.min(1, ((g.x - x1) * dx + (g.y - y1) * dy) / lenSq));
    const closestX = x1 + t * dx;
    const closestY = y1 + t * dy;
    const distSq = (closestX - g.x) * (closestX - g.x) + (closestY - g.y) * (closestY - g.y);
    const smokeRadius = g.radius || 100;
    if (distSq < smokeRadius * smokeRadius) return true;
  }
  return false;
}
