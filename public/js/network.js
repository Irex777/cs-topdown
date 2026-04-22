// CS Top-Down - Network (Socket.io)
import { state } from './state.js';
import { SoundManager } from './audio.js';
import { STATE_BUFFER_SIZE } from './interpolation.js';
import {
  updateHUD, showCenterMsg, addKillFeedEntry, showHitMarker,
  hideRoundResult, hideGameOver, showRoundResultBanner,
  updateRoundHistory, showGameOver, addChatMessage,
  hideDefuseProgress
} from './hud.js';
import {
  showDeathScreen, spawnDeathEffect, spawnExplosion,
  spawnSmokeEffect, spawnBulletImpact, spawnDamageNumber,
  addDamageIndicator, spawnSoundRing
} from './effects.js';

// Re-export ESC menu functions that use socket
export { escSwitchTeam, escDisconnect, escRestartGame, escRemoveBots } from './hud.js';

// ==================== CONNECTION ====================
export function connect() {
  const name = document.getElementById('name-input').value.trim() || 'Player';
  let server = document.getElementById('server-input').value.trim();
  if (!server) {
    server = window.location.origin;
  } else if (!server.startsWith('http://') && !server.startsWith('https://')) {
    if (server.includes('localhost') || server.startsWith('127.0.0.1') || server.startsWith('192.168.')) {
      server = 'http://' + server;
    } else {
      server = 'https://' + server;
    }
  }
  document.getElementById('menu-status').textContent = 'Connecting...';
  document.getElementById('status-dot').className = 'status-dot';
  document.getElementById('status-text').textContent = 'Connecting...';

  state.socket = io(server, {
    query: { name }, transports: ['polling', 'websocket'],
    secure: server.startsWith('https'), reconnection: true,
    reconnectionAttempts: 10, reconnectionDelay: 1000,
    upgrade: true,
  });

  state.socket.on('connect', () => {
    document.getElementById('status-dot').className = 'status-dot online';
    document.getElementById('status-text').textContent = 'Connected';
    document.getElementById('menu-status').textContent = '';
  });

  state.socket.on('disconnect', () => {
    document.getElementById('status-dot').className = 'status-dot offline';
    document.getElementById('status-text').textContent = 'Disconnected';
  });

  state.socket.on('connect_error', (err) => {
    document.getElementById('menu-status').textContent = 'Failed: ' + err.message;
    document.getElementById('status-dot').className = 'status-dot offline';
    document.getElementById('status-text').textContent = 'Error';
  });

  state.socket.on('welcome', (data) => {
    state.myId = data.id; state.mapWidth = data.mapWidth; state.mapHeight = data.mapHeight;
    state.gameState = data.gameState; state.roundNumber = data.round;
    state.tScore = data.tScore; state.ctScore = data.ctScore;
    if (data.playerCount !== undefined) state.playerCount = data.playerCount;
    document.getElementById('menu-screen').classList.add('hidden');
    // Handle reconnect vs new player
    if (data.team && data.team !== 'SPEC') {
      // Server already restored our team — update client state without showing team-select
      state.myPlayer = { team: data.team };
      state.spectating = false;
      document.getElementById('team-select').classList.remove('show');
      document.getElementById('hud').classList.remove('hidden');
      document.getElementById('crosshair').style.display = '';
      document.getElementById('spectator-info').classList.add('hidden');
    } else if (state.pendingTeam) {
      // Pending team join from before reconnect — re-emit
      state.socket.emit('join_team', state.pendingTeam);
    } else {
      document.getElementById('team-select').classList.add('show');
    }
  });

  state.socket.on('map_data', (data) => {
    state.mapData = data.map; state.bombsites = data.bombsites;
    // preRenderMap is set as a callback by the render module
    if (state.preRenderMap) state.preRenderMap();
  });

  state.socket.on('player_list', (list) => {
    let tc = 0, ctc = 0;
    for (const p of Object.values(list)) { if (p.team==='T') tc++; else if (p.team==='CT') ctc++; }
    state.playerCount = Object.keys(list).length;
    document.getElementById('t-count').textContent = tc + ' players';
    document.getElementById('ct-count').textContent = ctc + ' players';
    document.getElementById('player-count-text').textContent = state.playerCount + ' online';
    // updateScoreboard is set as a callback by the render module
    if (state.updateScoreboard) state.updateScoreboard(list);
  });

  state.socket.on('player_joined_team', (data) => {
    if (data.id === state.myId) {
      state.myPlayer = { team: data.team };
      state.spectating = data.team === 'SPEC';
      state.spectateTarget = null;
      state.spectateFreeCam = false;
      document.getElementById('team-select').classList.remove('show');
      document.getElementById('hud').classList.remove('hidden');
      if (state.spectating) {
        document.getElementById('spectator-info').classList.remove('hidden');
        document.getElementById('crosshair').style.display = 'none';
      } else {
        document.getElementById('spectator-info').classList.add('hidden');
        document.getElementById('crosshair').style.display = '';
      }
    }
  });

  state.socket.on('game_state', (gs) => {
    if (gs.state !== undefined) state.gameState = gs.state;
    if (gs.round !== undefined) state.roundNumber = gs.round;
    if (gs.tScore !== undefined) state.tScore = gs.tScore;
    if (gs.ctScore !== undefined) state.ctScore = gs.ctScore;
    if (gs.roundHistory) { state.roundHistory = gs.roundHistory; updateRoundHistory(); }
    updateHUD();
  });

  state.socket.on('game_state_update', (gs) => {
    gs._recvTime = performance.now();
    gs._serverTime = performance.now(); // server doesn't send timestamps yet, use arrival time
    state.stateBuffer.push(gs);
    if (state.stateBuffer.length > STATE_BUFFER_SIZE) state.stateBuffer.shift();

    // Apply non-interpolated data immediately (timers, scores, etc.)
    state.roundTimer = gs.roundTimer; state.freezeTimer = gs.freezeTimer;
    state.gameState = gs.gameState; state.roundNumber = gs.round;
    state.tScore = gs.tScore; state.ctScore = gs.ctScore;
    if (gs.roundHistory) { state.roundHistory = gs.roundHistory; updateRoundHistory(); }
    state.bomb = gs.bomb;
    state.droppedWeapons = gs.droppedWeapons || [];
    state.activeGrenades = gs.activeGrenades;
    state.serverGrenades = gs.grenades;
    state.bullets = gs.bullets;

    // Merge non-spatial fields from server for own player.
    // DO NOT replace the entire player object — spatial fields (x, y, angle, vx, vy)
    // are managed by the interpolation / prediction system. Overwriting them with
    // raw server snapshots would bypass client-side prediction and cause choppy controls.
    if (gs.players && gs.players[state.myId]) {
      const serverMe = gs.players[state.myId];
      if (state.players[state.myId]) {
        // Merge only non-spatial properties the client doesn't predict
        state.players[state.myId].team = serverMe.team;
        state.players[state.myId].hp = serverMe.hp;
        state.players[state.myId].armor = serverMe.armor;
        state.players[state.myId].helmet = serverMe.helmet;
        state.players[state.myId].money = serverMe.money;
        state.players[state.myId].alive = serverMe.alive;
        state.players[state.myId].weapons = serverMe.weapons;
        state.players[state.myId].currentWeapon = serverMe.currentWeapon;
        state.players[state.myId].ammo = serverMe.ammo;
        state.players[state.myId].grenades = serverMe.grenades;
        state.players[state.myId].hasDefuseKit = serverMe.hasDefuseKit;
        state.players[state.myId].reloading = serverMe.reloading;
        state.players[state.myId].kills = serverMe.kills;
        state.players[state.myId].deaths = serverMe.deaths;
        state.players[state.myId].assists = serverMe.assists;
        state.players[state.myId].isBot = serverMe.isBot;
        state.players[state.myId].crouching = serverMe.crouching;
        state.players[state.myId].sprinting = serverMe.sprinting;
        state.players[state.myId].weaponType = serverMe.weaponType;
        state.players[state.myId].specTarget = serverMe.specTarget;
      } else {
        // First snapshot — no local player object yet, accept full server state
        state.players[state.myId] = serverMe;
      }
      state.myPlayer = state.players[state.myId];
    } else if (state.players[state.myId]) {
      state.myPlayer = state.players[state.myId];
    }
    // Update action progress from state
    if (gs.plantProgress !== undefined && gs.plantProgress > 0) {
      state.actionProgress = { active: true, type: 'planting', progress: gs.plantProgress };
    } else if (gs.defuseProgress !== undefined && gs.defuseProgress > 0) {
      state.actionProgress = { active: true, type: 'defusing', progress: gs.defuseProgress };
    } else {
      state.actionProgress.active = false;
    }
    updateHUD();
  });

  state.socket.on('round_start', (d) => {
    state.roundNumber = d.round; state.tScore = d.tScore; state.ctScore = d.ctScore;
    showCenterMsg('FREEZE TIME', '#ff6b35', 'Round ' + d.round, 3);
    hideRoundResult();
    hideGameOver();
    state.deathScreenData = null;
    state.deathScreenTimer = 0;
  });

  state.socket.on('round_live', (d) => {
    showCenterMsg('ROUND ' + d.round, '#4caf50', 'GO GO GO!', 2);
  });

  state.socket.on('round_end', (d) => {
    const winner = d.winner;
    const reason = d.reason || '';
    const mvpData = d.mvp || {};
    const mvpName = mvpData.name || '';
    const mvpId = mvpData.id || null;
    state.roundMvp = { name: mvpName, id: mvpId };

    // Add to history
    if (d.roundHistory) {
      state.roundHistory = d.roundHistory;
    } else {
      state.roundHistory.push(winner);
      if (state.roundHistory.length > 15) state.roundHistory.shift();
    }
    updateRoundHistory();

    // Show banner
    const color = winner === 'T' ? '#d4a537' : '#4a90d9';
    const teamName = winner === 'T' ? 'TERRORISTS' : 'COUNTER-TERRORISTS';
    showRoundResultBanner(teamName, color, reason, mvpName ? '⭐ MVP: ' + mvpName : '');

    showCenterMsg(teamName + ' WIN', color, reason, 4);
  });

  state.socket.on('player_killed', (d) => {
    addKillFeedEntry(d);
    if (d.victim === state.myId) {
      // Show death screen with killer info
      showDeathScreen(d.killerName || 'Unknown', d.weapon || 'knife');
      SoundManager.death();
      showCenterMsg('YOU DIED', '#ff3333', 'Spectating...', 3);
      // Enter spectator mode for the player
      if (d.killer) state.spectateTarget = d.killer;
    }
    if (d.killer === state.myId) {
      SoundManager.hitMarker(true);
    }
    const vp = state.players[d.victim];
    if (vp) {
      spawnDeathEffect(vp.x, vp.y);
      // Add death animation
      state.deathAnimations.push({
        x: vp.x, y: vp.y, timer: 2.0, maxTimer: 2.0,
        team: vp.team, name: vp.name, angle: vp.angle,
      });
    }
  });

  state.socket.on('hit_marker', (d) => {
    showHitMarker(d && d.kill);
    SoundManager.hitMarker(d && d.kill);
    if (d && d.damage && d.target) {
      const tp = state.players[d.target];
      if (tp) spawnDamageNumber(tp.x, tp.y, d.damage, d.headshot);
    }
  });

  state.socket.on('bullet_impact', (d) => { spawnBulletImpact(d.x, d.y); });

  state.socket.on('damage_taken', (d) => {
    // Show damage direction indicator
    addDamageIndicator(d.attackerX, d.attackerY);
    // Flash damage vignette
    const dv = document.getElementById('damage-vignette');
    if (dv) {
      dv.style.opacity = '1';
      setTimeout(() => { dv.style.opacity = '0'; }, 200);
    }
  });

  state.socket.on('grenade_explode', (d) => {
    if (d.type === 'he') spawnExplosion(d.x, d.y, d.radius);
    else if (d.type === 'flash') { state.flashTimer = d.duration || 3; }
    else if (d.type === 'smoke') spawnSmokeEffect(d.x, d.y, d.radius);
  });

  state.socket.on('bomb_planted', (d) => {
    showCenterMsg('BOMB PLANTED - SITE ' + d.site, '#ff3333', 'Defuse it!', 3);
    spawnExplosion(d.x, d.y, 50);
    state.bombHudTimer = 0; // Reset to fade in
  });
  state.socket.on('bomb_defused', (d) => { showCenterMsg('BOMB DEFUSED', '#4caf50', 'Counter-Terrorists save the day!', 3); });
  state.socket.on('bomb_exploded', (d) => { spawnExplosion(d.x, d.y, 400); });

  state.socket.on('game_over', (d) => {
    const winner = d.winner === 'T' ? 'TERRORISTS' : 'COUNTER-TERRORISTS';
    const color = d.winner === 'T' ? '#d4a537' : '#4a90d9';
    showCenterMsg(winner + ' WIN THE GAME', color, '', 10);
    const mvpData = d.mvp || {};
    showGameOver(d.winner, mvpData.name || '');
  });

  state.socket.on('game_restart', () => {
    state.roundHistory = [];
    state.roundMvp = null;
    hideRoundResult();
    hideGameOver();
    showCenterMsg('GAME RESTARTED', '#fff', 'New match!', 3);
  });

  state.socket.on('team_swap', () => {
    showCenterMsg('TEAMS SWAPPED', '#ff6b35', 'Switching sides...', 3);
  });

  state.socket.on('chat', (d) => { addChatMessage(d); });
  state.socket.on('error', (m) => { showCenterMsg(m, '#ff4444', '', 3); });
  state.socket.on('player_update', (d) => { if (state.players[d.id]) Object.assign(state.players[d.id], d); });
  state.socket.on('bomb_defusing', (d) => {
    const el = document.getElementById('action-progress');
    const fill = document.getElementById('action-progress-fill');
    if (!el) return;
    document.getElementById('action-progress-label').textContent = 'DEFUSING';
    fill.className = 'action-progress-fill defusing';
    fill.style.width = (d.progress * 100) + '%';
    el.classList.add('show');
  });
  state.socket.on('bomb_defuse_cancelled', () => { hideDefuseProgress(); });
  state.socket.on('sound', (d) => { playSound(d); });
}

