// Class gadgets: defibrillator, repair tool, medic bag, ammo crate, mines, claymores, C4, beacons, sensors, rocket launchers.
import { DT, RULES, SPEC } from '../shared/constants.js';
import { AIR_DEFENSE, CLASSES } from '../shared/weapons.js';
import { canSee } from '../shared/vision.js';
import { angleDiff } from '../shared/gamemap.js';
import { explode } from './world.js';
import { spawnProjectile } from './projectiles.js';
import { startReload } from './combat.js';
import { repairVehicle } from './vehicles.js';
import { updateAirLock } from './air-defense.js';

const MAX_C4 = 3;

export function useGadget(game, p, g, held, edge, aimDist, keys) {
  const def = g.def;
  const scopeEdge = (keys & 64) !== 0 && !p.prevScope;
  p.prevScope = (keys & 64) !== 0;
  if (p.drawT > 0) { p.reviveProg = 0; return; }
  switch (def.kind) {
    case 'defib': return defib(game, p, held);
    case 'repair': return repair(game, p, held);
    case 'launcher': return launcher(game, p, g, held, edge, keys);
    case 'c4':
      if (scopeEdge) detonateC4(game, p);
      if (edge && p.fireCd <= 0 && g.charges > 0) placeC4(game, p, g, aimDist);
      return;
    default:
      if (edge && p.fireCd <= 0 && g.charges > 0) deploy(game, p, g);
  }
}

// ------------------------------------------------------------------------------------------ defibrillator
function defib(game, p, held) {
  if (!held) { p.reviveProg = 0; return; }
  const c = game.nearestCorpse(p, 48);
  if (!c) { p.reviveProg = 0; return; }
  if (p.speed > 60) { p.reviveProg = 0; return; }
  if (p.reviveProg === 0) game.emit(['defib', p.id, Math.round(p.x), Math.round(p.y)], p.x, p.y, 900);
  p.reviveProg += DT;
  if (p.reviveProg >= RULES.reviveTime) { p.reviveProg = 0; game.revive(c, p); }
}

// ------------------------------------------------------------------------------------------ repair tool
function repair(game, p, held) {
  if (!held) { p.repairAcc = 0; return; }
  let best = null, bd = Infinity;
  for (const v of game.vehicles) {
    if (v.dead || v.hp >= v.def.hp) continue;
    if (v.team !== p.team && v.occupants().length) continue;
    const d = Math.hypot(v.x - p.x, v.y - p.y) - v.def.r;
    if (d < 64 && d < bd) { bd = d; best = v; }
  }
  if (!best) return;
  const got = repairVehicle(best, 75 * DT);
  p.repairAcc += got;
  if (p.repairAcc >= 60) { p.repairAcc -= 60; game.addScore(p, RULES.score.repair, 'Repair'); p.stats.repairs++; }
  if (game.tick % 12 === 0) game.emit(['repair', Math.round(best.x), Math.round(best.y)], best.x, best.y, 900);
}

// ------------------------------------------------------------------------------------------ launchers
function launcher(game, p, g, held, edge, keys) {
  const def = g.def;
  if (def.aa) updateAirLock(game, p, (keys & 64) !== 0);
  if (!(edge || held) || p.fireCd > 0 || p.reloadT > 0) return;
  if (!g.loaded) { if (g.charges > 0) startReload(game, p); return; }
  const locked = def.aa && p.lockTarget && p.lockT >= AIR_DEFENSE.lockTime;
  if (def.aa && !locked) return;
  g.loaded = false;
  p.fireCd = def.cd;
  p.lastShot = game.time; p.spawnProt = 0;
  const ox = p.x + Math.cos(p.angle) * 16, oy = p.y + Math.sin(p.angle) * 16;
  spawnProjectile(game, { type: def.proj, owner: p, x: ox, y: oy, ang: p.angle, target: locked ? p.lockTarget : 0 });
  p.lockTarget = 0; p.lockT = 0;
  game.emit(['blast', Math.round(p.x), Math.round(p.y), Math.round(p.angle * 100) / 100], p.x, p.y, 700);
  if (g.charges > 0) startReload(game, p);
}

