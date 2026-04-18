// CS Top-Down Shooter - Game Server (v2)
// Improvements: knife, crouching, bomb progress, kill rewards, round history,
//               spectator mode, clean auto-restart, round MVP, sound events, weapon drops
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const C = require('./shared/constants');
const { generateMap, getSpawnPoints, getBombsites, isWall, isOnBombsite, lineOfSight,
  TILE_WALL, TILE_CRATE, TILE_BOMBSITE_A, TILE_BOMBSITE_B, TILE_T_SPAWN, TILE_CT_SPAWN, TILE_DOOR, TILE_EMPTY } = require('./shared/map');
const { createBot, updateBot, spawnBotsForTeam, addBotBuyLogic, getCurrentWeapon: getBotWeapon, BOT_PREFIX, randomMapPoint, lineBlockedBySmoke } = require('./server/bots');

// ==================== KNIFE WEAPON DEFINITION ====================
// Knife is slot 0, always available, melee range, fast attack
const KNIFE_WEAPON = {
  key: 'knife',
  name: 'Knife',
  type: 'knife',
  price: 0,
  damage: 40,
  fireRate: 2.0,         // attacks per second
  range: 50,             // very short melee range
  moveSpread: 0,
  spread: 0,
  reloadTime: 0,
  magSize: Infinity,
  reserveAmmo: Infinity,
  reward: 1500,          // knife kill reward
  fireMode: 'semi',
  recoilPattern: [],
  armorPenetration: 1.0, // full armor penetration
};

// ==================== SOUND EVENTS ====================
const SOUNDS = {
  gunshot: (weapon) => ({ type: 'gunshot', weapon }),
  footstep: () => ({ type: 'footstep' }),
  knife_swing: () => ({ type: 'knife_swing' }),
  knife_hit: () => ({ type: 'knife_hit' }),
  grenade_bounce: () => ({ type: 'grenade_bounce' }),
  grenade_explode: (gtype) => ({ type: 'grenade_explode', gtype }),
  bomb_plant_tick: () => ({ type: 'bomb_plant_tick' }),
  bomb_defuse_tick: () => ({ type: 'bomb_defuse_tick' }),
  bomb_beep: () => ({ type: 'bomb_beep' }),
  weapon_pickup: () => ({ type: 'weapon_pickup' }),
  weapon_drop: () => ({ type: 'weapon_drop' }),
  player_death: () => ({ type: 'player_death' }),
  round_start: () => ({ type: 'round_start' }),
  round_end: () => ({ type: 'round_end' }),
  headshot: () => ({ type: 'headshot' }),
};

function emitSound(x, y, soundData, range = 800) {
  io.emit('sound', { ...soundData, x, y, range });
}

// ==================== SERVER SETUP ====================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  allowEIO3: true,
  transports: ['polling', 'websocket'],
  pingInterval: 10000,
  pingTimeout: 5000,
  maxHttpBufferSize: 1e6,
});

app.use(express.static(path.join(__dirname, 'public')));

// ==================== GAME STATE ====================
let gameId = 0;
let gameState = 'waiting'; // waiting, warmup, freeze, playing, round_end, game_over
let roundTimer = 0;
let freezeTimer = 0;
let roundEndTimer = 0;     // pause between rounds (for MVP display)
let gameOverTimer = 0;      // auto-restart countdown after game_over
let roundNumber = 0;
let tScore = 0;
let ctScore = 0;
let lossBonus = { T: 0, CT: 0 };
let consecutiveLosses = { T: 0, CT: 0 };
const gameMap = generateMap();
const tSpawns = getSpawnPoints(gameMap, 'T');
const ctSpawns = getSpawnPoints(gameMap, 'CT');
const bombsites = getBombsites(gameMap);

let players = {};
let bullets = [];
let grenades = [];
let activeGrenades = [];  // thrown grenades in flight
let bombState = null;     // { site, x, y, planter, timer, defuser, defuseTimer, planted, exploded, defused, plantProgress }
let damageIndicators = [];
let droppedWeapons = [];  // { id, weaponKey, x, y, ammo }
let droppedIdCounter = 0;

// Round history (last 5 rounds)
let roundHistory = []; // [{ round, winner, reason, mvp }]
const MAX_ROUND_HISTORY = 5;

// Round MVP tracking
let roundMVP = null;     // { id, name, kills, damage, team }
let roundMVPTracker = {}; // { playerId: { kills, damage } }

// ==================== PLAYER CLASS ====================
function createPlayer(id, name) {
  return {
    id,
    name: name || 'Player',
    team: C.TEAM_SPEC,
    x: 0, y: 0,
    vx: 0, vy: 0,
    angle: 0,
    hp: C.PLAYER_MAX_HP,
    armor: 0,
    helmet: false,
    money: C.START_MONEY,
    alive: true,
    weapons: [],       // array of weapon keys (does NOT include knife; knife is implicit slot 0)
    currentWeapon: -1, // index into weapons; -1 = knife
    ammo: {},          // { weaponKey: { mag, reserve } }
    grenades: { he: 0, flash: 0, smoke: 0 },
    hasDefuseKit: false,
    kills: 0,
    deaths: 0,
    assists: 0,
    lastDamageBy: null,
    input: { up: false, down: false, left: false, right: false, shoot: false, reload: false, sprint: false, crouch: false },
    lastShot: 0,
    shotsFired: 0,
    lastShotTime: 0,
    prevShoot: false,
    reloading: false,
    reloadTimer: 0,
    sprinting: false,
    crouching: false,
    crouchTransition: 0, // 0 = standing, 1 = fully crouched (smooth visual)
    connected: true,
    ping: 0,
    // Spectator state
    specTarget: null,   // player id being spectated, or null for free roam
    specX: 0,
    specY: 0,
    // Footstep tracking
    footstepTimer: 0,
    // Plant progress (server-side for player-initiated planting)
    plantingBomb: false,
    plantProgress: 0,
    defusingBomb: false,
    defuseProgress: 0,
  };
}

function spawnPlayer(player) {
  const spawns = player.team === 'T' ? tSpawns : ctSpawns;
  const sp = spawns[Math.floor(Math.random() * spawns.length)];
  player.x = sp.x + (Math.random() - 0.5) * 30;
  player.y = sp.y + (Math.random() - 0.5) * 30;
  player.hp = C.PLAYER_MAX_HP;
  player.alive = true;
  player.reloading = false;
  player.reloadTimer = 0;
  player.lastDamageBy = null;
  player.vx = 0;
  player.vy = 0;
  player.crouching = false;
  player.crouchTransition = 0;
  player.plantingBomb = false;
  player.plantProgress = 0;
  player.defusingBomb = false;
  player.defuseProgress = 0;
}

function resetPlayerRound(player) {
  spawnPlayer(player);
  // Keep weapons and armor bought during freeze time
}

function giveDefaultWeapons(player) {
  player.weapons = [];
  player.ammo = {};
  const pistol = player.team === 'T' ? 'glock' : 'usp';
  player.weapons.push(pistol);
  player.ammo[pistol] = { mag: C.WEAPONS[pistol].magSize, reserve: C.WEAPONS[pistol].reserveAmmo };
  player.currentWeapon = 0; // slot 0 in weapons array = pistol; knife is implicit at index -1
  player.grenades = { he: 0, flash: 0, smoke: 0 };
  player.hasDefuseKit = false;
}

// ==================== WEAPON HELPERS ====================
// Get the effective weapon for a player (knife if currentWeapon == -1)
function getCurrentWeapon(p) {
  if (p.currentWeapon < 0) {
    // Knife is always available
    return { key: 'knife', data: KNIFE_WEAPON };
  }
  if (p.currentWeapon >= p.weapons.length) return null;
  const key = p.weapons[p.currentWeapon];
  const data = C.WEAPONS[key];
  return data ? { key, data } : null;
}

// Get weapon key string for display
function getWeaponKeyForPlayer(p) {
  const wep = getCurrentWeapon(p);
  return wep ? wep.key : 'knife';
}

// ==================== ROUND MVP TRACKING ====================
function initRoundMVPTracker() {
  roundMVPTracker = {};
  for (const p of Object.values(players)) {
    if (p.team !== C.TEAM_SPEC) {
      roundMVPTracker[p.id] = { kills: 0, damage: 0, name: p.name, team: p.team };
    }
  }
}