// ==================== TEAM / GAME ACTIONS ====================
export function joinTeam(t) {
  state.pendingTeam = t;  // Store for reconnection recovery
  if (state.socket) state.socket.emit('join_team', t);
}
export function startGame() { if (state.socket) state.socket.emit('start_game'); }
export function addBots() {
  if (!state.socket) return;
  state.socket.emit('add_bots');
  state.socket.once('bots_added', (r) => {
    console.log('Bots added: T=' + r.t + ' CT=' + r.ct);
  });
}

export function reconnectGame() {
  hideGameOver();
  if (state.socket) state.socket.disconnect();
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('menu-screen').classList.remove('hidden');

  // Reset all state arrays/objects to prevent stale data leaks on reconnect
  state.players = {};
  state.bullets = [];
  state.serverGrenades = [];
  state.activeGrenades = [];
  state.droppedWeapons = [];
  state.bomb = null;
  state.effects = [];
  state.particles = [];
  state.damageNumbers = [];
  state.deathAnimations = [];
  state.shellCasings = [];
  state.ambientParticles = [];
  state.soundIndicators = [];
  state.damageIndicators = [];
  state.muzzleFlashTimers = {};
  state.prevPositions = {};
  state.footstepTimers = {};
  state.stateBuffer = [];
  state.centerMessages = [];
  state.bulletHoles = [];
  state.myPlayer = null;
  state.myId = null;
  state.spectating = false;
  state.spectateTarget = null;
  state.deathScreenData = null;
  state.deathScreenTimer = 0;
  state.gameState = 'waiting';

  connect();
}

