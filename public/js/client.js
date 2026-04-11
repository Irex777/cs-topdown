// CS Top-Down - Client Game Logic
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');

// State
let socket = null;
let myId = null;
let mapData = null;
let bombsites = null;
let gameState = 'waiting';
let myPlayer = null;
let players = {};
let bullets = [];
let grenades = [];
let activeGrenades = [];
let bomb = null;
let tScore = 0, ctScore = 0, roundNumber = 0;
let roundTimer = 0, freezeTimer = 0;
let camera = { x: 0, y: 0 };
let keys = {};
let mouse = { x: 0, y: 0, down: false };
let showBuyMenu = false;
let showScoreboard = false;
let chatOpen = false;
let flashTimer = 0;
let killFeedEntries = [];
let mapWidth = 80, mapHeight = 60, tileSize = 32;
let TILE_WALL = 1, TILE_CRATE = 2, TILE_BOMBSITE_A = 3, TILE_BOMBSITE_B = 4;
let TILE_T_SPAWN = 5, TILE_CT_SPAWN = 6, TILE_DOOR = 7;
let mapOffscreen = null; // pre-rendered map
let spectating = null;

// Constants (duplicated from shared for client use)
const PLAYER_RADIUS = 12;
const WEAPONS = {
  pistol: { name: 'P250', type: 'pistol' },
  glock: { name: 'Glock-18', type: 'pistol' },
  usp: { name: 'USP-S', type: 'pistol' },
  deagle: { name: 'Desert Eagle', type: 'pistol' },
  mp9: { name: 'MP9', type: 'smg' },
  mac10: { name: 'MAC-10', type: 'smg' },
  p90: { name: 'P90', type: 'smg' },
  ak47: { name: 'AK-47', type: 'rifle' },
  m4a4: { name: 'M4A4', type: 'rifle' },
  galil: { name: 'Galil AR', type: 'rifle' },
  famas: { name: 'FAMAS', type: 'rifle' },
  awp: { name: 'AWP', type: 'sniper' },
  ssg08: { name: 'SSG 08', type: 'sniper' },
  nova: { name: 'Nova', type: 'shotgun' },
};

const BUY_ITEMS = {
  'Pistols': [
    { key: 'pistol', name: 'P250', price: 300 },
    { key: 'deagle', name: 'Desert Eagle', price: 700 },
  ],
  'SMGs': [
    { key: 'mp9', name: 'MP9', price: 1250, team: 'CT' },
    { key: 'mac10', name: 'MAC-10', price: 1050, team: 'T' },
    { key: 'p90', name: 'P90', price: 2350 },
  ],
  'Rifles': [
    { key: 'galil', name: 'Galil AR', price: 1800, team: 'T' },
    { key: 'famas', name: 'FAMAS', price: 2050, team: 'CT' },
    { key: 'ak47', name: 'AK-47', price: 2700, team: 'T' },
    { key: 'm4a4', name: 'M4A4', price: 3100, team: 'CT' },
  ],
  'Snipers': [
    { key: 'ssg08', name: 'SSG 08', price: 1700 },
    { key: 'awp', name: 'AWP', price: 4750 },
  ],
  'Shotguns': [
    { key: 'nova', name: 'Nova', price: 1050 },
  ],
  'Equipment': [
    { key: 'kevlar', name: 'Kevlar Vest', price: 650 },
    { key: 'helmet', name: 'Kevlar + Helmet', price: 1000 },
    { key: 'defuse_kit', name: 'Defuse Kit', price: 400, team: 'CT' },
  ],
  'Grenades': [
    { key: 'he_grenade', name: 'HE Grenade', price: 300 },
    { key: 'flashbang', name: 'Flashbang', price: 200 },
    { key: 'smoke', name: 'Smoke Grenade', price: 300 },
  ],
};

// ==================== RESIZE ====================
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ==================== CONNECTION ====================
document.getElementById('connect-btn').addEventListener('click', connect);