// ------------------------------------------------------------------------------------------ deployables
function deploy(game, p, g) {
  const def = g.def;
  const dx = Math.cos(p.angle), dy = Math.sin(p.angle);
  let x = p.x + dx * 24, y = p.y + dy * 24;
  if (!game.map.clearLine(p.x, p.y, x, y) ) { x = p.x; y = p.y; }
  if (def.id === 'beacon' && p.speed > 40) return;
  // limits
  const mine = game.gadgets.filter((q) => q.owner === p.id && q.type === def.id);
  const limit = def.id === 'mine' ? 5 : def.id === 'claymore' ? 4 : def.id === 'beacon' ? 1 : def.id === 'sensor' ? 2 : 3;
  if (mine.length >= limit) game.removeGadget(mine[0], null, false);
  g.charges--;
  p.fireCd = 0.6;
  game.gadgets.push({
    id: game.nextId++, type: def.id, owner: p.id, team: p.team, squad: p.squad, x, y, z: game.map.heightAt(x, y), a: p.angle, t0: game.time,
    life: def.life || 0, arm: def.id === 'mine' ? 1.2 : def.id === 'claymore' ? 1.5 : 0, acc: 0, hp: 60, attach: 0, tick: 0,
  });
  game.emit(['deploy', p.id, def.id, Math.round(x), Math.round(y)], x, y, 900);
  if (def.id === 'beacon') game.emit(['beaconup', p.team], x, y, 0, 0);
  if (g.charges <= 0 && def.kind === 'deploy' && def.charges > 1) { /* keep the empty slot selected: recharge on resupply */ }
}

function placeC4(game, p, g, aimDist) {
  const mine = game.gadgets.filter((q) => q.owner === p.id && q.type === 'c4');
  if (mine.length >= MAX_C4) return;
  const d = Math.max(24, Math.min(150, aimDist || 60));
  let x = p.x + Math.cos(p.angle) * d, y = p.y + Math.sin(p.angle) * d;
  if (!game.map.clearLine(p.x, p.y, x, y)) { x = p.x; y = p.y; }
  let attach = 0, ox = 0, oy = 0, z = game.map.heightAt(x, y) + 2;
  for (const v of game.vehicles) {
    if (v.dead || Math.abs(v.z + (v.def.zr[0] + v.def.zr[1]) / 2 - p.eyeZ) > 64) continue;
    if (Math.hypot(v.x - x, v.y - y) < v.def.r + 10) { attach = v.id; z = v.z + (v.def.zr[0] + v.def.zr[1]) / 2; ox = x - v.x; oy = y - v.y; break; }
  }
  g.charges--;
  p.fireCd = 0.5;
  game.gadgets.push({ id: game.nextId++, type: 'c4', owner: p.id, team: p.team, squad: p.squad, x, y, z, a: 0, t0: game.time, life: 0, arm: 0.4, hp: 40, attach, ox, oy, tick: 0 });
  game.emit(['deploy', p.id, 'c4', Math.round(x), Math.round(y)], x, y, 900);
}

export function detonateC4(game, p) {
  const list = game.gadgets.filter((q) => q.owner === p.id && q.type === 'c4' && game.time - q.t0 > q.arm);
  for (const q of list) game.removeGadget(q, p, true);
  if (list.length) game.emit(['click', p.id], p.x, p.y, 400);
}