// ==================== SOUND INDICATORS ====================
function playSound(d) {
  if (!state.myPlayer) return;
  const dx = d.x - state.myPlayer.x;
  const dy = d.y - state.myPlayer.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > (d.range || 800)) return;

  // Play actual audio
  if (d.type === 'gunshot' && d.weapon) SoundManager.gunshot(d.weapon);
  else if (d.type === 'footstep') SoundManager.footstep();
  else if (d.type === 'round_start') SoundManager.roundStart();
  else if (d.type === 'round_end') SoundManager.roundEnd();
  else if (d.type === 'bomb_beep' || d.type === 'bomb_plant_tick') SoundManager.bombTick();
  else if (d.type === 'bomb_defuse_tick') SoundManager.defuseTick();
  else if (d.type === 'player_death') SoundManager.death();
  else if (d.type === 'headshot') SoundManager.hitMarker(false);

  // Direction indicator on minimap
  state.soundIndicators.push({
    x: d.x, y: d.y, type: d.type,
    alpha: 1.0, life: 1.5, maxLife: 1.5,
    range: d.range || 800
  });
  if (state.soundIndicators.length > 30) state.soundIndicators.shift();

  // Visual feedback for certain sounds
  if (d.type === 'gunshot') spawnSoundRing(d.x, d.y, '#ff6600');
  else if (d.type === 'footstep') spawnSoundRing(d.x, d.y, '#ffffff', 0.3);
  else if (d.type === 'knife_swing') spawnSoundRing(d.x, d.y, '#cccccc', 0.3);
  else if (d.type === 'grenade_explode') spawnSoundRing(d.x, d.y, '#ff4400');
  else if (d.type === 'bomb_beep') spawnSoundRing(d.x, d.y, '#ff0000');
  else if (d.type === 'player_death') spawnSoundRing(d.x, d.y, '#ff0000');
  else if (d.type === 'headshot') spawnSoundRing(d.x, d.y, '#ff0000');
}
