// CS Top-Down Shooter - Game Server
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const C = require('./shared/constants');
const { generateMap, getSpawnPoints, getBombsites, isWall, isOnBombsite, lineOfSight,
  TILE_WALL, TILE_CRATE, TILE_BOMBSITE_A, TILE_BOMBSITE_B, TILE_T_SPAWN, TILE_CT_SPAWN, TILE_DOOR, TILE_EMPTY } = require('./shared/map');
const { createBot, updateBot, spawnBotsForTeam, addBotBuyLogic, getCurrentWeapon: getBotWeapon, BOT_PREFIX, randomMapPoint } = require('./server/bots');

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
let bombState = null;     // { site, x, y, planter, timer, defuser, defuseTimer, planted: bool, exploded: bool }
let damageIndicators = [];

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
    weapons: [],       // array of weapon keys
    currentWeapon: -1, // index into weapons
    ammo: {},          // { weaponKey: { mag, reserve } }
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
    // Plant / defuse progress
    plantProgress: 0,
    plantSite: null,
    defusing: false,
    lastMoveTime: 0,
    connected: true,
    ping: 0,
  };
}

function spawnPlayer(player) {
  const spawns = player.team === 'T' ? tSpawns : ctSpawns;
  if (!spawns || spawns.length === 0) {
    console.warn('[spawnPlayer] no spawns for team', player.team, '- using map center');
    player.x = C.MAP_WIDTH * C.TILE_SIZE / 2;
    player.y = C.MAP_HEIGHT * C.TILE_SIZE / 2;
  } else {
    const sp = spawns[Math.floor(Math.random() * spawns.length)];
    player.x = sp.x + (Math.random() - 0.5) * 30;
    player.y = sp.y + (Math.random() - 0.5) * 30;
  }
  player.hp = C.PLAYER_MAX_HP;
  player.alive = true;
  player.reloading = false;
  player.reloadTimer = 0;
  player.lastDamageBy = null;
  player.vx = 0;
  player.vy = 0;
  // Defensive: reset angle if bogus
  if (!Number.isFinite(player.angle)) player.angle = 0;
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
  player.currentWeapon = 0;
  player.grenades = { he: 0, flash: 0, smoke: 0 };
  player.hasDefuseKit = false;
  player.knife = true;
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

  for (const p of Object.values(players)) {
    if (p.team !== C.TEAM_SPEC) {
      p.money = C.START_MONEY;
      giveDefaultWeapons(p);
      spawnPlayer(p);
      if (p.isBot) p._botBought = false;
    }
  }

  freezeTimer = C.FREEZE_TIME;
  io.emit('round_start', { round: roundNumber, tScore, ctScore, freezeTime: C.FREEZE_TIME });
  io.emit('game_state', { state: gameState, round: roundNumber, tScore, ctScore });
}

function startRound() {
  gameState = 'playing';
  roundTimer = C.ROUND_TIME;
  bombState = null;
  bullets = [];
  activeGrenades = [];
  grenades = [];

  for (const p of Object.values(players)) {
    if (p.team !== C.TEAM_SPEC) {
      resetPlayerRound(p);
    }
  }

  io.emit('round_live', { round: roundNumber, tScore, ctScore });
  io.emit('game_state', { state: gameState, round: roundNumber, tScore, ctScore });
}

