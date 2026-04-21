// CS Top-Down - Effects (Particles, Damage Indicators, Death Screen)
import { state } from './state.js';
import { WEAPONS, WEAPON_ICONS, MAX_DAMAGE_INDICATORS, DEATH_SCREEN_DURATION } from './constants.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// ==================== DAMAGE DIRECTION INDICATORS ====================

export function addDamageIndicator(fromX, fromY) {
  if (!state.myPlayer || !state.myPlayer.alive) return;
  const dx = fromX - state.myPlayer.x;
  const dy = fromY - state.myPlayer.y;
  const angle = Math.atan2(dy, dx);
  state.damageIndicators.push({ angle, timer: 2.0, maxTimer: 2.0 });
  if (state.damageIndicators.length > MAX_DAMAGE_INDICATORS) state.damageIndicators.shift();
}

export function drawDamageIndicators() {
  if (state.damageIndicators.length === 0) return;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = Math.min(canvas.width, canvas.height) * 0.4;

  for (let i = state.damageIndicators.length - 1; i >= 0; i--) {
    const d = state.damageIndicators[i];
    d.timer -= 1 / 60; // approximate dt
    if (d.timer <= 0) { state.damageIndicators.splice(i, 1); continue; }

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

export function showDeathScreen(killerName, weapon) {
  state.deathScreenData = { killerName, weapon };
  state.deathScreenTimer = DEATH_SCREEN_DURATION;
}

export function updateDeathScreen(dt) {
  if (state.deathScreenTimer > 0) {
    state.deathScreenTimer -= dt;
  }
}

export function drawDeathScreen() {
  if (!state.deathScreenData || state.deathScreenTimer <= 0) return;
  const d = state.deathScreenData;
  const alpha = Math.min(1, state.deathScreenTimer / 0.5); // fade out in last 0.5s

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
  const remaining = Math.ceil(state.deathScreenTimer);
  if (remaining > 0) {
    ctx.font = '14px monospace';
    ctx.fillStyle = '#888';
    ctx.fillText('Respawning in ' + remaining + 's...', canvas.width / 2, canvas.height / 2 + 42);
  }
  ctx.restore();
}

// ==================== PARTICLE SYSTEM ====================
export class Particle {
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

export function spawnMuzzleFlash(x, y, angle, weaponType) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  // Scale flash size by weapon type
  const sizeMult = weaponType === 'sniper' ? 2.5 : weaponType === 'rifle' ? 2.0 : weaponType === 'shotgun' ? 2.2 : weaponType === 'smg' ? 1.5 : weaponType === 'pistol' ? 1.0 : 0.5;
  const countMult = weaponType === 'shotgun' ? 1.5 : weaponType === 'sniper' ? 1.3 : 1.0;
  const barrelLen = weaponType === 'sniper' ? 32 : weaponType === 'rifle' ? 28 : weaponType === 'smg' ? 22 : weaponType === 'shotgun' ? 20 : weaponType === 'pistol' ? 18 : 14;

  // Dynamic crosshair spread on shoot
  state.lastShotTime = Date.now();
  state.crosshairTargetSpread = Math.min(20, state.crosshairTargetSpread + (weaponType === 'rifle' || weaponType === 'smg' ? 8 : 12));
  if (state.adsActive) state.crosshairTargetSpread *= 0.4;

  // Core bright flash
  for (let i = 0; i < Math.ceil(3 * countMult); i++) {
    const spread = (Math.random() - 0.5) * 0.8;
    const spd = (200 + Math.random() * 300) * sizeMult;
    state.particles.push(new Particle(
      x + cos * barrelLen, y + sin * barrelLen,
      Math.cos(angle + spread) * spd, Math.sin(angle + spread) * spd,
      0.06 + Math.random() * 0.06, (3 + Math.random() * 3) * sizeMult,
      `hsl(${40 + Math.random() * 20}, 100%, ${70 + Math.random() * 30}%)`,
      0, 0.9, true, 15 * sizeMult
    ));
  }
  // Smoke wisps
  for (let i = 0; i < Math.ceil(2 * countMult); i++) {
    state.particles.push(new Particle(
      x + cos * (barrelLen + 2), y + sin * (barrelLen + 2),
      cos * 30 + (Math.random()-0.5) * 60, sin * 30 + (Math.random()-0.5) * 60,
      0.3 + Math.random() * 0.4, (4 + Math.random() * 4) * sizeMult,
      `rgba(180,180,180,0.4)`, 0, 0.96, true, 0
    ));
  }
  // Bright white core flash (bigger for bigger weapons)
  if (sizeMult > 1) {
    state.particles.push(new Particle(
      x + cos * barrelLen, y + sin * barrelLen,
      cos * 10, sin * 10,
      0.04, 6 * sizeMult,
      `rgba(255,255,240,0.9)`, 0, 0.8, true, 25 * sizeMult
    ));
  }
}

export function spawnBulletImpact(x, y) {
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 80 + Math.random() * 200;
    state.particles.push(new Particle(x, y,
      Math.cos(a)*spd, Math.sin(a)*spd,
      0.15 + Math.random()*0.2, 1.5 + Math.random()*1.5,
      `hsl(${30+Math.random()*30}, 100%, ${60+Math.random()*40}%)`,
      200, 0.95, true, 5
    ));
  }
  for (let i = 0; i < 4; i++) {
    state.particles.push(new Particle(x, y,
      (Math.random()-0.5)*60, (Math.random()-0.5)*60,
      0.4 + Math.random()*0.3, 3 + Math.random()*3,
      `rgba(140,130,120,0.5)`, 0, 0.96, true, 0
    ));
  }
  // Add bullet hole
  state.bulletHoles.push({ x, y, life: 8, maxLife: 8 });
  if (state.bulletHoles.length > 60) state.bulletHoles.shift();
}

export function spawnBlood(x, y, angle) {
  // More particles, darker, directional spray
  for (let i = 0; i < 8; i++) {
    const a = angle + (Math.random() - 0.5) * 1.4;
    const spd = 40 + Math.random() * 180;
    state.particles.push(new Particle(x, y,
      Math.cos(a)*spd, Math.sin(a)*spd,
      0.4 + Math.random()*0.6, 1 + Math.random()*2.5,
      `hsl(${0+Math.random()*8}, ${70+Math.random()*30}%, ${15+Math.random()*15}%)`,
      120, 0.96, true, 0
    ));
  }
  // Dark blood pool splat
  state.particles.push(new Particle(x, y,
    (Math.random()-0.5)*8, (Math.random()-0.5)*8,
    4 + Math.random()*2, 6 + Math.random()*5,
    `hsl(0, 80%, 12%)`, 0, 1, false, 0
  ));
  // Secondary splatter drops
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 8 + Math.random() * 12;
    state.particles.push(new Particle(x + Math.cos(a)*d, y + Math.sin(a)*d,
      (Math.random()-0.5)*20, (Math.random()-0.5)*20,
      2 + Math.random()*2, 2 + Math.random()*3,
      `hsl(0, 75%, 18%)`, 0, 1, false, 0
    ));
  }
}