function trackDamage(attackerId, damage) {
  if (roundMVPTracker[attackerId]) {
    roundMVPTracker[attackerId].damage += damage;
  }
}

function trackKill(attackerId) {
  if (roundMVPTracker[attackerId]) {
    roundMVPTracker[attackerId].kills++;
  }
}

function calculateRoundMVP() {
  let best = null;
  for (const [id, stats] of Object.entries(roundMVPTracker)) {
    if (!best || stats.kills > best.kills || (stats.kills === best.kills && stats.damage > best.damage)) {
      best = { id, ...stats };
    }
  }
  return best;
}

// ==================== ROUND MANAGEMENT ====================
function startGame() {
  if (gameState !== 'waiting') return;
  gameState = 'freeze';
  roundNumber = 1;
  tScore = 0;
  ctScore = 0;
  lossBonus = { T: 0, CT: 0 };
  consecutiveLosses = { T: 0, CT: 0 };
  bombState = null;
  roundHistory = [];
  droppedWeapons = [];

  for (const p of Object.values(players)) {
    if (p.team !== C.TEAM_SPEC) {
      p.money = C.START_MONEY;
      giveDefaultWeapons(p);
      spawnPlayer(p);
      if (p.isBot) p._botBought = false;
    }
  }

  initRoundMVPTracker();
  freezeTimer = C.FREEZE_TIME;
  emitSound(0, 0, SOUNDS.round_start(), 99999);
  io.emit('round_start', { round: roundNumber, tScore, ctScore, freezeTime: C.FREEZE_TIME });
  io.emit('game_state', { state: gameState, round: roundNumber, tScore, ctScore, roundHistory });
}

function startRound() {
  gameState = 'playing';
  roundTimer = C.ROUND_TIME;
  bombState = null;
  bullets = [];
  activeGrenades = [];
  grenades = [];
  droppedWeapons = [];

  for (const p of Object.values(players)) {
    if (p.team !== C.TEAM_SPEC) {
      resetPlayerRound(p);
    }
  }

  initRoundMVPTracker();
  emitSound(0, 0, SOUNDS.round_start(), 99999);
  io.emit('round_live', { round: roundNumber, tScore, ctScore });
  io.emit('game_state', { state: gameState, round: roundNumber, tScore, ctScore, roundHistory });
}

function endRound(winner, reason) {
  if (gameState === 'round_end' || gameState === 'game_over') return; // Prevent double-call
  gameState = 'round_end';
  roundEndTimer = 5.0; // 5 second pause for MVP display

  // Calculate rewards
  if (winner === 'T') {
    tScore++;
    consecutiveLosses.T = 0;
    consecutiveLosses.CT++;
    lossBonus.T = 0;
    lossBonus.CT = Math.min(C.MAX_LOSS_BONUS, C.ROUND_LOSS_REWARD + consecutiveLosses.CT * C.LOSS_BONUS_INCREMENT);
  } else {
    ctScore++;
    consecutiveLosses.CT = 0;
    consecutiveLosses.T++;
    lossBonus.CT = 0;
    lossBonus.T = Math.min(C.MAX_LOSS_BONUS, C.ROUND_LOSS_REWARD + consecutiveLosses.T * C.LOSS_BONUS_INCREMENT);
  }

  const winReward = winner === 'T' ? (reason === 'bomb' ? 3500 : C.ROUND_WIN_REWARD) : C.ROUND_WIN_REWARD;
  const loseReward = winner === 'T' ? lossBonus.CT : lossBonus.T;

  for (const p of Object.values(players)) {
    if (p.team !== C.TEAM_SPEC) {
      const reward = p.team === winner ? winReward : (loseReward || C.ROUND_LOSS_REWARD);
      p.money = Math.min(C.MAX_MONEY, p.money + reward);
    }
  }

  // Calculate and store round MVP
  roundMVP = calculateRoundMVP();

  // Record round history
  roundHistory.push({
    round: roundNumber,
    winner,
    reason,
    mvp: roundMVP ? { id: roundMVP.id, name: roundMVP.name, kills: roundMVP.kills, damage: Math.round(roundMVP.damage) } : null,
  });
  if (roundHistory.length > MAX_ROUND_HISTORY) {
    roundHistory.shift();
  }

  emitSound(0, 0, SOUNDS.round_end(), 99999);
  io.emit('round_end', {
    winner,
    reason,
    tScore,
    ctScore,
    round: roundNumber,
    mvp: roundMVP,
    roundHistory,
  });

  // Check game over — handled naturally in the game loop via roundEndTimer
}

function handleGameOver() {
  gameState = 'game_over';
  gameOverTimer = 8.0; // 8 seconds before auto-restart
  const gameWinner = tScore >= C.ROUNDS_TO_WIN ? 'T' : 'CT';
  io.emit('game_over', { winner: gameWinner, tScore, ctScore, roundHistory });
}

function handleNextRound() {
  roundNumber++;

  // Half-time swap at round 13
  if (roundNumber === 13) {
    for (const p of Object.values(players)) {
      if (p.team === 'T') p.team = 'CT';
      else if (p.team === 'CT') p.team = 'T';
    }
    const tmp = tScore;
    tScore = ctScore;
    ctScore = tmp;
    io.emit('team_swap', { tScore, ctScore });
  }

  for (const p of Object.values(players)) {
    if (p.team !== C.TEAM_SPEC) {
      giveDefaultWeapons(p);
      spawnPlayer(p);
      if (p.isBot) p._botBought = false;
    }
  }

  gameState = 'freeze';
  freezeTimer = C.FREEZE_TIME;
  bombState = null;
  droppedWeapons = [];

  initRoundMVPTracker();
  emitSound(0, 0, SOUNDS.round_start(), 99999);
  io.emit('round_start', { round: roundNumber, tScore, ctScore, freezeTime: C.FREEZE_TIME, roundHistory });
  io.emit('game_state', { state: gameState, round: roundNumber, tScore, ctScore, roundHistory });
}

function handleAutoRestart() {
  console.log('Auto-restarting game after game_over');
  // Remove old bots
  for (const [id, p] of Object.entries(players)) {
    if (p.isBot) delete players[id];
  }
  gameState = 'waiting';
  roundNumber = 0;
  tScore = 0;
  ctScore = 0;
  bombState = null;
  lossBonus = { T: 0, CT: 0 };
  consecutiveLosses = { T: 0, CT: 0 };
  roundHistory = [];
  droppedWeapons = [];
  gameOverTimer = 0;

  // Reset all player stats
  for (const [id, p] of Object.entries(players)) {
    p.kills = 0;
    p.deaths = 0;
    p.assists = 0;
    p.money = C.START_MONEY;
  }

  io.emit('game_restart');
  io.emit('game_state', { state: 'waiting', round: 0, tScore: 0, ctScore: 0, roundHistory });

  // Re-add bots and start fresh after short delay
  setTimeout(() => {
    autoStartGame();
  }, 1500);
}

