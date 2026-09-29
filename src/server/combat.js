// Shooting, reloading, weapon switching, damage and kills.
import { DT, PLAYER_R, SPEC, RULES, GREN_ORDER } from '../shared/constants.js';
import { WEAPONS, weaponSpread, applyArmor } from '../shared/weapons.js';
import { rayCircle, angleDiff } from '../shared/gamemap.js';
import { throwGrenade } from './grenades.js';

const MAX_RANGE = 2600;
const tmp = { x: 0, y: 0, alive: false };

export function tickWeaponTimers(game, p, dt) {
  p.fixSelection();
  if (p.fireCd > 0) p.fireCd -= dt;
  if (p.drawT > 0) p.drawT -= dt;
  if (p.clickBuf > 0) p.clickBuf -= dt;
  p.burstT += dt;
  if (p.burstT > 0.22 && p.burst > 0) p.burst = Math.max(0, p.burst - dt * 9);
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) {
      p.reloadT = 0;
      const w = p.weapon();
      if (w && w.kind !== 'knife') {
        const am = p.ammoOf(w);
        const fill = Math.min(w.mag - am.clip, am.reserve);
        am.clip += fill; am.reserve -= fill;
      }
    }
  }
}

export function startReload(game, p) {
  const w = p.weapon();
  if (!w || w.kind === 'knife' || p.reloadT > 0 || !p.alive) return;
  const am = p.ammoOf(w);
  if (am.clip >= w.mag || am.reserve <= 0) return;
  p.reloadT = w.reload;
  p.reloadTotal = w.reload;
  p.scoped = false;
  game.emit(['rel', p.id, Math.round(p.x), Math.round(p.y), w.idx], p.x, p.y, 700);
}

export function selectSlot(game, p, slot) {
  if (!p.alive) return;
  if (slot === 'last') slot = p.lastSel;
  if (slot === 'primary' && !p.primary) return;
  if (slot === 'secondary' && !p.secondary) return;
  if (slot === 'grenade') {
    const owned = GREN_ORDER.filter((k) => p.grenades[k] > 0);
    if (!owned.length) return;
    if (p.sel === 'grenade') {
      const i = owned.indexOf(p.gsel);
      p.gsel = owned[(i + 1) % owned.length];
    } else p.gsel = owned.includes(p.gsel) ? p.gsel : owned[0];
  } else if (slot === p.sel) return;
  if (p.sel !== slot) p.lastSel = p.sel;
  p.sel = slot;
  p.reloadT = 0;
  p.scoped = false;
  const w = p.weapon();
  p.drawT = w ? w.draw : 0.25;
  p.burst = 0;
}

/** Called every applied input command while the player is alive. */
export function tryFire(game, p, held, edge, vt, aimDist) {
  if (edge) p.clickBuf = 0.14;
  if (!held && !(p.clickBuf > 0)) return;
  if (p.drawT > 0) return;
  if (p.sel === 'grenade') { if (edge) throwGrenade(game, p, aimDist); return; }
  const w = p.weapon();
  if (!w || p.fireCd > 0) return;
  if (w.kind === 'knife') { if (held) swingKnife(game, p, w); return; }
  if (p.reloadT > 0) return;
  if (!w.auto && !(p.clickBuf > 0)) return;
  if (w.auto && !held) return;
  const am = p.ammoOf(w);
  if (am.clip <= 0) {
    if (am.reserve > 0) startReload(game, p);
    else if (edge) game.emit(['empty', p.id], p.x, p.y, 0, p.id);
    return;
  }
  am.clip--;
  p.clickBuf = 0;
  p.fireCd = w.cd;
  const spread = weaponSpread(w, p.speed, p.burst, p.scoped);
  p.burst++; p.burstT = 0;
  p.scoped = p.scoped && w.scope > 0;

  // lag compensation: shoot against where the client saw the other players
  let tf = 0;
  if (vt > 0 && game.time - vt < 0.4 && vt <= game.time + 0.05) tf = vt / DT;
  const ox = p.x, oy = p.y;
  const shotgun = w.pellets > 1;
  for (let i = 0; i < w.pellets; i++) {
    const off = shotgun ? (Math.random() * 2 - 1) * spread : (Math.random() + Math.random() - 1) * spread;
    const ang = p.angle + off;
    const r = castBullet(game, p, ox, oy, ang, tf);
    let kind = r.wall ? 1 : 0;
    if (r.target) {
      kind = 2;
      const dmg = w.dmg * Math.pow(w.rangeMod, r.dist / 345);
      const dealt = damagePlayer(game, r.target, p, dmg, w.ap, w.id, { angle: ang });
      if (dealt > 0 && p.conn) game.emit(['hitm', Math.round(dealt), r.target.alive ? 0 : 1], 0, 0, 0, p.id);
    }
    game.emit(['shot', p.id, w.idx, Math.round(ox), Math.round(oy), Math.round(ang * 1000) / 1000, Math.round(r.dist), kind, i === 0 ? 0 : 1, w.suppressed ? 1 : 0], ox, oy, 2000);
  }
  if (am.clip <= 0 && am.reserve > 0 && w.kind !== 'sniper') { /* auto-reload happens on next trigger pull */ }
}

