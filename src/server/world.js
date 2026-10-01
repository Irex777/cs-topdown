// Explosions and destruction: damage to soldiers, vehicles, gadgets and — voxel by voxel — the terrain itself.
import { TILE, SPEC } from '../shared/constants.js';
import { TILES } from '../shared/gamemap.js';
import { damagePlayer } from './combat.js';
import { damageVehicle } from './vehicles.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * o: { x, y, radius, dmg (soldiers), veh (vehicles), tile (structures), owner, wid, kind, hitVeh, hitPlayer, air }
 * kind is the effect name sent to clients ('he', 'rocket', 'shell', 'c4', 'mine', 'barrel', 'veh', 'ugl', 'claymore').
 */
export function explode(game, o) {
  const { x, y, radius } = o;
  const owner = o.owner || null;
  const z = Number.isFinite(o.z) ? o.z : game.map.heightAt(x, y) + 8;
  game.emit(['boom', o.kind || 'he', Math.round(x), Math.round(y), Math.round(radius), Math.round(z)], x, y, 6000);
  // ---- soldiers
  if (o.dmg > 0) {
    for (const p of [...game.players.values()]) {
      if (!p.alive || p.team === SPEC || p.veh) continue;
      const d = Math.hypot(p.x - x, p.y - y, z - p.z - 14);
      if (d > radius) continue;
      if (d > 26 && !game.map.los(x, y, p.x, p.y, z + 4, p.z + 14)) continue;
      const fall = p === o.hitPlayer ? 1 : Math.pow(1 - d / radius, 0.85);
      if (p.alive && d > 1) { p.vx += (p.x - x) / d * fall * 110; p.vy += (p.y - y) / d * fall * 110; p.vz += fall * 65; }
      damagePlayer(game, p, owner, o.dmg * fall + 2, o.wid, { expl: true, angle: Math.atan2(p.y - y, p.x - x) });
    }
  }
  // ---- vehicles
  if (o.veh > 0) {
    for (const v of [...game.vehicles]) {
      if (v.dead) continue;
      const d = Math.max(0, Math.hypot(v.x - x, v.y - y, z - v.z - (v.def.zr[0] + v.def.zr[1]) / 2) - v.def.hr);
      if (d > radius) continue;
      if (v.def.kind === 'air' && v.z > game.map.heightAt(v.x, v.y) + 80 && !o.air && v !== o.hitVeh) continue;   // ground blasts do not reach a helicopter in the air
      const fall = v === o.hitVeh ? 1 : 0.3 + 0.7 * clamp(1 - d / radius, 0, 1);
      const mass = { tank: 55000, apc: 18000, jeep: 3800, quad: 350, heli: 5000, boat: 1700 }[v.type] || 3000;
      const kick = Math.min(90, o.veh * 200 / mass) * fall;
      const horizontal = Math.hypot(v.x - x, v.y - y) || 1;
      v.vx += (v.x - x) / horizontal * kick; v.vy += (v.y - y) / horizontal * kick;
      damageVehicle(game, v, o.veh * fall * v.def.resist.expl, owner, o.wid, 'expl');
    }
  }
  // ---- deployables
  for (const g of [...game.gadgets]) {
    if (Math.hypot(g.x - x, g.y - y, z - (g.z ?? game.map.heightAt(g.x, g.y))) > radius * 0.8) continue;
    if (g.type === 'c4' && o.kind === 'c4') continue;
    game.removeGadget(g, owner, true);
  }
  // ---- terrain
  game.physics?.blastBodies(x, y, z, radius, o.tile || o.dmg || 100, owner);
  if (o.tile > 0) {
    const previous = game.physics?.blast;
    if (game.physics) game.physics.blast = { x, y, z, radius, power: o.tile };
    blastTiles(game, x, y, z, radius, o.tile, owner);
    game.physics?.damageRoofs(x, y, z, radius, o.tile);
    game.physics?.crater(x, y, z, radius, o.tile);
    if (game.physics) game.physics.blast = previous;
  }
}

function blastTiles(game, x, y, z, radius, power, owner) {
  const map = game.map;
  const r = radius + TILE * 0.55;
  const tx0 = Math.floor((x - r) / TILE), tx1 = Math.floor((x + r) / TILE);
  const ty0 = Math.floor((y - r) / TILE), ty1 = Math.floor((y + r) / TILE);
  const barrels = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!map.isDestructible(tx, ty)) continue;
      const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
      const horizontal = Math.hypot(cx - x, cy - y);
      const base = map.heightAt(cx, cy), top = base + map.top[ty * map.w + tx];
      const d = Math.hypot(horizontal, Math.max(0, base - z, z - top));
      if (d > r) continue;
      if (d > TILE * 0.9) {
        // only the first solid tile along the ray takes damage, so a blast eats into a wall layer by layer
        const targetZ = clamp(z, base + 1, top - 1);
        const hit = map.castBullet(x, y, z + 4, (cx - x) / horizontal, (cy - y) / horizontal, (targetZ - z - 4) / horizontal, horizontal + 2, map.solid);
        if (!(hit.tx === tx && hit.ty === ty)) continue;
      }
      const dmg = power * (1 - d / r);
      if (dmg <= 0) continue;
      const ch = map.chars[ty * map.w + tx];
      if (map.damageTile(tx, ty, dmg) && TILES[ch].explosive) barrels.push([cx, cy]);
    }
  }
  if (barrels.length && game.explDepth < 5) {
    game.explDepth++;
    for (const [bx, by] of barrels) explode(game, { x: bx, y: by, radius: 95, dmg: 70, veh: 60, tile: 150, owner, wid: 'barrel', kind: 'barrel' });
    game.explDepth--;
  }
}

/** Damage a structure along a projectile's endpoint. */
export function impactTile(game, tx, ty, dmg) {
  return game.map.damageTile(tx, ty, dmg);
}