// ==================== BUY SYSTEM ====================
function handleBuy(player, item) {
  if (!player.alive) return false;
  // Allow buying during freeze, waiting, round_end, and first 15 seconds of round
  const buyTimeLeft = C.ROUND_TIME - roundTimer;
  if (gameState !== 'freeze' && gameState !== 'waiting' && gameState !== 'round_end' && buyTimeLeft > 15) return false;
  const weapon = C.WEAPONS[item];
  if (!weapon) return false;

  // Team check
  if (weapon.team && weapon.team !== player.team) return false;

  if (player.money < weapon.price) return false;

  if (weapon.type === 'armor') {
    if (weapon.armor && player.armor >= 100 && (!weapon.helmet || player.helmet)) return false;
    player.armor = weapon.armor;
    if (weapon.helmet) player.helmet = true;
    player.money -= weapon.price;
    return true;
  }

  if (weapon.type === 'utility') {
    if (item === 'defuse_kit') {
      if (player.team !== 'CT') return false;
      if (player.hasDefuseKit) return false;
      player.hasDefuseKit = true;
      player.money -= weapon.price;
      return true;
    }
  }

  if (weapon.type === 'grenade') {
    const gType = item === 'he_grenade' ? 'he' : item === 'flashbang' ? 'flash' : 'smoke';
    if (player.grenades[gType] >= weapon.maxCarry) return false;
    player.grenades[gType]++;
    player.money -= weapon.price;
    return true;
  }

  // Weapon
  const existingType = player.weapons.map(w => C.WEAPONS[w]?.type);
  const typeCount = existingType.filter(t => t === weapon.type).length;

  // Can carry one of each type (pistol, smg, rifle, sniper, shotgun)
  if (typeCount >= 1 && weapon.type !== 'pistol') {
    // Drop the existing weapon of this type
    const idx = player.weapons.findIndex(w => C.WEAPONS[w]?.type === weapon.type);
    if (idx >= 0) {
      // Drop old weapon on ground
      const oldKey = player.weapons[idx];
      const oldAmmo = player.ammo[oldKey];
      dropWeaponOnGround(oldKey, player.x, player.y, oldAmmo ? oldAmmo.reserve : 0);

      player.weapons.splice(idx, 1);
      delete player.ammo[oldKey];
      // Fix currentWeapon index
      if (player.currentWeapon >= player.weapons.length) player.currentWeapon = player.weapons.length - 1;
    }
  } else if (weapon.type === 'pistol' && player.weapons.length >= 2) {
    // Replace current pistol
    const pistolIdx = player.weapons.findIndex(w => C.WEAPONS[w]?.type === 'pistol');
    if (pistolIdx >= 0) {
      const oldKey = player.weapons[pistolIdx];
      const oldAmmo = player.ammo[oldKey];
      dropWeaponOnGround(oldKey, player.x, player.y, oldAmmo ? oldAmmo.reserve : 0);
      delete player.ammo[oldKey];

      player.weapons[pistolIdx] = item;
      player.ammo[item] = { mag: weapon.magSize, reserve: weapon.reserveAmmo };
      player.money -= weapon.price;
      return true;
    }
  }

  player.weapons.push(item);
  player.ammo[item] = { mag: weapon.magSize, reserve: weapon.reserveAmmo };
  player.currentWeapon = player.weapons.length - 1;
  player.money -= weapon.price;
  return true;
}

// ==================== DROPPED WEAPONS ====================
function dropWeaponOnGround(weaponKey, x, y, reserveAmmo) {
  if (!weaponKey || weaponKey === 'knife') return;
  droppedWeapons.push({
    id: ++droppedIdCounter,
    weaponKey,
    x: x + (Math.random() - 0.5) * 20,
    y: y + (Math.random() - 0.5) * 20,
    ammo: { mag: C.WEAPONS[weaponKey] ? C.WEAPONS[weaponKey].magSize : 0, reserve: reserveAmmo },
  });
}

function dropPrimaryWeaponOnDeath(player) {
  // Find primary weapon (non-pistol, non-knife)
  for (let i = player.weapons.length - 1; i >= 0; i--) {
    const wKey = player.weapons[i];
    const wData = C.WEAPONS[wKey];
    if (wData && wData.type !== 'pistol') {
      const ammo = player.ammo[wKey];
      dropWeaponOnGround(wKey, player.x, player.y, ammo ? ammo.reserve : 0);
      player.weapons.splice(i, 1);
      delete player.ammo[wKey];
      if (player.currentWeapon >= player.weapons.length) {
        player.currentWeapon = player.weapons.length - 1;
      }
      emitSound(player.x, player.y, SOUNDS.weapon_drop(), 500);
      return;
    }
  }
}

function checkWeaponPickup(player) {
  if (!player.alive || player.team === C.TEAM_SPEC) return;

  for (let i = droppedWeapons.length - 1; i >= 0; i--) {
    const dw = droppedWeapons[i];
    const dx = player.x - dw.x;
    const dy = player.y - dw.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 30) {
      const wData = C.WEAPONS[dw.weaponKey];
      if (!wData) continue;

      // Check if player already has this weapon type
      const existingIdx = player.weapons.findIndex(w => {
        const wd = C.WEAPONS[w];
        return wd && wd.type === wData.type;
      });

      if (existingIdx >= 0) {
        // Replace existing weapon of same type
        const oldKey = player.weapons[existingIdx];
        const oldAmmo = player.ammo[oldKey];
        dropWeaponOnGround(oldKey, player.x, player.y, oldAmmo ? oldAmmo.reserve : 0);
        delete player.ammo[oldKey];

        player.weapons[existingIdx] = dw.weaponKey;
        player.ammo[dw.weaponKey] = dw.ammo;
        player.currentWeapon = existingIdx;
      } else if (player.weapons.length < 3) {
        // Add to inventory (max 3 weapons + knife)
        player.weapons.push(dw.weaponKey);
        player.ammo[dw.weaponKey] = dw.ammo;
        player.currentWeapon = player.weapons.length - 1;
      } else {
        // Inventory full, skip
        continue;
      }

      droppedWeapons.splice(i, 1);
      emitSound(player.x, player.y, SOUNDS.weapon_pickup(), 400);
      break; // Only pick up one weapon per tick
    }
  }
}

// ==================== GAME PHYSICS ====================
function update(dt) {
  if (gameState === 'waiting') {
    // Allow free movement and shooting in waiting state
    updatePlayers(dt);
    updateBullets(dt);
    updateBots(dt);
    return;
  }

  if (gameState === 'freeze') {
    freezeTimer -= dt;
    if (freezeTimer <= 0) {
      startRound();
    }
    updatePlayers(dt);
    updateBots(dt);
    botBuyDuringFreeze();
    return;
  }

  // Handle round_end pause (5 seconds for MVP display)
  if (gameState === 'round_end') {
    roundEndTimer -= dt;
    if (roundEndTimer <= 0) {
      // Check if this should trigger game_over
      if (tScore >= C.ROUNDS_TO_WIN || ctScore >= C.ROUNDS_TO_WIN) {
        handleGameOver();
        return;
      }
      handleNextRound();
    }
    return;
  }

  // Handle game_over with auto-restart countdown
  if (gameState === 'game_over') {
    gameOverTimer -= dt;
    if (gameOverTimer <= 0) {
      handleAutoRestart();
    }
    return;
  }

  if (gameState !== 'playing') return;

  roundTimer -= dt;

  // Round timer expired
  if (roundTimer <= 0) {
    // CT wins if bomb not planted
    if (!bombState || !bombState.planted) {
      endRound('CT', 'time');
      return;
    }
  }

  updatePlayers(dt);
  updateBullets(dt);
  updateActiveGrenades(dt);
  updateGrenades(dt);
  updateBomb(dt);
  updateBots(dt);
  updateWeaponPickups(dt);
  checkRoundEnd();
}

function updateWeaponPickups(dt) {
  for (const p of Object.values(players)) {
    if (!p.alive || p.team === C.TEAM_SPEC || p.isBot) continue;
    checkWeaponPickup(p);
  }
}

function updatePlayers(dt) {
  for (const p of Object.values(players)) {
    if (p.team === C.TEAM_SPEC) {
      updateSpectator(p, dt);
      continue;
    }
    if (!p.alive) continue;

    // Crouching
    p.crouching = !!p.input.crouch;
    if (p.crouching) {
      p.crouchTransition = Math.min(1, p.crouchTransition + dt * 8);
    } else {
      p.crouchTransition = Math.max(0, p.crouchTransition - dt * 8);
    }

    // Reloading
    if (p.reloading) {
      p.reloadTimer -= dt;
      if (p.reloadTimer <= 0) {
        const wep = getCurrentWeapon(p);
        if (wep && wep.key !== 'knife') {
          const ammo = p.ammo[wep.key];
          if (ammo) {
            const needed = wep.data.magSize - ammo.mag;
            const available = Math.min(needed, ammo.reserve);
            ammo.mag += available;
            ammo.reserve -= available;
          }
        }
        p.reloading = false;
      }
    }

    // Movement
    applyMovement(p, dt);

    // Footsteps
    const moving = Math.abs(p.vx) > 10 || Math.abs(p.vy) > 10;
    if (moving && !p.crouching) {
      const speed = p.input.sprint ? C.PLAYER_SPRINT_SPEED : C.PLAYER_SPEED;
      const stepInterval = p.input.sprint ? 0.3 : 0.45;
      p.footstepTimer -= dt;
      if (p.footstepTimer <= 0) {
        p.footstepTimer = stepInterval;
        emitSound(p.x, p.y, SOUNDS.footstep(), 600);
      }
    } else {
      p.footstepTimer = 0;
    }

    // Shooting
    if (p.input.shoot && !p.reloading) {
      shoot(p);
    } else if (!p.input.shoot) {
      // Track when player stops shooting for recoil reset
      const now = Date.now() / 1000;
      if (p.lastShotTime > 0 && now - p.lastShotTime > 0.2) {
        p.shotsFired = 0;
      }
    }

    // Track shoot state for semi-auto rising-edge detection
    p.prevShoot = p.input.shoot;

    // Check weapon pickup
    if (!p.isBot) {
      checkWeaponPickup(p);
    }
  }
}

