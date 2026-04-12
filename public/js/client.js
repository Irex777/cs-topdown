// CS Top-Down - Client v2 with Advanced Graphics Engine
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');

// ==================== CONSTANTS ====================
const PLAYER_RADIUS = 12;
const TILE_SIZE = 32;
const TILE_WALL = 1, TILE_CRATE = 2, TILE_BS_A = 3, TILE_BS_B = 4;
const TILE_T_SPAWN = 5, TILE_CT_SPAWN = 6, TILE_DOOR = 7;
const WEAPONS = {
  pistol:{name:'P250',type:'pistol'},glock:{name:'Glock-18',type:'pistol'},
  usp:{name:'USP-S',type:'pistol'},deagle:{name:'Desert Eagle',type:'pistol'},
  mp9:{name:'MP9',type:'smg'},mac10:{name:'MAC-10',type:'smg'},p90:{name:'P90',type:'smg'},
  ak47:{name:'AK-47',type:'rifle'},m4a4:{name:'M4A4',type:'rifle'},
  galil:{name:'Galil AR',type:'rifle'},famas:{name:'FAMAS',type:'rifle'},
  awp:{name:'AWP',type:'sniper'},ssg08:{name:'SSG 08',type:'sniper'},
  nova:{name:'Nova',type:'shotgun'},
};
const BUY_ITEMS = {
  'Pistols':[{key:'pistol',name:'P250',price:300},{key:'deagle',name:'Desert Eagle',price:700}],
  'SMGs':[{key:'mp9',name:'MP9',price:1250,team:'CT'},{key:'mac10',name:'MAC-10',price:1050,team:'T'},{key:'p90',name:'P90',price:2350}],
  'Rifles':[{key:'galil',name:'Galil AR',price:1800,team:'T'},{key:'famas',name:'FAMAS',price:2050,team:'CT'},{key:'ak47',name:'AK-47',price:2700,team:'T'},{key:'m4a4',name:'M4A4',price:3100,team:'CT'}],
  'Snipers':[{key:'ssg08',name:'SSG 08',price:1700},{key:'awp',name:'AWP',price:4750}],
  'Shotguns':[{key:'nova',name:'Nova',price:1050}],
  'Equipment':[{key:'kevlar',name:'Kevlar Vest',price:650},{key:'helmet',name:'Kevlar + Helmet',price:1000},{key:'defuse_kit',name:'Defuse Kit',price:400,team:'CT'}],
  'Grenades':[{key:'he_grenade',name:'HE Grenade',price:300},{key:'flashbang',name:'Flashbang',price:200},{key:'smoke',name:'Smoke Grenade',price:300}],
};

// ==================== STATE ====================
let socket = null, myId = null, mapData = null, bombsites = null;
let gameState = 'waiting';
let myPlayer = null;
let players = {};
let bullets = [];
let serverGrenades = [];
let activeGrenades = [];
let bomb = null;
let tScore = 0, ctScore = 0, roundNumber = 0;
let roundTimer = 0, freezeTimer = 0;
let camera = { x: 0, y: 0, shakeX: 0, shakeY: 0 };
let keys = {};
let mouse = { x: 0, y: 0, down: false };
let showBuyMenu = false, chatOpen = false;
let flashTimer = 0;
let mapWidth = 80, mapHeight = 60;
let mapOffscreen = null;
let mapWidthPx, mapHeightPx;

