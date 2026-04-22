// CS Top-Down - Renderer (Map, Rendering, Minimap, Fog)
import { state } from './state.js';
import {
  PLAYER_RADIUS, TILE_SIZE, TILE_WALL, TILE_CRATE, TILE_BS_A, TILE_BS_B,
  TILE_T_SPAWN, TILE_CT_SPAWN, TILE_DOOR, WEAPONS, WEAPON_ICONS,
  ADS_ZOOM_LEVELS, FOG_VISIBILITY_RADIUS, GAME_VERSION
} from './constants.js';
import { getInterpolatedState } from './interpolation.js';
import { SoundManager } from './audio.js';
import { drawDamageIndicators, drawDeathScreen, updateDeathScreen, Particle, spawnMuzzleFlash, spawnShellCasing, spawnFootstepParticles, spawnAmbientDust, spawnBlood, spawnExplosion, spawnBulletImpact, spawnSmokeEffect, spawnDeathEffect, spawnDamageNumber, addDamageIndicator } from './effects.js';
import { updateHUD, drawBombHud, hideRoundResult, drawRoundRect } from './hud.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const menuCanvas = document.getElementById('menu-particles');
const menuCtx = menuCanvas ? menuCanvas.getContext('2d') : null;
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');

// ==================== MENU PARTICLES ====================
state.menuParticles = [];
export function initMenuParticles() {
  if (!menuCanvas) return;
  menuCanvas.width = window.innerWidth;
  menuCanvas.height = window.innerHeight;
  state.menuParticles = [];
  for (let i = 0; i < 80; i++) {
    state.menuParticles.push({
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
export function updateMenuParticles() {
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

  for (const p of state.menuParticles) {
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
    // Connect nearby state.particles
    for (const q of state.menuParticles) {
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


// ==================== RESIZE ====================

export function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (menuCanvas) {
    menuCanvas.width = window.innerWidth;
    menuCanvas.height = window.innerHeight;
  }
}
window.addEventListener('resize', resize);
resize();



// ==================== MAP PRE-RENDER ====================
// ==================== MAP PRE-RENDER ====================
export function preRenderMap() {
  if (!state.mapData) return;
  state.mapWidthPx = state.mapWidth * TILE_SIZE;
  state.mapHeightPx = state.mapHeight * TILE_SIZE;
  state.mapOffscreen = document.createElement('canvas');
  state.mapOffscreen.width = state.mapWidthPx;
  state.mapOffscreen.height = state.mapHeightPx;
  const mc = state.mapOffscreen.getContext('2d');

  // Base floor
  mc.fillStyle = '#1a1a28';
  mc.fillRect(0, 0, state.mapWidthPx, state.mapHeightPx);

  // Subtle concrete-like floor texture
  for (let y = 0; y < state.mapHeight; y++) {
    for (let x = 0; x < state.mapWidth; x++) {
      const t = state.mapData[y][x], px = x * TILE_SIZE, py = y * TILE_SIZE;
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
  for (let y = 0; y < state.mapHeight; y++) {
    for (let x = 0; x < state.mapWidth; x++) {
      if (state.mapData[y][x] === TILE_WALL || state.mapData[y][x] === TILE_CRATE) continue;
      const px = x * TILE_SIZE, py = y * TILE_SIZE;
      // Check each neighbor for walls
      const wallTop = y > 0 && (state.mapData[y-1][x] === TILE_WALL || state.mapData[y-1][x] === TILE_CRATE);
      const wallBottom = y < state.mapHeight-1 && (state.mapData[y+1][x] === TILE_WALL || state.mapData[y+1][x] === TILE_CRATE);
      const wallLeft = x > 0 && (state.mapData[y][x-1] === TILE_WALL || state.mapData[y][x-1] === TILE_CRATE);
      const wallRight = x < state.mapWidth-1 && (state.mapData[y][x+1] === TILE_WALL || state.mapData[y][x+1] === TILE_CRATE);

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
      if ((wallTop || wallLeft) && y > 0 && x > 0 && (state.mapData[y-1][x] === TILE_WALL || state.mapData[y][x-1] === TILE_WALL)) {
        mc.fillStyle = 'rgba(0,0,0,0.08)';
        mc.fillRect(px, py, TILE_SIZE * 0.3, TILE_SIZE * 0.3);
      }
    }
  }
  mc.restore();

  if (state.bombsites) {
    mc.font = 'bold 52px sans-serif'; mc.textAlign = 'center'; mc.textBaseline = 'middle';
    if (state.bombsites.A) {
      // Large semi-transparent floor zone for site A
      if (state.bombsites.A.tiles && state.bombsites.A.tiles.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const t of state.bombsites.A.tiles) {
          if (t.x < minX) minX = t.x; if (t.y < minY) minY = t.y;
          if (t.x > maxX) maxX = t.x; if (t.y > maxY) maxY = t.y;
        }
        mc.fillStyle = 'rgba(255,60,40,0.08)';
        mc.fillRect(minX * TILE_SIZE, minY * TILE_SIZE, (maxX - minX + 1) * TILE_SIZE, (maxY - minY + 1) * TILE_SIZE);
        // Inner glow
        const aGrad = mc.createRadialGradient(
          state.bombsites.A.centerX, state.bombsites.A.centerY, 0,
          state.bombsites.A.centerX, state.bombsites.A.centerY, 200
        );
        aGrad.addColorStop(0, 'rgba(255,60,40,0.1)');
        aGrad.addColorStop(1, 'rgba(255,60,40,0)');
        mc.fillStyle = aGrad;
        mc.fillRect(minX * TILE_SIZE, minY * TILE_SIZE, (maxX - minX + 1) * TILE_SIZE, (maxY - minY + 1) * TILE_SIZE);
      }
      mc.fillStyle = 'rgba(255,80,60,0.2)';
      mc.fillText('A', state.bombsites.A.centerX, state.bombsites.A.centerY);
      drawBombsiteOutline(mc, state.bombsites.A, 'rgba(255,80,60,0.3)');
    }
    if (state.bombsites.B) {
      // Large semi-transparent floor zone for site B
      if (state.bombsites.B.tiles && state.bombsites.B.tiles.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const t of state.bombsites.B.tiles) {
          if (t.x < minX) minX = t.x; if (t.y < minY) minY = t.y;
          if (t.x > maxX) maxX = t.x; if (t.y > maxY) maxY = t.y;
        }
        mc.fillStyle = 'rgba(40,60,255,0.08)';
        mc.fillRect(minX * TILE_SIZE, minY * TILE_SIZE, (maxX - minX + 1) * TILE_SIZE, (maxY - minY + 1) * TILE_SIZE);
        // Inner glow
        const bGrad = mc.createRadialGradient(
          state.bombsites.B.centerX, state.bombsites.B.centerY, 0,
          state.bombsites.B.centerX, state.bombsites.B.centerY, 200
        );
        bGrad.addColorStop(0, 'rgba(40,60,255,0.1)');
        bGrad.addColorStop(1, 'rgba(40,60,255,0)');
        mc.fillStyle = bGrad;
        mc.fillRect(minX * TILE_SIZE, minY * TILE_SIZE, (maxX - minX + 1) * TILE_SIZE, (maxY - minY + 1) * TILE_SIZE);
      }
      mc.fillStyle = 'rgba(60,80,255,0.2)';
      mc.fillText('B', state.bombsites.B.centerX, state.bombsites.B.centerY);
      drawBombsiteOutline(mc, state.bombsites.B, 'rgba(60,80,255,0.3)');
    }
  }

  // Spawn area labels
  mc.font = 'bold 28px sans-serif'; mc.textAlign = 'center'; mc.textBaseline = 'middle';
  let tSX = 0, tSY = 0, tC = 0, ctSX = 0, ctSY = 0, ctC = 0;
  for (let sy = 0; sy < state.mapHeight; sy++) {
    for (let sx = 0; sx < state.mapWidth; sx++) {
      const cx = (sx + 0.5) * TILE_SIZE, cy = (sy + 0.5) * TILE_SIZE;
      if (state.mapData[sy][sx] === TILE_T_SPAWN) { tSX += cx; tSY += cy; tC++; }
      if (state.mapData[sy][sx] === TILE_CT_SPAWN) { ctSX += cx; ctSY += cy; ctC++; }
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
  state.freeCamPos.x = state.mapWidthPx / 2;
  state.freeCamPos.y = state.mapHeightPx / 2;

  // Pre-render vignette
  state.vignetteCanvas = document.createElement('canvas');
  state.vignetteCanvas.width = 1920;
  state.vignetteCanvas.height = 1080;
  const vc = state.vignetteCanvas.getContext('2d');
  const vg = vc.createRadialGradient(960, 540, 300, 960, 540, 960);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.5, 'rgba(0,0,0,0)');
  vg.addColorStop(0.75, 'rgba(0,0,0,0.15)');
  vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  vc.fillStyle = vg;
  vc.fillRect(0, 0, 1920, 1080);
}

export function drawBombsiteOutline(mc, site, color) {
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



// ==================== WEAPON SHAPE DRAWING ====================
// ==================== WEAPON SHAPE DRAWING ====================
export function drawWeaponShape(ctx, weaponKey, isMe, angle) {
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


// ==================== SPECTATE CAMERA ====================
export function getSpectateCameraTarget() {
  if (!state.spectating) return null;
  if (state.spectateFreeCam || !state.spectateTarget) return { x: state.freeCamPos.x, y: state.freeCamPos.y, free: true };
  const target = state.players[state.spectateTarget];
  if (target && target.alive) return { x: target.x, y: target.y, free: false, player: target };
  // Target died, switch
  state.spectateTarget = null;
  return { x: state.freeCamPos.x, y: state.freeCamPos.y, free: true };
}

// ==================== MAIN RENDER LOOP ====================
let lastTime = 0;
state.muzzleFlashTimers = {};
state.prevPositions = {}; // For detecting movement

export function render(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  // Apply interpolated state for rendering
  const interpState = getInterpolatedState();
  if (interpState) {
    const myServerState = state.players[state.myId]; // save my own server position
    state.players = interpState.players;
    // Keep my own position from latest server state (no self-interpolation delay)
    if (myServerState) {
      state.players[state.myId] = myServerState;
      state.myPlayer = myServerState;
    }
  }

  // Update state.effects
  state.flashTimer = Math.max(0, state.flashTimer - dt);
  state.centerMessages = state.centerMessages.filter(m => {
    m.timer -= dt;
    // Animate scale in
    if (m.scale < 1) m.scale = Math.min(1, m.scale + dt * 5);
    return m.timer > 0;
  });
  state.particles = state.particles.filter(p => p.update(dt));
  // Cap state.particles to prevent memory buildup
  if (state.particles.length > 500) state.particles.splice(0, state.particles.length - 500);

  // Update damage numbers
  state.damageNumbers = state.damageNumbers.filter(d => {
    d.timer -= dt;
    d.y += d.vy * dt;
    d.vy *= 0.95;
    return d.timer > 0;
  });

  // Update death animations
  state.deathAnimations = state.deathAnimations.filter(d => {
    d.timer -= dt;
    return d.timer > 0;
  });

  // Update shell casings
  state.shellCasings = state.shellCasings.filter(s => {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += 200 * dt; // gravity
    s.vx *= 0.95;
    s.rotation += s.rotSpeed * dt;
    s.rotSpeed *= 0.95;
    s.life -= dt;
    return s.life > 0;
  });

  // Update ambient state.particles
  state.ambientParticles = state.ambientParticles.filter(a => {
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.life -= dt;
    return a.life > 0;
  });

  // Camera shake decay
  state.camera.shakeX *= 0.9; state.camera.shakeY *= 0.9;
  if (Math.abs(state.camera.shakeX) < 0.5) state.camera.shakeX = 0;
  if (Math.abs(state.camera.shakeY) < 0.5) state.camera.shakeY = 0;

  // Camera target
  const p = state.players[state.myId];
  let camTargetX, camTargetY;

  if (state.spectating) {
    const specTarget = getSpectateCameraTarget();
    if (specTarget) {
      camTargetX = specTarget.x - canvas.width / 2;
      camTargetY = specTarget.y - canvas.height / 2;
      if (specTarget.free) {
        state.freeCamPos.x = specTarget.x;
        state.freeCamPos.y = specTarget.y;
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
    const isMoving = state.keys['KeyW'] || state.keys['KeyS'] || state.keys['KeyA'] || state.keys['KeyD'];
    if (isMoving) {
      state.weaponSway.targetX = (Math.random() - 0.5) * 3;
      state.weaponSway.targetY = (Math.random() - 0.5) * 3;
    } else {
      state.weaponSway.targetX = 0;
      state.weaponSway.targetY = 0;
    }
    state.weaponSway.x += (state.weaponSway.targetX - state.weaponSway.x) * dt * 8;
    state.weaponSway.y += (state.weaponSway.targetY - state.weaponSway.y) * dt * 8;
  } else if (state.mapOffscreen) {
    camTargetX = state.mapWidthPx / 2 - canvas.width / 2;
    camTargetY = state.mapHeightPx / 2 - canvas.height / 2;
  }

  // Smooth ADS zoom
  state.adsZoom += (state.adsTargetZoom - state.adsZoom) * 0.12;

  if (camTargetX !== undefined) {
    state.camera.x += (camTargetX - state.camera.x) * 0.15;
    state.camera.y += (camTargetY - state.camera.y) * 0.15;
  }

  // Clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  // Apply ADS zoom - scale from center of screen
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(state.adsZoom, state.adsZoom);
  ctx.translate(-canvas.width / 2, -canvas.height / 2);
  ctx.translate(-state.camera.x + state.camera.shakeX, -state.camera.y + state.camera.shakeY);

  // Map
  if (state.mapOffscreen) ctx.drawImage(state.mapOffscreen, 0, 0);

  // ---- FOG OF WAR OVERLAY ----
  const viewPlayer = state.spectating
    ? (state.spectateTarget ? state.players[state.spectateTarget] : null)
    : p;
  if (viewPlayer && viewPlayer.alive && viewPlayer.team !== 'SPEC' && state.mapOffscreen) {
    if (!state.fogCanvas) {
      state.fogCanvas = document.createElement('canvas');
      state.fogCtx = state.fogCanvas.getContext('2d');
    }
    // Only resize fog canvas when dimensions actually change (avoids reallocating backing buffer every frame)
    if (state.fogCanvas.width !== canvas.width || state.fogCanvas.height !== canvas.height) {
      state.fogCanvas.width = canvas.width;
      state.fogCanvas.height = canvas.height;
    }

    state.fogCtx.fillStyle = 'rgba(0, 0, 10, 0.82)';
    state.fogCtx.fillRect(0, 0, canvas.width, canvas.height);

    state.fogCtx.globalCompositeOperation = 'destination-out';
    // Player position in true screen space (accounts for ADS zoom transform)
    const cx = (viewPlayer.x - state.camera.x + state.camera.shakeX) * state.adsZoom
             + canvas.width / 2 * (1 - state.adsZoom);
    const cy = (viewPlayer.y - state.camera.y + state.camera.shakeY) * state.adsZoom
             + canvas.height / 2 * (1 - state.adsZoom);
    // Fog visibility radius in screen pixels (world radius scaled by zoom)
    const fogScreenRadius = Math.max(FOG_VISIBILITY_RADIUS * state.adsZoom, 80);
    // Outer gradient radius - large enough to cover the full fog canvas
    const outerR = Math.max(fogScreenRadius * 1.5, Math.sqrt(canvas.width * canvas.width + canvas.height * canvas.height) / 2);
    const fogGrad = state.fogCtx.createRadialGradient(cx, cy, fogScreenRadius * 0.25, cx, cy, outerR);
    fogGrad.addColorStop(0, 'rgba(0, 0, 0, 1)');
    fogGrad.addColorStop(Math.min(0.99, fogScreenRadius / outerR * 0.6), 'rgba(0, 0, 0, 0.95)');
    fogGrad.addColorStop(Math.min(0.999, fogScreenRadius / outerR), 'rgba(0, 0, 0, 0)');
    fogGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    state.fogCtx.fillStyle = fogGrad;
    state.fogCtx.beginPath();
    state.fogCtx.arc(cx, cy, outerR, 0, Math.PI * 2);
    state.fogCtx.fill();
    state.fogCtx.globalCompositeOperation = 'source-over';

    // Draw fog scaled to cover the full viewport in the zoom-transformed context
    const invZoom = 1 / state.adsZoom;
    const fogW = canvas.width * invZoom;
    const fogH = canvas.height * invZoom;
    const fogX = state.camera.x - state.camera.shakeX - canvas.width / 2 * (invZoom - 1);
    const fogY = state.camera.y - state.camera.shakeY - canvas.height / 2 * (invZoom - 1);
    ctx.drawImage(state.fogCanvas, fogX, fogY, fogW, fogH);
  }

  // Shadow layer
  drawShadows();

  // Smoke grenades with animated edges
  for (const g of state.serverGrenades) {
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

      // Smoke edge state.particles
      if (Math.random() < 0.2) {
        const a = Math.random() * Math.PI * 2;
        state.particles.push(new Particle(
          g.x + Math.cos(a)*g.radius*0.8, g.y + Math.sin(a)*g.radius*0.8,
          Math.cos(a)*15, Math.sin(a)*15 - 5,
          1.2, 4+Math.random()*4, 'rgba(80,80,80,0.25)', 0, 0.99, false, 0
        ));
      }
    }
  }

  // Active grenades
  for (const g of state.activeGrenades) {
    const colors = { he: '#ff4444', flash: '#ffee44', smoke: '#aaa' };
    ctx.save();
    ctx.shadowColor = colors[g.type] || '#fff';
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(g.x, g.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = colors[g.type] || '#fff'; ctx.fill();
    ctx.restore();
    state.particles.push(new Particle(g.x, g.y, (Math.random()-0.5)*10, (Math.random()-0.5)*10,
      0.2, 2, 'rgba(200,200,200,0.3)', 0, 0.9, true, 0));
  }

  // Dropped weapons on the ground
  for (const dw of state.droppedWeapons) {
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
  if (state.bomb && state.bomb.planted) {
    const pulse = Math.sin(Date.now() / 150) * 0.4 + 0.6;
    const urgentPulse = state.bomb.timer < 10 ? Math.sin(Date.now() / 60) * 0.3 + 0.7 : pulse;
    ctx.save();
    ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 30 * urgentPulse;
    ctx.beginPath(); ctx.arc(state.bomb.x, state.bomb.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,50,30,${urgentPulse * 0.8})`; ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#111'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('💣', state.bomb.x, state.bomb.y + 5);
    ctx.font = 'bold 16px monospace'; ctx.fillStyle = state.bomb.timer < 10 ? '#ff0000' : '#ff4444';
    ctx.fillText(Math.ceil(state.bomb.timer) + 's', state.bomb.x, state.bomb.y - 22);
    if (state.bomb.timer < 10) {
      const ring = (10 - state.bomb.timer) % 2;
      ctx.beginPath(); ctx.arc(state.bomb.x, state.bomb.y, 20 + ring * 30, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,0,0,${0.3 * (1 - ring/2)})`; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  // Death animations (blood pools and fading bodies)
  for (const da of state.deathAnimations) {
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
  for (const s of state.shellCasings) {
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
  for (const b of state.bullets) {
    if (!state.muzzleFlashTimers[b.owner]) {
      const shooter = state.players[b.owner];
      if (shooter) {
        spawnMuzzleFlash(shooter.x, shooter.y, shooter.angle);
        // Shell casing from shooter
        spawnShellCasing(shooter.x, shooter.y, shooter.angle);
      }
      state.muzzleFlashTimers[b.owner] = 0.05;
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
  for (const k in state.muzzleFlashTimers) {
    state.muzzleFlashTimers[k] -= dt;
    if (state.muzzleFlashTimers[k] <= 0) delete state.muzzleFlashTimers[k];
  }

  // Players
  // Clean stale entries from prevPositions/footstepTimers for disconnected players
  for (const id in state.prevPositions) {
    if (!state.players[id]) delete state.prevPositions[id];
  }
  for (const id in state.footstepTimers) {
    if (!state.players[id]) delete state.footstepTimers[id];
  }
  for (const [id, pl] of Object.entries(state.players)) {
    if (!pl.alive || pl.team === 'SPEC') continue;
    const isMe = id === state.myId;
    const isAlly = pl.team === viewPlayer?.team;
    if (pl.noiseVisible && !isMe && !isAlly) continue;
    drawPlayer(pl, isMe, isAlly, dt);

    // Footstep state.particles
    if (isMe || isAlly) {
      if (!state.footstepTimers[id]) state.footstepTimers[id] = 0;
      // Detect movement by checking position change
      const prev = state.prevPositions[id];
      if (prev) {
        const dx = pl.x - prev.x, dy = pl.y - prev.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 2) {
          state.footstepTimers[id] -= dt;
          if (state.footstepTimers[id] <= 0) {
            spawnFootstepParticles(pl.x, pl.y);
            state.footstepTimers[id] = 0.25;
          }
        }
      }
      state.prevPositions[id] = { x: pl.x, y: pl.y };
    }
  }

  // Particles (game state.particles)
  for (const part of state.particles) part.draw(ctx);

  // Effects (sound rings, etc.)
  for (let i = state.effects.length - 1; i >= 0; i--) {
    const e = state.effects[i];
    e.life -= dt;
    if (e.life <= 0) { state.effects.splice(i, 1); continue; }
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
  spawnAmbientDust(state.camera.x, state.camera.y);
  for (const a of state.ambientParticles) {
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
  if (state.adsActive && state.adsZoom < 0.8) {
    const scopeRadius = Math.min(canvas.width, canvas.height) * 0.35;
    ctx.save();
    // Draw dark overlay with a circular hole (no destination-out needed)
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.arc(canvas.width / 2, canvas.height / 2, scopeRadius, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fill();
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
  } else if (!state.spectating) {
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
  for (const d of state.damageNumbers) {
    const screenX = (d.x - state.camera.x + state.camera.shakeX) * state.adsZoom + canvas.width / 2 * (1 - state.adsZoom);
    const screenY = (d.y - state.camera.y + state.camera.shakeY) * state.adsZoom + canvas.height / 2 * (1 - state.adsZoom);
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
  for (let i = 0; i < state.centerMessages.length; i++) {
    const msg = state.centerMessages[i];
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
  for (let i = state.soundIndicators.length - 1; i >= 0; i--) {
    const s = state.soundIndicators[i];
    s.life -= dt;
    if (s.life <= 0) { state.soundIndicators.splice(i, 1); continue; }
    s.alpha = s.life / s.maxLife;
  }

  // Cap state.effects and state.particles to prevent runaway growth
  if (state.effects.length > 50) state.effects.splice(0, state.effects.length - 50);
  if (state.particles.length > 200) state.particles.splice(0, state.particles.length - 200);

  // Minimap
  drawMinimap();

  // Auto-hide round result banner after 5 seconds
  if (state.lastRoundEnd && Date.now() - state.lastRoundEnd > 5000) {
    hideRoundResult();
  }

  requestAnimationFrame(render);
}

export function drawPlayer(pl, isMe, isAlly, dt) {
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
  // Show name for all state.players - enemies slightly dimmer, allies/me brighter
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

export function drawShadows() {
  if (!state.mapData) return;
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#000';
  const startX = Math.max(0, Math.floor(state.camera.x / TILE_SIZE));
  const startY = Math.max(0, Math.floor(state.camera.y / TILE_SIZE));
  const endX = Math.min(state.mapWidth, Math.ceil((state.camera.x + canvas.width) / TILE_SIZE) + 1);
  const endY = Math.min(state.mapHeight, Math.ceil((state.camera.y + canvas.height) / TILE_SIZE) + 1);
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const t = state.mapData[y][x];
      if (t === TILE_WALL || t === TILE_CRATE) {
        ctx.fillRect(x * TILE_SIZE + 3, y * TILE_SIZE + 3, TILE_SIZE, TILE_SIZE);
      }
    }
  }
  ctx.restore();
}

export function drawVignette() {
  const grad = ctx.createRadialGradient(
    canvas.width/2, canvas.height/2, canvas.width * 0.3,
    canvas.width/2, canvas.height/2, canvas.width * 0.7
  );
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

export function drawMinimap() {
  if (!state.mapData) return;
  const mw = minimapCanvas.width, mh = minimapCanvas.height;
  const sx = mw / (state.mapWidth * TILE_SIZE), sy = mh / (state.mapHeight * TILE_SIZE);

  minimapCtx.fillStyle = 'rgba(10,10,20,0.85)';
  minimapCtx.fillRect(0, 0, mw, mh);

  // Tiles
  for (let y = 0; y < state.mapHeight; y++) {
    for (let x = 0; x < state.mapWidth; x++) {
      const t = state.mapData[y][x];
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
  for (let y = 0; y < state.mapHeight; y++) {
    for (let x = 0; x < state.mapWidth; x++) {
      const cx = (x + 0.5) * TILE_SIZE, cy = (y + 0.5) * TILE_SIZE;
      if (state.mapData[y][x] === TILE_T_SPAWN) { tSpawnX += cx; tSpawnY += cy; tCount++; }
      if (state.mapData[y][x] === TILE_CT_SPAWN) { ctSpawnX += cx; ctSpawnY += cy; ctCount++; }
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
  const me = state.players[state.myId];
  const viewTeam = state.spectating ? null : me?.team;
  for (const [id, pl] of Object.entries(state.players)) {
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
    if (!isAlly && !state.spectating && id !== state.myId) {
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
    minimapCtx.arc(px, py, id === state.myId ? 3 : 2.5, 0, Math.PI*2);
    minimapCtx.fillStyle = pl.team === 'T' ? '#d4a537' : '#4a90d9';
    minimapCtx.fill();
    if (id === state.myId || (state.spectating && id === state.spectateTarget)) {
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
  if (state.bomb?.planted) {
    const bx = state.bomb.x * sx, by = state.bomb.y * sy;
    // Pulsing state.bomb indicator
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
    minimapCtx.fillText(Math.ceil(state.bomb.timer) + 's', bx, by - 10);
  } else if (state.bomb && !state.bomb.planted && state.bomb.carrier) {
    // Show state.bomb on carrier
    const carrier = state.players[state.bomb.carrier];
    if (carrier) {
      minimapCtx.beginPath();
      minimapCtx.arc(carrier.x * sx, carrier.y * sy + 6, 3, 0, Math.PI * 2);
      minimapCtx.fillStyle = '#ff6644';
      minimapCtx.fill();
    }
  }

  // Sound indicators on minimap (render only - lifecycle updated in render())
  for (const s of state.soundIndicators) {
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
  minimapCtx.strokeRect(state.camera.x * sx, state.camera.y * sy, canvas.width * sx, canvas.height * sy);
}

// ==================== INIT ====================
initMenuParticles();
updateMenuParticles();
requestAnimationFrame(render);


