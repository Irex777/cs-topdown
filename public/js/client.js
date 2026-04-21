// CS Top-Down - Client v3.0 — Enhanced Edition
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');
const menuCanvas = document.getElementById('menu-particles');
const menuCtx = menuCanvas ? menuCanvas.getContext('2d') : null;

// ==================== STATE INTERPOLATION ====================
const STATE_BUFFER_SIZE = 10;
const stateBuffer = [];
let interpDelay = 80; // ms — interpolate 80ms behind latest server state
let lastServerTime = 0;

// ==================== CONSTANTS ====================
const GAME_VERSION = '3.0';
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
  nova:{name:'Nova',type:'shotgun'},knife:{name:'Knife',type:'knife'},
};
const WEAPON_ICONS = {
  pistol:'🔫',glock:'🔫',usp:'🔫',deagle:'🔫',
  mp9:'🔫',mac10:'🔫',p90:'🔫',
  ak47:'🎯',m4a4:'🎯',galil:'🎯',famas:'🎯',
  awp:'🔭',ssg08:'🔭',nova:'💥',knife:'🗡️',
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
let adsActive = false;
let adsZoom = 1.0;
let adsTargetZoom = 1.0;
const ADS_ZOOM_LEVELS = { pistol: 0.7, rifle: 0.55, smg: 0.65, sniper: 0.35, shotgun: 0.75 };

function getPlayerWeaponType() {
  const p = players[myId];
  if (!p || !p.alive) return 'pistol';
  if (p.weaponType) return p.weaponType;
  const wIdx = p.currentWeapon;
  if (wIdx < 0 || !p.weapons || !p.weapons[wIdx]) return 'knife';
  const wKey = p.weapons[wIdx];
  if (WEAPONS[wKey]) return WEAPONS[wKey].type;
  return 'pistol';
}

let serverGrenades = [];
let activeGrenades = [];
let droppedWeapons = [];
let bomb = null;
let tScore = 0, ctScore = 0, roundNumber = 0;
let roundTimer = 0, freezeTimer = 0;
let camera = { x: 0, y: 0, shakeX: 0, shakeY: 0 };
let keys = {};
let mouse = { x: 0, y: 0, down: false };
let showBuyMenu = false, chatOpen = false, chatTeamOnly = false, escMenuOpen = false;
let flashTimer = 0;
let mapWidth = 80, mapHeight = 60;
let mapOffscreen = null;
let mapWidthPx, mapHeightPx;
let fogCanvas = null, fogCtx = null;
let playerCount = 0;
let roundHistory = []; // array of 'T' or 'CT'
let roundMvp = null;
let lastRoundEnd = null;

// Spectator state
let spectating = false;
let spectateTarget = null;
let spectateFreeCam = false;
let freeCamPos = { x: 0, y: 0 };
let freeCamSpeed = 400;

// ==================== SOUND MANAGER (Web Audio API) ====================
const SoundManager = {
  ctx: null,
  masterGain: null,
  initialized: false,

  init() {
    if (this.initialized) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.3;
      this.masterGain.connect(this.ctx.destination);
      this.initialized = true;
    } catch (e) {
      console.warn('Web Audio API not available');
    }
  },

  // Resume context if suspended (autoplay policy)
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },

  // Play a gunshot sound — pitch varies by weapon type
  gunshot(weaponKey) {
    if (!this.ctx) return;
    this.resume();
    const now = this.ctx.currentTime;
    const typeMap = {
      knife: 200, pistol: 400, glock: 450, usp: 500, deagle: 300,
      smg: 350, mp9: 380, mac10: 360, p90: 340,
      rifle: 250, ak47: 220, m4a4: 280, galil: 260, famas: 300,
      sniper: 150, awp: 120, ssg08: 180,
      shotgun: 100, nova: 110,
    };
    const freq = typeMap[weaponKey] || 300;
    const isSniper = weaponKey === 'awp' || weaponKey === 'ssg08';
    const isShotgun = weaponKey === 'nova';
    const duration = isSniper ? 0.3 : isShotgun ? 0.2 : 0.08;

    // Noise burst
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 3);
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq * 3;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(isSniper ? 0.6 : isShotgun ? 0.5 : 0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + duration);

    // Tone component
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, now + duration);
    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.15, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.5);
    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + duration);
  },

  // Soft footstep tick
  footstep() {
    if (!this.ctx) return;
    this.resume();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 80 + Math.random() * 40;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.06);
  },

  // Hit marker ding
  hitMarker(isKill) {
    if (!this.ctx) return;
    this.resume();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = isKill ? 1800 : 1200;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + isKill ? 0.2 : 0.1);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + isKill ? 0.2 : 0.1);
  },

  // Round start beep
  roundStart() {
    if (!this.ctx) return;
    this.resume();
    const now = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 800;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, now + i * 0.15);
      gain.gain.linearRampToValueAtTime(0.15, now + i * 0.15 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.12);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + i * 0.15);
      osc.stop(now + i * 0.15 + 0.12);
    }
  },

  // Round end sound
  roundEnd() {
    if (!this.ctx) return;
    this.resume();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.5);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.5);
  },

  // Bomb tick
  bombTick() {
    if (!this.ctx) return;
    this.resume();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 600;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.1);
  },

  // Death sound
  death() {
    if (!this.ctx) return;
    this.resume();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.4);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.4);
  },

  // Defuse tick
  defuseTick() {
    if (!this.ctx) return;
    this.resume();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1000;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.05);
  },
};

// Initialize audio on first user interaction
document.addEventListener('click', () => SoundManager.init(), { once: true });
document.addEventListener('keydown', () => SoundManager.init(), { once: true });

// ==================== DAMAGE DIRECTION INDICATORS ====================
const damageIndicators = [];
// Store damage events: { angle, timer, maxTimer }
const MAX_DAMAGE_INDICATORS = 8;

function addDamageIndicator(fromX, fromY) {
  if (!myPlayer || !myPlayer.alive) return;
  const dx = fromX - myPlayer.x;
  const dy = fromY - myPlayer.y;
  const angle = Math.atan2(dy, dx);
  damageIndicators.push({ angle, timer: 2.0, maxTimer: 2.0 });
  if (damageIndicators.length > MAX_DAMAGE_INDICATORS) damageIndicators.shift();
}

function drawDamageIndicators() {
  if (damageIndicators.length === 0) return;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = Math.min(canvas.width, canvas.height) * 0.4;

  for (let i = damageIndicators.length - 1; i >= 0; i--) {
    const d = damageIndicators[i];
    d.timer -= 1 / 60; // approximate dt
    if (d.timer <= 0) { damageIndicators.splice(i, 1); continue; }

    const alpha = Math.min(1, d.timer / (d.maxTimer * 0.3));
    const arcLen = 0.5; // radians
    const innerR = radius - 20;
    const outerR = radius + 20;

    ctx.save();
    ctx.globalAlpha = alpha * 0.6;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, d.angle - arcLen / 2, d.angle + arcLen / 2);
    ctx.arc(cx, cy, innerR, d.angle + arcLen / 2, d.angle - arcLen / 2, true);
    ctx.closePath();
    ctx.fillStyle = '#ff2222';
    ctx.fill();
    ctx.restore();
  }
}

// ==================== DEATH SCREEN STATE ====================
let deathScreenData = null; // { killerName, weapon, timer }
let deathScreenTimer = 0;
const DEATH_SCREEN_DURATION = 4; // seconds

function showDeathScreen(killerName, weapon) {
  deathScreenData = { killerName, weapon };
  deathScreenTimer = DEATH_SCREEN_DURATION;
}

function updateDeathScreen(dt) {
  if (deathScreenTimer > 0) {
    deathScreenTimer -= dt;
  }
}

function drawDeathScreen() {
  if (!deathScreenData || deathScreenTimer <= 0) return;
  const d = deathScreenData;
  const alpha = Math.min(1, deathScreenTimer / 0.5); // fade out in last 0.5s

  ctx.save();
  ctx.globalAlpha = alpha * 0.7;
  ctx.fillStyle = 'rgba(80, 0, 0, 0.5)';
  ctx.fillRect(0, canvas.height / 2 - 40, canvas.width, 80);

  ctx.globalAlpha = alpha;
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ff3333';
  ctx.fillText('YOU WERE KILLED', canvas.width / 2, canvas.height / 2 - 10);

  const weaponIcon = WEAPON_ICONS[d.weapon] || '🔫';
  ctx.font = '18px sans-serif';
  ctx.fillStyle = '#ccc';
  ctx.fillText('by ' + d.killerName + '  ' + weaponIcon + ' ' + (WEAPONS[d.weapon]?.name || d.weapon), canvas.width / 2, canvas.height / 2 + 18);

  // Respawn timer
  const remaining = Math.ceil(deathScreenTimer);
  if (remaining > 0) {
    ctx.font = '14px monospace';
    ctx.fillStyle = '#888';
    ctx.fillText('Respawning in ' + remaining + 's...', canvas.width / 2, canvas.height / 2 + 42);
  }
  ctx.restore();
}

// ==================== BOMB HUD ====================
let bombHudTimer = 0;