function connect() {
  const name = document.getElementById('name-input').value.trim() || 'Player';
  let server = document.getElementById('server-input').value.trim();
  
  // If no server entered, connect to same host (works for both LAN and internet)
  if (!server) {
    server = window.location.origin;
  } else if (!server.startsWith('http://') && !server.startsWith('https://')) {
    // Auto-detect protocol - use https for non-localhost
    if (server.includes('localhost') || server.startsWith('127.0.0.1') || server.startsWith('192.168.')) {
      server = 'http://' + server;
    } else {
      server = 'https://' + server;
    }
  }

  document.getElementById('menu-status').textContent = 'Connecting to ' + server + '...';

  socket = io(server, {
    query: { name },
    transports: ['websocket', 'polling'],
    secure: server.startsWith('https'),
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  socket.on('connect_error', (err) => {
    document.getElementById('menu-status').textContent = 'Connection failed: ' + err.message;
  });

  socket.on('welcome', (data) => {
    myId = data.id;
    mapWidth = data.mapWidth;
    mapHeight = data.mapHeight;
    tileSize = data.tileSize;
    gameState = data.gameState;
    roundNumber = data.round;
    tScore = data.tScore;
    ctScore = data.ctScore;
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('team-select').classList.add('show');
  });

  socket.on('map_data', (data) => {
    mapData = data.map;
    bombsites = data.bombsites;
    preRenderMap();
  });

  socket.on('player_list', (list) => {
    let tCount = 0, ctCount = 0;
    for (const p of Object.values(list)) {
      if (p.team === 'T') tCount++;
      else if (p.team === 'CT') ctCount++;
    }
    document.getElementById('t-count').textContent = tCount + ' players';
    document.getElementById('ct-count').textContent = ctCount + ' players';

    // Update scoreboard
    updateScoreboard(list);
  });

  socket.on('player_joined_team', (data) => {
    if (data.id === myId) {
      myPlayer = { team: data.team };
      document.getElementById('team-select').classList.remove('show');
      document.getElementById('hud').classList.remove('hidden');
    }
  });

  socket.on('game_state_update', (state) => {
    players = state.players;
    bullets = state.bullets;
    grenades = state.grenades;
    activeGrenades = state.activeGrenades;
    bomb = state.bomb;
    roundTimer = state.roundTimer;
    freezeTimer = state.freezeTimer;
    gameState = state.gameState;
    roundNumber = state.round;
    tScore = state.tScore;
    ctScore = state.ctScore;

    // Update my player ref
    if (players[myId]) {
      myPlayer = players[myId];
    }

    updateHUD();
  });

  socket.on('round_start', (data) => {
    roundNumber = data.round;
    tScore = data.tScore;
    ctScore = data.ctScore;
    showCenterMessage('FREEZE TIME', '#ff6b35', 3);
  });

  socket.on('round_live', (data) => {
    showCenterMessage('ROUND ' + data.round + ' - GO!', '#4caf50', 2);
  });

  socket.on('round_end', (data) => {
    const color = data.winner === 'T' ? '#d4a537' : '#4a90d9';
    const teamName = data.winner === 'T' ? 'TERRORISTS' : 'COUNTER-TERRORISTS';
    showCenterMessage(teamName + ' WIN - ' + data.reason.toUpperCase(), color, 4);
  });

  socket.on('player_killed', (data) => {
    addKillFeedEntry(data);
    // If we died, go to spectator
    if (data.victim === myId) {
      showCenterMessage('YOU DIED', '#ff3333', 3);
    }
  });

  socket.on('hit_marker', (data) => {
    showHitMarker();
  });

  socket.on('bullet_impact', (data) => {
    spawnImpact(data.x, data.y);
  });

  socket.on('grenade_explode', (data) => {
    if (data.type === 'flash') {
      flashTimer = data.duration;
    }
  });

  socket.on('bomb_planted', (data) => {
    showCenterMessage('BOMB PLANTED - SITE ' + data.site, '#ff3333', 3);
  });

  socket.on('bomb_defused', (data) => {
    showCenterMessage('BOMB DEFUSED!', '#4caf50', 3);
  });

  socket.on('bomb_defusing', (data) => {
    showCenterMessage('DEFUSING...', '#4a90d9', data.time);
  });

  socket.on('bomb_exploded', (data) => {
    // Screen shake effect
    camera.shakeX = (Math.random() - 0.5) * 40;
    camera.shakeY = (Math.random() - 0.5) * 40;
    setTimeout(() => { camera.shakeX = 0; camera.shakeY = 0; }, 500);
  });

  socket.on('game_over', (data) => {
    const name = data.winner === 'T' ? 'TERRORISTS' : 'COUNTER-TERRORISTS';
    showCenterMessage(name + ' WIN THE GAME!', '#ff6b35', 10);
  });

  socket.on('game_restart', () => {
    showCenterMessage('GAME RESTARTED', '#fff', 3);
  });

  socket.on('team_swap', () => {
    showCenterMessage('TEAM SWAP!', '#ff6b35', 3);
  });

  socket.on('chat', (data) => {
    addChatMessage(data);
  });

  socket.on('error', (msg) => {
    alert(msg);
  });

  socket.on('player_update', (data) => {
    if (players[data.id]) {
      Object.assign(players[data.id], data);
    }
  });
}

// ==================== TEAM JOIN ====================
function joinTeam(team) {
  if (socket) socket.emit('join_team', team);
}

function startGame() {
  if (socket) socket.emit('start_game');
}

// ==================== INPUT ====================
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;

  // Chat
  if (e.code === 'Enter' && !chatOpen) {
    chatOpen = true;
    const input = document.getElementById('chat-input');
    input.classList.add('show');
    input.focus();
    return;
  }
  if (e.code === 'Enter' && chatOpen) {
    const input = document.getElementById('chat-input');
    if (input.value.trim() && socket) {
      socket.emit('chat', input.value.trim());
    }
    input.value = '';
    input.classList.remove('show');
    chatOpen = false;
    return;
  }
  if (e.code === 'Escape' && chatOpen) {
    const input = document.getElementById('chat-input');
    input.value = '';
    input.classList.remove('show');
    chatOpen = false;
    return;
  }

  if (chatOpen) return;

  // Buy menu
  if (e.code === 'KeyB') {
    toggleBuyMenu();
  }

  // Scoreboard
  if (e.code === 'Tab') {
    e.preventDefault();
    showScoreboard = true;
    document.getElementById('scoreboard').classList.add('show');
  }

  // Weapon switching
  if (e.code === 'Digit1' && myPlayer) socket.emit('switch_weapon', 0);
  if (e.code === 'Digit2' && myPlayer) socket.emit('switch_weapon', 1);
  if (e.code === 'Digit3' && myPlayer) socket.emit('switch_weapon', 2);
  if (e.code === 'Digit4' && myPlayer) socket.emit('switch_weapon', 3);

  // Reload
  if (e.code === 'KeyR') socket.emit('reload');

  // Grenades
  if (e.code === 'KeyG') socket.emit('throw_grenade', 'he');
  if (e.code === 'KeyF') socket.emit('throw_grenade', 'flash');
  if (e.code === 'KeyC') socket.emit('throw_grenade', 'smoke');

  // Bomb plant/defuse
  if (e.code === 'KeyE') {
    if (myPlayer?.team === 'T') socket.emit('plant_bomb');
    else if (myPlayer?.team === 'CT') socket.emit('defuse_bomb');
  }
});