function applyMovement(p, dt) {
  let dx = 0, dy = 0;
  if (p.input.up) dy -= 1;
  if (p.input.down) dy += 1;
  if (p.input.left) dx -= 1;
  if (p.input.right) dx += 1;

  if (dx === 0 && dy === 0) {
    p.vx = 0;
    p.vy = 0;
    return;
  }

  const len = Math.sqrt(dx * dx + dy * dy);
  dx /= len;
  dy /= len;

  let speed;
  if (p.crouching) {
    speed = C.PLAYER_CROUCH_SPEED;
  } else if (p.input.sprint) {
    speed = C.PLAYER_SPRINT_SPEED;
  } else {
    speed = C.PLAYER_SPEED;
  }

  const newX = p.x + dx * speed * dt;
  const newY = p.y + dy * speed * dt;

  // Collision with walls
  const r = C.PLAYER_RADIUS;
  if (!isWall(gameMap, newX - r, p.y) && !isWall(gameMap, newX + r, p.y)) {
    p.x = newX;
  }
  if (!isWall(gameMap, p.x, newY - r) && !isWall(gameMap, p.x, newY + r)) {
    p.y = newY;
  }

  p.vx = dx * speed;
  p.vy = dy * speed;
}

function shoot(p) {
  const wep = getCurrentWeapon(p);
  if (!wep) return;

  const now = Date.now() / 1000;
  const fireInterval = 1 / wep.data.fireRate;
  if (now - p.lastShot < fireInterval) return;

  // Knife attack
  if (wep.key === 'knife') {
    // Knife uses semi-auto (rising edge)
    if (p.prevShoot) return;
    p.lastShot = now;
    p.lastShotTime = now;
    emitSound(p.x, p.y, SOUNDS.knife_swing(), 400);

    // Check for melee hit (short range, wide arc)
    for (const target of Object.values(players)) {
      if (!target.alive || target.team === p.team || target.id === p.id) continue;
      const tdx = target.x - p.x;
      const tdy = target.y - p.y;
      const dist = Math.sqrt(tdx * tdx + tdy * tdy);
      if (dist > KNIFE_WEAPON.range) continue;

      // Check angle (wide 120 degree arc)
      const angleToTarget = Math.atan2(tdy, tdx);
      let angleDiff = angleToTarget - p.angle;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      if (Math.abs(angleDiff) > Math.PI / 3) continue; // 60 degrees each side

      // Hit!
      let damage = KNIFE_WEAPON.damage;
      // Crouching targets take 30% less damage (harder to hit)
      if (target.crouching) {
        damage *= 0.7;
      }

      // Armor doesn't help much against knife
      if (target.armor > 0) {
        const absorbed = damage * 0.2;
        const armorDmg = Math.min(target.armor, absorbed);
        target.armor -= armorDmg;
        damage -= armorDmg;
      }

      target.hp -= damage;
      target.lastDamageBy = p.id;
      trackDamage(p.id, damage);
      emitSound(target.x, target.y, SOUNDS.knife_hit(), 400);
      // Send damage direction to victim
      for (const [sockId, sock] of io.sockets.sockets) {
        if (sockId === target.id) {
          sock.emit('damage_taken', { attackerX: p.x, attackerY: p.y, damage, headshot: false });
          break;
        }
      }
      io.emit('hit_marker', { target: target.id, damage, headshot: false, kill: target.hp <= 0 });

      if (target.hp <= 0) {
        target.hp = 0;
        target.alive = false;
        target.deaths++;
        p.kills++;
        trackKill(p.id);
        // Knife kill reward
        p.money = Math.min(C.MAX_MONEY, p.money + KNIFE_WEAPON.reward);
        dropPrimaryWeaponOnDeath(target);

        if (target.lastDamageBy && target.lastDamageBy !== p.id && players[target.lastDamageBy]) {
          players[target.lastDamageBy].assists++;
        }

        emitSound(target.x, target.y, SOUNDS.player_death(), 600);
        io.emit('player_killed', {
          victim: target.id,
          victimName: target.name,
          killer: p.id,
          killerName: p.name,
          weapon: 'knife',
          headshot: false,
        });
      }
      break; // Only hit one target per swing
    }
    return;
  }

  // Gun attack
  const ammo = p.ammo[wep.key];
  if (!ammo || ammo.mag <= 0) {
    // Auto reload
    startReload(p);
    return;
  }

  // Fire mode check
  const fireMode = wep.data.fireMode || 'auto';
  if (fireMode === 'semi') {
    // Only fire on rising edge (shoot just pressed this frame)
    if (p.prevShoot) return;
  }

  p.lastShot = now;

  // Reset shotsFired if player stopped shooting for 200ms
  if (p.lastShotTime > 0 && now - p.lastShotTime > 0.2) {
    p.shotsFired = 0;
  }
  p.lastShotTime = now;
  p.shotsFired++;

  ammo.mag--;

  // Emit gunshot sound
  emitSound(p.x, p.y, SOUNDS.gunshot(wep.key), 1200);

  // Calculate spread: base + movement penalty + recoil penalty + crouch bonus
  const moving = Math.abs(p.vx) > 10 || Math.abs(p.vy) > 10;
  const sprinting = p.input.sprint && moving;

  let baseSpread;
  if (!moving) {
    baseSpread = wep.data.spread;                          // Standing still
  } else if (sprinting) {
    baseSpread = wep.data.moveSpread * 1.5;                // Sprinting
  } else {
    baseSpread = wep.data.moveSpread;                      // Walking
  }

  // Crouch bonus: 50% spread reduction
  if (p.crouching) {
    baseSpread *= 0.5;
  }

  // Recoil escalation for auto weapons
  let recoilPenalty = 0;
  if (fireMode === 'auto' && p.shotsFired > 1) {
    recoilPenalty = p.shotsFired * 0.005;
  }

  const spread = baseSpread + recoilPenalty;

  // Shotgun pellets
  const pellets = wep.data.pellets || 1;
  for (let i = 0; i < pellets; i++) {
    const angle = p.angle + (Math.random() - 0.5) * spread * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    bullets.push({
      x: p.x + cos * 16,
      y: p.y + sin * 16,
      vx: cos * 1500,
      vy: sin * 1500,
      owner: p.id,
      damage: wep.data.damage,
      range: wep.data.range,
      dist: 0,
      team: p.team,
      weaponKey: wep.key,
    });
  }
}

function startReload(p) {
  const wep = getCurrentWeapon(p);
  if (!wep || wep.key === 'knife' || p.reloading) return;
  const ammo = p.ammo[wep.key];
  if (!ammo || ammo.mag >= wep.data.magSize || ammo.reserve <= 0) return;
  p.reloading = true;
  p.reloadTimer = wep.data.reloadTime;
}