function castBullet(game, shooter, ox, oy, ang, tf) {
  const map = game.map;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const wallD = map.castDist(ox, oy, dx, dy, MAX_RANGE);
  let best = wallD, target = null;
  for (const q of game.players.values()) {
    if (q === shooter || !q.alive || q.team === SPEC || q.spawnProt > 0) continue;
    if (q.team === shooter.team && !game.ff) continue;
    let qx = q.x, qy = q.y;
    if (tf > 0) { q.rewound(tf, tmp); if (!tmp.alive) continue; qx = tmp.x; qy = tmp.y; }
    if (Math.abs(qx - ox) > best + PLAYER_R || Math.abs(qy - oy) > best + PLAYER_R) continue;
    const d = rayCircle(ox, oy, dx, dy, qx, qy, PLAYER_R);
    if (d >= 0 && d < best) { best = d; target = q; }
  }
  return { dist: best, target, wall: !target && wallD < MAX_RANGE };
}

function swingKnife(game, p, w) {
  p.fireCd = w.cd;
  let best = null, bd = Infinity;
  for (const q of game.players.values()) {
    if (q === p || !q.alive || q.team === SPEC || q.spawnProt > 0) continue;
    if (q.team === p.team && !game.ff) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d > w.reach + PLAYER_R) continue;
    if (Math.abs(angleDiff(Math.atan2(q.y - p.y, q.x - p.x), p.angle)) > 0.9) continue;
    if (!game.map.los(p.x, p.y, q.x, q.y)) continue;
    if (d < bd) { bd = d; best = q; }
  }
  game.emit(['knife', p.id, Math.round(p.x), Math.round(p.y), Math.round(p.angle * 100) / 100, best ? 1 : 0], p.x, p.y, 900);
  if (!best) return;
  const back = Math.abs(angleDiff(p.angle, best.angle)) < 1.2;
  const dealt = damagePlayer(game, best, p, back ? w.backstab : w.dmg, 0.85, 'knife', { angle: p.angle });
  if (dealt > 0 && p.conn) game.emit(['hitm', Math.round(dealt), best.alive ? 0 : 1], 0, 0, 0, p.id);
}

/**
 * Applies damage with armour. `attacker` may be null (world/bomb). Returns health damage dealt.
 * wid is a weapon id or one of 'he', 'molo', 'bomb', 'knife'.
 */
export function damagePlayer(game, v, attacker, raw, ap, wid, o = {}) {
  if (!v.alive || v.spawnProt > 0) return 0;
  const self = !!attacker && attacker.id === v.id;
  const friendly = !!attacker && !self && attacker.team === v.team;
  if (friendly && !game.ff) return 0;
  let [hp, ar] = applyArmor(raw, ap, v.armor);
  if (ar > 0) { v.armor = Math.max(0, v.armor - ar); if (v.armor <= 0) v.helmet = false; }
  hp = Math.min(hp, v.hp);
  v.hp -= hp;
  if (attacker && !self) {
    if (!friendly) { attacker.stats.damage += hp; attacker.roundDamage += hp; }
    v.dmgFrom.set(attacker.id, (v.dmgFrom.get(attacker.id) || 0) + hp);
  }
  if (!o.quiet) {
    const from = attacker && !self ? Math.atan2(attacker.y - v.y, attacker.x - v.x) : (o.angle !== undefined ? o.angle + Math.PI : 0);
    game.emit(['hurt', Math.ceil(hp), Math.round(from * 100) / 100], v.x, v.y, 0, v.id);
  }
  if (v.hp <= 0.01) killPlayer(game, v, attacker, wid);
  return hp;
}

export function killPlayer(game, v, attacker, wid) {
  if (!v.alive) return;
  v.alive = false; v.hp = 0;
  v.planting = 0; v.defusing = 0;
  if (game.bomb.defuser === v.id) game.bomb.defuser = 0;
  const self = !attacker || attacker.id === v.id;
  const friendly = !self && attacker.team === v.team;
  v.stats.deaths++;
  // drop the primary weapon and the bomb
  if (v.primary) { game.dropWeapon(v, v.primary, 0); v.primary = null; }
  if (v.hasBomb) game.dropBomb(v);
  let assister = 0;
  if (!self && !friendly) {
    attacker.stats.kills++; attacker.roundKills++; attacker.stats.score += wid === 'knife' ? 3 : 2;
    const w = WEAPONS[wid];
    game.addMoney(attacker, wid === 'he' || wid === 'molo' ? 300 : w ? w.reward : 0);
    let bestD = 40;
    for (const [id, d] of v.dmgFrom) if (id !== attacker.id && d >= bestD) { bestD = d; assister = id; }
    const a = game.players.get(assister);
    if (a && a.team !== v.team) { a.stats.assists++; a.stats.score++; } else assister = 0;
    if (game.mode === 'dm') game.score[attacker.team]++;
  } else if (friendly) {
    attacker.stats.kills--; attacker.stats.score -= 1;
    game.addMoney(attacker, -RULES.teamkillPenalty);
  } else if (self) v.stats.score -= 1;
  game.broadcast({ t: 'kill', k: self ? 0 : attacker.id, v: v.id, w: wid, a: assister, tk: friendly ? 1 : 0 });
  game.emit(['die', v.id, Math.round(v.x), Math.round(v.y), Math.round(v.angle * 100) / 100, v.team], v.x, v.y, 99999);
  if (game.mode === 'dm') v.respawnAt = game.time + RULES.respawnDelay;
  // spectate: prefer the killer's teammate view, else a teammate
  v.specId = 0;
  game.room.sendRosterSoon();
  for (const b of game.players.values()) if (b.bot && b.alive) b.bot.onDeathSeen(v, attacker);
}