function drawBombHud() {
  if (!bomb || !bomb.planted) return;
  const alpha = Math.min(1, bombHudTimer / 0.5);
  if (bombHudTimer < 2) bombHudTimer += 1 / 60;

  ctx.save();
  ctx.globalAlpha = alpha;
  const x = canvas.width / 2;
  const y = canvas.height * 0.12;

  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  const bw = 200, bh = 36;
  ctx.beginPath();
  drawRoundRect(ctx, x - bw / 2 - 2, y - bh / 2 - 2, bw + 4, bh + 4, 6);
  ctx.fill();

  // Border (red pulsing)
  const pulse = Math.sin(Date.now() / 150) * 0.3 + 0.7;
  ctx.strokeStyle = `rgba(255, 50, 30, ${pulse})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  drawRoundRect(ctx, x - bw / 2 - 2, y - bh / 2 - 2, bw + 4, bh + 4, 6);
  ctx.stroke();

  // Text
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = bomb.timer < 10 ? '#ff0000' : '#ff4444';
  ctx.fillText('💣 BOMB PLANTED — SITE ' + (bomb.site || '?'), x, y - 5);

  ctx.font = 'bold 20px monospace';
  ctx.fillStyle = bomb.timer < 10 ? '#ff0000' : '#ff6644';
  ctx.fillText(Math.ceil(bomb.timer) + 's', x, y + 16);

  ctx.restore();
}


// Death animations
let deathAnimations = []; // {x, y, timer, maxTimer, team, name}

// Damage numbers
let damageNumbers = []; // {x, y, amount, timer, vy, color}

// Plant/defuse progress (from server events)
let actionProgress = { active: false, type: '', progress: 0 };

// Ambient dust particles
let ambientParticles = [];

// Shell casings
let shellCasings = []; // {x, y, vx, vy, rotation, rotSpeed, life, maxLife}

// Footstep particles
let footstepTimers = {}; // playerId -> timer

// Weapon sway
let weaponSway = { x: 0, y: 0, targetX: 0, targetY: 0 };

// Bullet holes on walls
let bulletHoles = []; // {x, y, life, maxLife}

// Dynamic crosshair
let crosshairSpread = 0;
let crosshairTargetSpread = 0;
let lastShotTime = 0;
let lastMoveTime = 0;

// Bomb glow canvas (pre-rendered)
let bombGlowCanvas = null;

// Vignette canvas (pre-rendered)
let vignetteCanvas = null;

// ==================== MENU PARTICLES ====================
let menuParticles = [];
function initMenuParticles() {
  if (!menuCanvas) return;
  menuCanvas.width = window.innerWidth;
  menuCanvas.height = window.innerHeight;
  menuParticles = [];
  for (let i = 0; i < 80; i++) {
    menuParticles.push({
      x: Math.random() * menuCanvas.width,
      y: Math.random() * menuCanvas.height,
      vx: (Math.random() - 0.5) * 30,
      vy: (Math.random() - 0.5) * 30,
      size: 1 + Math.random() * 3,
      alpha: 0.05 + Math.random() * 0.25,
      color: ['#ff6b35','#ffd700','#4a90d9','#d4a537','#ff4444','#44ff88'][Math.floor(Math.random() * 6)],
    });
  }
}
function updateMenuParticles() {
  if (!menuCtx || document.getElementById('menu-screen').classList.contains('hidden')) return;
  menuCtx.clearRect(0, 0, menuCanvas.width, menuCanvas.height);

  // Animated gradient background
  const time = Date.now() / 1000;
  const grad = menuCtx.createRadialGradient(
    menuCanvas.width * (0.5 + Math.sin(time * 0.3) * 0.2),
    menuCanvas.height * (0.5 + Math.cos(time * 0.2) * 0.2),
    0,
    menuCanvas.width / 2, menuCanvas.height / 2,
    menuCanvas.width * 0.8
  );
  grad.addColorStop(0, 'rgba(255,107,53,0.06)');
  grad.addColorStop(0.5, 'rgba(74,144,217,0.03)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  menuCtx.fillStyle = grad;
  menuCtx.fillRect(0, 0, menuCanvas.width, menuCanvas.height);

  // Scanline effect
  menuCtx.fillStyle = 'rgba(0,0,0,0.03)';
  for (let y = 0; y < menuCanvas.height; y += 4) {
    menuCtx.fillRect(0, y, menuCanvas.width, 1);
  }

  for (const p of menuParticles) {
    p.x += p.vx * 0.016;
    p.y += p.vy * 0.016;
    if (p.x < 0) p.x = menuCanvas.width;
    if (p.x > menuCanvas.width) p.x = 0;
    if (p.y < 0) p.y = menuCanvas.height;
    if (p.y > menuCanvas.height) p.y = 0;
    menuCtx.save();
    menuCtx.globalAlpha = p.alpha;
    menuCtx.fillStyle = p.color;
    menuCtx.beginPath();
    menuCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    menuCtx.fill();
    // Connect nearby particles
    for (const q of menuParticles) {
      const dx = p.x - q.x, dy = p.y - q.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 100 && dist > 0) {
        menuCtx.globalAlpha = (1 - dist / 100) * 0.06;
        menuCtx.strokeStyle = p.color;
        menuCtx.lineWidth = 0.5;
        menuCtx.beginPath();
        menuCtx.moveTo(p.x, p.y);
        menuCtx.lineTo(q.x, q.y);
        menuCtx.stroke();
      }
    }
    menuCtx.restore();
  }

  // Draw team logos (subtle background emblems)
  const logoAlpha = 0.04 + Math.sin(time) * 0.01;
  menuCtx.save();
  menuCtx.globalAlpha = logoAlpha;
  menuCtx.font = 'bold 180px sans-serif';
  menuCtx.textAlign = 'center';
  menuCtx.textBaseline = 'middle';
  // T logo
  menuCtx.fillStyle = '#d4a537';
  menuCtx.fillText('T', menuCanvas.width * 0.2, menuCanvas.height * 0.4);
  // CT logo
  menuCtx.fillStyle = '#4a90d9';
  menuCtx.fillText('CT', menuCanvas.width * 0.8, menuCanvas.height * 0.6);
  menuCtx.restore();

  requestAnimationFrame(updateMenuParticles);
}

function toggleControls() {
  const panel = document.getElementById('controls-panel');
  panel.classList.toggle('show');
  const toggle = document.querySelector('.controls-toggle');
  toggle.textContent = panel.classList.contains('show') ? 'HIDE CONTROLS' : 'SHOW CONTROLS';
}

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
let effects = [];

function spawnMuzzleFlash(x, y, angle, weaponType) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  // Scale flash size by weapon type
  const sizeMult = weaponType === 'sniper' ? 2.5 : weaponType === 'rifle' ? 2.0 : weaponType === 'shotgun' ? 2.2 : weaponType === 'smg' ? 1.5 : weaponType === 'pistol' ? 1.0 : 0.5;
  const countMult = weaponType === 'shotgun' ? 1.5 : weaponType === 'sniper' ? 1.3 : 1.0;
  const barrelLen = weaponType === 'sniper' ? 32 : weaponType === 'rifle' ? 28 : weaponType === 'smg' ? 22 : weaponType === 'shotgun' ? 20 : weaponType === 'pistol' ? 18 : 14;

  // Dynamic crosshair spread on shoot
  lastShotTime = Date.now();
  crosshairTargetSpread = Math.min(20, crosshairTargetSpread + (weaponType === 'rifle' || weaponType === 'smg' ? 8 : 12));
  if (adsActive) crosshairTargetSpread *= 0.4;

  // Core bright flash
  for (let i = 0; i < Math.ceil(3 * countMult); i++) {
    const spread = (Math.random() - 0.5) * 0.8;
    const spd = (200 + Math.random() * 300) * sizeMult;
    particles.push(new Particle(
      x + cos * barrelLen, y + sin * barrelLen,
      Math.cos(angle + spread) * spd, Math.sin(angle + spread) * spd,
      0.06 + Math.random() * 0.06, (3 + Math.random() * 3) * sizeMult,
      `hsl(${40 + Math.random() * 20}, 100%, ${70 + Math.random() * 30}%)`,
      0, 0.9, true, 15 * sizeMult
    ));
  }
  // Smoke wisps
  for (let i = 0; i < Math.ceil(2 * countMult); i++) {
    particles.push(new Particle(
      x + cos * (barrelLen + 2), y + sin * (barrelLen + 2),
      cos * 30 + (Math.random()-0.5) * 60, sin * 30 + (Math.random()-0.5) * 60,
      0.3 + Math.random() * 0.4, (4 + Math.random() * 4) * sizeMult,
      `rgba(180,180,180,0.4)`, 0, 0.96, true, 0
    ));
  }
  // Bright white core flash (bigger for bigger weapons)
  if (sizeMult > 1) {
    particles.push(new Particle(
      x + cos * barrelLen, y + sin * barrelLen,
      cos * 10, sin * 10,
      0.04, 6 * sizeMult,
      `rgba(255,255,240,0.9)`, 0, 0.8, true, 25 * sizeMult
    ));
  }
}

function spawnBulletImpact(x, y) {
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
  for (let i = 0; i < 4; i++) {
    particles.push(new Particle(x, y,
      (Math.random()-0.5)*60, (Math.random()-0.5)*60,
      0.4 + Math.random()*0.3, 3 + Math.random()*3,
      `rgba(140,130,120,0.5)`, 0, 0.96, true, 0
    ));
  }
  // Add bullet hole
  bulletHoles.push({ x, y, life: 8, maxLife: 8 });
  if (bulletHoles.length > 60) bulletHoles.shift();
}

function spawnBlood(x, y, angle) {
  // More particles, darker, directional spray
  for (let i = 0; i < 8; i++) {
    const a = angle + (Math.random() - 0.5) * 1.4;
    const spd = 40 + Math.random() * 180;
    particles.push(new Particle(x, y,
      Math.cos(a)*spd, Math.sin(a)*spd,
      0.4 + Math.random()*0.6, 1 + Math.random()*2.5,
      `hsl(${0+Math.random()*8}, ${70+Math.random()*30}%, ${15+Math.random()*15}%)`,
      120, 0.96, true, 0
    ));
  }
  // Dark blood pool splat
  particles.push(new Particle(x, y,
    (Math.random()-0.5)*8, (Math.random()-0.5)*8,
    4 + Math.random()*2, 6 + Math.random()*5,
    `hsl(0, 80%, 12%)`, 0, 1, false, 0
  ));
  // Secondary splatter drops
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 8 + Math.random() * 12;
    particles.push(new Particle(x + Math.cos(a)*d, y + Math.sin(a)*d,
      (Math.random()-0.5)*20, (Math.random()-0.5)*20,
      2 + Math.random()*2, 2 + Math.random()*3,
      `hsl(0, 75%, 18%)`, 0, 1, false, 0
    ));
  }
}

function spawnExplosion(x, y, radius) {
  const r = radius || 200;

  // 1. Bright central flash (white-hot)
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 20 + Math.random() * 60;
    particles.push(new Particle(x, y,
      Math.cos(a)*spd, Math.sin(a)*spd,
      0.08 + Math.random() * 0.06, 15 + Math.random() * 10,
      `rgba(255,255,240,0.95)`, 0, 0.8, true, 40
    ));
  }

  // 2. Fire particles
  for (let i = 0; i < 35; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 100 + Math.random() * 400;
    particles.push(new Particle(x, y,
      Math.cos(a)*spd, Math.sin(a)*spd,
      0.2 + Math.random()*0.5, 5 + Math.random()*8,
      `hsl(${15+Math.random()*35}, 100%, ${45+Math.random()*55}%)`,
      0, 0.95, true, 20
    ));
  }

  // 3. Expanding smoke ring
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + Math.random() * 0.2;
    const spd = 200 + Math.random() * 150;
    particles.push(new Particle(x, y,
      Math.cos(a)*spd, Math.sin(a)*spd,
      0.6 + Math.random()*0.8, 3 + Math.random()*3,
      `rgba(60,60,60,0.5)`, 0, 0.97, false, 0
    ));
  }

  // 4. Heavy smoke column
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

  // 5. Debris / rubble particles
  for (let i = 0; i < 25; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 200 + Math.random() * 500;
    particles.push(new Particle(x + Math.cos(a)*r*0.2, y + Math.sin(a)*r*0.2,
      Math.cos(a)*spd, Math.sin(a)*spd,
      0.8 + Math.random()*1.2, 2 + Math.random()*4,
      `hsl(${20+Math.random()*20}, ${10+Math.random()*20}%, ${25+Math.random()*20}%)`,
      500, 0.98, true, 0
    ));
  }

  // 6. Lingering smoke clouds
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * r * 0.4;
    particles.push(new Particle(x + Math.cos(a)*d, y + Math.sin(a)*d,
      (Math.random()-0.5)*40, -30 - Math.random()*50,
      2 + Math.random()*2, 10 + Math.random()*15,
      `rgba(50,50,50,0.5)`, -20, 0.99, false, 0
    ));
  }

  camera.shakeX = (Math.random()-0.5) * 35;
  camera.shakeY = (Math.random()-0.5) * 35;
  setTimeout(() => { camera.shakeX = 0; camera.shakeY = 0; }, 500);
}

function spawnSmokeEffect(x, y, radius) {
  const r = radius || 80;
  // Dense core puffs
  for (let i = 0; i < 20; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * r * 0.4;
    particles.push(new Particle(x + Math.cos(a)*d, y + Math.sin(a)*d,
      Math.cos(a)*15, Math.sin(a)*15,
      2.5 + Math.random()*3, 8 + Math.random()*12,
      `rgba(75,75,75,0.6)`, -5, 0.99, false, 0
    ));
  }
  // Outer wispy edges
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = r * 0.5 + Math.random() * r * 0.4;
    particles.push(new Particle(x + Math.cos(a)*d, y + Math.sin(a)*d,
      Math.cos(a)*25, Math.sin(a)*25 - 8,
      1.5 + Math.random()*2, 5 + Math.random()*8,
      `rgba(85,85,85,0.35)`, -3, 0.99, false, 0
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

function spawnShellCasing(x, y, angle) {
  const ejectAngle = angle + Math.PI / 2 + (Math.random() - 0.5) * 0.5;
  const spd = 80 + Math.random() * 120;
  shellCasings.push({
    x, y,
    vx: Math.cos(ejectAngle) * spd,
    vy: Math.sin(ejectAngle) * spd - 40,
    rotation: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 15,
    life: 1.5 + Math.random(),
    maxLife: 2.5,
    size: 2 + Math.random(),
  });
}

function spawnFootstepParticles(x, y) {
  for (let i = 0; i < 3; i++) {
    particles.push(new Particle(
      x + (Math.random() - 0.5) * 8,
      y + (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 20,
      (Math.random() - 0.5) * 20,
      0.3 + Math.random() * 0.3,
      1 + Math.random() * 1.5,
      'rgba(100,95,85,0.3)',
      0, 0.95, true, 0
    ));
  }
}

function spawnAmbientDust(camX, camY) {
  if (ambientParticles.length > 30) return;
  if (Math.random() > 0.05) return;
  ambientParticles.push({
    x: camX + Math.random() * canvas.width,
    y: camY + Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 8,
    vy: -2 - Math.random() * 5,
    life: 3 + Math.random() * 4,
    maxLife: 3 + Math.random() * 4,
    size: 0.5 + Math.random() * 1.5,
  });
}

function spawnDamageNumber(x, y, amount, isHeadshot) {
  damageNumbers.push({
    x: x + (Math.random() - 0.5) * 10,
    y: y - 10,
    amount: Math.round(amount),
    timer: 1.0,
    vy: -60,
    color: isHeadshot ? '#ffd700' : '#ff4444',
    isHeadshot,
  });
}

// ==================== RESIZE ====================
const FOG_VISIBILITY_RADIUS = 600;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (menuCanvas) {
    menuCanvas.width = window.innerWidth;
    menuCanvas.height = window.innerHeight;
  }
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
  document.getElementById('status-dot').className = 'status-dot';
  document.getElementById('status-text').textContent = 'Connecting...';

  socket = io(server, {
    query: { name }, transports: ['polling', 'websocket'],
    secure: server.startsWith('https'), reconnection: true,
    reconnectionAttempts: 10, reconnectionDelay: 1000,
    upgrade: true,
  });

  socket.on('connect', () => {
    document.getElementById('status-dot').className = 'status-dot online';
    document.getElementById('status-text').textContent = 'Connected';
    document.getElementById('menu-status').textContent = '';
  });

  socket.on('disconnect', () => {
    document.getElementById('status-dot').className = 'status-dot offline';
    document.getElementById('status-text').textContent = 'Disconnected';
  });

  socket.on('connect_error', (err) => {
    document.getElementById('menu-status').textContent = 'Failed: ' + err.message;
    document.getElementById('status-dot').className = 'status-dot offline';
    document.getElementById('status-text').textContent = 'Error';
  });

  socket.on('welcome', (data) => {
    myId = data.id; mapWidth = data.mapWidth; mapHeight = data.mapHeight;
    gameState = data.gameState; roundNumber = data.round;
    tScore = data.tScore; ctScore = data.ctScore;
    if (data.playerCount !== undefined) playerCount = data.playerCount;
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
    playerCount = Object.keys(list).length;
    document.getElementById('t-count').textContent = tc + ' players';
    document.getElementById('ct-count').textContent = ctc + ' players';
    document.getElementById('player-count-text').textContent = playerCount + ' online';
    updateScoreboard(list);
  });

  socket.on('player_joined_team', (data) => {
    if (data.id === myId) {
      myPlayer = { team: data.team };
      spectating = data.team === 'SPEC';
      spectateTarget = null;
      spectateFreeCam = false;
      document.getElementById('team-select').classList.remove('show');
      document.getElementById('hud').classList.remove('hidden');
      if (spectating) {
        document.getElementById('spectator-info').classList.remove('hidden');
        document.getElementById('crosshair').style.display = 'none';
      } else {
        document.getElementById('spectator-info').classList.add('hidden');
        document.getElementById('crosshair').style.display = '';
      }
    }
  });

  socket.on('game_state', (state) => {
    if (state.state !== undefined) gameState = state.state;
    if (state.round !== undefined) roundNumber = state.round;
    if (state.tScore !== undefined) tScore = state.tScore;
    if (state.ctScore !== undefined) ctScore = state.ctScore;
    if (state.roundHistory) { roundHistory = state.roundHistory; updateRoundHistory(); }
    updateHUD();
  });

  socket.on('game_state_update', (state) => {
    state._recvTime = performance.now();
    state._serverTime = performance.now(); // server doesn't send timestamps yet, use arrival time
    stateBuffer.push(state);
    if (stateBuffer.length > STATE_BUFFER_SIZE) stateBuffer.shift();

    // Apply non-interpolated data immediately (timers, scores, etc.)
    roundTimer = state.roundTimer; freezeTimer = state.freezeTimer;
    gameState = state.gameState; roundNumber = state.round;
    tScore = state.tScore; ctScore = state.ctScore;
    if (state.roundHistory) { roundHistory = state.roundHistory; updateRoundHistory(); }
    bomb = state.bomb;
    droppedWeapons = state.droppedWeapons || [];
    activeGrenades = state.activeGrenades;
    serverGrenades = state.grenades;
    bullets = state.bullets;

    if (players[myId]) myPlayer = players[myId];
    // Update action progress from state
    if (state.plantProgress !== undefined && state.plantProgress > 0) {
      actionProgress = { active: true, type: 'planting', progress: state.plantProgress };
    } else if (state.defuseProgress !== undefined && state.defuseProgress > 0) {
      actionProgress = { active: true, type: 'defusing', progress: state.defuseProgress };
    } else {
      actionProgress.active = false;
    }
    updateHUD();
  });

  socket.on('round_start', (d) => {
    roundNumber = d.round; tScore = d.tScore; ctScore = d.ctScore;
    showCenterMsg('FREEZE TIME', '#ff6b35', 'Round ' + d.round, 3);
    hideRoundResult();
    hideGameOver();
    deathScreenData = null;
    deathScreenTimer = 0;
  });

  socket.on('round_live', (d) => {
    showCenterMsg('ROUND ' + d.round, '#4caf50', 'GO GO GO!', 2);
  });

  socket.on('round_end', (d) => {
    const winner = d.winner;
    const reason = d.reason || '';
    const mvpData = d.mvp || {};
    const mvpName = mvpData.name || '';
    const mvpId = mvpData.id || null;
    roundMvp = { name: mvpName, id: mvpId };

    // Add to history
    if (d.roundHistory) {
      roundHistory = d.roundHistory;
    } else {
      roundHistory.push(winner);
      if (roundHistory.length > 15) roundHistory.shift();
    }
    updateRoundHistory();

    // Show banner
    const color = winner === 'T' ? '#d4a537' : '#4a90d9';
    const teamName = winner === 'T' ? 'TERRORISTS' : 'COUNTER-TERRORISTS';
    showRoundResultBanner(teamName, color, reason, mvpName ? '⭐ MVP: ' + mvpName : '');

    showCenterMsg(teamName + ' WIN', color, reason, 4);
  });

  socket.on('player_killed', (d) => {
    addKillFeedEntry(d);
    if (d.victim === myId) {
      // Show death screen with killer info
      showDeathScreen(d.killerName || 'Unknown', d.weapon || 'knife');
      SoundManager.death();
      showCenterMsg('YOU DIED', '#ff3333', 'Spectating...', 3);
      // Enter spectator mode for the player
      if (d.killer) spectateTarget = d.killer;
    }
    if (d.killer === myId) {
      SoundManager.hitMarker(true);
    }
    const vp = players[d.victim];
    if (vp) {
      spawnDeathEffect(vp.x, vp.y);
      // Add death animation
      deathAnimations.push({
        x: vp.x, y: vp.y, timer: 2.0, maxTimer: 2.0,
        team: vp.team, name: vp.name, angle: vp.angle,
      });
    }
  });

  socket.on('hit_marker', (d) => {
    showHitMarker(d && d.kill);
    SoundManager.hitMarker(d && d.kill);
    if (d && d.damage && d.target) {
      const tp = players[d.target];
      if (tp) spawnDamageNumber(tp.x, tp.y, d.damage, d.headshot);
    }
  });

  socket.on('bullet_impact', (d) => { spawnBulletImpact(d.x, d.y); });

  socket.on('damage_taken', (d) => {
    // Show damage direction indicator
    addDamageIndicator(d.attackerX, d.attackerY);
    // Flash damage vignette
    const dv = document.getElementById('damage-vignette');
    if (dv) {
      dv.style.opacity = '1';
      setTimeout(() => { dv.style.opacity = '0'; }, 200);
    }
  });

  socket.on('grenade_explode', (d) => {
    if (d.type === 'he') spawnExplosion(d.x, d.y, d.radius);
    else if (d.type === 'flash') { flashTimer = d.duration || 3; }
    else if (d.type === 'smoke') spawnSmokeEffect(d.x, d.y, d.radius);
  });

  socket.on('bomb_planted', (d) => {
    showCenterMsg('BOMB PLANTED - SITE ' + d.site, '#ff3333', 'Defuse it!', 3);
    spawnExplosion(d.x, d.y, 50);
    bombHudTimer = 0; // Reset to fade in
  });
  socket.on('bomb_defused', (d) => { showCenterMsg('BOMB DEFUSED', '#4caf50', 'Counter-Terrorists save the day!', 3); });
  socket.on('bomb_exploded', (d) => { spawnExplosion(d.x, d.y, 400); });

  socket.on('game_over', (d) => {
    const winner = d.winner === 'T' ? 'TERRORISTS' : 'COUNTER-TERRORISTS';
    const color = d.winner === 'T' ? '#d4a537' : '#4a90d9';
    showCenterMsg(winner + ' WIN THE GAME', color, '', 10);
    const mvpData = d.mvp || {};
    showGameOver(d.winner, mvpData.name || '');
  });

  socket.on('game_restart', () => {
    roundHistory = [];
    roundMvp = null;
    hideRoundResult();
    hideGameOver();
    showCenterMsg('GAME RESTARTED', '#fff', 'New match!', 3);
  });

  socket.on('team_swap', () => {
    showCenterMsg('TEAMS SWAPPED', '#ff6b35', 'Switching sides...', 3);
  });

  socket.on('chat', (d) => { addChatMessage(d); });
  socket.on('error', (m) => { showCenterMsg(m, '#ff4444', '', 3); });
  socket.on('player_update', (d) => { if (players[d.id]) Object.assign(players[d.id], d); });
  socket.on('bomb_defusing', (d) => {
    const el = document.getElementById('action-progress');
    const fill = document.getElementById('action-progress-fill');
    if (!el) return;
    document.getElementById('action-progress-label').textContent = 'DEFUSING';
    fill.className = 'action-progress-fill defusing';
    fill.style.width = (d.progress * 100) + '%';
    el.classList.add('show');
  });
  socket.on('bomb_defuse_cancelled', () => { hideDefuseProgress(); });
  socket.on('sound', (d) => { playSound(d); });
}

function joinTeam(t) { if (socket) socket.emit('join_team', t); }
function startGame() { if (socket) socket.emit('start_game'); }
function addBots() {
  if (!socket) return;
  socket.emit('add_bots');
  socket.once('bots_added', (r) => {
    console.log('Bots added: T=' + r.t + ' CT=' + r.ct);
  });
}
function reconnectGame() {
  hideGameOver();
  if (socket) socket.disconnect();
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('menu-screen').classList.remove('hidden');
  myPlayer = null;
  spectating = false;
  spectateTarget = null;
  connect();
}

// ==================== ESC MENU ====================
function closeEscMenu() {
  escMenuOpen = false;
  document.getElementById('esc-menu').classList.remove('show');
}

function escSwitchTeam(team) {
  if (!socket) return;
  socket.emit('switch_team', team);
  closeEscMenu();
}

function escSpectate() {
  if (!socket) return;
  socket.emit('switch_team', 'SPEC');
  closeEscMenu();
}

function escDisconnect() {
  if (socket) socket.disconnect();
  closeEscMenu();
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('menu-screen').classList.remove('hidden');
  myPlayer = null;
  spectating = false;
}

function escRestartGame() {
  if (!socket) return;
  socket.emit('restart_game');
  closeEscMenu();
}

function escRemoveBots() {
  if (!socket) return;
  socket.emit('remove_bots');
  closeEscMenu();
}

// ==================== INPUT ====================
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Escape' && chatOpen) {
    const inp = document.getElementById('chat-input');
    inp.value = ''; inp.classList.remove('show'); inp.classList.remove('team-chat-input');
    chatOpen = false; chatTeamOnly = false; return;
  }
  if (e.code === 'Escape' && showBuyMenu) {
    showBuyMenu = false;
    document.getElementById('buy-menu').classList.remove('show');
    return;
  }
  if (e.code === 'Escape') {
    escMenuOpen = !escMenuOpen;
    const escMenu = document.getElementById('esc-menu');
    if (escMenuOpen) escMenu.classList.add('show');
    else escMenu.classList.remove('show');
    return;
  }
  if (e.code === 'Enter' && !chatOpen && !escMenuOpen) {
    chatOpen = true; chatTeamOnly = false; const inp = document.getElementById('chat-input');
    inp.placeholder = 'Type message... (Enter to send)';
    inp.classList.add('show'); inp.classList.remove('team-chat-input'); inp.focus(); return;
  }
  if (e.code === 'KeyU' && !chatOpen && !escMenuOpen) {
    chatOpen = true; chatTeamOnly = true; const inp = document.getElementById('chat-input');
    inp.placeholder = 'Team chat... (Enter to send)';
    inp.classList.add('show'); inp.classList.add('team-chat-input'); inp.focus(); return;
  }
  if (e.code === 'Enter' && chatOpen) {
    const inp = document.getElementById('chat-input');
    if (inp.value.trim() && socket) socket.emit('chat_message', { message: inp.value.trim(), teamOnly: chatTeamOnly });
    inp.value = ''; inp.classList.remove('show'); inp.classList.remove('team-chat-input');
    chatOpen = false; chatTeamOnly = false; return;
  }
  if (chatOpen || escMenuOpen) return;

  // Spectator controls
  if (spectating) {
    if (e.code === 'Space') {
      e.preventDefault();
      cycleSpectateTarget();
      if (spectateTarget) socket?.emit('spectate_player', spectateTarget);
      return;
    }
  }

  if (e.code === 'KeyB') toggleBuyMenu();
  // Buy menu number shortcuts
  if (showBuyMenu && e.code.startsWith('Digit')) {
    const num = parseInt(e.code.replace('Digit', ''));
    if (num >= 1 && num <= 9 && window._buyKeys && window._buyKeys[num - 1]) {
      buyItem(window._buyKeys[num - 1]);
      return;
    }
  }
  if (e.code === 'Tab') { e.preventDefault(); document.getElementById('scoreboard').classList.add('show'); }
  if (!showBuyMenu) {
    if (e.code === 'Digit1') socket?.emit('switch_weapon', 0);
    if (e.code === 'Digit2') socket?.emit('switch_weapon', 1);
    if (e.code === 'Digit3') socket?.emit('switch_weapon', 2);
    if (e.code === 'Digit4') socket?.emit('switch_weapon', 3);
  }
  if (e.code === 'KeyR') socket?.emit('reload');
  if (e.code === 'KeyG') socket?.emit('throw_grenade', 'he');
  if (e.code === 'KeyF') socket?.emit('throw_grenade', 'flash');
  if (e.code === 'KeyC') socket?.emit('throw_grenade', 'smoke');
  if (e.code === 'KeyE') {
    if (myPlayer?.team === 'T') socket?.emit('plant_bomb');
    else if (myPlayer?.team === 'CT') socket?.emit('defuse_bomb');
  }
  // Cancel defuse when moving
  if ((e.code === 'KeyW' || e.code === 'KeyS' || e.code === 'KeyA' || e.code === 'KeyD') && myPlayer?.defusingBomb) {
    socket?.emit('cancel_defuse');
  }
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') document.getElementById('scoreboard').classList.remove('show');
});
canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  // BUG FIX: Update crosshair position to follow mouse cursor
  const crosshairEl = document.getElementById('crosshair');
  if (crosshairEl && crosshairEl.style.display !== 'none') {
    crosshairEl.style.left = mouse.x + 'px';
    crosshairEl.style.top = mouse.y + 'px';
  }
});
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) {
    mouse.down = true;
    // Spectator: click to select player
    if (spectating && !showBuyMenu && !escMenuOpen) {
      const worldX = (mouse.x - canvas.width / 2) / adsZoom + camera.x;
      const worldY = (mouse.y - canvas.height / 2) / adsZoom + camera.y;
      let closestId = null, closestDist = 40;
      for (const [id, pl] of Object.entries(players)) {
        if (!pl.alive || pl.team === 'SPEC') continue;
        const dx = pl.x - worldX, dy = pl.y - worldY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < closestDist) { closestDist = dist; closestId = id; }
      }
      if (closestId) {
        spectateTarget = closestId;
        spectateFreeCam = false;
        socket?.emit('spectate_player', closestId);
      }
    }
  }
  if (e.button === 2) {
    adsActive = true;
    const p = players[myId];
    if (p && p.alive) {
      const wepType = getPlayerWeaponType();
      adsTargetZoom = ADS_ZOOM_LEVELS[wepType] || 1.3;
    }
  }
});
canvas.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouse.down = false;
  if (e.button === 2) {
    adsActive = false;
    adsTargetZoom = 1.0;
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  if (!socket || chatOpen || escMenuOpen) return;
  e.preventDefault();
  const dir = e.deltaY > 0 ? 1 : -1;
  socket.emit('scroll_weapon', dir);
}, { passive: false });

// Input sending
setInterval(() => {
  if (!socket || !myPlayer || chatOpen || escMenuOpen) return;

  // Spectator free camera
  if (spectating) {
    if (keys['KeyW']) freeCamPos.y -= freeCamSpeed * (1/30);
    if (keys['KeyS']) freeCamPos.y += freeCamSpeed * (1/30);
    if (keys['KeyA']) freeCamPos.x -= freeCamSpeed * (1/30);
    if (keys['KeyD']) freeCamPos.x += freeCamSpeed * (1/30);
    return;
  }

  const p = players[myId];
  if (!p || !p.alive) return;
  const wmx = (mouse.x - canvas.width / 2) / adsZoom;
  const wmy = (mouse.y - canvas.height / 2) / adsZoom;
  socket.emit('update_input', {
    up: keys['KeyW']||false, down: keys['KeyS']||false,
    left: keys['KeyA']||false, right: keys['KeyD']||false,
    shoot: mouse.down && !showBuyMenu,
    sprint: keys['ShiftLeft'] || keys['ShiftRight'] || false,
    crouch: keys['ControlLeft'] || keys['ControlRight'] || false,
    ads: adsActive,
  });
  socket.emit('update_angle', Math.atan2(wmy, wmx));
}, 1000/30);

// ==================== SPECTATOR ====================
function cycleSpectateTarget() {
  const alivePlayers = Object.entries(players).filter(([id, pl]) => pl.alive && pl.team !== 'SPEC');
  if (alivePlayers.length === 0) return;
  if (!spectateTarget) {
    spectateTarget = alivePlayers[0][0];
    spectateFreeCam = false;
    return;
  }
  const idx = alivePlayers.findIndex(([id]) => id === spectateTarget);
  const next = (idx + 1) % alivePlayers.length;
  spectateTarget = alivePlayers[next][0];
  spectateFreeCam = false;
}

function getSpectateCameraTarget() {
  if (!spectating) return null;
  if (spectateFreeCam || !spectateTarget) return { x: freeCamPos.x, y: freeCamPos.y, free: true };
  const target = players[spectateTarget];
  if (target && target.alive) return { x: target.x, y: target.y, free: false, player: target };
  // Target died, switch
  spectateTarget = null;
  return { x: freeCamPos.x, y: freeCamPos.y, free: true };
}

// ==================== BUY MENU ====================
function toggleBuyMenu() {
  showBuyMenu = !showBuyMenu;
  const m = document.getElementById('buy-menu');
  if (showBuyMenu) { renderBuyMenu(); m.classList.add('show'); } else m.classList.remove('show');
}
function renderBuyMenu() {
  const c = document.getElementById('buy-content');
  const p = players[myId]; if (!p) return;
  // Update money display
  document.getElementById('buy-money').textContent = '$' + p.money;

  // Buy availability feedback
  const buyTimeLeft = 115 - roundTimer;
  const canBuy = gameState === 'freeze' || gameState === 'waiting' || gameState === 'round_end' || buyTimeLeft <= 4;
  const statusEl = document.querySelector('.buy-title');
  if (statusEl) {
    if (gameState === 'playing' && buyTimeLeft > 4) {
      statusEl.innerHTML = 'BUY MENU <span style="color:#ff4444;font-size:11px;">[BUY TIME EXPIRED]</span>';
    } else if (gameState === 'freeze') {
      statusEl.innerHTML = 'BUY MENU <span style="color:#4caf50;font-size:11px;">[FREEZE TIME]</span>';
    } else if (gameState === 'round_end') {
      statusEl.innerHTML = 'BUY MENU <span style="color:#ffaa00;font-size:11px;">[ROUND OVER]</span>';
    } else {
      statusEl.innerHTML = 'BUY MENU <span style="color:#4caf50;font-size:11px;">[' + Math.max(0, 4 - Math.floor(buyTimeLeft)) + 's left]</span>';
    }
  }
  // Show current loadout
  const loadoutEl = document.getElementById('buy-loadout-items');
  let loadoutHtml = '';
  if (p.weapons) {
    p.weapons.forEach((w, i) => {
      const wInfo = WEAPONS[w];
      const name = wInfo ? wInfo.name : w;
      const sellPrice = getSellPrice(w);
      loadoutHtml += `<div class="buy-loadout-item owned">${i+1}. ${name}<button class="sell-btn" onclick="sellItem('${w}')" title="Sell for $${sellPrice}">SELL $${sellPrice}</button></div>`;
    });
  }
  if (p.grenades) {
    if (p.grenades.he > 0) { const sp = getSellPrice('he_grenade'); loadoutHtml += `<div class="buy-loadout-item owned">HE Grenade x${p.grenades.he}<button class="sell-btn" onclick="sellItem('he_grenade')" title="Sell for $${sp}">SELL $${sp}</button></div>`; }
    if (p.grenades.flash > 0) { const sp = getSellPrice('flashbang'); loadoutHtml += `<div class="buy-loadout-item owned">Flashbang x${p.grenades.flash}<button class="sell-btn" onclick="sellItem('flashbang')" title="Sell for $${sp}">SELL $${sp}</button></div>`; }
    if (p.grenades.smoke > 0) { const sp = getSellPrice('smoke'); loadoutHtml += `<div class="buy-loadout-item owned">Smoke x${p.grenades.smoke}<button class="sell-btn" onclick="sellItem('smoke')" title="Sell for $${sp}">SELL $${sp}</button></div>`; }
  }
  if (p.hasDefuseKit) { const sp = getSellPrice('defuse_kit'); loadoutHtml += `<div class="buy-loadout-item owned">Defuse Kit<button class="sell-btn" onclick="sellItem('defuse_kit')" title="Sell for $${sp}">SELL $${sp}</button></div>`; }
  if (p.armor > 0) { const akey = p.helmet ? 'helmet' : 'kevlar'; const sp = getSellPrice(akey); loadoutHtml += `<div class="buy-loadout-item owned">Armor${p.helmet ? '+Helm' : ''}<button class="sell-btn" onclick="sellItem('${akey}')" title="Sell for $${sp}">SELL $${sp}</button></div>`; }
  loadoutEl.innerHTML = loadoutHtml;

  let h = '';
  let buyKeyIdx = 1;
  const buyKeys = [];
  for (const [sec, items] of Object.entries(BUY_ITEMS)) {
    h += '<div class="buy-section"><div class="buy-section-title">' + sec + '</div><div class="buy-grid">';
    for (const it of items) {
      const ca = p.money < it.price, wt = it.team && it.team !== p.team;
      const keyLabel = buyKeyIdx <= 9 ? buyKeyIdx : '';
      if (buyKeyIdx <= 9) buyKeys.push(it.key);
      buyKeyIdx++;
      // Build stats tooltip
      const wInfo = WEAPONS[it.key];
      let statsHtml = '';
      if (wInfo) {
        const dmgPct = Math.min(100, Math.round((wInfo.damage || 0) / 40 * 100));
        const ratePct = Math.min(100, Math.round((wInfo.fireRate || 0) / 12 * 100));
        const accVal = wInfo.spread ? Math.max(0, Math.round((1 - wInfo.spread) * 100)) : 70;
        statsHtml = '<div class="buy-item-stats">' +
          '<div class="buy-item-stats-row"><span>Damage</span><div class="buy-item-stats-bar"><div class="buy-item-stats-fill" style="width:'+dmgPct+'%;background:#ff4444"></div></div></div>' +
          '<div class="buy-item-stats-row"><span>Fire Rate</span><div class="buy-item-stats-bar"><div class="buy-item-stats-fill" style="width:'+ratePct+'%;background:#ffaa00"></div></div></div>' +
          '<div class="buy-item-stats-row"><span>Accuracy</span><div class="buy-item-stats-bar"><div class="buy-item-stats-fill" style="width:'+accVal+'%;background:#4caf50"></div></div></div>' +
          '</div>';
      }
      h += '<div class="buy-item '+(ca?'cant-afford':wt?'wrong-team':'')+'" onclick="buyItem(\''+it.key+'\')">';
      if (keyLabel) h += '<div class="buy-item-key">' + keyLabel + '</div>';
      h += '<div class="buy-item-name">'+it.name+'</div><div class="buy-item-price">$'+it.price+'</div>' + statsHtml + '</div>';
    }
    h += '</div></div>';
  }
  c.innerHTML = h;
  // Store buy keys for keyboard shortcuts
  window._buyKeys = buyKeys;
}
function buyItem(k) { if (socket) socket.emit('buy', k); renderBuyMenu(); }
function sellItem(k) { if (socket) socket.emit('sell', k); renderBuyMenu(); }
function getSellPrice(key) {
  // Look up price from BUY_ITEMS, then compute 50% refund
  for (const items of Object.values(BUY_ITEMS)) {
    const item = items.find(it => it.key === key);
    if (item) return Math.floor((item.price || 0) * 0.5);
  }
  return 0;
}

// ==================== HUD ====================
function updateHUD() {
  const p = players[myId]; if (!p) return;

  // Score
  document.getElementById('score-t').textContent = tScore;
  document.getElementById('score-ct').textContent = ctScore;
  document.getElementById('round-num').textContent = 'Round ' + roundNumber;

  // Round dots in score bar
  updateRoundDots();

  // Timer
  const time = gameState === 'waiting' ? 0 : Math.max(0, gameState === 'freeze' ? freezeTimer : roundTimer);
  const m = Math.floor(time/60), s = Math.floor(time%60);
  const timerEl = document.getElementById('round-timer');
  timerEl.textContent = m + ':' + s.toString().padStart(2, '0');
  if (time < 10) {
    timerEl.style.color = '#ff4444';
    timerEl.classList.add('timer-critical');
    timerEl.classList.remove('timer-warning');
  } else if (time < 30) {
    timerEl.style.color = '#ffaa00';
    timerEl.classList.remove('timer-critical');
    timerEl.classList.add('timer-warning');
  } else {
    timerEl.style.color = '#fff';
    timerEl.classList.remove('timer-critical', 'timer-warning');
  }

  // HP/Armor
  document.getElementById('hp-text').textContent = Math.ceil(p.hp);
  const hpPct = Math.max(0, p.hp);
  const hpFill = document.getElementById('hp-fill');
  hpFill.style.width = hpPct + '%';
  hpFill.className = 'bar-fill hp-fill' + (hpPct <= 25 ? ' low' : hpPct <= 50 ? ' mid' : '');
  document.getElementById('armor-fill').style.width = p.armor + '%';

  // Weapon & ammo
  if (p.weapons?.length && p.currentWeapon >= 0 && p.ammo) {
    const wk = p.weapons[p.currentWeapon], am = p.ammo[wk], w = WEAPONS[wk];
    document.getElementById('weapon-name').textContent = w ? w.name.toUpperCase() : wk;
    const ammoEl = document.getElementById('ammo-current');
    ammoEl.textContent = am ? am.mag : 0;
    // Low ammo warning: flash red when mag <= 25% of magSize
    if (w && w.magSize && am && am.mag <= Math.ceil(w.magSize * 0.25) && am.mag > 0) {
      ammoEl.classList.add('ammo-low');
      ammoEl.style.color = '#ff4444';
    } else if (am && am.mag === 0) {
      ammoEl.classList.remove('ammo-low');
      ammoEl.style.color = '#ff2222';
    } else {
      ammoEl.classList.remove('ammo-low');
      ammoEl.style.color = '';
    }
    document.getElementById('ammo-reserve').textContent = am ? am.reserve : 0;
  } else if (p.currentWeapon === -1) {
    document.getElementById('weapon-name').textContent = 'KNIFE';
    const ammoEl = document.getElementById('ammo-current');
    ammoEl.textContent = '\u221E';
    ammoEl.classList.remove('ammo-low');
    ammoEl.style.color = '';
    document.getElementById('ammo-reserve').textContent = '';
  }

  // Reload progress on weapon panel
  const reloadBar = document.getElementById('reload-bar');
  const reloadFill = document.getElementById('reload-fill');
  if (p.reloading && p.reloadTimer !== undefined) {
    reloadBar.style.display = 'block';
    const wk = p.currentWeapon >= 0 && p.weapons ? p.weapons[p.currentWeapon] : null;
    const reloadTimes = {pistol:2.2,glock:2.2,usp:2.2,deagle:2.2,mp9:3.1,mac10:3.1,p90:3.3,ak47:2.5,m4a4:3.1,galil:2.5,famas:3.1,awp:3.7,ssg08:3.7,nova:4.0};
    const maxReload = wk ? (reloadTimes[wk] || 2.5) : 2.5;
    const progress = 1 - Math.max(0, p.reloadTimer) / maxReload;
    reloadFill.style.width = (progress * 100) + '%';
  } else {
    reloadBar.style.display = 'none';
  }

  document.getElementById('money-amount').textContent = '$' + p.money;
  document.getElementById('grenade-he').textContent = p.grenades?.he || 0;
  document.getElementById('grenade-flash').textContent = p.grenades?.flash || 0;
  document.getElementById('grenade-smoke').textContent = p.grenades?.smoke || 0;

  // Weapon slots
  const slots = document.getElementById('weapon-slots');
  if (p.weapons) {
    let sh = '';
    p.weapons.forEach((w, i) => {
      sh += '<div class="weapon-slot '+(i===p.currentWeapon?'active':'')+'"><span class="slot-key">'+(i+1)+'</span>'+(WEAPONS[w]?.name||w)+'</div>';
    });
    slots.innerHTML = sh;
  }

  // Bomb indicator
  const bombInd = document.getElementById('bomb-indicator');
  if (bomb && bomb.planted) {
    bombInd.classList.remove('hidden');
    const siteLabel = document.getElementById('bomb-site-label');
    siteLabel.textContent = 'BOMB ' + (bomb.site || 'A');
    const timerEl2 = document.getElementById('bomb-timer');
    const bt = Math.ceil(bomb.timer);
    timerEl2.textContent = bt + 's';
    timerEl2.className = 'bomb-timer' + (bt <= 10 ? ' urgent' : '');
  } else {
    bombInd.classList.add('hidden');
  }

  // Action progress (plant/defuse)
  const actionEl = document.getElementById('action-progress');
  if (actionProgress.active) {
    actionEl.classList.add('show');
    document.getElementById('action-progress-label').textContent = actionProgress.type === 'planting' ? 'PLANTING...' : 'DEFUSING...';
    const fillEl = document.getElementById('action-progress-fill');
    fillEl.style.width = (actionProgress.progress * 100) + '%';
    fillEl.className = 'action-progress-fill ' + (actionProgress.type === 'planting' ? 'planting' : 'defusing');
  } else {
    actionEl.classList.remove('show');
  }

  // Flash
  document.getElementById('flash-overlay').style.opacity = Math.min(1, flashTimer);

  // Damage vignette
  if (p.hp < 100 && p.alive) {
    document.getElementById('damage-vignette').style.opacity = Math.max(0, (1 - p.hp/100) * 0.6);
  } else {
    document.getElementById('damage-vignette').style.opacity = 0;
  }

  // Alive counts on minimap
  let tAlive = 0, ctAlive = 0;
  for (const pl of Object.values(players)) {
    if (!pl.alive || pl.team === 'SPEC') continue;
    if (pl.team === 'T') tAlive++;
    else ctAlive++;
  }
  document.getElementById('minimap-t-alive').textContent = 'T: ' + tAlive;
  document.getElementById('minimap-ct-alive').textContent = 'CT: ' + ctAlive;
}

function updateRoundDots() {
  const maxRounds = 16;
  const dotsT = document.getElementById('round-dots-t');
  const dotsCT = document.getElementById('round-dots-ct');
  let htmlT = '', htmlCT = '';
  for (let i = 0; i < Math.max(tScore, ctScore, 5); i++) {
    if (i < tScore) htmlT += '<div class="round-dot t"></div>';
    else htmlT += '<div class="round-dot empty"></div>';
    if (i < ctScore) htmlCT += '<div class="round-dot ct"></div>';
    else htmlCT += '<div class="round-dot empty"></div>';
  }
  dotsT.innerHTML = htmlT;
  dotsCT.innerHTML = htmlCT;
}

function updateRoundHistory() {
  const container = document.getElementById('round-history');
  let html = '';
  for (const r of roundHistory) {
    const winner = typeof r === 'string' ? r : (r.winner || '');
    html += `<div class="round-history-dot ${winner.toLowerCase()}"></div>`;
  }
  container.innerHTML = html;
}

// ==================== ROUND RESULT & GAME OVER ====================
function showRoundResultBanner(winner, color, reason, mvpText) {
  const banner = document.getElementById('round-result-banner');
  document.getElementById('round-result-winner').textContent = winner + ' WIN';
  document.getElementById('round-result-winner').style.color = color;
  document.getElementById('round-result-reason').textContent = reason || '';
  document.getElementById('round-result-mvp').textContent = mvpText || '';
  banner.classList.add('show');
  lastRoundEnd = Date.now();
}

function hideRoundResult() {
  document.getElementById('round-result-banner').classList.remove('show');
  lastRoundEnd = null;
}

function showGameOver(winner, mvpName) {
  const screen = document.getElementById('game-over-screen');
  const color = winner === 'T' ? '#d4a537' : '#4a90d9';
  const teamName = winner === 'T' ? 'TERRORISTS' : 'COUNTER-TERRORISTS';
  document.getElementById('game-over-title').textContent = teamName + ' WIN';
  document.getElementById('game-over-title').style.color = color;
  document.getElementById('game-over-score').textContent = tScore + ' — ' + ctScore;
  document.getElementById('game-over-score').innerHTML =
    `<span style="color:#d4a537">${tScore}</span> — <span style="color:#4a90d9">${ctScore}</span>`;
  document.getElementById('game-over-mvp').textContent = mvpName ? '⭐ MVP: ' + mvpName : '';
  screen.classList.add('show');
}

function hideGameOver() {
  document.getElementById('game-over-screen').classList.remove('show');
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

  // Subtle concrete-like floor texture
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const t = mapData[y][x], px = x * TILE_SIZE, py = y * TILE_SIZE;
      switch (t) {
        case TILE_WALL:
          // Wall with 3D depth effect - darker base, lighter top edge
          mc.fillStyle = '#3d3d52';
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          // Top highlight (light catching top edge)
          mc.fillStyle = '#555570';
          mc.fillRect(px, py, TILE_SIZE, 3);
          // Left highlight
          mc.fillStyle = '#4a4a64';
          mc.fillRect(px, py, 2, TILE_SIZE);
          // Bottom shadow
          mc.fillStyle = '#2a2a40';
          mc.fillRect(px, py + TILE_SIZE - 2, TILE_SIZE, 2);
          // Right shadow
          mc.fillStyle = '#333348';
          mc.fillRect(px + TILE_SIZE - 2, py, 2, TILE_SIZE);
          // Inner brick pattern
          mc.strokeStyle = 'rgba(0,0,0,0.12)';
          mc.lineWidth = 0.5;
          mc.strokeRect(px+1, py+1, TILE_SIZE-2, TILE_SIZE-2);
          if ((x+y)%2===0) mc.strokeRect(px+4, py+4, TILE_SIZE-8, TILE_SIZE/2-4);
          // Subtle noise texture on wall
          mc.fillStyle = `rgba(255,255,255,${Math.random()*0.02})`;
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          break;
        case TILE_CRATE:
          // Crate with wood texture
          mc.fillStyle = '#5c4a38';
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          // Wood grain
          mc.fillStyle = '#6b5743';
          mc.fillRect(px+2, py+2, TILE_SIZE-4, TILE_SIZE-4);
          // Cross planks
          mc.strokeStyle = '#4a3828';
          mc.lineWidth = 1.5;
          mc.strokeRect(px+3, py+3, TILE_SIZE-6, TILE_SIZE-6);
          mc.beginPath();
          mc.moveTo(px+3, py+3); mc.lineTo(px+TILE_SIZE-3, py+TILE_SIZE-3);
          mc.moveTo(px+TILE_SIZE-3, py+3); mc.lineTo(px+3, py+TILE_SIZE-3);
          mc.strokeStyle = 'rgba(0,0,0,0.2)'; mc.stroke();
          // Top edge highlight
          mc.fillStyle = 'rgba(255,255,255,0.08)';
          mc.fillRect(px+2, py+2, TILE_SIZE-4, 2);
          // Bottom shadow
          mc.fillStyle = 'rgba(0,0,0,0.15)';
          mc.fillRect(px+2, py+TILE_SIZE-4, TILE_SIZE-4, 2);
          break;
        case TILE_BS_A:
          // Bombsite A - visible colored zone with stronger tint
          mc.fillStyle = '#1e1a1a';
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          const aAlpha = 0.12 + Math.random()*0.04;
          mc.fillStyle = `rgba(255,80,60,${aAlpha})`;
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          // Subtle zone border marking
          mc.fillStyle = `rgba(255,80,60,0.12)`;
          mc.fillRect(px, py, 2, TILE_SIZE);
          mc.fillRect(px + TILE_SIZE - 2, py, 2, TILE_SIZE);
          break;
        case TILE_BS_B:
          // Bombsite B - visible colored zone with stronger tint
          mc.fillStyle = '#1a1a1e';
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          const bAlpha = 0.12 + Math.random()*0.04;
          mc.fillStyle = `rgba(60,80,255,${bAlpha})`;
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          mc.fillStyle = `rgba(60,80,255,0.12)`;
          mc.fillRect(px, py, 2, TILE_SIZE);
          mc.fillRect(px + TILE_SIZE - 2, py, 2, TILE_SIZE);
          break;
        case TILE_T_SPAWN:
          // T Spawn - warm highlight
          mc.fillStyle = '#221e18';
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          mc.fillStyle = 'rgba(212,165,55,0.07)';
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          break;
        case TILE_CT_SPAWN:
          // CT Spawn - cool highlight
          mc.fillStyle = '#181e24';
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          mc.fillStyle = 'rgba(74,144,217,0.07)';
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          break;
        case TILE_DOOR:
          mc.fillStyle = '#4a3a28';
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          mc.fillStyle = '#554530';
          mc.fillRect(px+2, py+2, TILE_SIZE-4, TILE_SIZE-4);
          // Door handle detail
          mc.fillStyle = '#888';
          mc.beginPath();
          mc.arc(px + TILE_SIZE - 8, py + TILE_SIZE/2, 2, 0, Math.PI * 2);
          mc.fill();
          break;
        default:
          // Floor tile with subtle concrete texture
          mc.fillStyle = '#1a1a28';
          mc.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          // Random subtle noise specks
          if (Math.random() < 0.2) {
            mc.fillStyle = `rgba(255,255,255,${Math.random()*0.015})`;
            mc.fillRect(px + Math.random()*20, py + Math.random()*20, Math.random()*8+2, Math.random()*8+2);
          }
          if (Math.random() < 0.1) {
            mc.fillStyle = `rgba(0,0,0,${Math.random()*0.03})`;
            mc.fillRect(px + Math.random()*20, py + Math.random()*20, Math.random()*6+1, Math.random()*6+1);
          }
          break;
      }
      // Subtle grid lines on non-solid tiles
      if (t !== TILE_WALL && t !== TILE_CRATE) {
        mc.strokeStyle = 'rgba(255,255,255,0.03)';
        mc.lineWidth = 0.5;
        mc.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  // Ambient occlusion: darken floor tiles adjacent to walls
  mc.save();
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      if (mapData[y][x] === TILE_WALL || mapData[y][x] === TILE_CRATE) continue;
      const px = x * TILE_SIZE, py = y * TILE_SIZE;
      // Check each neighbor for walls
      const wallTop = y > 0 && (mapData[y-1][x] === TILE_WALL || mapData[y-1][x] === TILE_CRATE);
      const wallBottom = y < mapHeight-1 && (mapData[y+1][x] === TILE_WALL || mapData[y+1][x] === TILE_CRATE);
      const wallLeft = x > 0 && (mapData[y][x-1] === TILE_WALL || mapData[y][x-1] === TILE_CRATE);
      const wallRight = x < mapWidth-1 && (mapData[y][x+1] === TILE_WALL || mapData[y][x+1] === TILE_CRATE);

      if (wallTop) {
        const g = mc.createLinearGradient(px, py, px, py + TILE_SIZE * 0.4);
        g.addColorStop(0, 'rgba(0,0,0,0.15)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        mc.fillStyle = g;
        mc.fillRect(px, py, TILE_SIZE, TILE_SIZE * 0.4);
      }
      if (wallBottom) {
        const g = mc.createLinearGradient(px, py + TILE_SIZE, px, py + TILE_SIZE * 0.6);
        g.addColorStop(0, 'rgba(0,0,0,0.12)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        mc.fillStyle = g;
        mc.fillRect(px, py + TILE_SIZE * 0.6, TILE_SIZE, TILE_SIZE * 0.4);
      }
      if (wallLeft) {
        const g = mc.createLinearGradient(px, py, px + TILE_SIZE * 0.4, py);
        g.addColorStop(0, 'rgba(0,0,0,0.12)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        mc.fillStyle = g;
        mc.fillRect(px, py, TILE_SIZE * 0.4, TILE_SIZE);
      }
      if (wallRight) {
        const g = mc.createLinearGradient(px + TILE_SIZE, py, px + TILE_SIZE * 0.6, py);
        g.addColorStop(0, 'rgba(0,0,0,0.12)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        mc.fillStyle = g;
        mc.fillRect(px + TILE_SIZE * 0.6, py, TILE_SIZE * 0.4, TILE_SIZE);
      }
      // Corner darkening
      if ((wallTop || wallLeft) && y > 0 && x > 0 && (mapData[y-1][x] === TILE_WALL || mapData[y][x-1] === TILE_WALL)) {
        mc.fillStyle = 'rgba(0,0,0,0.08)';
        mc.fillRect(px, py, TILE_SIZE * 0.3, TILE_SIZE * 0.3);
      }
    }
  }
  mc.restore();

  if (bombsites) {
    mc.font = 'bold 52px sans-serif'; mc.textAlign = 'center'; mc.textBaseline = 'middle';
    if (bombsites.A) {
      // Large semi-transparent floor zone for site A
      if (bombsites.A.tiles && bombsites.A.tiles.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const t of bombsites.A.tiles) {
          if (t.x < minX) minX = t.x; if (t.y < minY) minY = t.y;
          if (t.x > maxX) maxX = t.x; if (t.y > maxY) maxY = t.y;
        }
        mc.fillStyle = 'rgba(255,60,40,0.08)';
        mc.fillRect(minX * TILE_SIZE, minY * TILE_SIZE, (maxX - minX + 1) * TILE_SIZE, (maxY - minY + 1) * TILE_SIZE);
        // Inner glow
        const aGrad = mc.createRadialGradient(
          bombsites.A.centerX, bombsites.A.centerY, 0,
          bombsites.A.centerX, bombsites.A.centerY, 200
        );
        aGrad.addColorStop(0, 'rgba(255,60,40,0.1)');
        aGrad.addColorStop(1, 'rgba(255,60,40,0)');
        mc.fillStyle = aGrad;
        mc.fillRect(minX * TILE_SIZE, minY * TILE_SIZE, (maxX - minX + 1) * TILE_SIZE, (maxY - minY + 1) * TILE_SIZE);
      }
      mc.fillStyle = 'rgba(255,80,60,0.2)';
      mc.fillText('A', bombsites.A.centerX, bombsites.A.centerY);
      drawBombsiteOutline(mc, bombsites.A, 'rgba(255,80,60,0.3)');
    }
    if (bombsites.B) {
      // Large semi-transparent floor zone for site B
      if (bombsites.B.tiles && bombsites.B.tiles.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const t of bombsites.B.tiles) {
          if (t.x < minX) minX = t.x; if (t.y < minY) minY = t.y;
          if (t.x > maxX) maxX = t.x; if (t.y > maxY) maxY = t.y;
        }
        mc.fillStyle = 'rgba(40,60,255,0.08)';
        mc.fillRect(minX * TILE_SIZE, minY * TILE_SIZE, (maxX - minX + 1) * TILE_SIZE, (maxY - minY + 1) * TILE_SIZE);
        // Inner glow
        const bGrad = mc.createRadialGradient(
          bombsites.B.centerX, bombsites.B.centerY, 0,
          bombsites.B.centerX, bombsites.B.centerY, 200
        );
        bGrad.addColorStop(0, 'rgba(40,60,255,0.1)');
        bGrad.addColorStop(1, 'rgba(40,60,255,0)');
        mc.fillStyle = bGrad;
        mc.fillRect(minX * TILE_SIZE, minY * TILE_SIZE, (maxX - minX + 1) * TILE_SIZE, (maxY - minY + 1) * TILE_SIZE);
      }
      mc.fillStyle = 'rgba(60,80,255,0.2)';
      mc.fillText('B', bombsites.B.centerX, bombsites.B.centerY);
      drawBombsiteOutline(mc, bombsites.B, 'rgba(60,80,255,0.3)');
    }
  }

  // Spawn area labels
  mc.font = 'bold 28px sans-serif'; mc.textAlign = 'center'; mc.textBaseline = 'middle';
  let tSX = 0, tSY = 0, tC = 0, ctSX = 0, ctSY = 0, ctC = 0;
  for (let sy = 0; sy < mapHeight; sy++) {
    for (let sx = 0; sx < mapWidth; sx++) {
      const cx = (sx + 0.5) * TILE_SIZE, cy = (sy + 0.5) * TILE_SIZE;
      if (mapData[sy][sx] === TILE_T_SPAWN) { tSX += cx; tSY += cy; tC++; }
      if (mapData[sy][sx] === TILE_CT_SPAWN) { ctSX += cx; ctSY += cy; ctC++; }
    }
  }
  if (tC > 0) {
    mc.fillStyle = 'rgba(212,165,55,0.12)';
    mc.fillText('T SPAWN', tSX / tC, tSY / tC);
  }
  if (ctC > 0) {
    mc.fillStyle = 'rgba(74,144,217,0.12)';
    mc.fillText('CT SPAWN', ctSX / ctC, ctSY / ctC);
  }

  // Initialize free cam pos
  freeCamPos.x = mapWidthPx / 2;
  freeCamPos.y = mapHeightPx / 2;

  // Pre-render vignette
  vignetteCanvas = document.createElement('canvas');
  vignetteCanvas.width = 1920;
  vignetteCanvas.height = 1080;
  const vc = vignetteCanvas.getContext('2d');
  const vg = vc.createRadialGradient(960, 540, 300, 960, 540, 960);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.5, 'rgba(0,0,0,0)');
  vg.addColorStop(0.75, 'rgba(0,0,0,0.15)');
  vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  vc.fillStyle = vg;
  vc.fillRect(0, 0, 1920, 1080);
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
function showCenterMsg(text, color, subText, dur) {
  centerMessages.push({ text, color, subText: subText || '', timer: dur || 3, max: dur || 3, scale: 0 });
}

function showHitMarker(kill) {
  const el = document.getElementById('hit-marker');
  el.className = kill ? 'show hm-kill' : 'show';
  setTimeout(() => { el.className = ''; }, 150);
}

function addKillFeedEntry(d) {
  const feed = document.getElementById('kill-feed');
  // Max 5 entries
  while (feed.children.length >= 5) { feed.removeChild(feed.firstChild); }
  const e = document.createElement('div');
  e.className = 'kill-entry' + (d.headshot ? ' headshot' : '');
  const tc = team => team === 'T' ? '#d4a537' : '#4a90d9';
  const hs = d.headshot ? ' <span class="hs-icon">🎯 HS</span>' : '';
  const weaponIcon = WEAPON_ICONS[d.weapon] || '🔫';
  const weaponName = d.weapon || 'Unknown';
  e.innerHTML =
    `<span class="killer-name" style="color:${tc(players[d.killer]?.team)}">${d.killerName}</span>` +
    `<span class="kill-weapon">${weaponIcon} ${weaponName}</span>` +
    `<span class="victim-name" style="color:${tc(players[d.victim]?.team)}">${d.victimName}</span>` + hs;
  feed.appendChild(e);
  // Fade out after 5 seconds, remove after 5.5s
  setTimeout(() => { e.style.opacity = '0'; e.style.transform = 'translateX(20px)'; }, 5000);
  setTimeout(() => { if (e.parentNode) e.remove(); }, 5500);
}

function addChatMessage(d) {
  const box = document.getElementById('chat-box');
  // Limit visible messages
  while (box.children.length >= 8) { box.removeChild(box.firstChild); }
  const msg = document.createElement('div');
  msg.className = 'chat-msg' + (d.teamOnly ? ' team-chat' : '');
  const teamPrefix = d.teamOnly ? '<span class="chat-prefix">[TEAM]</span>' : '';
  const nameClass = d.team || 'SPEC';
  msg.innerHTML = teamPrefix + '<span class="chat-name ' + nameClass + '">' + escapeHtml(d.name) + ':</span> ' + escapeHtml(d.message);
  box.insertBefore(msg, box.firstChild);
  // Remove after 7 seconds
  setTimeout(() => { if (msg.parentNode) msg.remove(); }, 7000);
}

function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

// ==================== DEFUSE PROGRESS ====================
let defuseInterval = null;
function showDefuseProgress(d) {
  const el = document.getElementById('action-progress');
  const label = document.getElementById('action-progress-label');
  const fill = document.getElementById('action-progress-fill');
  if (!el) return;
  label.textContent = 'DEFUSING';
  fill.className = 'action-progress-fill defusing';
  fill.style.width = (d.progress * 100) + '%';
  el.classList.add('show');
  if (defuseInterval) clearInterval(defuseInterval);
  defuseInterval = setInterval(() => {
    // Progress updates come from server, this just keeps the bar visible
  }, 200);
}
function hideDefuseProgress() {
  const el = document.getElementById('action-progress');
  if (el) el.classList.remove('show');
  if (defuseInterval) { clearInterval(defuseInterval); defuseInterval = null; }
}

// ==================== SOUND INDICATORS ====================
const soundIndicators = [];
function playSound(d) {
  if (!myPlayer) return;
  const dx = d.x - myPlayer.x;
  const dy = d.y - myPlayer.y;
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
  soundIndicators.push({
    x: d.x, y: d.y, type: d.type,
    alpha: 1.0, life: 1.5, maxLife: 1.5,
    range: d.range || 800
  });
  if (soundIndicators.length > 30) soundIndicators.shift();

  // Visual feedback for certain sounds
  if (d.type === 'gunshot') spawnSoundRing(d.x, d.y, '#ff6600');
  else if (d.type === 'footstep') spawnSoundRing(d.x, d.y, '#ffffff', 0.3);
  else if (d.type === 'knife_swing') spawnSoundRing(d.x, d.y, '#cccccc', 0.3);
  else if (d.type === 'grenade_explode') spawnSoundRing(d.x, d.y, '#ff4400');
  else if (d.type === 'bomb_beep') spawnSoundRing(d.x, d.y, '#ff0000');
  else if (d.type === 'player_death') spawnSoundRing(d.x, d.y, '#ff0000');
  else if (d.type === 'headshot') spawnSoundRing(d.x, d.y, '#ff0000');
}

function spawnSoundRing(x, y, color, maxRadius) {
  maxRadius = maxRadius || 20;
  effects.push({ type: 'sound-ring', x, y, color, radius: 0, maxRadius, alpha: 0.6, life: 0.4, maxLife: 0.4 });
}

function updateScoreboard(list) {
  const c = document.getElementById('sb-content'); if (!c) return;
  document.getElementById('sb-t-score').textContent = tScore;
  document.getElementById('sb-ct-score').textContent = ctScore;

  // Score dots in scoreboard
  let dotsT = '', dotsCT = '';
  for (let i = 0; i < Math.max(tScore, ctScore, 5); i++) {
    dotsT += i < tScore ? '<div class="round-dot t"></div>' : '<div class="round-dot empty"></div>';
    dotsCT += i < ctScore ? '<div class="round-dot ct"></div>' : '<div class="round-dot empty"></div>';
  }
  document.getElementById('sb-t-dots').innerHTML = dotsT;
  document.getElementById('sb-ct-dots').innerHTML = dotsCT;

  let tP = [], ctP = [];
  for (const p of Object.values(list)) {
    if (p.team === 'T') tP.push(p); else if (p.team === 'CT') ctP.push(p);
  }
  // Sort by kills descending
  tP.sort((a, b) => (b.kills || 0) - (a.kills || 0));
  ctP.sort((a, b) => (b.kills || 0) - (a.kills || 0));

  let h = '<div style="display:flex;gap:24px;">';
  const makeTable = (arr, teamColor) => {
    let t = '<table class="sb-table"><tr><th></th><th>Player</th><th>K</th><th>A</th><th>D</th><th>$</th><th>Ping</th></tr>';
    for (const p of arr) {
      const isMe = p.id === myId;
      const isMvp = roundMvp && roundMvp.id === p.id;
      const ping = p.ping || 0;
      const pingClass = ping < 50 ? 'good' : ping < 100 ? 'mid' : 'bad';
      t += `<tr class="${p.alive?'':'dead'} ${isMe?'me':''}">`;
      t += `<td>${isMvp ? '<span class="mvp-star">⭐</span>' : ''}</td>`;
      t += `<td>${escapeHtml(p.name)}${p.isBot ? ' <span style="color:#555;font-size:10px;">BOT</span>' : ''}</td>`;
      t += `<td style="color:${teamColor};font-weight:700;">${p.kills||0}</td>`;
      t += `<td>${p.assists||0}</td>`;
      t += `<td>${p.deaths||0}</td>`;
      t += `<td style="color:#4caf50;">$${p.money}</td>`;
      t += `<td><span class="sb-ping ${pingClass}">${ping}ms</span></td>`;
      t += '</tr>';
    }
    return t + '</table>';
  };
  h += '<div style="flex:1">' + makeTable(tP, '#d4a537') + '</div>';
  h += '<div style="flex:1">' + makeTable(ctP, '#4a90d9') + '</div></div>';
  c.innerHTML = h;
}

// ==================== WEAPON SHAPE DRAWING ====================
function drawWeaponShape(ctx, weaponKey, isMe, angle) {
  const wInfo = WEAPONS[weaponKey];
  if (!wInfo) return;
  const type = wInfo.type;
  const scale = isMe ? 1.1 : 0.9;

  ctx.save();
  ctx.rotate(angle);

  if (type === 'knife') {
    // Knife blade
    ctx.fillStyle = '#ccc';
    ctx.beginPath();
    ctx.moveTo(PLAYER_RADIUS - 2, -2 * scale);
    ctx.lineTo(PLAYER_RADIUS + 14 * scale, 0);
    ctx.lineTo(PLAYER_RADIUS - 2, 2 * scale);
    ctx.closePath();
    ctx.fill();
    // Handle
    ctx.fillStyle = '#5a3a20';
    ctx.fillRect(PLAYER_RADIUS - 8, -2.5 * scale, 8, 5 * scale);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(PLAYER_RADIUS - 8, -2.5 * scale, 8, 5 * scale);
  } else if (type === 'pistol') {
    // Pistol: short barrel + grip
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(PLAYER_RADIUS - 2, -2 * scale, 14 * scale, 4 * scale);
    // Barrel highlight
    ctx.fillStyle = '#444';
    ctx.fillRect(PLAYER_RADIUS - 2, -2 * scale, 14 * scale, 1);
    // Grip
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(PLAYER_RADIUS - 8, 1 * scale, 8, 5 * scale);
    // Slide
    ctx.fillStyle = '#333';
    ctx.fillRect(PLAYER_RADIUS - 4, -2.5 * scale, 12 * scale, 1);
  } else if (type === 'smg') {
    // SMG: medium barrel, stock
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(PLAYER_RADIUS - 2, -2.5 * scale, 18 * scale, 5 * scale);
    ctx.fillStyle = '#444';
    ctx.fillRect(PLAYER_RADIUS - 2, -2.5 * scale, 18 * scale, 1.5);
    // Magazine
    ctx.fillStyle = '#333';
    ctx.fillRect(PLAYER_RADIUS + 4, 2.5 * scale, 4, 5 * scale);
    // Stock
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(PLAYER_RADIUS - 12, -2 * scale, 10, 4 * scale);
  } else if (type === 'rifle') {
    // Rifle: long barrel, stock, magazine
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(PLAYER_RADIUS - 2, -2.5 * scale, 24 * scale, 5 * scale);
    // Barrel
    ctx.fillStyle = '#444';
    ctx.fillRect(PLAYER_RADIUS - 2, -2.5 * scale, 24 * scale, 1.5);
    // Magazine
    ctx.fillStyle = '#333';
    ctx.fillRect(PLAYER_RADIUS + 6, 2.5 * scale, 5, 6 * scale);
    // Stock
    ctx.fillStyle = '#5a3a20';
    ctx.fillRect(PLAYER_RADIUS - 14, -2 * scale, 12, 5 * scale);
    // Grip
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(PLAYER_RADIUS + 2, 2.5 * scale, 3, 4 * scale);
  } else if (type === 'sniper') {
    // Sniper: very long barrel, scope
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(PLAYER_RADIUS - 2, -2 * scale, 28 * scale, 4 * scale);
    ctx.fillStyle = '#444';
    ctx.fillRect(PLAYER_RADIUS - 2, -2 * scale, 28 * scale, 1);
    // Scope
    ctx.fillStyle = '#555';
    ctx.beginPath();
    ctx.arc(PLAYER_RADIUS + 8, -4 * scale, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#224';
    ctx.beginPath();
    ctx.arc(PLAYER_RADIUS + 8, -4 * scale, 2, 0, Math.PI * 2);
    ctx.fill();
    // Stock
    ctx.fillStyle = '#5a3a20';
    ctx.fillRect(PLAYER_RADIUS - 14, -1.5 * scale, 12, 4 * scale);
    // Bolt
    ctx.fillStyle = '#666';
    ctx.fillRect(PLAYER_RADIUS + 14, 1 * scale, 3, 2);
  } else if (type === 'shotgun') {
    // Shotgun: wide short barrel
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(PLAYER_RADIUS - 2, -3 * scale, 16 * scale, 6 * scale);
    ctx.fillStyle = '#444';
    ctx.fillRect(PLAYER_RADIUS - 2, -3 * scale, 16 * scale, 2);
    // Barrel end (wider)
    ctx.fillStyle = '#333';
    ctx.fillRect(PLAYER_RADIUS + 12, -3.5 * scale, 3, 7 * scale);
    // Pump
    ctx.fillStyle = '#5a3a20';
    ctx.fillRect(PLAYER_RADIUS + 4, 3 * scale, 6, 3 * scale);
    // Stock
    ctx.fillStyle = '#5a3a20';
    ctx.fillRect(PLAYER_RADIUS - 12, -2 * scale, 10, 5 * scale);
  }

  ctx.restore();
}

// ==================== roundRect POLYFILL ====================
function drawRoundRect(ctx, x, y, w, h, r) {
  if (w <= 0 || h <= 0) return;
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ==================== INTERPOLATION HELPERS ====================
function lerp(a, b, t) { return a + (b - a) * t; }

function getInterpolatedState() {
  if (stateBuffer.length < 2) return stateBuffer[stateBuffer.length - 1] || null;

  const now = performance.now();
  const renderTime = now - interpDelay;

  // Find the two states to interpolate between
  let older = null, newer = null;
  for (let i = 0; i < stateBuffer.length - 1; i++) {
    if (stateBuffer[i]._recvTime <= renderTime && stateBuffer[i + 1]._recvTime >= renderTime) {
      older = stateBuffer[i];
      newer = stateBuffer[i + 1];
      break;
    }
  }

  if (!older || !newer) {
    // Not enough buffered states yet or we fell behind — use latest
    return stateBuffer[stateBuffer.length - 1];
  }

  const t = (renderTime - older._recvTime) / (newer._recvTime - older._recvTime);
  const alpha = Math.max(0, Math.min(1, t));

  // Interpolate player positions
  const interpPlayers = {};
  for (const id of Object.keys(newer.players)) {
    const np = newer.players[id];
    const op = older.players[id];
    if (op) {
      interpPlayers[id] = {
        ...np,
        x: lerp(op.x, np.x, alpha),
        y: lerp(op.y, np.y, alpha),
        angle: lerp(op.angle, np.angle, alpha),
      };
    } else {
      interpPlayers[id] = np; // New player, no previous state
    }
  }
  return { ...newer, players: interpPlayers };
}

// ==================== MAIN RENDER LOOP ====================
let lastTime = 0;
let muzzleFlashTimers = {};
let prevPositions = {}; // For detecting movement

function render(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  // Apply interpolated state for rendering
  const interpState = getInterpolatedState();
  if (interpState) {
    const myServerState = players[myId]; // save my own server position
    players = interpState.players;
    // Keep my own position from latest server state (no self-interpolation delay)
    if (myServerState) {
      players[myId] = myServerState;
      myPlayer = myServerState;
    }
  }

  // Update effects
  flashTimer = Math.max(0, flashTimer - dt);
  centerMessages = centerMessages.filter(m => {
    m.timer -= dt;
    // Animate scale in
    if (m.scale < 1) m.scale = Math.min(1, m.scale + dt * 5);
    return m.timer > 0;
  });
  particles = particles.filter(p => p.update(dt));
  // Cap particles to prevent memory buildup
  if (particles.length > 500) particles.splice(0, particles.length - 500);

  // Update damage numbers
  damageNumbers = damageNumbers.filter(d => {
    d.timer -= dt;
    d.y += d.vy * dt;
    d.vy *= 0.95;
    return d.timer > 0;
  });

  // Update death animations
  deathAnimations = deathAnimations.filter(d => {
    d.timer -= dt;
    return d.timer > 0;
  });

  // Update shell casings
  shellCasings = shellCasings.filter(s => {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += 200 * dt; // gravity
    s.vx *= 0.95;
    s.rotation += s.rotSpeed * dt;
    s.rotSpeed *= 0.95;
    s.life -= dt;
    return s.life > 0;
  });

  // Update ambient particles
  ambientParticles = ambientParticles.filter(a => {
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.life -= dt;
    return a.life > 0;
  });

  // Camera shake decay
  camera.shakeX *= 0.9; camera.shakeY *= 0.9;
  if (Math.abs(camera.shakeX) < 0.5) camera.shakeX = 0;
  if (Math.abs(camera.shakeY) < 0.5) camera.shakeY = 0;

  // Camera target
  const p = players[myId];
  let camTargetX, camTargetY;

  if (spectating) {
    const specTarget = getSpectateCameraTarget();
    if (specTarget) {
      camTargetX = specTarget.x - canvas.width / 2;
      camTargetY = specTarget.y - canvas.height / 2;
      if (specTarget.free) {
        freeCamPos.x = specTarget.x;
        freeCamPos.y = specTarget.y;
      }
      // Update spectator info
      if (specTarget.player) {
        document.getElementById('spec-name').textContent = specTarget.player.name;
        document.getElementById('spec-name').style.color = specTarget.player.team === 'T' ? '#d4a537' : '#4a90d9';
        document.getElementById('spec-hp').textContent = 'HP: ' + Math.ceil(specTarget.player.hp) + ' | Armor: ' + specTarget.player.armor;
      } else {
        document.getElementById('spec-name').textContent = 'Free Camera';
        document.getElementById('spec-name').style.color = '#888';
        document.getElementById('spec-hp').textContent = '';
      }
    }
  } else if (p && p.alive && (p.x !== 0 || p.y !== 0)) {
    camTargetX = p.x - canvas.width / 2;
    camTargetY = p.y - canvas.height / 2;

    // Weapon sway based on movement
    const isMoving = keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'];
    if (isMoving) {
      weaponSway.targetX = (Math.random() - 0.5) * 3;
      weaponSway.targetY = (Math.random() - 0.5) * 3;
    } else {
      weaponSway.targetX = 0;
      weaponSway.targetY = 0;
    }
    weaponSway.x += (weaponSway.targetX - weaponSway.x) * dt * 8;
    weaponSway.y += (weaponSway.targetY - weaponSway.y) * dt * 8;
  } else if (mapOffscreen) {
    camTargetX = mapWidthPx / 2 - canvas.width / 2;
    camTargetY = mapHeightPx / 2 - canvas.height / 2;
  }

  // Smooth ADS zoom
  adsZoom += (adsTargetZoom - adsZoom) * 0.12;

  if (camTargetX !== undefined) {
    camera.x += (camTargetX - camera.x) * 0.15;
    camera.y += (camTargetY - camera.y) * 0.15;
  }

  // Clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  // Apply ADS zoom - scale from center of screen
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(adsZoom, adsZoom);
  ctx.translate(-canvas.width / 2, -canvas.height / 2);
  ctx.translate(-camera.x + camera.shakeX, -camera.y + camera.shakeY);

  // Map
  if (mapOffscreen) ctx.drawImage(mapOffscreen, 0, 0);

  // ---- FOG OF WAR OVERLAY ----
  const viewPlayer = spectating
    ? (spectateTarget ? players[spectateTarget] : null)
    : p;
  if (viewPlayer && viewPlayer.alive && viewPlayer.team !== 'SPEC' && mapOffscreen) {
    if (!fogCanvas) {
      fogCanvas = document.createElement('canvas');
      fogCtx = fogCanvas.getContext('2d');
    }
    fogCanvas.width = canvas.width;
    fogCanvas.height = canvas.height;

    fogCtx.fillStyle = 'rgba(0, 0, 10, 0.82)';
    fogCtx.fillRect(0, 0, canvas.width, canvas.height);

    fogCtx.globalCompositeOperation = 'destination-out';
    const cx = viewPlayer.x - camera.x + camera.shakeX;
    const cy = viewPlayer.y - camera.y + camera.shakeY;
    // Scale fog radius to always cover the full viewport when zoomed out
    const maxHalfView = Math.sqrt(canvas.width * canvas.width + canvas.height * canvas.height) / 2 / adsZoom;
    const effectiveFogRadius = Math.max(FOG_VISIBILITY_RADIUS, maxHalfView + 50);
    const fogGrad = fogCtx.createRadialGradient(cx, cy, FOG_VISIBILITY_RADIUS * 0.25, cx, cy, effectiveFogRadius);
    fogGrad.addColorStop(0, 'rgba(0, 0, 0, 1)');
    fogGrad.addColorStop(Math.min(0.99, FOG_VISIBILITY_RADIUS / effectiveFogRadius * 0.6), 'rgba(0, 0, 0, 0.95)');
    fogGrad.addColorStop(Math.min(0.999, FOG_VISIBILITY_RADIUS / effectiveFogRadius), 'rgba(0, 0, 0, 0)');
    fogGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    fogCtx.fillStyle = fogGrad;
    fogCtx.beginPath();
    fogCtx.arc(cx, cy, effectiveFogRadius, 0, Math.PI * 2);
    fogCtx.fill();
    fogCtx.globalCompositeOperation = 'source-over';

    ctx.drawImage(fogCanvas, camera.x - camera.shakeX, camera.y - camera.shakeY);
  }

  // Shadow layer
  drawShadows();

  // Smoke grenades with animated edges
  for (const g of serverGrenades) {
    if (g.type === 'smoke') {
      const time = Date.now() / 1000;
      // Base smoke
      const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.radius);
      grad.addColorStop(0, 'rgba(70,70,70,0.85)');
      grad.addColorStop(0.6, 'rgba(60,60,60,0.7)');
      grad.addColorStop(0.85, 'rgba(55,55,55,0.3)');
      grad.addColorStop(1, 'rgba(50,50,50,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2); ctx.fill();

      // Animated wavy edge
      ctx.save();
      ctx.globalAlpha = 0.4;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + time * 0.3;
        const wobble = Math.sin(time * 2 + i * 1.5) * 8;
        const r = g.radius * 0.9 + wobble;
        const px = g.x + Math.cos(a) * r;
        const py = g.y + Math.sin(a) * r;
        ctx.beginPath();
        ctx.arc(px, py, 6 + Math.sin(time + i) * 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(80,80,80,0.3)';
        ctx.fill();
      }
      ctx.restore();

      // Smoke edge particles
      if (Math.random() < 0.2) {
        const a = Math.random() * Math.PI * 2;
        particles.push(new Particle(
          g.x + Math.cos(a)*g.radius*0.8, g.y + Math.sin(a)*g.radius*0.8,
          Math.cos(a)*15, Math.sin(a)*15 - 5,
          1.2, 4+Math.random()*4, 'rgba(80,80,80,0.25)', 0, 0.99, false, 0
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
    particles.push(new Particle(g.x, g.y, (Math.random()-0.5)*10, (Math.random()-0.5)*10,
      0.2, 2, 'rgba(200,200,200,0.3)', 0, 0.9, true, 0));
  }

  // Dropped weapons on the ground
  for (const dw of droppedWeapons) {
    const wInfo = WEAPONS[dw.weaponKey];
    if (!wInfo) continue;
    const time = Date.now() / 1000;
    // Floating glow
    const pulse = Math.sin(time * 2 + dw.id) * 0.3 + 0.7;
    ctx.save();
    ctx.globalAlpha = 0.5 * pulse;
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(dw.x, dw.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,215,0,0.15)';
    ctx.fill();
    ctx.restore();
    // Weapon icon dot
    ctx.save();
    ctx.fillStyle = wInfo.type === 'rifle' ? '#ff8844' : wInfo.type === 'smg' ? '#44aaff' : wInfo.type === 'sniper' ? '#aa44ff' : wInfo.type === 'shotgun' ? '#ff4444' : '#88cc44';
    ctx.beginPath(); ctx.arc(dw.x, dw.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    // Weapon name label
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(wInfo.name, dw.x, dw.y - 12);
    ctx.restore();
    // Pickup hint for nearby player
    if (p && p.alive) {
      const pdx = p.x - dw.x, pdy = p.y - dw.y;
      const pdist = Math.sqrt(pdx * pdx + pdy * pdy);
      if (pdist < 50) {
        ctx.save();
        ctx.globalAlpha = 0.8 * pulse;
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd700';
        ctx.fillText('[E] Pick up ' + wInfo.name, dw.x, dw.y - 22);
        ctx.restore();
      }
    }
  }

  // Bomb
  if (bomb && bomb.planted) {
    const pulse = Math.sin(Date.now() / 150) * 0.4 + 0.6;
    const urgentPulse = bomb.timer < 10 ? Math.sin(Date.now() / 60) * 0.3 + 0.7 : pulse;
    ctx.save();
    ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 30 * urgentPulse;
    ctx.beginPath(); ctx.arc(bomb.x, bomb.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,50,30,${urgentPulse * 0.8})`; ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#111'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('💣', bomb.x, bomb.y + 5);
    ctx.font = 'bold 16px monospace'; ctx.fillStyle = bomb.timer < 10 ? '#ff0000' : '#ff4444';
    ctx.fillText(Math.ceil(bomb.timer) + 's', bomb.x, bomb.y - 22);
    if (bomb.timer < 10) {
      const ring = (10 - bomb.timer) % 2;
      ctx.beginPath(); ctx.arc(bomb.x, bomb.y, 20 + ring * 30, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,0,0,${0.3 * (1 - ring/2)})`; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  // Death animations (blood pools and fading bodies)
  for (const da of deathAnimations) {
    const alpha = Math.max(0, da.timer / da.maxTimer);
    ctx.save();
    ctx.globalAlpha = alpha * 0.6;
    // Blood pool
    ctx.beginPath();
    ctx.ellipse(da.x, da.y, PLAYER_RADIUS * (1.5 - alpha * 0.5), PLAYER_RADIUS * (1.2 - alpha * 0.3), 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(100, 10, 10, 0.5)';
    ctx.fill();
    // Fading body outline
    ctx.globalAlpha = alpha * 0.3;
    ctx.beginPath();
    ctx.arc(da.x, da.y, PLAYER_RADIUS * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = da.team === 'T' ? '#c9952d' : '#3a7bc8';
    ctx.fill();
    // Red X dead marker
    ctx.globalAlpha = alpha * 0.8;
    ctx.strokeStyle = '#ff2222';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    const xSize = 6;
    ctx.beginPath();
    ctx.moveTo(da.x - xSize, da.y - xSize);
    ctx.lineTo(da.x + xSize, da.y + xSize);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(da.x + xSize, da.y - xSize);
    ctx.lineTo(da.x - xSize, da.y + xSize);
    ctx.stroke();
    // Dead player name
    ctx.globalAlpha = alpha * 0.5;
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff6666';
    ctx.fillText(da.name, da.x, da.y - 18);
    ctx.restore();
  }

  // Shell casings
  for (const s of shellCasings) {
    const alpha = Math.min(1, s.life / (s.maxLife * 0.3));
    ctx.save();
    ctx.globalAlpha = alpha * 0.7;
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rotation);
    ctx.fillStyle = '#b8a040';
    ctx.fillRect(-s.size * 0.5, -s.size * 0.3, s.size * 1.5, s.size * 0.6);
    ctx.fillStyle = '#d4b850';
    ctx.fillRect(-s.size * 0.5, -s.size * 0.3, s.size * 1.5, s.size * 0.2);
    ctx.restore();
  }

  // Bullets with improved trails
  for (const b of bullets) {
    if (!muzzleFlashTimers[b.owner]) {
      const shooter = players[b.owner];
      if (shooter) {
        spawnMuzzleFlash(shooter.x, shooter.y, shooter.angle);
        // Shell casing from shooter
        spawnShellCasing(shooter.x, shooter.y, shooter.angle);
      }
      muzzleFlashTimers[b.owner] = 0.05;
    }
    const spd = Math.sqrt(b.vx*b.vx + b.vy*b.vy);
    if (spd > 0) {
      const trailLen = 18;
      const tx = b.x - (b.vx/spd)*trailLen, ty = b.y - (b.vy/spd)*trailLen;
      // Outer glow trail
      ctx.save();
      ctx.shadowColor = '#ffaa00';
      ctx.shadowBlur = 4;
      const grad = ctx.createLinearGradient(tx, ty, b.x, b.y);
      grad.addColorStop(0, 'rgba(255,200,50,0)');
      grad.addColorStop(0.5, 'rgba(255,180,40,0.4)');
      grad.addColorStop(1, 'rgba(255,220,80,0.9)');
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = grad; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.restore();
    }
    // Bullet head
    ctx.save();
    ctx.shadowColor = '#ffaa00'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2);
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
    const isAlly = pl.team === viewPlayer?.team;
    if (pl.noiseVisible && !isMe && !isAlly) continue;
    drawPlayer(pl, isMe, isAlly, dt);

    // Footstep particles
    if (isMe || isAlly) {
      if (!footstepTimers[id]) footstepTimers[id] = 0;
      // Detect movement by checking position change
      const prev = prevPositions[id];
      if (prev) {
        const dx = pl.x - prev.x, dy = pl.y - prev.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 2) {
          footstepTimers[id] -= dt;
          if (footstepTimers[id] <= 0) {
            spawnFootstepParticles(pl.x, pl.y);
            footstepTimers[id] = 0.25;
          }
        }
      }
      prevPositions[id] = { x: pl.x, y: pl.y };
    }
  }

  // Particles (game particles)
  for (const part of particles) part.draw(ctx);

  // Effects (sound rings, etc.)
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life -= dt;
    if (e.life <= 0) { effects.splice(i, 1); continue; }
    const t = 1 - e.life / e.maxLife;
    if (e.type === 'sound-ring') {
      e.radius = t * e.maxRadius;
      e.alpha = (1 - t) * 0.6;
      ctx.save();
      ctx.globalAlpha = e.alpha;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Ambient dust motes
  spawnAmbientDust(camera.x, camera.y);
  for (const a of ambientParticles) {
    const alpha = (a.life / a.maxLife) * 0.15;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#aaa';
    ctx.beginPath();
    ctx.arc(a.x, a.y, a.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();

  // Sniper scope overlay when ADS
  if (adsActive && adsZoom < 0.8) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Clear circle in center
    ctx.globalCompositeOperation = 'destination-out';
    const scopeRadius = Math.min(canvas.width, canvas.height) * 0.35;
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, scopeRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // Scope crosshair lines
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.lineWidth = 1.5;
    // Horizontal
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width / 2 - scopeRadius, canvas.height / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2 + scopeRadius, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
    // Vertical
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height / 2 - scopeRadius);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, canvas.height / 2 + scopeRadius);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();
    // Scope circle border
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, scopeRadius, 0, Math.PI * 2);
    ctx.stroke();
    // Small red dot in center
    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 2, 0, Math.PI * 2);
    ctx.fill();
    // Hide normal crosshair when scoped
    document.getElementById('crosshair').style.display = 'none';
    ctx.restore();
  } else if (!spectating) {
    document.getElementById('crosshair').style.display = '';
  }

  // Draw vignette
  drawVignette();

  // Damage direction indicators (red arcs on screen edges)
  drawDamageIndicators();

  // Death screen overlay
  updateDeathScreen(dt);
  drawDeathScreen();

  // Bomb status HUD
  drawBombHud();

  // Damage numbers (screen space)
  for (const d of damageNumbers) {
    const screenX = (d.x - camera.x + camera.shakeX) * adsZoom + canvas.width / 2 * (1 - adsZoom);
    const screenY = (d.y - camera.y + camera.shakeY) * adsZoom + canvas.height / 2 * (1 - adsZoom);
    const alpha = Math.min(1, d.timer / 0.5);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = (d.isHeadshot ? 'bold 16px' : 'bold 14px') + ' sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000';
    ctx.fillText((d.isHeadshot ? 'HS ' : '') + d.amount, screenX + 1, screenY + 1);
    ctx.fillStyle = d.color;
    ctx.fillText((d.isHeadshot ? 'HS ' : '') + d.amount, screenX, screenY);
    ctx.restore();
  }

  // Center messages (animated)
  for (let i = 0; i < centerMessages.length; i++) {
    const msg = centerMessages[i];
    const alpha = Math.min(1, msg.timer / (msg.max * 0.3));
    const scale = msg.scale * (msg.timer < 0.5 ? (0.5 + msg.timer) : 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(canvas.width / 2, canvas.height * 0.32 + i * 50);
    ctx.scale(scale, scale);
    ctx.font = 'bold 42px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // Text shadow
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillText(msg.text, 2, 2);
    ctx.fillStyle = msg.color;
    ctx.fillText(msg.text, 0, 0);
    // Sub text
    if (msg.subText) {
      ctx.font = '16px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(msg.subText, 0, 30);
    }
    ctx.restore();
  }

  // Reload bar (center of screen, CS:GO style)
  if (p && p.reloading) {
    const bw = 160, bh = 6;
    const bx = canvas.width/2 - bw/2, by = canvas.height/2 + 40;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    drawRoundRect(ctx, bx - 1, by - 1, bw + 2, bh + 2, 3);
    ctx.fill();
    const wk = p.currentWeapon >= 0 && p.weapons ? p.weapons[p.currentWeapon] : null;
    const reloadTimes = {pistol:2.2,glock:2.2,usp:2.2,deagle:2.2,mp9:3.1,mac10:3.1,p90:3.3,ak47:2.5,m4a4:3.1,galil:2.5,famas:3.1,awp:3.7,ssg08:3.7,nova:4.0};
    const maxReload = wk ? (reloadTimes[wk] || 2.5) : 2.5;
    const progress = 1 - Math.max(0, p.reloadTimer || 0) / maxReload;
    ctx.fillStyle = '#ff6b35';
    ctx.beginPath();
    drawRoundRect(ctx, bx, by, bw * progress, bh, 2);
    ctx.fill();
    ctx.font = '11px sans-serif'; ctx.fillStyle = '#aaa'; ctx.textAlign = 'center';
    ctx.fillText('RELOADING', canvas.width/2, by + 20);
  }

  // Update sound indicators lifecycle (moved here so dt is in scope)
  for (let i = soundIndicators.length - 1; i >= 0; i--) {
    const s = soundIndicators[i];
    s.life -= dt;
    if (s.life <= 0) { soundIndicators.splice(i, 1); continue; }
    s.alpha = s.life / s.maxLife;
  }

  // Cap effects and particles to prevent runaway growth
  if (effects.length > 50) effects.splice(0, effects.length - 50);
  if (particles.length > 200) particles.splice(0, particles.length - 200);

  // Minimap
  drawMinimap();

  // Auto-hide round result banner after 5 seconds
  if (lastRoundEnd && Date.now() - lastRoundEnd > 5000) {
    hideRoundResult();
  }

  requestAnimationFrame(render);
}

function drawPlayer(pl, isMe, isAlly, dt) {
  const x = pl.x, y = pl.y, angle = pl.angle;
  const isT = pl.team === 'T';
  const isCrouching = pl.crouching;

  const bodyColor = isT ? '#c9952d' : '#3a7bc8';
  const bodyLight = isT ? '#daa535' : '#4a8bd8';
  const bodyDark = isT ? '#8a6a20' : '#2a5590';
  const outlineColor = isMe ? '#fff' : isAlly ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)';

  const radius = isCrouching ? PLAYER_RADIUS * 0.8 : PLAYER_RADIUS;

  ctx.save();
  ctx.translate(x, y);

  // Team glow ring (subtle colored aura)
  const glowColor = isT ? 'rgba(255,140,30,' : 'rgba(60,130,220,';
  const time = Date.now() / 1000;
  const glowPulse = 0.08 + Math.sin(time * 2.5 + (pl.name || '').charCodeAt(0)) * 0.03;
  ctx.beginPath(); ctx.arc(0, 0, radius + 5, 0, Math.PI * 2);
  ctx.strokeStyle = glowColor + glowPulse + ')';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Player shadow (dark semi-transparent ellipse below)
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.beginPath(); ctx.ellipse(3, 4, radius + 1, radius * 0.7, 0.15, 0, Math.PI * 2);
  ctx.fillStyle = '#000'; ctx.fill();
  ctx.restore();

  // Body circle with gradient
  ctx.rotate(angle);

  const bodyGrad = ctx.createRadialGradient(-2, -2, 0, 0, 0, radius);
  bodyGrad.addColorStop(0, bodyLight);
  bodyGrad.addColorStop(0.7, bodyColor);
  bodyGrad.addColorStop(1, bodyDark);
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = bodyGrad; ctx.fill();

  // Darker outline around body (2px)
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.strokeStyle = bodyDark;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Crouching indicator: brighter ring
  if (isCrouching) {
    ctx.beginPath(); ctx.arc(0, 0, radius + 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
    // Crouch chevron
    ctx.beginPath();
    ctx.moveTo(-4, -radius - 4); ctx.lineTo(0, -radius - 7); ctx.lineTo(4, -radius - 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.stroke();
  }

  // White outline for identification
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = isMe ? 2.5 : 1.5;
  ctx.stroke();

  // Weapon barrel line pointing in aim direction
  let weaponKey = null;
  if (pl.weapons && pl.currentWeapon >= 0 && pl.currentWeapon < pl.weapons.length) {
    weaponKey = pl.weapons[pl.currentWeapon];
  }
  const wInfo = WEAPONS[weaponKey];
  if (wInfo) {
    const barrelLens = { rifle: 28, smg: 22, pistol: 16, knife: 12, sniper: 32, shotgun: 20 };
    const barrelLen = barrelLens[wInfo.type] || 18;
    // Barrel line from player edge outward
    ctx.beginPath();
    ctx.moveTo(radius - 2, 0);
    ctx.lineTo(radius - 2 + barrelLen, 0);
    ctx.strokeStyle = 'rgba(80,80,80,0.7)';
    ctx.lineWidth = wInfo.type === 'sniper' ? 2.5 : wInfo.type === 'rifle' ? 2.2 : wInfo.type === 'shotgun' ? 2.5 : 1.8;
    ctx.stroke();
    // Barrel tip highlight
    ctx.beginPath();
    ctx.arc(radius - 2 + barrelLen, 0, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(180,180,180,0.6)';
    ctx.fill();
  }

  // Weapon shape (determine current weapon)
  drawWeaponShape(ctx, weaponKey, isMe, 0);

  // Face direction indicator
  ctx.beginPath(); ctx.arc(radius * 0.4, 0, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = isT ? '#ffe0a0' : '#a0c8ff'; ctx.fill();

  ctx.rotate(-angle);

  // Armor indicator ring
  if (pl.armor > 0) {
    ctx.beginPath();
    ctx.arc(0, 0, radius + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (pl.armor / 100));
    ctx.strokeStyle = 'rgba(33,150,243,0.5)'; ctx.lineWidth = 2; ctx.stroke();
  }

  ctx.restore();

  // Name tag (not rotated)
  ctx.save();
  ctx.font = isMe ? 'bold 10px sans-serif' : '10px sans-serif';
  ctx.textAlign = 'center';
  // Show name for all players - enemies slightly dimmer, allies/me brighter
  const nameAlpha = isMe ? 1.0 : isAlly ? 0.85 : 0.65;
  ctx.fillStyle = `rgba(255,255,255,${nameAlpha})`;
  ctx.fillText(pl.name, x, y - radius - 16);

  // Bot badge
  if (pl.isBot) {
    ctx.font = '8px sans-serif';
    ctx.fillStyle = 'rgba(100,200,255,0.6)';
    ctx.fillText('BOT', x, y - radius - 6);
  }

  // HP bar
  const barW = 26, barH = 3;
  const bx = x - barW/2, by = y - radius - 10;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(bx-1, by-1, barW+2, barH+2);
  const hpPct = pl.hp / 100;
  const hpColor = hpPct > 0.6 ? '#4caf50' : hpPct > 0.3 ? '#ff9800' : '#f44336';
  ctx.fillStyle = hpColor;
  ctx.fillRect(bx, by, barW * hpPct, barH);

  // Defuse kit icon
  if (pl.hasDefuseKit) {
    ctx.font = '8px sans-serif';
    ctx.fillText('🔧', x + radius + 5, y);
  }

  ctx.restore();
}

function drawShadows() {
  if (!mapData) return;
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#000';
  const startX = Math.max(0, Math.floor(camera.x / TILE_SIZE));
  const startY = Math.max(0, Math.floor(camera.y / TILE_SIZE));
  const endX = Math.min(mapWidth, Math.ceil((camera.x + canvas.width) / TILE_SIZE) + 1);
  const endY = Math.min(mapHeight, Math.ceil((camera.y + canvas.height) / TILE_SIZE) + 1);
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
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

  minimapCtx.fillStyle = 'rgba(10,10,20,0.85)';
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
      } else if (t === TILE_T_SPAWN) {
        minimapCtx.fillStyle = 'rgba(212,165,55,0.12)';
      } else if (t === TILE_CT_SPAWN) {
        minimapCtx.fillStyle = 'rgba(74,144,217,0.12)';
      } else continue;
      minimapCtx.fillRect(x*TILE_SIZE*sx, y*TILE_SIZE*sy, TILE_SIZE*sx+1, TILE_SIZE*sy+1);
    }
  }

  // Spawn area labels
  minimapCtx.font = '7px sans-serif';
  minimapCtx.textAlign = 'center';
  // Find spawn centers (approximate)
  let tSpawnX = 0, tSpawnY = 0, tCount = 0;
  let ctSpawnX = 0, ctSpawnY = 0, ctCount = 0;
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const cx = (x + 0.5) * TILE_SIZE, cy = (y + 0.5) * TILE_SIZE;
      if (mapData[y][x] === TILE_T_SPAWN) { tSpawnX += cx; tSpawnY += cy; tCount++; }
      if (mapData[y][x] === TILE_CT_SPAWN) { ctSpawnX += cx; ctSpawnY += cy; ctCount++; }
    }
  }
  if (tCount > 0) {
    minimapCtx.fillStyle = 'rgba(212,165,55,0.5)';
    minimapCtx.fillText('T', tSpawnX/tCount * sx, tSpawnY/tCount * sy);
  }
  if (ctCount > 0) {
    minimapCtx.fillStyle = 'rgba(74,144,217,0.5)';
    minimapCtx.fillText('CT', ctSpawnX/ctCount * sx, ctSpawnY/ctCount * sy);
  }

  // Players (alive)
  const me = players[myId];
  const viewTeam = spectating ? null : me?.team;
  for (const [id, pl] of Object.entries(players)) {
    if (pl.team === 'SPEC') continue;
    const isAlly = pl.team === viewTeam;
    if (!pl.alive) {
      // Dead teammates shown as X
      if (isAlly) {
        const px = pl.x * sx, py = pl.y * sy;
        minimapCtx.save();
        minimapCtx.globalAlpha = 0.4;
        minimapCtx.font = 'bold 8px monospace';
        minimapCtx.fillStyle = pl.team === 'T' ? '#d4a537' : '#4a90d9';
        minimapCtx.textAlign = 'center';
        minimapCtx.textBaseline = 'middle';
        minimapCtx.fillText('X', px, py);
        minimapCtx.restore();
      }
      continue;
    }
    if (!isAlly && !spectating && id !== myId) {
      if (!pl.noiseVisible) continue;
      minimapCtx.beginPath();
      minimapCtx.arc(pl.x * sx, pl.y * sy, 2, 0, Math.PI * 2);
      minimapCtx.fillStyle = 'rgba(255, 100, 100, 0.4)';
      minimapCtx.fill();
      continue;
    }
    // Direction indicator for allies
    const px = pl.x * sx, py = pl.y * sy;
    minimapCtx.beginPath();
    minimapCtx.arc(px, py, id === myId ? 3 : 2.5, 0, Math.PI*2);
    minimapCtx.fillStyle = pl.team === 'T' ? '#d4a537' : '#4a90d9';
    minimapCtx.fill();
    if (id === myId || (spectating && id === spectateTarget)) {
      minimapCtx.strokeStyle = '#fff'; minimapCtx.lineWidth = 1; minimapCtx.stroke();
      // Direction line
      const dirLen = 8;
      minimapCtx.beginPath();
      minimapCtx.moveTo(px, py);
      minimapCtx.lineTo(px + Math.cos(pl.angle) * dirLen, py + Math.sin(pl.angle) * dirLen);
      minimapCtx.strokeStyle = 'rgba(255,255,255,0.5)';
      minimapCtx.lineWidth = 1;
      minimapCtx.stroke();
    }
  }

  // Bomb on minimap
  if (bomb?.planted) {
    const bx = bomb.x * sx, by = bomb.y * sy;
    // Pulsing bomb indicator
    const pulse = Math.sin(Date.now() / 200) * 0.3 + 0.7;
    minimapCtx.save();
    minimapCtx.globalAlpha = pulse;
    minimapCtx.beginPath();
    minimapCtx.arc(bx, by, 5, 0, Math.PI * 2);
    minimapCtx.fillStyle = '#ff3333';
    minimapCtx.fill();
    // Ring
    minimapCtx.beginPath();
    minimapCtx.arc(bx, by, 8, 0, Math.PI * 2);
    minimapCtx.strokeStyle = 'rgba(255,50,50,0.5)';
    minimapCtx.lineWidth = 1;
    minimapCtx.stroke();
    minimapCtx.restore();
    // Timer text
    minimapCtx.font = 'bold 8px monospace';
    minimapCtx.fillStyle = '#ff4444';
    minimapCtx.textAlign = 'center';
    minimapCtx.fillText(Math.ceil(bomb.timer) + 's', bx, by - 10);
  } else if (bomb && !bomb.planted && bomb.carrier) {
    // Show bomb on carrier
    const carrier = players[bomb.carrier];
    if (carrier) {
      minimapCtx.beginPath();
      minimapCtx.arc(carrier.x * sx, carrier.y * sy + 6, 3, 0, Math.PI * 2);
      minimapCtx.fillStyle = '#ff6644';
      minimapCtx.fill();
    }
  }

  // Sound indicators on minimap (render only - lifecycle updated in render())
  for (const s of soundIndicators) {
    const mx = s.x * sx, my = s.y * sy;
    let color = 'rgba(255,255,255,';
    if (s.type === 'gunshot') color = 'rgba(255,150,50,';
    else if (s.type === 'footstep') color = 'rgba(200,200,200,';
    else if (s.type === 'grenade_explode') color = 'rgba(255,100,50,';
    else if (s.type === 'bomb_beep') color = 'rgba(255,50,50,';
    else if (s.type === 'player_death' || s.type === 'headshot') color = 'rgba(255,0,0,';
    minimapCtx.beginPath();
    minimapCtx.arc(mx, my, 3, 0, Math.PI * 2);
    minimapCtx.fillStyle = color + ((s.alpha || 0) * 0.8) + ')';
    minimapCtx.fill();
  }

  // Camera view rectangle
  minimapCtx.strokeStyle = 'rgba(255,255,255,0.2)'; minimapCtx.lineWidth = 1;
  minimapCtx.strokeRect(camera.x * sx, camera.y * sy, canvas.width * sx, canvas.height * sy);
}

// ==================== INIT ====================
initMenuParticles();
updateMenuParticles();
requestAnimationFrame(render);