// ==================== PARTICLE SYSTEM ====================
class Particle {
  constructor(x, y, vx, vy, life, size, color, gravity, friction, shrink, glow) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life; this.size = size;
    this.color = color; this.gravity = gravity || 0;
    this.friction = friction || 1; this.shrink = shrink !== false;
    this.glow = glow || 0; this.rotation = Math.random() * Math.PI * 2;
    this.rotSpeed = (Math.random() - 0.5) * 5;
  }
  update(dt) {
    this.vy += this.gravity * dt;
    this.vx *= this.friction; this.vy *= this.friction;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.life -= dt; this.rotation += this.rotSpeed * dt;
    return this.life > 0;
  }
  draw(ctx) {
    const alpha = Math.max(0, this.life / this.maxLife);
    const sz = this.shrink ? this.size * alpha : this.size;
    if (sz <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    if (this.glow > 0) {
      ctx.shadowColor = this.color; ctx.shadowBlur = this.glow;
    }
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(0, 0, sz, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

let particles = [];

function spawnMuzzleFlash(x, y, angle) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  // Bright flash
  for (let i = 0; i < 6; i++) {
    const spread = (Math.random() - 0.5) * 0.8;
    const spd = 200 + Math.random() * 300;
    particles.push(new Particle(
      x + cos * 18, y + sin * 18,
      Math.cos(angle + spread) * spd, Math.sin(angle + spread) * spd,
      0.06 + Math.random() * 0.06, 3 + Math.random() * 3,
      `hsl(${40 + Math.random() * 20}, 100%, ${70 + Math.random() * 30}%)`,
      0, 0.9, true, 15
    ));
  }
  // Smoke puff
  for (let i = 0; i < 3; i++) {
    particles.push(new Particle(
      x + cos * 20, y + sin * 20,
      cos * 30 + (Math.random()-0.5) * 60, sin * 30 + (Math.random()-0.5) * 60,
      0.3 + Math.random() * 0.4, 4 + Math.random() * 4,
      `rgba(180,180,180,0.4)`, 0, 0.96, true, 0
    ));
  }
}

function spawnBulletImpact(x, y) {
  // Sparks
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 80 + Math.random() * 200;
    particles.push(new Particle(x, y,
      Math.cos(a)*spd, Math.sin(a)*spd,
      0.15 + Math.random()*0.2, 1.5 + Math.random()*1.5,
      `hsl(${30+Math.random()*30}, 100%, ${60+Math.random()*40}%)`,
      200, 0.95, true, 5
    ));
  }
  // Dust
  for (let i = 0; i < 4; i++) {
    particles.push(new Particle(x, y,
      (Math.random()-0.5)*60, (Math.random()-0.5)*60,
      0.4 + Math.random()*0.3, 3 + Math.random()*3,
      `rgba(140,130,120,0.5)`, 0, 0.96, true, 0
    ));
  }
}

function spawnBlood(x, y, angle) {
  // Blood spray
  for (let i = 0; i < 12; i++) {
    const a = angle + (Math.random() - 0.5) * 1.2;
    const spd = 50 + Math.random() * 150;
    particles.push(new Particle(x, y,
      Math.cos(a)*spd, Math.sin(a)*spd,
      0.3 + Math.random()*0.5, 1.5 + Math.random()*2,
      `hsl(${0+Math.random()*10}, ${80+Math.random()*20}%, ${25+Math.random()*20}%)`,
      100, 0.96, true, 0
    ));
  }
  // Blood pool (large slow particle)
  particles.push(new Particle(x, y,
    (Math.random()-0.5)*10, (Math.random()-0.5)*10,
    3 + Math.random()*2, 5 + Math.random()*4,
    `hsl(0, 85%, 22%)`, 0, 1, false, 0
  ));
}

function spawnExplosion(x, y, radius) {
  const r = radius || 200;
  // Core flash
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 100 + Math.random() * 400;
    particles.push(new Particle(x, y,
      Math.cos(a)*spd, Math.sin(a)*spd,
      0.2 + Math.random()*0.4, 5 + Math.random()*8,
      `hsl(${20+Math.random()*30}, 100%, ${50+Math.random()*50}%)`,
      0, 0.95, true, 20
    ));
  }
  // Debris
  for (let i = 0; i < 15; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 150 + Math.random() * 300;
    particles.push(new Particle(x, y,
      Math.cos(a)*spd, Math.sin(a)*spd,
      0.5 + Math.random()*1, 2 + Math.random()*3,
      `hsl(${20+Math.random()*15}, 30%, ${20+Math.random()*15}%)`,
      400, 0.97, true, 0
    ));
  }
  // Smoke
  for (let i = 0; i < 20; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * r * 0.5;
    particles.push(new Particle(x + Math.cos(a)*d, y + Math.sin(a)*d,
      (Math.random()-0.5)*40, -30 - Math.random()*50,
      1.5 + Math.random()*2, 8 + Math.random()*12,
      `rgba(60,60,60,0.6)`, -20, 0.99, false, 0
    ));
  }
  // Screen shake
  camera.shakeX = (Math.random()-0.5) * 30;
  camera.shakeY = (Math.random()-0.5) * 30;
  setTimeout(() => { camera.shakeX = 0; camera.shakeY = 0; }, 400);
}

function spawnSmokeEffect(x, y, radius) {
  for (let i = 0; i < 15; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * (radius || 80);
    particles.push(new Particle(x + Math.cos(a)*d*0.3, y + Math.sin(a)*d*0.3,
      Math.cos(a)*20, Math.sin(a)*20,
      2 + Math.random()*3, 6 + Math.random()*10,
      `rgba(80,80,80,0.5)`, -5, 0.99, false, 0
    ));
  }
}