function updateBullets(dt) {
  const newBullets = [];
  for (const b of bullets) {
    const newX = b.x + b.vx * dt;
    const newY = b.y + b.vy * dt;
    const moveDist = Math.sqrt((newX - b.x) ** 2 + (newY - b.y) ** 2);
    b.dist += moveDist;

    if (b.dist > b.range) continue;

    // Wall hit
    if (isWall(gameMap, newX, newY)) {
      // Spawn impact effect
      io.emit('bullet_impact', { x: newX, y: newY });
      continue;
    }

    // Player hit
    let hit = false;
    for (const p of Object.values(players)) {
      if (!p.alive || p.team === b.team || p.id === b.owner) continue;
      const dx = newX - p.x;
      const dy = newY - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < C.PLAYER_RADIUS) {
        // Hit!
        let damage = b.damage;

        // Crouching damage reduction (30% less, simulating smaller hitbox)
        if (p.crouching) {
          damage *= 0.7;
        }

        // Headshot detection (top 30% of player circle)
        const weaponData = b.weaponKey ? C.WEAPONS[b.weaponKey] : null;
        const isHeadshot = dy < -C.PLAYER_RADIUS * 0.4;
        if (isHeadshot) {
          const canOneTap = weaponData && weaponData.oneTapHeadshot;
          if (!p.helmet || canOneTap) {
            damage *= 2.5; // Full headshot multiplier
            if (p.helmet) p.helmet = false; // Helmet consumed
          } else {
            damage *= 1.5; // Helmet reduces headshot multiplier
            p.helmet = false;
          }
        }

        // Armor damage reduction (uses weapon armorPenetration)
        if (p.armor > 0) {
          const ap = weaponData ? (weaponData.armorPenetration !== undefined ? weaponData.armorPenetration : 0.5) : 0.5;
          const absorbRate = (1 - ap) * 0.5; // Armor absorbs half of non-penetrating damage
          const absorbed = damage * absorbRate;
          const armorDmg = Math.min(p.armor, absorbed);
          p.armor -= armorDmg;
          damage -= armorDmg;
        }

        // AWP one-shot body: ensure minimum 100 damage after armor
        if (weaponData && weaponData.oneShotBody && !isHeadshot && damage < 100) {
          damage = 100;
        }

        p.hp -= damage;
        p.lastDamageBy = b.owner;

        // Track damage for MVP
        trackDamage(b.owner, damage);

        // Send damage direction info to victim
        const attacker = players[b.owner];
        if (attacker) {
          // Emit to the specific victim socket if connected, otherwise broadcast
          for (const [sockId, sock] of io.sockets.sockets) {
            if (sockId === p.id) {
              sock.emit('damage_taken', { attackerX: attacker.x, attackerY: attacker.y, damage, headshot: !!isHeadshot });
              break;
            }
          }
        }

        // Kill assist tracking
        io.emit('hit_marker', { target: p.id, damage, headshot: !!isHeadshot, kill: p.hp <= 0 });

        if (p.hp <= 0) {
          p.hp = 0;
          p.alive = false;
          p.deaths++;

          const killer = players[b.owner];
          if (killer) {
            killer.kills++;
            trackKill(killer.id);
            // Kill reward per weapon + headshot bonus
            const wepKey = getWeaponKeyForPlayer(killer);
            const weaponReward = wepKey === 'knife' ? KNIFE_WEAPON.reward : (C.WEAPONS[wepKey]?.reward || C.KILL_REWARD);
            let reward = weaponReward;
            if (isHeadshot) reward += 300; // Headshot bonus
            killer.money = Math.min(C.MAX_MONEY, killer.money + reward);
          }

          // Credit assist
          if (p.lastDamageBy && p.lastDamageBy !== b.owner && players[p.lastDamageBy]) {
            players[p.lastDamageBy].assists++;
          }

          // Drop weapon on death
          dropPrimaryWeaponOnDeath(p);

          emitSound(p.x, p.y, SOUNDS.player_death(), 600);
          if (isHeadshot) {
            emitSound(p.x, p.y, SOUNDS.headshot(), 800);
          }

          io.emit('player_killed', {
            victim: p.id,
            victimName: p.name,
            killer: b.owner,
            killerName: killer?.name || 'Unknown',
            weapon: getWeaponKeyForPlayer(killer || {}),
            headshot: isHeadshot,
          });
        }

        hit = true;
        break;
      }
    }

    if (!hit) {
      b.x = newX;
      b.y = newY;
      newBullets.push(b);
    }
  }
  bullets = newBullets;
}

function updateActiveGrenades(dt) {
  const newActive = [];
  for (const g of activeGrenades) {
    const oldX = g.x, oldY = g.y;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.vx *= 0.95;
    g.vy *= 0.95;
    g.timer -= dt;

    // Bounce off walls
    if (isWall(gameMap, g.x, g.y)) {
      g.vx *= -0.5;
      g.vy *= -0.5;
      g.x += g.vx * dt * 2;
      g.y += g.vy * dt * 2;
      // Emit bounce sound
      emitSound(g.x, g.y, SOUNDS.grenade_bounce(), 500);
    }

    if (g.timer <= 0) {
      detonateGrenade(g);
    } else {
      newActive.push(g);
    }
  }
  activeGrenades = newActive;
}

function detonateGrenade(g) {
  emitSound(g.x, g.y, SOUNDS.grenade_explode(g.type), 1500);

  if (g.type === 'he') {
    // HE explosion
    for (const p of Object.values(players)) {
      if (!p.alive) continue;
      if (p.id === g.owner) continue; // Don't damage self with own HE
      const dx = p.x - g.x;
      const dy = p.y - g.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < C.HE_RADIUS) {
        const falloff = 1 - (dist / C.HE_RADIUS);
        let damage = C.HE_DAMAGE * falloff;
        if (p.armor > 0) {
          const absorbed = damage * 0.5;
          p.armor -= Math.min(p.armor, absorbed);
          damage -= absorbed;
        }
        p.hp -= damage;
        if (p.hp <= 0) {
          p.hp = 0;
          p.alive = false;
          p.deaths++;
          if (g.owner && players[g.owner]) {
            players[g.owner].kills++;
            trackKill(g.owner);
          }
          dropPrimaryWeaponOnDeath(p);
          emitSound(p.x, p.y, SOUNDS.player_death(), 600);
          io.emit('player_killed', {
            victim: p.id, victimName: p.name,
            killer: g.owner, killerName: players[g.owner]?.name || 'Unknown',
            weapon: 'he_grenade', headshot: false,
          });
        }
      }
    }
    io.emit('grenade_explode', { type: 'he', x: g.x, y: g.y, radius: C.HE_RADIUS });
  } else if (g.type === 'flash') {
    io.emit('grenade_explode', { type: 'flash', x: g.x, y: g.y, radius: C.FLASH_RADIUS, duration: C.FLASH_DURATION });
  } else if (g.type === 'smoke') {
    grenades.push({ type: 'smoke', x: g.x, y: g.y, timer: C.SMOKE_DURATION, radius: C.SMOKE_RADIUS });
    io.emit('grenade_explode', { type: 'smoke', x: g.x, y: g.y, radius: C.SMOKE_RADIUS });
  }
}

function updateGrenades(dt) {
  grenades = grenades.filter(g => {
    g.timer -= dt;
    return g.timer > 0;
  });
}