function endRound(winner, reason) {
  if (gameState === 'round_end' || gameState === 'game_over') return; // Prevent double-call
  gameState = 'round_end';

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

  io.emit('round_end', {
    winner,
    reason,
    tScore,
    ctScore,
    round: roundNumber,
  });

  // Check game over
  if (tScore >= C.ROUNDS_TO_WIN || ctScore >= C.ROUNDS_TO_WIN) {
    setTimeout(() => {
      gameState = 'game_over';
      const gameWinner = tScore >= C.ROUNDS_TO_WIN ? 'T' : 'CT';
      io.emit('game_over', { winner: gameWinner, tScore, ctScore });
    }, 3000);
    return;
  }

  // Next round after delay
  setTimeout(() => {
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

    io.emit('round_start', { round: roundNumber, tScore, ctScore, freezeTime: C.FREEZE_TIME });
    io.emit('game_state', { state: gameState, round: roundNumber, tScore, ctScore });
  }, 5000);
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
      player.weapons.splice(idx, 1);
      // Fix currentWeapon index
      if (player.currentWeapon >= player.weapons.length) player.currentWeapon = player.weapons.length - 1;
    }
  } else if (weapon.type === 'pistol' && player.weapons.length >= 2) {
    // Replace current pistol
    const pistolIdx = player.weapons.findIndex(w => C.WEAPONS[w]?.type === 'pistol');
    if (pistolIdx >= 0) {
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
  processPlantDefuse(dt);
  updateBomb(dt);
  updateBots(dt);
  checkRoundEnd();
}

// Plant/defuse progression driven by player input ('use' = E held)
function processPlantDefuse(dt) {
  for (const p of Object.values(players)) {
    if (!p.alive || p.team === C.TEAM_SPEC) continue;
    const holdingUse = !!p.input.use;

    // ----- PLANTING (T only, bomb not planted) -----
    if (p.team === 'T' && (!bombState || !bombState.planted)) {
      let site = null;
      if (isOnBombsite(gameMap, p.x, p.y, 'A')) site = 'A';
      else if (isOnBombsite(gameMap, p.x, p.y, 'B')) site = 'B';

      // Only one planter at a time — first come, first serve
      const alreadyPlanting = Object.values(players)
        .some(o => o !== p && o.team === 'T' && o.plantProgress > 0);

      if (holdingUse && site && !alreadyPlanting) {
        p.plantSite = site;
        p.plantProgress += dt;
        if (p.plantProgress >= C.BOMB_PLANT_TIME) {
          // Plant the bomb
          bombState = {
            site,
            x: bombsites[site].centerX,
            y: bombsites[site].centerY,
            planter: p.id,
            timer: C.BOMB_TIMER,
            defuser: null,
            defuseTimer: 0,
            defuseTotalTime: 0,
            planted: true,
            exploded: false,
            defused: false,
            plantProgress: 0,
          };
          p.money = Math.min(C.MAX_MONEY, p.money + C.BOMB_PLANT_REWARD);
          p.plantProgress = 0;
          p.plantSite = null;
          io.emit('bomb_planted', { site, x: bombState.x, y: bombState.y, timer: C.BOMB_TIMER });
        }
      } else {
        p.plantProgress = 0;
        p.plantSite = null;
      }
    } else if (p.plantProgress > 0) {
      p.plantProgress = 0;
      p.plantSite = null;
    }

    // ----- DEFUSING (CT only, bomb planted) -----
    if (p.team === 'CT' && bombState && bombState.planted) {
      const dx = p.x - bombState.x;
      const dy = p.y - bombState.y;
      const inRange = (dx * dx + dy * dy) < (60 * 60);
      const currentDefuser = bombState.defuser;
      const canDefuse = inRange && holdingUse &&
        (!currentDefuser || currentDefuser === p.id);

      if (canDefuse) {
        if (bombState.defuser !== p.id) {
          bombState.defuser = p.id;
          const defuseTime = p.hasDefuseKit ? C.BOMB_DEFUSE_TIME * 0.5 : C.BOMB_DEFUSE_TIME;
          bombState.defuseTimer = defuseTime;
          bombState.defuseTotalTime = defuseTime;
          io.emit('bomb_defusing', { defuser: p.id, time: defuseTime });
        }
        p.defusing = true;
      } else {
        if (bombState.defuser === p.id) {
          bombState.defuser = null;
          bombState.defuseTimer = 0;
        }
        p.defusing = false;
      }
    } else {
      p.defusing = false;
    }
  }
}

function updatePlayersFrozen(dt) {
  // Allow movement in spawn but can't leave spawn area
  for (const p of Object.values(players)) {
    if (!p.alive || p.team === C.TEAM_SPEC) continue;
    applyMovement(p, dt);
  }
}

function updatePlayers(dt) {
  for (const p of Object.values(players)) {
    if (!p.alive || p.team === C.TEAM_SPEC) continue;

    // Reloading
    if (p.reloading) {
      p.reloadTimer -= dt;
      if (p.reloadTimer <= 0) {
        const wep = getCurrentWeapon(p);
        if (wep) {
          const ammo = p.ammo[wep.key];
          const needed = wep.data.magSize - ammo.mag;
          const available = Math.min(needed, ammo.reserve);
          ammo.mag += available;
          ammo.reserve -= available;
        }
        p.reloading = false;
      }
    }

    // Movement
    applyMovement(p, dt);

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

  const speed = p.input.sprint ? C.PLAYER_SPRINT_SPEED : C.PLAYER_SPEED;
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

function getCurrentWeapon(p) {
  if (p.currentWeapon < 0 || p.currentWeapon >= p.weapons.length) return null;
  const key = p.weapons[p.currentWeapon];
  const data = C.WEAPONS[key];
  return data ? { key, data } : null;
}

function shoot(p) {
  const wep = getCurrentWeapon(p);
  if (!wep) return;

  // Defensive: don't fire if player state is bogus
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.angle)) return;

  const now = Date.now() / 1000;
  const fireInterval = 1 / wep.data.fireRate;
  if (now - p.lastShot < fireInterval) return;

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
  // bolt and pump are naturally limited by their slow fireRate — no extra logic needed

  p.lastShot = now;

  // Reset shotsFired if player stopped shooting for 200ms
  if (p.lastShotTime > 0 && now - p.lastShotTime > 0.2) {
    p.shotsFired = 0;
  }
  p.lastShotTime = now;
  p.shotsFired++;

  ammo.mag--;

  // Calculate spread: base + movement penalty + recoil penalty
  const moving = Math.abs(p.vx) > 10 || Math.abs(p.vy) > 10;
  const sprinting = p.input.sprint && moving;

  let baseSpread;
  if (!moving) {
    baseSpread = wep.data.spread;                          // Standing still
  } else if (sprinting) {
    baseSpread = wep.data.moveSpread * 1.8;                // Sprinting — severe
  } else {
    baseSpread = wep.data.moveSpread;                      // Walking
  }

  // Recoil escalation — accumulates per shot, decays over time between shots.
  // Apply to all fire modes so mindless spam is always punished.
  const maxRecoil = wep.data.type === 'sniper' ? 0.04
    : wep.data.type === 'rifle' ? 0.18
    : wep.data.type === 'smg' ? 0.20
    : wep.data.type === 'shotgun' ? 0.10
    : 0.14; // pistols
  const perShot = wep.data.type === 'sniper' ? 0.02
    : wep.data.type === 'rifle' ? 0.011
    : wep.data.type === 'smg' ? 0.009
    : wep.data.type === 'shotgun' ? 0.05
    : 0.010;
  // First shot is always accurate
  const recoilPenalty = Math.min(maxRecoil, Math.max(0, p.shotsFired - 1) * perShot);

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
      armorPen: wep.data.armorPenetration != null ? wep.data.armorPenetration : 0.5,
      weaponKey: wep.key,
    });
  }
}