function spawnDeathEffect(x, y) {
  for (let i = 0; i < 20; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 30 + Math.random() * 80;
    particles.push(new Particle(x, y,
      Math.cos(a)*spd, Math.sin(a)*spd,
      0.5 + Math.random()*0.5, 2 + Math.random()*3,
      `hsl(0, 70%, ${20+Math.random()*15}%)`,
      0, 0.97, true, 0
    ));
  }
}

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
  socket = io(server, {
    query: { name }, transports: ['websocket', 'polling'],
    secure: server.startsWith('https'), reconnection: true,
    reconnectionAttempts: 10, reconnectionDelay: 1000,
  });

  socket.on('connect_error', (err) => {
    document.getElementById('menu-status').textContent = 'Failed: ' + err.message;
  });

  socket.on('welcome', (data) => {
    myId = data.id; mapWidth = data.mapWidth; mapHeight = data.mapHeight;
    gameState = data.gameState; roundNumber = data.round;
    tScore = data.tScore; ctScore = data.ctScore;
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('team-select').classList.add('show');
  });

  socket.on('map_data', (data) => {
    mapData = data.map; bombsites = data.bombsites;
    preRenderMap();
  });

  socket.on('player_list', (list) => {
    let tc = 0, ctc = 0;
    for (const p of Object.values(list)) { if (p.team==='T') tc++; else if (p.team==='CT') ctc++; }
    document.getElementById('t-count').textContent = tc + ' players';
    document.getElementById('ct-count').textContent = ctc + ' players';
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
    players = state.players; bullets = state.bullets;
    serverGrenades = state.grenades; activeGrenades = state.activeGrenades;
    bomb = state.bomb; roundTimer = state.roundTimer; freezeTimer = state.freezeTimer;
    gameState = state.gameState; roundNumber = state.round;
    tScore = state.tScore; ctScore = state.ctScore;
    if (players[myId]) myPlayer = players[myId];
    updateHUD();
  });

  socket.on('round_start', (d) => { roundNumber = d.round; tScore = d.tScore; ctScore = d.ctScore; showCenterMsg('FREEZE TIME', '#ff6b35'); });
  socket.on('round_live', (d) => { showCenterMsg('ROUND ' + d.round, '#4caf50'); });
  socket.on('round_end', (d) => {
    const c = d.winner==='T'?'#d4a537':'#4a90d9';
    showCenterMsg((d.winner==='T'?'TERRORISTS':'COUNTER-TERRORISTS')+' WIN', c, 4);
  });

  socket.on('player_killed', (d) => {
    addKillFeedEntry(d);
    if (d.victim === myId) showCenterMsg('YOU DIED', '#ff3333');
    const vp = players[d.victim];
    if (vp) spawnDeathEffect(vp.x, vp.y);
  });

  socket.on('hit_marker', (d) => { showHitMarker(false); });

  socket.on('bullet_impact', (d) => { spawnBulletImpact(d.x, d.y); });

  socket.on('grenade_explode', (d) => {
    if (d.type === 'he') spawnExplosion(d.x, d.y, d.radius);
    else if (d.type === 'flash') { flashTimer = d.duration || 3; }
    else if (d.type === 'smoke') spawnSmokeEffect(d.x, d.y, d.radius);
  });

  socket.on('bomb_planted', (d) => {
    showCenterMsg('BOMB PLANTED - SITE ' + d.site, '#ff3333', 3);
    spawnExplosion(d.x, d.y, 50);
  });
  socket.on('bomb_defused', (d) => { showCenterMsg('BOMB DEFUSED', '#4caf50', 3); });
  socket.on('bomb_exploded', (d) => { spawnExplosion(d.x, d.y, 400); });
  socket.on('game_over', (d) => {
    showCenterMsg((d.winner==='T'?'TERRORISTS':'COUNTER-TERRORISTS')+' WIN THE GAME', '#ff6b35', 10);
  });
  socket.on('game_restart', () => { showCenterMsg('GAME RESTARTED', '#fff'); });
  socket.on('team_swap', () => { showCenterMsg('TEAM SWAP', '#ff6b35'); });
  socket.on('chat', (d) => { addChatMessage(d); });
  socket.on('error', (m) => { alert(m); });
  socket.on('player_update', (d) => { if (players[d.id]) Object.assign(players[d.id], d); });
}

function joinTeam(t) { if (socket) socket.emit('join_team', t); }
function startGame() { if (socket) socket.emit('start_game'); }

