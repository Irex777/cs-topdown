// Grenade flight, detonation and lingering area effects (smoke, fire).
import {
  GRENADE, GREN_ORDER, GREN_DRAG, GREN_MIN_DIST, GREN_MAX_DIST, HE_RADIUS, HE_DAMAGE, FLASH_RADIUS, FLASH_MAX,
  SMOKE_RADIUS, SMOKE_TIME, FIRE_RADIUS, FIRE_TIME, FIRE_DPS, SPEC,
} from '../shared/constants.js';
import { angleDiff } from '../shared/gamemap.js';
import { damagePlayer, selectSlot } from './combat.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function throwGrenade(game, p, aimDist) {
  const type = p.gsel;
  if (!p.grenades[type] || p.grenades[type] <= 0) return;
  p.grenades[type]--;
  const dist = clamp(aimDist || 320, GREN_MIN_DIST, GREN_MAX_DIST);
  const dx = Math.cos(p.angle), dy = Math.sin(p.angle);
  let sx = p.x + dx * 16, sy = p.y + dy * 16;
  if (!game.map.clearLine(p.x, p.y, sx, sy)) { sx = p.x; sy = p.y; }
  const v0 = dist * GREN_DRAG;
  const g = { id: game.nextId++, type, owner: p.id, team: p.team, x: sx, y: sy, vx: dx * v0, vy: dy * v0, t: 0, fuse: GRENADE[type].fuse };
  game.grenades.push(g);
  game.emit(['nade', type, Math.round(sx), Math.round(sy), p.id], sx, sy, 800);
  // choose what to hold next
  if (p.grenades[type] <= 0) {
    const other = GREN_ORDER.find((k) => p.grenades[k] > 0);
    if (other) p.gsel = other;
    else selectSlot(game, p, p.lastSel !== 'grenade' && (p.lastSel !== 'primary' || p.primary) ? p.lastSel : (p.primary ? 'primary' : 'secondary'));
  }
  p.drawT = Math.max(p.drawT, 0.3);
  if (game.mode === 'defuse') for (const b of game.players.values()) if (b.bot && b.alive && b.team !== p.team) b.bot.onNadeThrown(g);
}

export function updateGrenades(game, dt) {
  const map = game.map;
  for (let i = game.grenades.length - 1; i >= 0; i--) {
    const g = game.grenades[i];
    g.t += dt;
    const k = Math.exp(-GREN_DRAG * dt);
    g.vx *= k; g.vy *= k;
    let nx = g.x + g.vx * dt, ny = g.y + g.vy * dt;
    const px = nx + Math.sign(g.vx) * 4, py = ny + Math.sign(g.vy) * 4;
    if (map.isSolidAt(px, g.y)) { g.vx = -g.vx * 0.5; nx = g.x; }
    if (map.isSolidAt(g.x, py)) { g.vy = -g.vy * 0.5; ny = g.y; }
    g.x = nx; g.y = ny;
    const speed = Math.hypot(g.vx, g.vy);
    if (g.t >= g.fuse || (g.type === 'smoke' && g.t > 0.7 && speed < 14)) {
      game.grenades.splice(i, 1);
      detonate(game, g);
    }
  }
}

function detonate(game, g) {
  const owner = game.players.get(g.owner) || null;
  if (g.type === 'he') {
    game.emit(['boom', 'he', Math.round(g.x), Math.round(g.y)], g.x, g.y, 5000);
    for (const p of [...game.players.values()]) {
      if (!p.alive || p.team === SPEC) continue;
      const d = Math.hypot(p.x - g.x, p.y - g.y);
      if (d > HE_RADIUS) continue;
      if (d > 20 && !game.map.los(g.x, g.y, p.x, p.y)) continue;
      damagePlayer(game, p, owner, HE_DAMAGE * (1 - d / HE_RADIUS) + 2, 0.55, 'he', {});
    }
  } else if (g.type === 'flash') {
    game.emit(['boom', 'flash', Math.round(g.x), Math.round(g.y)], g.x, g.y, 5000);
    for (const p of game.players.values()) {
      if (!p.alive || p.team === SPEC) continue;
      const d = Math.hypot(p.x - g.x, p.y - g.y);
      if (d > FLASH_RADIUS) continue;
      if (d > 20 && !game.map.los(g.x, g.y, p.x, p.y)) continue;
      let dur = FLASH_MAX * clamp(1.15 - d / FLASH_RADIUS, 0.18, 1);
      const facing = Math.abs(angleDiff(Math.atan2(g.y - p.y, g.x - p.x), p.angle));
      if (facing > 1.75) dur *= 0.35; else if (facing > 1.0) dur *= 0.7;
      const now = game.time;
      p.flashUntil = Math.max(p.flashUntil, now + dur);
      p.flashFullUntil = Math.max(p.flashFullUntil, now + dur * 0.45);
      if (p.bot) p.bot.onFlashed(dur);
    }
  } else if (g.type === 'smoke') {
    game.smokes.push({ id: game.nextId++, x: g.x, y: g.y, t0: game.time, r: 8 });
    game.fires = game.fires.filter((f) => Math.hypot(f.x - g.x, f.y - g.y) > FIRE_RADIUS + SMOKE_RADIUS * 0.5);
    game.emit(['boom', 'smoke', Math.round(g.x), Math.round(g.y)], g.x, g.y, 5000);
  } else if (g.type === 'molo') {
    game.fires.push({ id: game.nextId++, x: g.x, y: g.y, t0: game.time, r: FIRE_RADIUS, owner: g.owner, team: g.team, acc: new Map() });
    game.emit(['boom', 'molo', Math.round(g.x), Math.round(g.y)], g.x, g.y, 5000);
  }
}

export function updateSmokes(game) {
  for (let i = game.smokes.length - 1; i >= 0; i--) {
    const s = game.smokes[i];
    const age = game.time - s.t0;
    if (age > SMOKE_TIME) { game.smokes.splice(i, 1); continue; }
    s.r = Math.min(SMOKE_RADIUS, 8 + age * 190);
    if (age > SMOKE_TIME - 2) s.r = SMOKE_RADIUS * ((SMOKE_TIME - age) / 2 * 0.25 + 0.75);
  }
}

export function updateFires(game, dt) {
  for (let i = game.fires.length - 1; i >= 0; i--) {
    const f = game.fires[i];
    const age = game.time - f.t0;
    if (age > FIRE_TIME) { game.fires.splice(i, 1); continue; }
    const owner = game.players.get(f.owner) || null;
    for (const p of game.players.values()) {
      if (!p.alive || p.team === SPEC) continue;
      const d = Math.hypot(p.x - f.x, p.y - f.y);
      if (d > f.r || (d > 24 && !game.map.clearLine(f.x, f.y, p.x, p.y))) continue;
      const acc = (f.acc.get(p.id) || 0) + FIRE_DPS * dt;
      if (acc >= FIRE_DPS * 0.25) {
        f.acc.set(p.id, 0);
        damagePlayer(game, p, owner, acc, 1, 'molo', {});
      } else f.acc.set(p.id, acc);
    }
  }
}