export function spawnExplosion(x, y, radius) {
  const r = radius || 200;

  // 1. Bright central flash (white-hot)
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 20 + Math.random() * 60;
    state.particles.push(new Particle(x, y,
      Math.cos(a)*spd, Math.sin(a)*spd,
      0.08 + Math.random() * 0.06, 15 + Math.random() * 10,
      `rgba(255,255,240,0.95)`, 0, 0.8, true, 40
    ));
  }

  // 2. Fire particles
  for (let i = 0; i < 35; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 100 + Math.random() * 400;
    state.particles.push(new Particle(x, y,
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
    state.particles.push(new Particle(x, y,
      Math.cos(a)*spd, Math.sin(a)*spd,
      0.6 + Math.random()*0.8, 3 + Math.random()*3,
      `rgba(60,60,60,0.5)`, 0, 0.97, false, 0
    ));
  }

  // 4. Heavy smoke column
  for (let i = 0; i < 15; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 150 + Math.random() * 300;
    state.particles.push(new Particle(x, y,
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
    state.particles.push(new Particle(x + Math.cos(a)*r*0.2, y + Math.sin(a)*r*0.2,
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
    state.particles.push(new Particle(x + Math.cos(a)*d, y + Math.sin(a)*d,
      (Math.random()-0.5)*40, -30 - Math.random()*50,
      2 + Math.random()*2, 10 + Math.random()*15,
      `rgba(50,50,50,0.5)`, -20, 0.99, false, 0
    ));
  }

  state.camera.shakeX = (Math.random()-0.5) * 35;
  state.camera.shakeY = (Math.random()-0.5) * 35;
  setTimeout(() => { state.camera.shakeX = 0; state.camera.shakeY = 0; }, 500);
}

export function spawnSmokeEffect(x, y, radius) {
  const r = radius || 80;
  // Dense core puffs
  for (let i = 0; i < 20; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * r * 0.4;
    state.particles.push(new Particle(x + Math.cos(a)*d, y + Math.sin(a)*d,
      Math.cos(a)*15, Math.sin(a)*15,
      2.5 + Math.random()*3, 8 + Math.random()*12,
      `rgba(75,75,75,0.6)`, -5, 0.99, false, 0
    ));
  }
  // Outer wispy edges
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = r * 0.5 + Math.random() * r * 0.4;
    state.particles.push(new Particle(x + Math.cos(a)*d, y + Math.sin(a)*d,
      Math.cos(a)*25, Math.sin(a)*25 - 8,
      1.5 + Math.random()*2, 5 + Math.random()*8,
      `rgba(85,85,85,0.35)`, -3, 0.99, false, 0
    ));
  }
}

export function spawnDeathEffect(x, y) {
  for (let i = 0; i < 20; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 30 + Math.random() * 80;
    state.particles.push(new Particle(x, y,
      Math.cos(a)*spd, Math.sin(a)*spd,
      0.5 + Math.random()*0.5, 2 + Math.random()*3,
      `hsl(0, 70%, ${20+Math.random()*15}%)`,
      0, 0.97, true, 0
    ));
  }
}

export function spawnShellCasing(x, y, angle) {
  const ejectAngle = angle + Math.PI / 2 + (Math.random() - 0.5) * 0.5;
  const spd = 80 + Math.random() * 120;
  state.shellCasings.push({
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

export function spawnFootstepParticles(x, y) {
  for (let i = 0; i < 3; i++) {
    state.particles.push(new Particle(
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

export function spawnAmbientDust(camX, camY) {
  if (state.ambientParticles.length > 30) return;
  if (Math.random() > 0.05) return;
  state.ambientParticles.push({
    x: camX + Math.random() * canvas.width,
    y: camY + Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 8,
    vy: -2 - Math.random() * 5,
    life: 3 + Math.random() * 4,
    maxLife: 3 + Math.random() * 4,
    size: 0.5 + Math.random() * 1.5,
  });
}

export function spawnDamageNumber(x, y, amount, isHeadshot) {
  state.damageNumbers.push({
    x: x + (Math.random() - 0.5) * 10,
    y: y - 10,
    amount: Math.round(amount),
    timer: 1.0,
    vy: -60,
    color: isHeadshot ? '#ffd700' : '#ff4444',
    isHeadshot,
  });
}

export function spawnSoundRing(x, y, color, maxRadius) {
  maxRadius = maxRadius || 20;
  state.effects.push({ type: 'sound-ring', x, y, color, radius: 0, maxRadius, alpha: 0.6, life: 0.4, maxLife: 0.4 });
}