function updateBomb(dt) {
  if (!bombState || !bombState.planted) return;

  bombState.timer -= dt;

  // Emit bomb beep sound periodically (more frequent as timer runs low)
  const beepInterval = bombState.timer > 10 ? 1.0 : 0.5;
  if (!bombState._lastBeep || Date.now() / 1000 - bombState._lastBeep > beepInterval) {
    bombState._lastBeep = Date.now() / 1000;
    emitSound(bombState.x, bombState.y, SOUNDS.bomb_beep(), 99999);
  }

  if (bombState.timer <= 0) {
    bombState.exploded = true;
    bombState.planted = false;
    // Kill everyone in radius
    for (const p of Object.values(players)) {
      if (!p.alive) continue;
      const dx = p.x - bombState.x;
      const dy = p.y - bombState.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < C.BOMB_BLAST_RADIUS) {
        p.hp = 0;
        p.alive = false;
        p.deaths++;
        dropPrimaryWeaponOnDeath(p);
        emitSound(p.x, p.y, SOUNDS.player_death(), 600);
      }
    }
    io.emit('bomb_exploded', { x: bombState.x, y: bombState.y, site: bombState.site });
    endRound('T', 'bomb');
    return;
  }

  // Defusing — check if defuser is still close enough (cancel if moved away)
  if (bombState.defuser) {
    const defuser = players[bombState.defuser];
    if (!defuser || !defuser.alive) {
      // Defuser died or disconnected
      bombState.defuser = null;
      bombState.defuseTimer = 0;
      io.emit('bomb_defuse_cancelled', { reason: 'disconnected' });
    } else {
      // Check distance — cancel if too far
      const dx = defuser.x - bombState.x;
      const dy = defuser.y - bombState.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 80) {
        // Moved away — cancel defuse
        bombState.defuser = null;
        bombState.defuseTimer = 0;
        defuser.defusingBomb = false;
        defuser.defuseProgress = 0;
        io.emit('bomb_defuse_cancelled', { reason: 'moved_away' });
      } else {
        bombState.defuseTimer -= dt;
        const totalDefuseTime = defuser.hasDefuseKit ? C.BOMB_DEFUSE_TIME * 0.5 : C.BOMB_DEFUSE_TIME;
        const progress = 1 - (bombState.defuseTimer / totalDefuseTime);

        // Emit defuse progress
        io.emit('bomb_defusing', { defuser: defuser.id, progress: Math.max(0, progress), timeLeft: Math.max(0, bombState.defuseTimer) });

        if (bombState.defuseTimer <= 0) {
          bombState.planted = false;
          bombState.defused = true;
          defuser.money = Math.min(C.MAX_MONEY, defuser.money + C.BOMB_DEFUSE_REWARD);
          defuser.defusingBomb = false;
          io.emit('bomb_defused', { site: bombState.site, defuser: bombState.defuser });
          endRound('CT', 'defuse');
        }
      }
    }
  }

  // Handle player-initiated planting progress
  if (bombState.planter && !bombState.planted) {
    // This shouldn't happen since planting is instant, but for future use
  }
}

function checkRoundEnd() {
  let tAlive = 0, ctAlive = 0;
  for (const p of Object.values(players)) {
    if (!p.alive || p.team === C.TEAM_SPEC) continue;
    if (p.team === 'T') tAlive++;
    else ctAlive++;
  }

  // Only check elimination if bomb not planted
  if (bombState && bombState.planted) {
    if (ctAlive === 0) {
      endRound('T', 'elimination');
    }
    return;
  }

  if (tAlive === 0 && ctAlive > 0) {
    endRound('CT', 'elimination');
  } else if (ctAlive === 0 && tAlive > 0) {
    endRound('T', 'elimination');
  } else if (tAlive === 0 && ctAlive === 0) {
    endRound('CT', 'draw'); // CT wins draws
  }
}

// ==================== SPECTATOR MODE ====================
function updateSpectator(p, dt) {
  // Free-roam with WASD
  let dx = 0, dy = 0;
  if (p.input.up) dy -= 1;
  if (p.input.down) dy += 1;
  if (p.input.left) dx -= 1;
  if (p.input.right) dx += 1;

  if (p.specTarget) {
    // Following a specific player
    const target = players[p.specTarget];
    if (!target || !target.alive || target.team === C.TEAM_SPEC) {
      p.specTarget = null;
    } else {
      // Follow target position
      p.specX = target.x;
      p.specY = target.y;
      // Allow free-roam offset
      if (dx !== 0 || dy !== 0) {
        const speed = 300;
        p.specX += dx * speed * dt;
        p.specY += dy * speed * dt;
      }
    }
  } else {
    // Free roam
    if (dx !== 0 || dy !== 0) {
      const speed = 400;
      const len = Math.sqrt(dx * dx + dy * dy);
      p.specX += (dx / len) * speed * dt;
      p.specY += (dy / len) * speed * dt;
    }
  }

  // Clamp to map bounds
  const maxX = C.MAP_WIDTH * C.TILE_SIZE;
  const maxY = C.MAP_HEIGHT * C.TILE_SIZE;
  p.specX = Math.max(0, Math.min(maxX, p.specX));
  p.specY = Math.max(0, Math.min(maxY, p.specY));

  // Store as player position for visibility purposes
  p.x = p.specX;
  p.y = p.specY;
}

function getAlivePlayersForSpectate() {
  return Object.values(players).filter(p => p.alive && p.team !== C.TEAM_SPEC);
}

function cycleSpectateTarget(p, direction) {
  const alive = getAlivePlayersForSpectate();
  if (alive.length === 0) {
    p.specTarget = null;
    return;
  }

  if (!p.specTarget) {
    p.specTarget = alive[0].id;
    return;
  }

  const currentIdx = alive.findIndex(pl => pl.id === p.specTarget);
  if (currentIdx === -1) {
    p.specTarget = alive[0].id;
    return;
  }

  const newIdx = (currentIdx + direction + alive.length) % alive.length;
  p.specTarget = alive[newIdx].id;
}

// ==================== BOT MANAGEMENT ====================
function updateBots(dt) {
  for (const p of Object.values(players)) {
    if (!p.isBot || !p.alive || p.team === C.TEAM_SPEC) continue;
    updateBot(p, dt, players, gameMap, gameState, bombState, bombsites, grenades);

    // Process bot pending grenades
    if (p._pendingGrenades && p._pendingGrenades.length > 0) {
      for (const g of p._pendingGrenades) {
        activeGrenades.push(g);
      }
      p._pendingGrenades = [];
    }

    // Bot weapon pickup (occasionally check)
    if (Math.random() < 0.01) {
      checkWeaponPickup(p);
    }

    // Bot defuse bomb (server-side since bots can't emit socket events)
    if (p.team === 'CT' && bombState && bombState.planted && !bombState.defused && !bombState.exploded && p.input.use) {
      const dx = p.x - bombState.x;
      const dy = p.y - bombState.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 80 && !bombState.defuser) {
        const defuseTime = p.hasDefuseKit ? C.BOMB_DEFUSE_TIME * 0.5 : C.BOMB_DEFUSE_TIME;
        bombState.defuser = p.id;
        bombState.defuseTimer = defuseTime;
        p.defusingBomb = true;
        io.emit('bomb_defusing', { defuser: p.id, progress: 0, timeLeft: defuseTime });
      }
    }
  }
  // Bot auto-plant bomb (server-side since bots can't emit socket events)
  if (gameState === 'playing' && (!bombState || !bombState.planted)) {
    for (const p of Object.values(players)) {
      if (!p.isBot || !p.alive || p.team !== 'T') continue;
      let site = null;
      if (isOnBombsite(gameMap, p.x, p.y, 'A')) site = 'A';
      else if (isOnBombsite(gameMap, p.x, p.y, 'B')) site = 'B';
      if (site && Math.random() < 0.02 * dt * 30) { // ~2% chance per tick when on site
        bombState = {
          site,
          x: bombsites[site].centerX,
          y: bombsites[site].centerY,
          planter: p.id,
          timer: C.BOMB_TIMER,
          defuser: null,
          defuseTimer: 0,
          planted: true,
          exploded: false,
          defused: false,
          plantProgress: 1,
          _lastBeep: null,
        };
        p.money = Math.min(C.MAX_MONEY, p.money + C.BOMB_PLANT_REWARD);
        io.emit('bomb_planted', { site, x: bombState.x, y: bombState.y, timer: C.BOMB_TIMER, planter: p.id });
        break;
      }
    }
  }
}

function botBuyDuringFreeze() {
  for (const p of Object.values(players)) {
    if (!p.isBot || !p.alive || p.team === C.TEAM_SPEC) continue;
    if (p._botBought) continue;
    const items = addBotBuyLogic(p);
    // addBotBuyLogic returns an array of items to buy in priority order
    if (items && items.length > 0) {
      for (const item of items) {
        handleBuy(p, item);
      }
    }
    p._botBought = true;
  }
}

function addBotsToGame() {
  const tPlayers = Object.values(players).filter(p => p.team === 'T');
  const ctPlayers = Object.values(players).filter(p => p.team === 'CT');
  const tBots = tPlayers.filter(p => p.isBot).length;
  const ctBots = ctPlayers.filter(p => p.isBot).length;

  // Ensure each team has at least 3 bots
  const tNeeded = Math.max(0, 3 - tBots);
  const ctNeeded = Math.max(0, 3 - ctBots);

  const tNew = spawnBotsForTeam(players, 'T', tNeeded);
  const ctNew = spawnBotsForTeam(players, 'CT', ctNeeded);

  for (const bot of [...tNew, ...ctNew]) {
    players[bot.id] = bot;
    giveDefaultWeapons(bot);
    spawnPlayer(bot);
    // Override spawn position with open map position to avoid spawn room walls
    const openPos = randomMapPoint(gameMap);
    bot.x = openPos.x;
    bot.y = openPos.y;
    if (gameState === 'playing' || gameState === 'freeze') {
      bot.money = C.START_MONEY;
    }
  }

  broadcastPlayerList();
  return { t: tNew.length, ct: ctNew.length };
}