document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') {
    showScoreboard = false;
    document.getElementById('scoreboard').classList.remove('show');
  }
});

canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

canvas.addEventListener('mousedown', (e) => {
  mouse.down = true;
});

canvas.addEventListener('mouseup', (e) => {
  mouse.down = false;
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ==================== INPUT SENDING ====================
setInterval(() => {
  if (!socket || !myPlayer || chatOpen) return;

  const p = players[myId];
  if (!p || !p.alive) return;

  // Calculate angle from player to mouse (in world coords)
  const worldMouseX = mouse.x - canvas.width / 2;
  const worldMouseY = mouse.y - canvas.height / 2;
  const angle = Math.atan2(worldMouseY, worldMouseX);

  socket.emit('update_input', {
    up: keys['KeyW'] || false,
    down: keys['KeyS'] || false,
    left: keys['KeyA'] || false,
    right: keys['KeyD'] || false,
  });

  socket.emit('update_angle', angle);

  if (mouse.down && !showBuyMenu) {
    socket.emit('shoot');
  }
}, 1000 / 30);

// ==================== BUY MENU ====================
function toggleBuyMenu() {
  showBuyMenu = !showBuyMenu;
  const menu = document.getElementById('buy-menu');
  if (showBuyMenu) {
    renderBuyMenu();
    menu.classList.add('show');
  } else {
    menu.classList.remove('show');
  }
}

function renderBuyMenu() {
  const container = document.getElementById('buy-content');
  const p = players[myId];
  if (!p) return;

  let html = '';
  for (const [section, items] of Object.entries(BUY_ITEMS)) {
    html += '<div class="buy-section">';
    html += '<div class="buy-section-title">' + section + '</div>';
    html += '<div class="buy-grid">';
    for (const item of items) {
      const cantAfford = p.money < item.price;
      const wrongTeam = item.team && item.team !== p.team;
      const cls = cantAfford ? 'cant-afford' : wrongTeam ? 'wrong-team' : '';
      html += '<div class="buy-item ' + cls + '" onclick="buyItem(\'' + item.key + '\')">';
      html += '<div class="buy-item-name">' + item.name + '</div>';
      html += '<div class="buy-item-price">$' + item.price + '</div>';
      html += '</div>';
    }
    html += '</div></div>';
  }
  container.innerHTML = html;
}

function buyItem(key) {
  if (socket) socket.emit('buy', key);
  renderBuyMenu(); // Refresh
}

// ==================== HUD UPDATE ====================
function updateHUD() {
  const p = players[myId];
  if (!p) return;

  // Score
  document.getElementById('score-t').textContent = tScore;
  document.getElementById('score-ct').textContent = ctScore;
  document.getElementById('round-num').textContent = 'Round ' + roundNumber;

  // Timer
  const time = Math.max(0, gameState === 'freeze' ? freezeTimer : roundTimer);
  const mins = Math.floor(time / 60);
  const secs = Math.floor(time % 60);
  document.getElementById('round-timer').textContent = mins + ':' + secs.toString().padStart(2, '0');

  // HP
  document.getElementById('hp-text').textContent = Math.ceil(p.hp);
  const hpPct = Math.max(0, p.hp / 100 * 100);
  document.getElementById('hp-fill').style.width = hpPct + '%';
  document.getElementById('hp-fill').style.background = hpPct > 50 ? '#4caf50' : hpPct > 25 ? '#ff9800' : '#f44336';

  // Armor
  document.getElementById('armor-fill').style.width = p.armor + '%';

  // Ammo
  if (p.weapons && p.weapons.length > 0 && p.currentWeapon >= 0 && p.ammo) {
    const wepKey = p.weapons[p.currentWeapon];
    const ammo = p.ammo[wepKey];
    const wep = WEAPONS[wepKey];
    document.getElementById('weapon-name').textContent = wep ? wep.name : wepKey;
    document.getElementById('ammo-current').textContent = ammo ? ammo.mag : 0;
    document.getElementById('ammo-reserve').textContent = '/ ' + (ammo ? ammo.reserve : 0);
  }

  // Money
  document.getElementById('money-amount').textContent = '$' + p.money;

  // Grenades
  document.getElementById('grenade-he').textContent = p.grenades?.he || 0;
  document.getElementById('grenade-flash').textContent = p.grenades?.flash || 0;
  document.getElementById('grenade-smoke').textContent = p.grenades?.smoke || 0;

  // Weapon slots
  const slots = document.getElementById('weapon-slots');
  if (p.weapons) {
    let html = '';
    p.weapons.forEach((w, i) => {
      const active = i === p.currentWeapon ? 'active' : '';
      const wep = WEAPONS[w];
      html += '<div class="weapon-slot ' + active + '"><span class="slot-key">' + (i + 1) + '</span>' + (wep ? wep.name : w) + '</div>';
    });
    slots.innerHTML = html;
  }

  // Flash
  if (flashTimer > 0) {
    document.getElementById('flash-overlay').style.opacity = Math.min(1, flashTimer);
  } else {
    document.getElementById('flash-overlay').style.opacity = 0;
  }
}

// ==================== MAP PRE-RENDERING ====================
function preRenderMap() {
  if (!mapData) return;
  const w = mapWidth * tileSize;
  const h = mapHeight * tileSize;

  mapOffscreen = document.createElement('canvas');
  mapOffscreen.width = w;
  mapOffscreen.height = h;
  const mctx = mapOffscreen.getContext('2d');

  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const tile = mapData[y][x];
      const px = x * tileSize;
      const py = y * tileSize;

      switch (tile) {
        case TILE_WALL:
          mctx.fillStyle = '#3a3a4a';
          mctx.fillRect(px, py, tileSize, tileSize);
          mctx.fillStyle = '#2a2a3a';
          mctx.fillRect(px, py, tileSize, 2);
          mctx.fillRect(px, py, 2, tileSize);
          break;
        case TILE_CRATE:
          mctx.fillStyle = '#5a4a3a';
          mctx.fillRect(px, py, tileSize, tileSize);
          mctx.strokeStyle = '#4a3a2a';
          mctx.lineWidth = 1;
          mctx.strokeRect(px + 2, py + 2, tileSize - 4, tileSize - 4);
          // X pattern
          mctx.beginPath();
          mctx.moveTo(px + 4, py + 4);
          mctx.lineTo(px + tileSize - 4, py + tileSize - 4);
          mctx.moveTo(px + tileSize - 4, py + 4);
          mctx.lineTo(px + 4, py + tileSize - 4);
          mctx.stroke();
          break;
        case TILE_BOMBSITE_A:
          mctx.fillStyle = '#2a2a1a';
          mctx.fillRect(px, py, tileSize, tileSize);
          // A marking
          mctx.fillStyle = 'rgba(255,100,100,0.15)';
          mctx.fillRect(px, py, tileSize, tileSize);
          break;
        case TILE_BOMBSITE_B:
          mctx.fillStyle = '#2a2a1a';
          mctx.fillRect(px, py, tileSize, tileSize);
          mctx.fillStyle = 'rgba(100,100,255,0.15)';
          mctx.fillRect(px, py, tileSize, tileSize);
          break;
        case TILE_T_SPAWN:
          mctx.fillStyle = '#2a2518';
          mctx.fillRect(px, py, tileSize, tileSize);
          break;
        case TILE_CT_SPAWN:
          mctx.fillStyle = '#182028';
          mctx.fillRect(px, py, tileSize, tileSize);
          break;
        case TILE_DOOR:
          mctx.fillStyle = '#4a3a2a';
          mctx.fillRect(px, py, tileSize, tileSize);
          break;
        default: // empty
          mctx.fillStyle = '#1e1e2e';
          mctx.fillRect(px, py, tileSize, tileSize);
          // Subtle grid
          mctx.strokeStyle = 'rgba(255,255,255,0.02)';
          mctx.lineWidth = 0.5;
          mctx.strokeRect(px, py, tileSize, tileSize);
          break;
      }
    }
  }

  // Bombsite labels
  if (bombsites) {
    mctx.font = 'bold 48px sans-serif';
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    if (bombsites.A) {
      mctx.fillStyle = 'rgba(255,100,100,0.3)';
      mctx.fillText('A', bombsites.A.centerX, bombsites.A.centerY);
    }
    if (bombsites.B) {
      mctx.fillStyle = 'rgba(100,100,255,0.3)';
      mctx.fillText('B', bombsites.B.centerX, bombsites.B.centerY);
    }
  }
}

