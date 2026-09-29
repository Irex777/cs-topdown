// Rockets, tank shells and other physical projectiles.
import { DT, SPEC, PLAYER_R } from '../shared/constants.js';
import { PROJ } from '../shared/weapons.js';
import { rayCircle, angleDiff } from '../shared/gamemap.js';
import { explode } from './world.js';

export const PROJ_TYPES = Object.keys(PROJ);

const KIND = { rpg: 'rocket', smaw: 'rocket', stinger: 'rocket', cannon: 'shell', apcgun: 'shell', hrocket: 'rocket', ugl: 'ugl', torpedo: 'rocket' };

export function spawnProjectile(game, o) {
  const pr = PROJ[o.type];
  const owner = o.owner || null;
  game.projectiles.push({
    id: game.nextId++, type: o.type, idx: PROJ_TYPES.indexOf(o.type), owner: owner ? owner.id : 0, team: owner ? owner.team : (o.veh ? o.veh.team : -1),
    x: o.x, y: o.y, a: o.ang, vx: Math.cos(o.ang) * pr.speed, vy: Math.sin(o.ang) * pr.speed, t: 0, life: o.life || pr.life,
    veh: o.veh ? o.veh.id : 0, target: o.target || 0, air: !!o.air, dist: o.dist || 0,
  });
  if (!o.quiet) game.emit(['launch', PROJ_TYPES.indexOf(o.type), Math.round(o.x), Math.round(o.y), Math.round(o.ang * 1000) / 1000], o.x, o.y, 2400);
}

export function updateProjectiles(game, dt) {
  const map = game.map;
  const list = game.projectiles;
  for (let i = list.length - 1; i >= 0; i--) {
    const pj = list[i];
    const pr = PROJ[pj.type];
    pj.t += dt;
    const owner = game.players.get(pj.owner) || null;
    // homing (Stinger): steer toward the locked vehicle
    if (pr.homing && pj.target) {
      const tv = game.vehicles.find((v) => v.id === pj.target && !v.dead);
      if (tv) {
        const want = Math.atan2(tv.y - pj.y, tv.x - pj.x);
        const turn = Math.max(-pr.homing * dt, Math.min(pr.homing * dt, angleDiff(want, pj.a)));
        pj.a += turn;
        const sp = Math.hypot(pj.vx, pj.vy);
        pj.vx = Math.cos(pj.a) * sp; pj.vy = Math.sin(pj.a) * sp;
      }
    }
    // grenades fired with a target distance stop where they were aimed
    const step = Math.hypot(pj.vx, pj.vy) * dt;
    const dx = pj.vx * dt / Math.max(1e-6, step), dy = pj.vy * dt / Math.max(1e-6, step);
    let hitD = step, hitKind = 0, hitP = null, hitV = null;
    // walls (bullets and rockets fly over see-through props? no: everything solid stops a rocket)
    const wall = map.castTile(pj.x, pj.y, dx, dy, step + 2, map.solid);
    if (wall.tx >= 0) { hitD = Math.max(0, wall.d - 3); hitKind = 1; }
    // soldiers
    for (const p of game.players.values()) {
      if (!p.alive || p.veh || p.team === SPEC || p.spawnProt > 0) continue;
      if (p.id === pj.owner && pj.t < 0.25) continue;
      if (p.team === pj.team && !game.ff && p.id !== pj.owner) continue;
      if (Math.abs(p.x - pj.x) > step + 20 || Math.abs(p.y - pj.y) > step + 20) continue;
      const d = rayCircle(pj.x, pj.y, dx, dy, p.x, p.y, PLAYER_R + pr.radius);
      if (d >= 0 && d < hitD) { hitD = d; hitKind = 2; hitP = p; }
    }
    // vehicles
    for (const v of game.vehicles) {
      if (v.dead || (v.id === pj.veh && pj.t < 0.3)) continue;
      if (v.team === pj.team && v.team >= 0 && !game.ff && v.id !== pj.veh) continue;
      if (v.def.kind === 'air' && pr.air === 0) continue;
      if (Math.abs(v.x - pj.x) > step + v.def.r + 10 || Math.abs(v.y - pj.y) > step + v.def.r + 10) continue;
      const d = rayCircle(pj.x, pj.y, dx, dy, v.x, v.y, v.def.r * 0.95 + pr.radius);
      if (d >= 0 && d < hitD) { hitD = d; hitKind = 3; hitV = v; hitP = null; }
    }
    if (hitKind) {
      pj.x += dx * hitD; pj.y += dy * hitD;
      list.splice(i, 1);
      detonate(game, pj, pr, owner, hitV, hitP);
      continue;
    }
    pj.x += dx * step; pj.y += dy * step;
    pj.dist += step;
    if (pj.t >= pj.life) { list.splice(i, 1); detonate(game, pj, pr, owner, null, null); }
  }
}

function detonate(game, pj, pr, owner, hitV, hitP) {
  const airMul = hitV && hitV.def.kind === 'air' ? (pr.air || 1) : 1;
  explode(game, {
    x: pj.x, y: pj.y, radius: pr.expl, dmg: pr.dmg, veh: pr.veh * airMul, tile: pr.tile, owner, wid: pj.type, kind: KIND[pj.type] || 'rocket',
    hitVeh: hitV, hitPlayer: hitP, air: pr.air !== 0,
  });
}