// ------------------------------------------------------------------------------------------ per-tick behaviour
export function updateGadgets(game, dt) {
  const list = game.gadgets;
  const drop = (q) => { const k = list.indexOf(q); if (k >= 0) list.splice(k, 1); };
  for (const q of [...list]) {
    if (!list.includes(q)) continue;
    if (q.life && game.time - q.t0 > q.life) { drop(q); continue; }
    const owner = game.players.get(q.owner) || null;
    if (q.attach) {
      const v = game.vehicles.find((x) => x.id === q.attach && !x.dead);
      if (v) { q.x = v.x + q.ox; q.y = v.y + q.oy; q.z = v.z + (v.def.zr[0] + v.def.zr[1]) / 2; } else q.attach = 0;
    }
    const armed = game.time - q.t0 >= q.arm;
    switch (q.type) {
      case 'medkit': {
        q.tick += dt;
        for (const p of game.players.values()) {
          if (!p.alive || p.veh || p.team !== q.team || p.hp >= 100) continue;
          if (Math.hypot(p.x - q.x, p.y - q.y) > 110) continue;
          const heal = Math.min(100 - p.hp, 16 * dt);
          p.hp += heal;
          if (owner && owner !== p) { q.acc += heal; if (q.acc >= 50) { q.acc -= 50; game.addScore(owner, RULES.score.heal, 'Heal'); owner.stats.heals++; } }
        }
        break;
      }
      case 'ammo': {
        q.tick += dt;
        if (q.tick >= 1) {
          q.tick = 0;
          for (const p of game.players.values()) {
            if (!p.alive || p.veh || p.team !== q.team) continue;
            if (Math.hypot(p.x - q.x, p.y - q.y) > 110) continue;
            const maxAr = (CLASSES[p.cls] && CLASSES[p.cls].armor) || 0;
            const armored = p.armor < maxAr; if (armored) p.armor = Math.min(maxAr, p.armor + 12);
            if ((p.resupply(0.34) || armored) && owner && owner !== p) game.addScore(owner, RULES.score.resupply, 'Resupply');
          }
        }
        break;
      }
      case 'mine': {
        if (!armed) break;
        for (const v of game.vehicles) {
          if (v.dead || v.def.kind === 'air' || v.speed < 25) continue;
          if (v.team === q.team && !game.ff) continue;
          if (Math.hypot(v.x - q.x, v.y - q.y) < v.def.r + 8) {
            drop(q);
            explode(game, { x: q.x, y: q.y, radius: 95, dmg: 40, veh: 520, tile: 140, owner, wid: 'mine', kind: 'mine', hitVeh: v });
            break;
          }
        }
        break;
      }
      case 'claymore': {
        if (!armed) break;
        let trig = false;
        for (const p of game.players.values()) {
          if (!p.alive || p.veh || p.team === q.team || p.team === SPEC || p.spawnProt > 0) continue;
          const d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d > 150) continue;
          if (Math.abs(angleDiff(Math.atan2(p.y - q.y, p.x - q.x), q.a)) > 0.75) continue;
          if (!game.map.los(q.x, q.y, p.x, p.y)) continue;
          trig = true; break;
        }
        if (trig) { drop(q); explode(game, { x: q.x, y: q.y, radius: 140, dmg: 105, veh: 60, tile: 70, owner, wid: 'claymore', kind: 'claymore' }); }
        break;
      }
      case 'sensor': {
        q.tick += dt;
        if (q.tick >= 0.4) {
          q.tick = 0;
          for (const p of game.players.values()) {
            if (!p.alive || p.team === q.team || p.team === SPEC || p.veh) continue;
            if (Math.hypot(p.x - q.x, p.y - q.y) > 340) continue;
            if (p.speed > 45 || game.time - p.lastShot < 1.2) p.spotUntil = Math.max(p.spotUntil, game.time + 1.2);
          }
        }
        break;
      }
      default: break;
    }
  }
}

/** Does the team's own gadget list contain something the enemy may see from here? */
export function gadgetVisibleToEnemy(game, q, viewers) {
  for (const p of viewers) {
    if (!p.alive) continue;
    if (Math.hypot(p.x - q.x, p.y - q.y) < 900 && canSee(game.map, game.smokes, p.x, p.y, p.angle, { range: 900, fov: 6.3 }, q.x, q.y, 0, 6)) return true;
  }
  return false;
}