function removeAllBots() {
  let count = 0;
  for (const [id, p] of Object.entries(players)) {
    if (p.isBot) {
      delete players[id];
      count++;
    }
  }
  broadcastPlayerList();
  return count;
}

// ==================== NETWORKING ====================
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  players[socket.id] = createPlayer(socket.id, socket.handshake.query.name);

  // Send initial state
  socket.emit('welcome', {
    id: socket.id,
    mapWidth: C.MAP_WIDTH,
    mapHeight: C.MAP_HEIGHT,
    tileSize: C.TILE_SIZE,
    gameState,
    round: roundNumber,
    tScore,
    ctScore,
    roundHistory,
  });

  // Send map
  socket.emit('map_data', { map: gameMap, bombsites });

  // Broadcast player list
  broadcastPlayerList();

  socket.on('join_team', (team) => {
    const p = players[socket.id];
    if (!p) return;
    if (team !== 'T' && team !== 'CT' && team !== 'SPEC') return;

    // Block mid-match team switching via join_team (use switch_team instead)
    if (gameState === 'playing' && p.team !== C.TEAM_SPEC && p.team !== team) {
      socket.emit('error', 'Cannot switch teams during a round. Use ESC menu.');
      return;
    }

    // Auto-balance: limit to 10 per team
    const teamCount = Object.values(players).filter(pl => pl.team === team).length;
    if (team !== 'SPEC' && teamCount >= 10) {
      socket.emit('error', 'Team is full (max 10 players)');
      return;
    }

    p.team = team;
    if (team === 'SPEC') {
      p.specTarget = null;
      p.specX = C.MAP_WIDTH * C.TILE_SIZE / 2;
      p.specY = C.MAP_HEIGHT * C.TILE_SIZE / 2;
      p.alive = false;
      p.weapons = [];
      p.currentWeapon = -1;
    } else {
      giveDefaultWeapons(p);
      spawnPlayer(p);
      // If joining mid-game, give starting money and mark as alive
      if (gameState === 'playing') {
        p.money = Math.min(p.money, C.START_MONEY);
      }
    }

    broadcastPlayerList();
    io.emit('player_joined_team', {
      id: socket.id, name: p.name, team,
    });
    // Send current game state to the joining player
    socket.emit('game_state', { state: gameState, round: roundNumber, tScore, ctScore, roundHistory });
  });

  // Explicit mid-match team switch (from ESC menu)
  socket.on('switch_team', (team) => {
    const p = players[socket.id];
    if (!p) return;
    if (team !== 'T' && team !== 'CT' && team !== 'SPEC') return;
    if (p.team === team) return; // already on this team

    // Kill the player if alive
    if (p.alive) {
      p.alive = false;
      p.hp = 0;
    }

    p.team = team;
    p.vx = 0;
    p.vy = 0;
    p.input = { up: false, down: false, left: false, right: false, shoot: false, reload: false, sprint: false, crouch: false };

    if (team === 'SPEC') {
      p.weapons = [];
      p.currentWeapon = -1;
      p.specTarget = null;
      p.specX = p.x;
      p.specY = p.y;
    } else {
      giveDefaultWeapons(p);
      // Player respawns next round
    }

    broadcastPlayerList();
    io.emit('player_joined_team', { id: socket.id, name: p.name, team });
    socket.emit('game_state', { state: gameState, round: roundNumber, tScore, ctScore, roundHistory });
  });

  socket.on('update_input', (input) => {
    const p = players[socket.id];
    if (!p) return;
    p.input = { ...p.input, ...input };
  });

  socket.on('update_angle', (angle) => {
    const p = players[socket.id];
    if (!p) return;
    p.angle = angle;
  });

  socket.on('shoot', () => {
    const p = players[socket.id];
    if (!p) return;
    p.input.shoot = true;
    setTimeout(() => { if (players[socket.id]) players[socket.id].input.shoot = false; }, 50);
  });

  socket.on('reload', () => {
    const p = players[socket.id];
    if (!p) return;
    startReload(p);
  });

  socket.on('switch_weapon', (index) => {
    const p = players[socket.id];
    if (!p) return;

    // index -1 = knife (always available)
    // index 0..weapons.length-1 = weapon slots
    if (index === -1 || index === 'knife') {
      p.currentWeapon = -1; // knife
      p.reloading = false;
      return;
    }

    if (typeof index === 'string' && index === 'knife') {
      p.currentWeapon = -1;
      p.reloading = false;
      return;
    }

    const idx = parseInt(index);
    if (isNaN(idx) || idx < 0 || idx >= p.weapons.length) return;
    p.currentWeapon = idx;
    p.reloading = false;
  });

  // Scroll weapon switch (up/down cycle)
  socket.on('scroll_weapon', (direction) => {
    const p = players[socket.id];
    if (!p) return;

    // If spectator, cycle spectate target instead
    if (p.team === C.TEAM_SPEC) {
      cycleSpectateTarget(p, direction === 1 ? 1 : -1);
      return;
    }

    if (!p.alive) return;

    // Cycle through weapons: knife -> slot0 -> slot1 -> ... -> knife
    const totalSlots = p.weapons.length + 1; // +1 for knife
    let currentSlot = p.currentWeapon + 1; // +1 because knife is -1
    if (currentSlot < 0) currentSlot = 0;

    const newSlot = ((currentSlot + direction) % totalSlots + totalSlots) % totalSlots;
    p.currentWeapon = newSlot - 1; // back to -1 for knife
    p.reloading = false;
  });

  socket.on('buy', (item) => {
    const p = players[socket.id];
    if (!p) return;
    handleBuy(p, item);
    socket.emit('player_update', serializePlayer(p));
  });

  socket.on('plant_bomb', () => {
    const p = players[socket.id];
    if (!p || p.team !== 'T' || !p.alive || bombState?.planted) return;

    // Check if on bombsite
    let site = null;
    if (isOnBombsite(gameMap, p.x, p.y, 'A')) site = 'A';
    else if (isOnBombsite(gameMap, p.x, p.y, 'B')) site = 'B';
    if (!site) return;

    bombState = {
      site,
      x: bombsites[site].centerX,
      y: bombsites[site].centerY,
      planter: p.id,
      timer: C.BOMB_TIMER,
      defuser: null,
      defuseTimer: 0,
      planted: true,
      exploded: false,
      defused: false,
      plantProgress: 1,
      _lastBeep: null,
    };

    p.money = Math.min(C.MAX_MONEY, p.money + C.BOMB_PLANT_REWARD);
    io.emit('bomb_planted', { site, x: bombState.x, y: bombState.y, timer: C.BOMB_TIMER, planter: p.id });
  });

  socket.on('defuse_bomb', () => {
    const p = players[socket.id];
    if (!p || p.team !== 'CT' || !p.alive || !bombState?.planted) return;

    const dx = p.x - bombState.x;
    const dy = p.y - bombState.y;
    if (Math.sqrt(dx * dx + dy * dy) > 80) return;

    const defuseTime = p.hasDefuseKit ? C.BOMB_DEFUSE_TIME * 0.5 : C.BOMB_DEFUSE_TIME;
    bombState.defuser = p.id;
    bombState.defuseTimer = defuseTime;
    p.defusingBomb = true;
    io.emit('bomb_defusing', { defuser: p.id, progress: 0, timeLeft: defuseTime });
  });

  // Cancel defuse (explicit)
  socket.on('cancel_defuse', () => {
    const p = players[socket.id];
    if (!p) return;
    if (bombState && bombState.defuser === p.id) {
      bombState.defuser = null;
      bombState.defuseTimer = 0;
      p.defusingBomb = false;
      p.defuseProgress = 0;
      io.emit('bomb_defuse_cancelled', { reason: 'cancelled' });
    }
  });

  socket.on('throw_grenade', (type) => {
    const p = players[socket.id];
    if (!p || !p.alive) return;

    const gMap = { he: 'he_grenade', flash: 'flashbang', smoke: 'smoke' };
    const gKey = gMap[type];
    if (!gKey || p.grenades[type] <= 0) return;

    p.grenades[type]--;
    const cos = Math.cos(p.angle);
    const sin = Math.sin(p.angle);

    activeGrenades.push({
      type,
      x: p.x + cos * 20,
      y: p.y + sin * 20,
      vx: cos * C.GRENADE_THROW_SPEED,
      vy: sin * C.GRENADE_THROW_SPEED,
      owner: p.id,
      timer: type === 'smoke' ? 1.5 : (type === 'flash' ? 1.0 : 1.5),
      team: p.team,
    });
  });

  // Spectator: click on player to spectate them
  socket.on('spectate_player', (targetId) => {
    const p = players[socket.id];
    if (!p || p.team !== C.TEAM_SPEC) return;
    const target = players[targetId];
    if (!target || !target.alive || target.team === C.TEAM_SPEC) return;
    p.specTarget = targetId;
  });

  // Spectator: stop spectating, go to free roam
  socket.on('spectate_free', () => {
    const p = players[socket.id];
    if (!p || p.team !== C.TEAM_SPEC) return;
    p.specTarget = null;
  });

  socket.on('start_game', () => {
    const tCount = Object.values(players).filter(p => p.team === 'T').length;
    const ctCount = Object.values(players).filter(p => p.team === 'CT').length;
    if (tCount < 1 || ctCount < 1) {
      socket.emit('error', 'Need at least 1 player on each team');
      return;
    }
    startGame();
  });

  socket.on('restart_game', () => {
    gameState = 'waiting';
    roundNumber = 0;
    tScore = 0;
    ctScore = 0;
    bombState = null;
    roundHistory = [];
    droppedWeapons = [];
    roundEndTimer = 0;
    gameOverTimer = 0;
    // Keep bots, reset their stats too
    for (const [id, p] of Object.entries(players)) {
      p.kills = 0;
      p.deaths = 0;
      p.assists = 0;
      p.money = C.START_MONEY;
    }
    io.emit('game_restart');
    io.emit('game_state', { state: gameState, round: 0, tScore: 0, ctScore: 0, roundHistory });
  });

  socket.on('add_bots', () => {
    const result = addBotsToGame();
    socket.emit('bots_added', result);
  });

  socket.on('remove_bots', () => {
    const count = removeAllBots();
    socket.emit('bots_removed', { count });
  });

  socket.on('chat_message', (data) => {
    const p = players[socket.id];
    if (!p) return;
    const message = (data.message || '').substring(0, 100);
    if (!message.trim()) return;
    const teamOnly = !!data.teamOnly;
    const chatData = { name: p.name, team: p.team, message, teamOnly };
    if (teamOnly) {
      // Send only to teammates
      Object.keys(players).forEach(id => {
        if (players[id].team === p.team) {
          io.to(id).emit('chat', chatData);
        }
      });
    } else {
      io.emit('chat', chatData);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    const p = players[socket.id];
    if (p) {
      delete players[socket.id];
      broadcastPlayerList();
      // If someone was spectating this player, reset their target
      for (const other of Object.values(players)) {
        if (other.specTarget === socket.id) {
          other.specTarget = null;
        }
      }
      // Game keeps running even without real players — bots play on
    }
  });
});