// ==================== RENDERING ====================
let impacts = [];
let centerMessages = [];

function spawnImpact(x, y) {
  impacts.push({ x, y, timer: 0.3 });
}

function showCenterMessage(text, color, duration) {
  centerMessages.push({ text, color, timer: duration, maxTimer: duration });
}

function showHitMarker() {
  // Brief white X on crosshair
  const el = document.getElementById('dmg-indicator');
  el.style.borderColor = 'rgba(255,255,255,0.5)';
  setTimeout(() => { el.style.borderColor = 'transparent'; }, 100);
}

function addKillFeedEntry(data) {
  const feed = document.getElementById('kill-feed');
  const entry = document.createElement('div');
  entry.className = 'kill-entry';
  const hs = data.headshot ? ' <span class="hs-icon">★ HS</span>' : '';
  entry.innerHTML = '<span class="killer-name" style="color:' + (players[data.killer]?.team === 'T' ? '#d4a537' : '#4a90d9') + '">' + data.killerName + '</span>' +
    '<span class="weapon-icon">[' + (WEAPONS[data.weapon]?.name || data.weapon) + ']</span>' +
    '<span class="victim-name" style="color:' + (players[data.victim]?.team === 'T' ? '#d4a537' : '#4a90d9') + '">' + data.victimName + '</span>' + hs;
  feed.appendChild(entry);
  setTimeout(() => { if (entry.parentNode) entry.parentNode.removeChild(entry); }, 4500);
}