function startReload(p) {
  const wep = getCurrentWeapon(p);
  if (!wep || p.reloading) return;
  const ammo = p.ammo[wep.key];
  if (!ammo || ammo.mag >= wep.data.magSize || ammo.reserve <= 0) return;
  p.reloading = true;
  p.reloadTimer = wep.data.reloadTime;
}

function updateBullets(dt) {
  const newBullets = [];
  for (const b of bullets) {
    // Defensive: drop any bullet with invalid data
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) ||
        !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) {
      continue;
    }
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

        // Damage falloff — shots past 60% of effective range start losing power
        // (gradient from 100% to 60% damage at max range)
        const falloffStart = b.range * 0.6;
        if (b.dist > falloffStart) {
          const excess = (b.dist - falloffStart) / (b.range - falloffStart);
          damage *= 1 - excess * 0.4;
        }

        // Headshot detection — in top-down, a "headshot" is a near-center hit.
        // Tight center cluster (~35% of radius) is considered a head hit.
        const isHeadshot = dist < C.PLAYER_RADIUS * 0.35;
        if (isHeadshot && !p.helmet) {
          damage *= 2.5; // Instant kill for most rifles
        } else if (isHeadshot && p.helmet) {
          damage *= 1.5;
          p.helmet = false; // Helmet absorbs first HS
        }

        // Armor damage reduction — rifles with armor penetration hurt more through kevlar
        if (p.armor > 0) {
          const ap = b.armorPen != null ? b.armorPen : 0.5;
          const absorbed = damage * (1 - ap);
          const armorDmg = Math.min(p.armor, absorbed);
          p.armor -= armorDmg;
          damage -= armorDmg;
        }

        // Never deal negative damage
        damage = Math.max(1, damage);

        p.hp -= damage;
        p.lastDamageBy = b.owner;

        // Kill assist tracking
        io.emit('hit_marker', { x: p.x, y: p.y, damage });

        if (p.hp <= 0) {
          p.hp = 0;
          p.alive = false;
          p.deaths++;

          const killer = players[b.owner];
          if (killer) {
            killer.kills++;
            killer.money = Math.min(C.MAX_MONEY, killer.money + (C.WEAPONS[getCurrentWeapon(killer)?.key]?.reward || C.KILL_REWARD));
          }

          // Credit assist
          if (p.lastDamageBy && p.lastDamageBy !== b.owner && players[p.lastDamageBy]) {
            players[p.lastDamageBy].assists++;
          }

          io.emit('player_killed', {
            victim: p.id,
            victimName: p.name,
            killer: b.owner,
            killerName: killer?.name || 'Unknown',
            weapon: b.weaponKey || getCurrentWeapon(killer || {})?.key || 'unknown',
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
    // Step X and Y independently so walls properly block one axis at a time
    const nextX = g.x + g.vx * dt;
    const nextY = g.y + g.vy * dt;

    if (!isWall(gameMap, nextX, g.y)) {
      g.x = nextX;
    } else {
      g.vx = -g.vx * 0.55;                 // bounce X
    }
    if (!isWall(gameMap, g.x, nextY)) {
      g.y = nextY;
    } else {
      g.vy = -g.vy * 0.55;                 // bounce Y
    }

    // Air drag
    g.vx *= 0.97;
    g.vy *= 0.97;
    g.timer -= dt;

    // HE grenades hurt when they detonate mid-flight; flash/smoke just need to land
    if (g.timer <= 0) {
      detonateGrenade(g);
    } else {
      newActive.push(g);
    }
  }
  activeGrenades = newActive;
}

function detonateGrenade(g) {
  if (g.type === 'he') {
    // HE explosion
    for (const p of Object.values(players)) {
      if (!p.alive) continue;
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
          if (g.owner && players[g.owner]) players[g.owner].kills++;
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
      }
    }
    io.emit('bomb_exploded', { x: bombState.x, y: bombState.y, site: bombState.site });
    endRound('T', 'bomb');
    return;
  }

  // Defusing — only tick down while the committed defuser is alive AND still at the bomb
  if (bombState.defuser) {
    const defuser = players[bombState.defuser];
    const stillDefusing = defuser && defuser.alive && defuser.defusing;
    if (stillDefusing) {
      bombState.defuseTimer -= dt;
      if (bombState.defuseTimer <= 0) {
        bombState.planted = false;
        bombState.defused = true;
        defuser.money = Math.min(C.MAX_MONEY, defuser.money + C.BOMB_DEFUSE_REWARD);
        io.emit('bomb_defused', { site: bombState.site, defuser: bombState.defuser });
        endRound('CT', 'defuse');
      }
    } else {
      // Defuser left the bomb or died — reset progress
      bombState.defuser = null;
      bombState.defuseTimer = 0;
    }
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

// ==================== BOT MANAGEMENT ====================
function updateBots(dt) {
  for (const p of Object.values(players)) {
    if (!p.isBot || !p.alive || p.team === C.TEAM_SPEC) continue;
    updateBot(p, dt, players, gameMap, gameState, bombState, bombsites);

    // Collect any grenades the bot decided to throw this tick
    if (p._pendingGrenades && p._pendingGrenades.length) {
      for (const g of p._pendingGrenades) {
        activeGrenades.push(g);
      }
      p._pendingGrenades.length = 0;
    }
  }
}

function botBuyDuringFreeze() {
  for (const p of Object.values(players)) {
    if (!p.isBot || !p.alive || p.team === C.TEAM_SPEC) continue;
    if (p._botBought) continue;
    const items = addBotBuyLogic(p);
    if (Array.isArray(items)) {
      for (const item of items) {
        handleBuy(p, item);
      }
    } else if (typeof items === 'string') {
      handleBuy(p, items);
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
  const botsToAdd = [];
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
    if (team !== 'SPEC') {
      giveDefaultWeapons(p);
      spawnPlayer(p);
      // If joining mid-game, give starting money and mark as alive
      if (gameState === 'playing') {
        p.money = Math.min(p.money, C.START_MONEY);
        // Player will be alive but join the current round
        // If all enemies are dead, they'll be in the next round
      }
    }

    broadcastPlayerList();
    io.emit('player_joined_team', { 
      id: socket.id, name: p.name, team,
    });
    // Send current game state to the joining player
    socket.emit('game_state', { state: gameState, round: roundNumber, tScore, ctScore });
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
    p.input = { up: false, down: false, left: false, right: false, shoot: false, reload: false, sprint: false };

    if (team === 'SPEC') {
      p.weapons = [];
      p.currentWeapon = -1;
    } else {
      giveDefaultWeapons(p);
      // Player respawns next round
    }

    broadcastPlayerList();
    io.emit('player_joined_team', { id: socket.id, name: p.name, team });
    socket.emit('game_state', { state: gameState, round: roundNumber, tScore, ctScore });
  });

  socket.on('update_input', (input) => {
    const p = players[socket.id];
    if (!p) return;
    p.input = { ...p.input, ...input };
  });

  socket.on('update_angle', (angle) => {
    const p = players[socket.id];
    if (!p) return;
    if (!Number.isFinite(angle)) return;
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
    if (!p || index < 0 || index >= p.weapons.length) return;
    p.currentWeapon = index;
    p.reloading = false;
  });

  socket.on('buy', (item) => {
    const p = players[socket.id];
    if (!p) return;
    handleBuy(p, item);
    socket.emit('player_update', serializePlayer(p));
  });

  // Legacy plant/defuse events — kept for backward compat, now route to `use` input.
  socket.on('plant_bomb', () => {
    const p = players[socket.id];
    if (p) p.input.use = true;
  });

  socket.on('defuse_bomb', () => {
    const p = players[socket.id];
    if (p) p.input.use = true;
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
    // Keep bots, reset their stats too
    for (const [id, p] of Object.entries(players)) {
      p.kills = 0;
      p.deaths = 0;
      p.assists = 0;
      p.money = C.START_MONEY;
    }
    io.emit('game_restart');
    io.emit('game_state', { state: gameState, round: 0, tScore: 0, ctScore: 0 });
  });

  socket.on('add_bots', () => {
    const result = addBotsToGame();
    socket.emit('bots_added', result);
  });

  socket.on('remove_bots', () => {
    const count = removeAllBots();
    socket.emit('bots_removed', { count });
  });

  socket.on('chat', (msg) => {
    const p = players[socket.id];
    if (!p) return;
    io.emit('chat', { name: p.name, team: p.team, message: msg.substring(0, 100) });
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    const p = players[socket.id];
    if (p) {
      delete players[socket.id];
      broadcastPlayerList();
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
    reloadTimer: p.reloadTimer,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    plantProgress: p.plantProgress || 0,
    defusing: p.defusing || false,
    isBot: p.isBot || false,
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
    roundTimer,
    freezeTimer,
    gameState,
    round: roundNumber,
    tScore,
    ctScore,
  };

  // Find all connected sockets
  const connectedSockets = io.sockets.sockets;

  // Send state to each client with fog-of-war filtering
  for (const [socketId, socket] of connectedSockets) {
    const me = players[socketId];
    if (!me) continue;

    const myState = { ...baseState, players: {} };

    for (const [id, p] of Object.entries(players)) {
      // Always include self
      if (id === socketId) {
        myState.players[id] = serializePlayer(p);
        continue;
      }

      // Always include teammates (full visibility)
      if (p.team === me.team) {
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
      const canSee = dist <= VISIBILITY_RADIUS && lineOfSight(gameMap, me.x, me.y, p.x, p.y);

      // Check if enemy is making noise:
      //  - shooting (loud — heard at HEAR_RANGE)
      //  - sprinting running (heard at FOOTSTEP_RANGE)
      //  - walking (heard at closer range)
      const shootingNow = (now / 1000) - (p.lastShotTime || 0) < 0.5;
      const enemyMoving = (Math.abs(p.vx) + Math.abs(p.vy)) > 20;
      const enemySprinting = enemyMoving && p.input && p.input.sprint;
      const footstepRange = enemySprinting ? 400 : (enemyMoving ? 220 : 0);
      const canHear = (shootingNow && dist <= HEAR_RANGE)
                    || (enemyMoving && dist <= footstepRange);

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

// Patch endRound to auto-restart after game_over
(function patchEndRound() {
  const orig = endRound;
  endRound = function(winner, reason) {
    // Check if this will trigger game_over BEFORE calling orig
    let willBeGameOver = false;
    if (winner === 'T') {
      willBeGameOver = (tScore + 1) >= C.ROUNDS_TO_WIN;
    } else {
      willBeGameOver = (ctScore + 1) >= C.ROUNDS_TO_WIN;
    }
    
    orig(winner, reason);
    
    if (willBeGameOver) {
      // Wait for the game_over state to be set (3s from orig's setTimeout) + 5s display
      setTimeout(() => {
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
        io.emit('game_restart');
        io.emit('game_state', { state: 'waiting', round: 0, tScore: 0, ctScore: 0 });
        // Re-add bots and start fresh after short delay
        setTimeout(() => {
          autoStartGame();
        }, 1500);
      }, 10000); // 3s (round_end display) + 7s (game_over display)
    }
  };
})();