function serializePlayer(p) {
  return {
    id: p.id,
    name: p.name,
    team: p.team,
    x: p.x, y: p.y,
    hp: p.hp,
    armor: p.armor,
    helmet: p.helmet,
    money: p.money,
    alive: p.alive,
    weapons: p.weapons,
    currentWeapon: p.currentWeapon,
    ammo: p.ammo,
    grenades: p.grenades,
    hasDefuseKit: p.hasDefuseKit,
    angle: p.angle,
    reloading: p.reloading,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    isBot: p.isBot || false,
    crouching: p.crouching,
    crouchTransition: p.crouchTransition,
    sprinting: p.sprinting,
    // Spectator data
    specTarget: p.specTarget,
  };
}

function broadcastPlayerList() {
  const list = {};
  for (const [id, p] of Object.entries(players)) {
    list[id] = {
      id: p.id,
      name: p.name,
      team: p.team,
      kills: p.kills,
      deaths: p.deaths,
      money: p.money,
      alive: p.alive,
      connected: p.connected,
    };
  }
  io.emit('player_list', list);
}

// ==================== GAME LOOP ====================
const HEAR_RANGE = 500;  // px – enemies shooting within this range are "heard"
const VISIBILITY_RADIUS = 600; // px – max view distance for fog-of-war

let lastTime = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  update(Math.min(dt, 0.05)); // cap dt

  // Build base state (non-player data shared to everyone)
  const baseState = {
    players: {},
    bullets,
    grenades: grenades.map(g => ({ type: g.type, x: g.x, y: g.y, radius: g.radius, timer: g.timer })),
    activeGrenades: activeGrenades.map(g => ({ type: g.type, x: g.x, y: g.y })),
    bomb: bombState,
    droppedWeapons: droppedWeapons.map(dw => ({ id: dw.id, weaponKey: dw.weaponKey, x: dw.x, y: dw.y })),
    roundTimer,
    freezeTimer,
    roundEndTimer,
    gameState,
    round: roundNumber,
    tScore,
    ctScore,
    roundHistory,
    mvp: roundMVP,
  };

  // Find all connected sockets
  const connectedSockets = io.sockets.sockets;

  // Send state to each client with fog-of-war filtering
  for (const [socketId, socket] of connectedSockets) {
    const me = players[socketId];
    if (!me) continue;

    const myState = { ...baseState, players: {} };

    // Determine bomb carrier for T team visibility
    let bombCarrier = null;
    if (bombState && !bombState.planted && bombState.planter) {
      bombCarrier = bombState.planter;
    }
    // If bomb not planted and no planter set, find the T player who "has" the bomb
    // (In this implementation, any T on a bombsite can plant, so we show bomb carrier as
    //  the first alive T player as a visual indicator)

    for (const [id, p] of Object.entries(players)) {
      // Always include self
      if (id === socketId) {
        myState.players[id] = serializePlayer(p);
        continue;
      }

      // Always include teammates (full visibility)
      if (p.team === me.team && me.team !== C.TEAM_SPEC) {
        myState.players[id] = serializePlayer(p);
        continue;
      }

      // Spectators see everyone
      if (me.team === C.TEAM_SPEC) {
        myState.players[id] = serializePlayer(p);
        continue;
      }

      // Skip dead / spec enemies
      if (!p.alive || p.team === C.TEAM_SPEC) continue;

      // Enemy – check visibility
      const dx = p.x - me.x;
      const dy = p.y - me.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Check line of sight (and within view distance)
      const canSee = dist <= VISIBILITY_RADIUS && lineOfSight(gameMap, me.x, me.y, p.x, p.y) && !lineBlockedBySmoke(me.x, me.y, p.x, p.y, grenades);

      // Check if enemy is making noise (shot within last 0.5s) and within hearing range
      const shootingNow = (now / 1000) - (p.lastShotTime || 0) < 0.5;
      const canHear = shootingNow && dist <= HEAR_RANGE;

      if (canSee) {
        myState.players[id] = serializePlayer(p);
      } else if (canHear) {
        // Heard but not seen – send limited data + flag
        myState.players[id] = {
          ...serializePlayer(p),
          noiseVisible: true,  // client shows as dimmed minimap dot
        };
      }
      // Otherwise enemy is completely hidden – do not include
    }

    // Include bomb carrier indicator
    if (bombCarrier && myState.players[bombCarrier]) {
      myState.players[bombCarrier].hasBomb = true;
    }

    socket.emit('game_state_update', myState);
  }
}, 1000 / C.TICK_RATE);

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`CS Top-Down server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
  // Auto-start: add bots and kick off the game immediately
  autoStartGame();
});

// ==================== AUTO-RUN (like real CS) ====================
function autoStartGame() {
  // Add bots to both teams
  addBotsToGame();
  // Start the match
  startGame();
  console.log('Auto-started game with bots');
}