function addChatMessage(data) {
  const box = document.getElementById('chat-box');
  const msg = document.createElement('div');
  msg.className = 'chat-msg';
  const teamClass = data.team === 'T' ? 't' : 'ct';
  msg.innerHTML = '<span class="chat-name ' + teamClass + '">' + data.name + ':</span> ' + escapeHtml(data.message);
  box.appendChild(msg);
  setTimeout(() => { if (msg.parentNode) msg.parentNode.removeChild(msg); }, 8500);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateScoreboard(list) {
  const content = document.getElementById('sb-content');
  if (!content) return;
  document.getElementById('sb-t-score').textContent = tScore;
  document.getElementById('sb-ct-score').textContent = ctScore;

  let tPlayers = [];
  let ctPlayers = [];
  for (const p of Object.values(list)) {
    if (p.team === 'T') tPlayers.push(p);
    else if (p.team === 'CT') ctPlayers.push(p);
  }

  let html = '<div style="display:flex;gap:20px;">';

  // T side
  html += '<div style="flex:1;"><table class="sb-table"><tr><th>Player</th><th>K</th><th>D</th><th>$</th></tr>';
  for (const p of tPlayers) {
    html += '<tr class="sb-row ' + (p.alive ? '' : 'dead') + '"><td>' + escapeHtml(p.name) + '</td><td>' + p.kills + '</td><td>' + p.deaths + '</td><td>$' + p.money + '</td></tr>';
  }
  html += '</table></div>';

  // CT side
  html += '<div style="flex:1;"><table class="sb-table"><tr><th>Player</th><th>K</th><th>D</th><th>$</th></tr>';
  for (const p of ctPlayers) {
    html += '<tr class="sb-row ' + (p.alive ? '' : 'dead') + '"><td>' + escapeHtml(p.name) + '</td><td>' + p.kills + '</td><td>' + p.deaths + '</td><td>$' + p.money + '</td></tr>';
  }
  html += '</table></div></div>';
  content.innerHTML = html;
}

// ==================== MAIN RENDER LOOP ====================
let lastRenderTime = 0;

function render(timestamp) {
  const dt = Math.min((timestamp - lastRenderTime) / 1000, 0.05);
  lastRenderTime = timestamp;

  // Update timers
  flashTimer = Math.max(0, flashTimer - dt);
  impacts = impacts.filter(i => { i.timer -= dt; return i.timer > 0; });
  centerMessages = centerMessages.filter(m => { m.timer -= dt; return m.timer > 0; });

  const p = players[myId];
  if (p && p.alive) {
    // Camera follows player
    camera.x = p.x - canvas.width / 2;
    camera.y = p.y - canvas.height / 2;
  }

  // Camera shake
  const shakeX = camera.shakeX || 0;
  const shakeY = camera.shakeY || 0;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background
  ctx.fillStyle = '#111122';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(-camera.x + shakeX, -camera.y + shakeY);

  // Draw pre-rendered map
  if (mapOffscreen) {
    ctx.drawImage(mapOffscreen, 0, 0);
  }

  // Draw smoke grenades
  for (const g of grenades) {
    if (g.type === 'smoke') {
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(80,80,80,0.7)';
      ctx.fill();
      // Smoke edge
      ctx.strokeStyle = 'rgba(60,60,60,0.5)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  // Draw active grenades in flight
  for (const g of activeGrenades) {
    const colors = { he: '#ff4444', flash: '#ffff44', smoke: '#888' };
    ctx.beginPath();
    ctx.arc(g.x, g.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = colors[g.type] || '#fff';
    ctx.fill();
  }

  // Draw bomb
  if (bomb && bomb.planted) {
    const pulse = Math.sin(Date.now() / 200) * 0.3 + 0.7;
    ctx.beginPath();
    ctx.arc(bomb.x, bomb.y, 12, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 50, 50, ${pulse})`;
    ctx.fill();
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Timer above bomb
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#ff3333';
    ctx.textAlign = 'center';
    ctx.fillText(Math.ceil(bomb.timer) + 's', bomb.x, bomb.y - 20);
  }

  // Draw players
  for (const [id, pl] of Object.entries(players)) {
    if (!pl.alive || pl.team === 'SPEC') continue;

    const isMe = id === myId;
    const isAlly = pl.team === p?.team;

    // Player circle
    ctx.beginPath();
    ctx.arc(pl.x, pl.y, PLAYER_RADIUS, 0, Math.PI * 2);

    if (isMe) {
      ctx.fillStyle = pl.team === 'T' ? '#d4a537' : '#4a90d9';
    } else if (isAlly) {
      ctx.fillStyle = pl.team === 'T' ? 'rgba(212,165,55,0.7)' : 'rgba(74,144,217,0.7)';
    } else {
      // Only show enemies if visible (simplification: show all for now)
      ctx.fillStyle = pl.team === 'T' ? 'rgba(212,100,55,0.9)' : 'rgba(74,100,217,0.9)';
    }
    ctx.fill();
    ctx.strokeStyle = isMe ? '#fff' : 'rgba(255,255,255,0.3)';
    ctx.lineWidth = isMe ? 2 : 1;
    ctx.stroke();

    // Direction indicator (gun barrel)
    const barrelLen = 16;
    ctx.beginPath();
    ctx.moveTo(pl.x, pl.y);
    ctx.lineTo(pl.x + Math.cos(pl.angle) * barrelLen, pl.y + Math.sin(pl.angle) * barrelLen);
    ctx.strokeStyle = isMe ? '#fff' : '#ccc';
    ctx.lineWidth = 3;
    ctx.stroke();

    // HP bar above player
    if (!isMe || true) {
      const barW = 24;
      const barH = 3;
      const barX = pl.x - barW / 2;
      const barY = pl.y - PLAYER_RADIUS - 8;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(barX, barY, barW, barH);
      const hpPct = pl.hp / 100;
      ctx.fillStyle = hpPct > 0.5 ? '#4caf50' : hpPct > 0.25 ? '#ff9800' : '#f44336';
      ctx.fillRect(barX, barY, barW * hpPct, barH);
    }

    // Name
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(pl.name, pl.x, pl.y - PLAYER_RADIUS - 12);
  }

  // Draw bullets
  for (const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffff00';
    ctx.fill();

    // Bullet trail
    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (speed > 0) {
      const trailLen = 8;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - (b.vx / speed) * trailLen, b.y - (b.vy / speed) * trailLen);
      ctx.strokeStyle = 'rgba(255,255,0,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Draw impacts
  for (const imp of impacts) {
    ctx.beginPath();
    ctx.arc(imp.x, imp.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,200,50,${imp.timer / 0.3})`;
    ctx.fill();
  }

  ctx.restore();

  // Draw minimap
  drawMinimap();

  // Draw center messages
  for (const msg of centerMessages) {
    const alpha = Math.min(1, msg.timer);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 36px sans-serif';
    ctx.fillStyle = msg.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 4;
    ctx.fillText(msg.text, canvas.width / 2, canvas.height * 0.35);
    ctx.restore();
  }

  // Reload indicator
  if (p && p.reloading) {
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText('RELOADING...', canvas.width / 2, canvas.height / 2 + 40);
  }

  requestAnimationFrame(render);
}

function drawMinimap() {
  if (!mapData) return;
  const mw = minimapCanvas.width;
  const mh = minimapCanvas.height;
  const scaleX = mw / (mapWidth * tileSize);
  const scaleY = mh / (mapHeight * tileSize);

  minimapCtx.fillStyle = 'rgba(0,0,0,0.7)';
  minimapCtx.fillRect(0, 0, mw, mh);

  // Draw map tiles (simplified)
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const t = mapData[y][x];
      if (t === TILE_WALL || t === TILE_CRATE || t === TILE_DOOR) {
        minimapCtx.fillStyle = 'rgba(100,100,120,0.8)';
      } else if (t === TILE_BOMBSITE_A) {
        minimapCtx.fillStyle = 'rgba(255,100,100,0.3)';
      } else if (t === TILE_BOMBSITE_B) {
        minimapCtx.fillStyle = 'rgba(100,100,255,0.3)';
      } else {
        continue;
      }
      minimapCtx.fillRect(x * tileSize * scaleX, y * tileSize * scaleY, tileSize * scaleX + 1, tileSize * scaleY + 1);
    }
  }

  // Draw players on minimap
  const p = players[myId];
  for (const [id, pl] of Object.entries(players)) {
    if (!pl.alive || pl.team === 'SPEC') continue;
    const isAlly = pl.team === p?.team;
    if (!isAlly && id !== myId) continue; // Don't show enemies on minimap

    minimapCtx.beginPath();
    minimapCtx.arc(pl.x * scaleX, pl.y * scaleY, id === myId ? 3 : 2, 0, Math.PI * 2);
    minimapCtx.fillStyle = pl.team === 'T' ? '#d4a537' : '#4a90d9';
    minimapCtx.fill();
  }

  // Bomb on minimap
  if (bomb && bomb.planted) {
    minimapCtx.beginPath();
    minimapCtx.arc(bomb.x * scaleX, bomb.y * scaleY, 4, 0, Math.PI * 2);
    minimapCtx.fillStyle = '#ff3333';
    minimapCtx.fill();
  }
}

// Start render loop
requestAnimationFrame(render);
