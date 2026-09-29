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
  game.emit(['boom', o.kind || 'he', Math.round(x), Math.round(y), Math.round(radius)], x, y, 6000);
  // ---- soldiers
  if (o.dmg > 0) {
    for (const p of [...game.players.values()]) {
      if (!p.alive || p.team === SPEC || p.veh) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > radius) continue;
      if (d > 26 && !game.map.los(x, y, p.x, p.y)) continue;
      const fall = p === o.hitPlayer ? 1 : Math.pow(1 - d / radius, 0.85);
      damagePlayer(game, p, owner, o.dmg * fall + 2, o.wid, { expl: true, angle: Math.atan2(p.y - y, p.x - x) });
    }
  }
  // ---- vehicles
  if (o.veh > 0) {
    for (const v of [...game.vehicles]) {
      if (v.dead) continue;
      const d = Math.max(0, Math.hypot(v.x - x, v.y - y) - v.def.r);
      if (d > radius) continue;
      if (v.def.kind === 'air' && !o.air && v !== o.hitVeh) continue;   // ground blasts do not reach a helicopter in the air
      const fall = v === o.hitVeh ? 1 : 0.3 + 0.7 * clamp(1 - d / radius, 0, 1);
      damageVehicle(game, v, o.veh * fall * v.def.resist.expl, owner, o.wid, 'expl');
    }
  }
  // ---- deployables
  for (const g of [...game.gadgets]) {
    if (Math.hypot(g.x - x, g.y - y) > radius * 0.8) continue;
    if (g.type === 'c4' && o.kind === 'c4') continue;
    game.removeGadget(g, owner, true);
  }
  // ---- terrain
  if (o.tile > 0) blastTiles(game, x, y, radius, o.tile, owner);
}

function blastTiles(game, x, y, radius, power, owner) {
  const map = game.map;
  const r = radius + TILE * 0.55;
  const tx0 = Math.floor((x - r) / TILE), tx1 = Math.floor((x + r) / TILE);
  const ty0 = Math.floor((y - r) / TILE), ty1 = Math.floor((y + r) / TILE);
  const barrels = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!map.isDestructible(tx, ty)) continue;
      const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
      const d = Math.hypot(cx - x, cy - y);
      if (d > r) continue;
      if (d > TILE * 0.9) {
        // only the first solid tile along the ray takes damage, so a blast eats into a wall layer by layer
        const hit = map.castTile(x, y, (cx - x) / d, (cy - y) / d, d + 2, map.solid);
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

/** Damage the terrain along a bullet's endpoint (tank machine guns do not do this; used by cannon shells that hit walls). */
export function impactTile(game, tx, ty, dmg) {
  return game.map.damageTile(tx, ty, dmg);
}