// ==================== INPUT ====================
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Enter' && !chatOpen) {
    chatOpen = true; const inp = document.getElementById('chat-input');
    inp.classList.add('show'); inp.focus(); return;
  }
  if (e.code === 'Enter' && chatOpen) {
    const inp = document.getElementById('chat-input');
    if (inp.value.trim() && socket) socket.emit('chat', inp.value.trim());
    inp.value = ''; inp.classList.remove('show'); chatOpen = false; return;
  }
  if (e.code === 'Escape' && chatOpen) {
    const inp = document.getElementById('chat-input');
    inp.value = ''; inp.classList.remove('show'); chatOpen = false; return;
  }
  if (chatOpen) return;
  if (e.code === 'KeyB') toggleBuyMenu();
  if (e.code === 'Tab') { e.preventDefault(); document.getElementById('scoreboard').classList.add('show'); }
  if (e.code === 'Digit1') socket?.emit('switch_weapon', 0);
  if (e.code === 'Digit2') socket?.emit('switch_weapon', 1);
  if (e.code === 'Digit3') socket?.emit('switch_weapon', 2);
  if (e.code === 'Digit4') socket?.emit('switch_weapon', 3);
  if (e.code === 'KeyR') socket?.emit('reload');
  if (e.code === 'KeyG') socket?.emit('throw_grenade', 'he');
  if (e.code === 'KeyF') socket?.emit('throw_grenade', 'flash');
  if (e.code === 'KeyC') socket?.emit('throw_grenade', 'smoke');
  if (e.code === 'KeyE') {
    if (myPlayer?.team === 'T') socket?.emit('plant_bomb');
    else if (myPlayer?.team === 'CT') socket?.emit('defuse_bomb');
  }
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') document.getElementById('scoreboard').classList.remove('show');
});
canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('mousedown', () => { mouse.down = true; });
canvas.addEventListener('mouseup', () => { mouse.down = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Input sending
setInterval(() => {
  if (!socket || !myPlayer || chatOpen) return;
  const p = players[myId];
  if (!p || !p.alive) return;
  const wmx = mouse.x - canvas.width / 2;
  const wmy = mouse.y - canvas.height / 2;
  socket.emit('update_input', {
    up: keys['KeyW']||false, down: keys['KeyS']||false,
    left: keys['KeyA']||false, right: keys['KeyD']||false,
  });
  socket.emit('update_angle', Math.atan2(wmy, wmx));
  if (mouse.down && !showBuyMenu) socket.emit('shoot');
}, 1000/30);

// ==================== BUY MENU ====================
function toggleBuyMenu() {
  showBuyMenu = !showBuyMenu;
  const m = document.getElementById('buy-menu');
  if (showBuyMenu) { renderBuyMenu(); m.classList.add('show'); } else m.classList.remove('show');
}
function renderBuyMenu() {
  const c = document.getElementById('buy-content');
  const p = players[myId]; if (!p) return;
  let h = '';
  for (const [sec, items] of Object.entries(BUY_ITEMS)) {
    h += '<div class="buy-section"><div class="buy-section-title">' + sec + '</div><div class="buy-grid">';
    for (const it of items) {
      const ca = p.money < it.price, wt = it.team && it.team !== p.team;
      h += '<div class="buy-item '+(ca?'cant-afford':wt?'wrong-team':'')+'" onclick="buyItem(\''+it.key+'\')">';
      h += '<div class="buy-item-name">'+it.name+'</div><div class="buy-item-price">$'+it.price+'</div></div>';
    }
    h += '</div></div>';
  }
  c.innerHTML = h;
}
function buyItem(k) { if (socket) socket.emit('buy', k); renderBuyMenu(); }

// ==================== HUD ====================
function updateHUD() {
  const p = players[myId]; if (!p) return;
  document.getElementById('score-t').textContent = tScore;
  document.getElementById('score-ct').textContent = ctScore;
  document.getElementById('round-num').textContent = 'Round ' + roundNumber;
  const time = Math.max(0, gameState === 'freeze' ? freezeTimer : roundTimer);
  const m = Math.floor(time/60), s = Math.floor(time%60);
  const timerEl = document.getElementById('round-timer');
  timerEl.textContent = m + ':' + s.toString().padStart(2, '0');
  timerEl.style.color = time < 10 ? '#ff4444' : time < 30 ? '#ffaa00' : '#fff';

  document.getElementById('hp-text').textContent = Math.ceil(p.hp);
  const hpPct = Math.max(0, p.hp);
  const hpFill = document.getElementById('hp-fill');
  hpFill.style.width = hpPct + '%';
  hpFill.className = 'bar-fill hp-fill' + (hpPct <= 25 ? ' low' : hpPct <= 50 ? ' mid' : '');
  document.getElementById('armor-fill').style.width = p.armor + '%';

  if (p.weapons?.length && p.currentWeapon >= 0 && p.ammo) {
    const wk = p.weapons[p.currentWeapon], am = p.ammo[wk], w = WEAPONS[wk];
    document.getElementById('weapon-name').textContent = w ? w.name.toUpperCase() : wk;
    document.getElementById('ammo-current').textContent = am ? am.mag : 0;
    document.getElementById('ammo-reserve').textContent = am ? am.reserve : 0;
  }
  document.getElementById('money-amount').textContent = '$' + p.money;
  document.getElementById('grenade-he').textContent = p.grenades?.he || 0;
  document.getElementById('grenade-flash').textContent = p.grenades?.flash || 0;
  document.getElementById('grenade-smoke').textContent = p.grenades?.smoke || 0;

  const slots = document.getElementById('weapon-slots');
  if (p.weapons) {
    let sh = '';
    p.weapons.forEach((w, i) => {
      sh += '<div class="weapon-slot '+(i===p.currentWeapon?'active':'')+'"><span class="slot-key">'+(i+1)+'</span>'+(WEAPONS[w]?.name||w)+'</div>';
    });
    slots.innerHTML = sh;
  }

  // Flash
  document.getElementById('flash-overlay').style.opacity = Math.min(1, flashTimer);

  // Damage vignette
  if (p.hp < 100 && p.alive) {
    document.getElementById('damage-vignette').style.opacity = Math.max(0, (1 - p.hp/100) * 0.6);
  } else {
    document.getElementById('damage-vignette').style.opacity = 0;
  }
}

// ==================== MAP PRE-RENDER ====================
function preRenderMap() {
  if (!mapData) return;
  mapWidthPx = mapWidth * TILE_SIZE;
  mapHeightPx = mapHeight * TILE_SIZE;
  mapOffscreen = document.createElement('canvas');
  mapOffscreen.width = mapWidthPx;
  mapOffscreen.height = mapHeightPx;
  const mc = mapOffscreen.getContext('2d');

  // Base floor
  mc.fillStyle = '#1a1a28';
  mc.fillRect(0, 0, mapWidthPx, mapHeightPx);

  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const t = mapData[y][x], px = x * TILE_SIZE, py = y * TILE_SIZE;
      switch (t) {
        case TILE_WALL:
          // 3D wall effect
          mc.fillStyle = '#3d3d52';
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          mc.fillStyle = '#4a4a62';
          mc.fillRect(px, py, TILE_SIZE, 3);
          mc.fillStyle = '#32324a';
          mc.fillRect(px, py + TILE_SIZE - 2, TILE_SIZE, 2);
          mc.fillStyle = '#353550';
          mc.fillRect(px, py, 2, TILE_SIZE);
          // Brick pattern
          mc.strokeStyle = 'rgba(0,0,0,0.15)';
          mc.lineWidth = 0.5;
          mc.strokeRect(px+1, py+1, TILE_SIZE-2, TILE_SIZE-2);
          if ((x+y)%2===0) mc.strokeRect(px+4, py+4, TILE_SIZE-8, TILE_SIZE/2-4);
          break;
        case TILE_CRATE:
          mc.fillStyle = '#5c4a38';
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          mc.fillStyle = '#6b5743';
          mc.fillRect(px+2, py+2, TILE_SIZE-4, TILE_SIZE-4);
          mc.strokeStyle = '#4a3828';
          mc.lineWidth = 1.5;
          mc.strokeRect(px+3, py+3, TILE_SIZE-6, TILE_SIZE-6);
          mc.beginPath();
          mc.moveTo(px+3, py+3); mc.lineTo(px+TILE_SIZE-3, py+TILE_SIZE-3);
          mc.moveTo(px+TILE_SIZE-3, py+3); mc.lineTo(px+3, py+TILE_SIZE-3);
          mc.strokeStyle = 'rgba(0,0,0,0.2)'; mc.stroke();
          // Highlight
          mc.fillStyle = 'rgba(255,255,255,0.05)';
          mc.fillRect(px+2, py+2, TILE_SIZE-4, 2);
          break;
        case TILE_BS_A:
          mc.fillStyle = '#1e1e2a';
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          mc.fillStyle = `rgba(255,80,60,${0.04 + Math.random()*0.03})`;
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          break;
        case TILE_BS_B:
          mc.fillStyle = '#1e1e2a';
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          mc.fillStyle = `rgba(60,80,255,${0.04 + Math.random()*0.03})`;
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          break;
        case TILE_T_SPAWN:
          mc.fillStyle = '#221e18';
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          break;
        case TILE_CT_SPAWN:
          mc.fillStyle = '#181e24';
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          break;
        case TILE_DOOR:
          mc.fillStyle = '#4a3a28';
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          mc.fillStyle = '#554530';
          mc.fillRect(px+2, py+2, TILE_SIZE-4, TILE_SIZE-4);
          break;
        default:
          mc.fillStyle = '#1a1a28';
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          // Subtle floor texture
          if (Math.random() < 0.15) {
            mc.fillStyle = `rgba(255,255,255,${Math.random()*0.02})`;
            mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          }
          break;
      }
      // Grid lines
      if (t !== TILE_WALL && t !== TILE_CRATE) {
        mc.strokeStyle = 'rgba(255,255,255,0.012)';
        mc.lineWidth = 0.5;
        mc.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  // Bombsite labels
  if (bombsites) {
    mc.font = 'bold 52px sans-serif'; mc.textAlign = 'center'; mc.textBaseline = 'middle';
    if (bombsites.A) {
      mc.fillStyle = 'rgba(255,80,60,0.15)';
      mc.fillText('A', bombsites.A.centerX, bombsites.A.centerY);
      // Bombsite border outline
      drawBombsiteOutline(mc, bombsites.A, 'rgba(255,80,60,0.2)');
    }
    if (bombsites.B) {
      mc.fillStyle = 'rgba(60,80,255,0.15)';
      mc.fillText('B', bombsites.B.centerX, bombsites.B.centerY);
      drawBombsiteOutline(mc, bombsites.B, 'rgba(60,80,255,0.2)');
    }
  }
}

function drawBombsiteOutline(mc, site, color) {
  if (!site.tiles || site.tiles.length === 0) return;
  const padding = 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of site.tiles) {
    if (t.x < minX) minX = t.x; if (t.y < minY) minY = t.y;
    if (t.x > maxX) maxX = t.x; if (t.y > maxY) maxY = t.y;
  }
  mc.strokeStyle = color; mc.lineWidth = 2; mc.setLineDash([8, 4]);
  mc.strokeRect(
    minX * TILE_SIZE - padding, minY * TILE_SIZE - padding,
    (maxX - minX + 1) * TILE_SIZE + padding * 2, (maxY - minY + 1) * TILE_SIZE + padding * 2
  );
  mc.setLineDash([]);
}

// ==================== UI HELPERS ====================
let centerMessages = [];
function showCenterMsg(text, color, dur) {
  centerMessages.push({ text, color, timer: dur || 3, max: dur || 3 });
}

function showHitMarker(kill) {
  const el = document.getElementById('hit-marker');
  el.className = kill ? 'show hm-kill' : 'show';
  setTimeout(() => { el.className = ''; }, 150);
}

function addKillFeedEntry(d) {
  const feed = document.getElementById('kill-feed');
  const e = document.createElement('div'); e.className = 'kill-entry';
  const tc = team => team === 'T' ? '#d4a537' : '#4a90d9';
  const hs = d.headshot ? ' <span class="hs-icon">★ HS</span>' : '';
  e.innerHTML =
    `<span class="killer-name" style="color:${tc(players[d.killer]?.team)}">${d.killerName}</span>` +
    `<span class="weapon-icon">〈${WEAPONS[d.weapon]?.name||d.weapon}〉</span>` +
    `<span class="victim-name" style="color:${tc(players[d.victim]?.team)}">${d.victimName}</span>` + hs;
  feed.appendChild(e);
  setTimeout(() => { if (e.parentNode) e.remove(); }, 6000);
}

function addChatMessage(d) {
  const box = document.getElementById('chat-box');
  const msg = document.createElement('div'); msg.className = 'chat-msg';
  msg.innerHTML = `<span class="chat-name ${d.team}">${d.name}:</span> ${escapeHtml(d.message)}`;
  box.appendChild(msg);
  setTimeout(() => { if (msg.parentNode) msg.remove(); }, 10000);
}

function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

function updateScoreboard(list) {
  const c = document.getElementById('sb-content'); if (!c) return;
  document.getElementById('sb-t-score').textContent = tScore;
  document.getElementById('sb-ct-score').textContent = ctScore;
  let tP = [], ctP = [];
  for (const p of Object.values(list)) {
    if (p.team === 'T') tP.push(p); else if (p.team === 'CT') ctP.push(p);
  }
  let h = '<div style="display:flex;gap:24px;">';
  const makeTable = (arr) => {
    let t = '<table class="sb-table"><tr><th>Player</th><th>K</th><th>D</th><th>$</th></tr>';
    for (const p of arr) t += `<tr class="${p.alive?'':'dead'}"><td>${escapeHtml(p.name)}</td><td>${p.kills}</td><td>${p.deaths}</td><td>$${p.money}</td></tr>`;
    return t + '</table>';
  };
  h += '<div style="flex:1">' + makeTable(tP) + '</div>';
  h += '<div style="flex:1">' + makeTable(ctP) + '</div></div>';
  c.innerHTML = h;
}

// ==================== MAIN RENDER LOOP ====================
let lastTime = 0;
// Track prev player positions for interpolation
let prevPlayers = {};
let muzzleFlashTimers = {};

function render(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  // Update effects
  flashTimer = Math.max(0, flashTimer - dt);
  centerMessages = centerMessages.filter(m => { m.timer -= dt; return m.timer > 0; });
  particles = particles.filter(p => p.update(dt));

  // Camera shake decay
  camera.shakeX *= 0.9; camera.shakeY *= 0.9;
  if (Math.abs(camera.shakeX) < 0.5) camera.shakeX = 0;
  if (Math.abs(camera.shakeY) < 0.5) camera.shakeY = 0;

  const p = players[myId];
  if (p && p.alive) {
    camera.x = p.x - canvas.width / 2;
    camera.y = p.y - canvas.height / 2;
  }

  // Clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(-camera.x + camera.shakeX, -camera.y + camera.shakeY);

  // Map
  if (mapOffscreen) ctx.drawImage(mapOffscreen, 0, 0);

  // Shadow layer for players and objects
  drawShadows();

  // Smoke grenades (fog of war)
  for (const g of serverGrenades) {
    if (g.type === 'smoke') {
      const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.radius);
      grad.addColorStop(0, 'rgba(70,70,70,0.85)');
      grad.addColorStop(0.7, 'rgba(60,60,60,0.6)');
      grad.addColorStop(1, 'rgba(50,50,50,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2); ctx.fill();
      // Smoke edge particles
      if (Math.random() < 0.3) {
        const a = Math.random() * Math.PI * 2;
        particles.push(new Particle(
          g.x + Math.cos(a)*g.radius*0.8, g.y + Math.sin(a)*g.radius*0.8,
          Math.cos(a)*10, Math.sin(a)*10,
          1, 5+Math.random()*5, 'rgba(80,80,80,0.3)', 0, 0.99, false, 0
        ));
      }
    }
  }

  // Active grenades
  for (const g of activeGrenades) {
    const colors = { he: '#ff4444', flash: '#ffee44', smoke: '#aaa' };
    ctx.save();
    ctx.shadowColor = colors[g.type] || '#fff';
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(g.x, g.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = colors[g.type] || '#fff'; ctx.fill();
    ctx.restore();
    // Trail
    particles.push(new Particle(g.x, g.y, (Math.random()-0.5)*10, (Math.random()-0.5)*10,
      0.2, 2, 'rgba(200,200,200,0.3)', 0, 0.9, true, 0));
  }

  // Bomb
  if (bomb && bomb.planted) {
    const pulse = Math.sin(Date.now() / 150) * 0.4 + 0.6;
    const urgentPulse = bomb.timer < 10 ? Math.sin(Date.now() / 60) * 0.3 + 0.7 : pulse;
    // Glow
    ctx.save();
    ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 30 * urgentPulse;
    ctx.beginPath(); ctx.arc(bomb.x, bomb.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,50,30,${urgentPulse * 0.8})`; ctx.fill();
    ctx.restore();
    // Bomb icon
    ctx.fillStyle = '#111'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('💣', bomb.x, bomb.y + 5);
    // Timer
    ctx.font = 'bold 16px monospace'; ctx.fillStyle = bomb.timer < 10 ? '#ff0000' : '#ff4444';
    ctx.fillText(Math.ceil(bomb.timer) + 's', bomb.x, bomb.y - 22);
    // Ring expanding
    if (bomb.timer < 10) {
      const ring = (10 - bomb.timer) % 2;
      ctx.beginPath(); ctx.arc(bomb.x, bomb.y, 20 + ring * 30, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,0,0,${0.3 * (1 - ring/2)})`; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  // Bullets with trails
  for (const b of bullets) {
    // Muzzle flash from shooter
    if (!muzzleFlashTimers[b.owner]) {
      const shooter = players[b.owner];
      if (shooter) spawnMuzzleFlash(shooter.x, shooter.y, shooter.angle);
      muzzleFlashTimers[b.owner] = 0.05;
    }
    // Bullet trail
    const spd = Math.sqrt(b.vx*b.vx + b.vy*b.vy);
    if (spd > 0) {
      const trailLen = 12;
      const tx = b.x - (b.vx/spd)*trailLen, ty = b.y - (b.vy/spd)*trailLen;
      const grad = ctx.createLinearGradient(tx, ty, b.x, b.y);
      grad.addColorStop(0, 'rgba(255,200,50,0)');
      grad.addColorStop(1, 'rgba(255,200,50,0.8)');
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.stroke();
    }
    // Bullet head glow
    ctx.save();
    ctx.shadowColor = '#ffaa00'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffdd44'; ctx.fill();
    ctx.restore();
  }

  // Decay muzzle flash timers
  for (const k in muzzleFlashTimers) {
    muzzleFlashTimers[k] -= dt;
    if (muzzleFlashTimers[k] <= 0) delete muzzleFlashTimers[k];
  }

  // Players
  for (const [id, pl] of Object.entries(players)) {
    if (!pl.alive || pl.team === 'SPEC') continue;
    const isMe = id === myId;
    const isAlly = pl.team === p?.team;
    drawPlayer(pl, isMe, isAlly);
  }

  // Particles
  for (const part of particles) part.draw(ctx);

  ctx.restore();

  // Draw vignette (subtle darkening at edges)
  drawVignette();

  // Center messages
  for (const msg of centerMessages) {
    const alpha = Math.min(1, msg.timer / (msg.max * 0.3));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 42px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillText(msg.text, canvas.width/2+2, canvas.height*0.35+2);
    // Text
    ctx.fillStyle = msg.color;
    ctx.fillText(msg.text, canvas.width/2, canvas.height*0.35);
    ctx.restore();
  }

  // Reload bar
  if (p && p.reloading) {
    const bw = 100, bh = 4;
    const bx = canvas.width/2 - bw/2, by = canvas.height/2 + 40;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = '#ff6b35';
    ctx.fillRect(bx, by, bw * (1 - (p.reloadTimer || 0) / 3), bh);
    ctx.font = '11px sans-serif'; ctx.fillStyle = '#aaa'; ctx.textAlign = 'center';
    ctx.fillText('RELOADING', canvas.width/2, by + 16);
  }

  // Minimap
  drawMinimap();

  requestAnimationFrame(render);
}

function drawPlayer(pl, isMe, isAlly) {
  const x = pl.x, y = pl.y, angle = pl.angle;
  const isT = pl.team === 'T';

  // Team colors
  const bodyColor = isT ? '#c9952d' : '#3a7bc8';
  const bodyLight = isT ? '#daa535' : '#4a8bd8';
  const bodyDark = isT ? '#8a6a20' : '#2a5590';
  const outlineColor = isMe ? '#fff' : isAlly ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)';

  ctx.save();
  ctx.translate(x, y);

  // Player shadow
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.beginPath(); ctx.ellipse(2, 3, PLAYER_RADIUS+2, PLAYER_RADIUS, 0, 0, Math.PI*2);
  ctx.fillStyle = '#000'; ctx.fill();
  ctx.restore();

  // Body - circle with gradient
  ctx.rotate(angle);

  // Body base
  const bodyGrad = ctx.createRadialGradient(-2, -2, 0, 0, 0, PLAYER_RADIUS);
  bodyGrad.addColorStop(0, bodyLight);
  bodyGrad.addColorStop(0.7, bodyColor);
  bodyGrad.addColorStop(1, bodyDark);
  ctx.beginPath(); ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = bodyGrad; ctx.fill();

  // Outline
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = isMe ? 2.5 : 1.5;
  ctx.stroke();

  // Gun barrel
  const gunLen = isMe ? 20 : 16;
  const gunW = 3;
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(PLAYER_RADIUS - 3, -gunW/2, gunLen, gunW);
  ctx.fillStyle = '#444';
  ctx.fillRect(PLAYER_RADIUS - 3, -gunW/2, gunLen, 1);

  // Face direction indicator (small dot at front)
  ctx.beginPath(); ctx.arc(PLAYER_RADIUS * 0.4, 0, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = isT ? '#ffe0a0' : '#a0c8ff'; ctx.fill();

  ctx.rotate(-angle);

  // Armor indicator ring
  if (pl.armor > 0) {
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_RADIUS + 3, 0, Math.PI * 2 * (pl.armor / 100));
    ctx.strokeStyle = 'rgba(33,150,243,0.5)'; ctx.lineWidth = 2; ctx.stroke();
  }

  ctx.restore();

  // Name tag (not rotated)
  ctx.save();
  ctx.font = isMe ? 'bold 10px sans-serif' : '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = isMe ? '#fff' : 'rgba(255,255,255,0.7)';
  ctx.fillText(pl.name, x, y - PLAYER_RADIUS - 16);

  // HP bar
  const barW = 26, barH = 3;
  const bx = x - barW/2, by = y - PLAYER_RADIUS - 10;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(bx-1, by-1, barW+2, barH+2);
  const hpPct = pl.hp / 100;
  const hpColor = hpPct > 0.6 ? '#4caf50' : hpPct > 0.3 ? '#ff9800' : '#f44336';
  ctx.fillStyle = hpColor;
  ctx.fillRect(bx, by, barW * hpPct, barH);

  // Defuse kit icon
  if (pl.hasDefuseKit) {
    ctx.font = '8px sans-serif';
    ctx.fillText('🔧', x + PLAYER_RADIUS + 5, y);
  }

  ctx.restore();
}

function drawShadows() {
  // Cast simple shadows from walls
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#000';
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const t = mapData[y][x];
      if (t === TILE_WALL || t === TILE_CRATE) {
        ctx.fillRect(x * TILE_SIZE + 3, y * TILE_SIZE + 3, TILE_SIZE, TILE_SIZE);
      }
    }
  }
  ctx.restore();
}

function drawVignette() {
  const grad = ctx.createRadialGradient(
    canvas.width/2, canvas.height/2, canvas.width * 0.3,
    canvas.width/2, canvas.height/2, canvas.width * 0.7
  );
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawMinimap() {
  if (!mapData) return;
  const mw = minimapCanvas.width, mh = minimapCanvas.height;
  const sx = mw / (mapWidth * TILE_SIZE), sy = mh / (mapHeight * TILE_SIZE);

  minimapCtx.fillStyle = 'rgba(10,10,20,0.8)';
  minimapCtx.fillRect(0, 0, mw, mh);

  // Tiles
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const t = mapData[y][x];
      if (t === TILE_WALL || t === TILE_CRATE || t === TILE_DOOR) {
        minimapCtx.fillStyle = 'rgba(80,80,100,0.7)';
      } else if (t === TILE_BS_A) {
        minimapCtx.fillStyle = 'rgba(255,80,60,0.2)';
      } else if (t === TILE_BS_B) {
        minimapCtx.fillStyle = 'rgba(60,80,255,0.2)';
      } else continue;
      minimapCtx.fillRect(x*TILE_SIZE*sx, y*TILE_SIZE*sy, TILE_SIZE*sx+1, TILE_SIZE*sy+1);
    }
  }

  // Players
  const me = players[myId];
  for (const [id, pl] of Object.entries(players)) {
    if (!pl.alive || pl.team === 'SPEC') continue;
    const isAlly = pl.team === me?.team;
    if (!isAlly && id !== myId) continue;
    minimapCtx.beginPath();
    minimapCtx.arc(pl.x * sx, pl.y * sy, id === myId ? 3 : 2, 0, Math.PI*2);
    minimapCtx.fillStyle = pl.team === 'T' ? '#d4a537' : '#4a90d9';
    minimapCtx.fill();
    if (id === myId) {
      minimapCtx.strokeStyle = '#fff'; minimapCtx.lineWidth = 1; minimapCtx.stroke();
    }
  }

  // Bomb
  if (bomb?.planted) {
    minimapCtx.beginPath();
    minimapCtx.arc(bomb.x * sx, bomb.y * sy, 4, 0, Math.PI*2);
    minimapCtx.fillStyle = '#ff3333'; minimapCtx.fill();
  }

  // Camera view rectangle
  minimapCtx.strokeStyle = 'rgba(255,255,255,0.2)'; minimapCtx.lineWidth = 1;
  minimapCtx.strokeRect(camera.x * sx, camera.y * sy, canvas.width * sx, canvas.height * sy);
}

requestAnimationFrame(render);
