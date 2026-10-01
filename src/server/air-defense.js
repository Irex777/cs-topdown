import { DT } from '../shared/constants.js';
import { AIR_DEFENSE } from '../shared/weapons.js';
import { lineClear } from '../shared/vision.js';

export function updateAirLock(game, p, aiming) {
  let best = null, error = AIR_DEFENSE.cone;
  if (aiming && p.reloadT <= 0 && p.gadget()?.loaded) {
    const cp = Math.cos(p.pitch), dx = Math.cos(p.angle) * cp, dy = Math.sin(p.angle) * cp, dz = Math.sin(p.pitch);
    for (const v of game.vehicles) {
      if (v.dead || v.def.kind !== 'air' || v.team < 0 || v.team === p.team || v.flareUntil > game.time) continue;
      const x = v.x - p.x, y = v.y - p.y, z = v.z + (v.def.zr[0] + v.def.zr[1]) / 2 - p.eyeZ;
      const distance = Math.hypot(x, y, z);
      if (distance < 1 || distance > AIR_DEFENSE.range) continue;
      const angle = Math.acos(Math.max(-1, Math.min(1, (x * dx + y * dy + z * dz) / distance)));
      if (angle >= error || !lineClear(game.map, game.smokes, p.x, p.y, v.x, v.y, p.eyeZ, p.eyeZ + z)) continue;
      error = angle; best = v;
    }
  }
  if (best) { p.lockT = p.lockTarget === best.id ? Math.min(AIR_DEFENSE.lockTime, p.lockT + DT) : DT; p.lockTarget = best.id; }
  else { p.lockTarget = 0; p.lockT = 0; }
}

export function airThreat(game, v) {
  if (game.projectiles.some((p) => p.type === 'stinger' && p.target === v.id)) return 'incoming';
  if ([...game.players.values()].some((p) => p.alive && p.lockTarget === v.id && p.lockT > 0)) return 'locking';
  return '';
}

export function deployFlares(game, p) {
  const v = p.alive && p.veh && game.vehicleById(p.veh);
  if (!v || v.dead || v.def.kind !== 'air' || p.seat !== 0 || v.flareAmmo <= 0 || v.flareCd > 0) return false;
  v.flareAmmo--; v.flareCd = AIR_DEFENSE.flareCooldown; v.flareUntil = game.time + AIR_DEFENSE.flareLife;
  const burst = [];
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1, a = v.a + Math.PI + side * (.45 + Math.floor(i / 2) * .3);
    const flare = { id: game.nextId++, veh: v.id, x: v.x - Math.cos(v.a) * 22, y: v.y - Math.sin(v.a) * 22, z: v.z + 18, vx: v.vx + Math.cos(a) * 90, vy: v.vy + Math.sin(a) * 90, vz: 25 + Math.floor(i / 2) * 15, life: AIR_DEFENSE.flareLife };
    game.flares.push(flare); burst.push(flare);
  }
  for (const pj of game.projectiles) if (pj.type === 'stinger' && pj.target === v.id) { pj.target = 0; pj.decoy = burst[pj.id % burst.length].id; }
  for (const soldier of game.players.values()) if (soldier.lockTarget === v.id) { soldier.lockTarget = 0; soldier.lockT = 0; }
  game.emit(['flares', v.id, Math.round(v.x), Math.round(v.y), Math.round(v.z + 18)], v.x, v.y, 2600);
  return true;
}

export function updateFlares(game, dt) {
  for (const f of game.flares) {
    f.life -= dt; f.vz -= 38 * dt;
    f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
    if (f.z <= game.map.heightAt(f.x, f.y)) f.life = 0;
  }
  game.flares = game.flares.filter((f) => f.life > 0);
}
