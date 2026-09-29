// Shooting, reloading, weapon switching, damage, kills and revives.
import { DT, PLAYER_R, SPEC, RULES, GREN_ORDER, HEAD_FRAC, BODY_H, BODY_H_CROUCH } from '../shared/constants.js';
import { ALT, weaponSpread } from '../shared/weapons.js';
import { angleDiff } from '../shared/gamemap.js';
import { throwGrenade } from './grenades.js';
import { useGadget } from './gadgets.js';
import { spawnProjectile } from './projectiles.js';
import { damageVehicle } from './vehicles.js';

const MAX_RANGE = 2800;
const tmp = { x: 0, y: 0, z: 0, cf: 0, alive: false };
const HEAD_MUL = 2, LEG_MUL = 0.85;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

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
        const cap = p.altMode && w.alt ? ALT[w.alt].mag : w.mag;
        const fill = Math.min(cap - am.clip, am.reserve);
        am.clip += fill; am.reserve -= fill;
      } else {
        const g = p.gadget();
        if (g && g.def.kind === 'launcher' && g.charges > 0) { g.loaded = true; g.charges--; }
      }
    }
  }
  // health regenerates a few seconds after the last hit
  if (p.hp < 100 && game.time - p.lastHurt > RULES.regenDelay) p.hp = Math.min(100, p.hp + RULES.regenRate * dt);
}

export function startReload(game, p) {
  if (!p.alive || p.veh || p.reloadT > 0) return;
  const g = p.gadget();
  if (g && g.def.kind === 'launcher') {
    if (g.loaded || g.charges <= 0) return;
    p.reloadT = g.def.reload; p.reloadTotal = g.def.reload; p.scoped = false;
    return;
  }
  const w = p.weapon();
  if (!w || w.kind === 'knife') return;
  const am = p.ammoOf(w);
  const cap = p.altMode && w.alt ? ALT[w.alt].mag : w.mag;
  if (am.clip >= cap || am.reserve <= 0) return;
  const t = p.altMode && w.alt ? ALT[w.alt].reload : w.reload;
  p.reloadT = t;
  p.reloadTotal = t;
  p.scoped = false;
  game.emit(['rel', p.id, Math.round(p.x), Math.round(p.y), w.idx], p.x, p.y, 700);
}

const SLOTS = ['primary', 'secondary', 'gadget0', 'gadget1', 'grenade', 'knife'];
export function selectSlot(game, p, slot) {
  if (!p.alive || p.veh) return;
  if (slot === 'last') slot = p.lastSel;
  if (!SLOTS.includes(slot)) return;
  if (slot === 'primary' && !p.primaryW) return;
  if (slot === 'gadget0' && !p.gadgets[0]) return;
  if (slot === 'gadget1' && !p.gadgets[1]) return;
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
  p.reviveProg = 0; p.lockTarget = 0; p.lockT = 0;
  const w = p.weapon();
  p.drawT = w ? w.draw : 0.25;
  p.burst = 0;
}

export function toggleAlt(game, p) {
  const w = p.primaryW;
  if (!p.alive || p.veh || !w || !w.alt) return;
  p.altMode = !p.altMode;
  if (p.sel !== 'primary') selectSlot(game, p, 'primary');
  p.reloadT = 0; p.drawT = 0.25; p.scoped = false;
}

/** Called every applied input command while the player is alive and on foot. */
export function tryFire(game, p, held, edge, vt, aimDist, keys) {
  if (edge) p.clickBuf = 0.14;
  if (p.sprinting) return;
  const g = p.gadget();
  if (g) { useGadget(game, p, g, held, edge, aimDist, keys); return; }
  if (!held && !(p.clickBuf > 0)) return;
  if (p.drawT > 0) return;
  if (p.sel === 'grenade') { if (edge) throwGrenade(game, p, aimDist); return; }
  const w = p.weapon();
  if (!w || p.fireCd > 0) return;
  if (w.kind === 'knife') { if (held) swingKnife(game, p, w); return; }
  if (p.reloadT > 0) return;
  const alt = p.altMode && w.alt ? ALT[w.alt] : null;
  if (!alt) { if (!w.auto && !(p.clickBuf > 0)) return; if (w.auto && !held) return; }
  else if (!(p.clickBuf > 0)) return;
  const am = p.ammoOf(w);
  if (am.clip <= 0) {
    if (am.reserve > 0) startReload(game, p);
    else if (edge) game.emit(['empty', p.id], p.x, p.y, 0, p.id);
    return;
  }
  am.clip--;
  p.clickBuf = 0;
  p.lastShot = game.time;
  if (p.spawnProt > 0) p.spawnProt = 0;
  if (alt) { fireAlt(game, p, w, alt, vt, aimDist); return; }
  p.fireCd = w.cd;
  const spread = weaponSpread(w, p.speed, p.burst, p.scoped, p.cf, Math.abs(p.vz) > 1);
  p.burst++; p.burstT = 0;
  const tf = lagTick(game, vt);
  const ox = p.x, oy = p.y, oz = p.eyeZ;
  const shotgun = w.pellets > 1;
  for (let i = 0; i < w.pellets; i++) {
    const rr = shotgun ? Math.sqrt(Math.random()) * spread : (Math.random() + Math.random() - 1) * spread;
    const th = Math.random() * Math.PI * 2;
    const ang = p.angle + rr * Math.cos(th) / Math.max(0.2, Math.cos(p.pitch));
    const pit = clamp(p.pitch + rr * Math.sin(th), -1.5, 1.5);
    const r = castRay(game, ox, oy, oz, ang, pit, { range: MAX_RANGE, shooter: p, tf });
    let kind = r.tile ? 1 : 0;
    const fall = Math.pow(w.rangeMod, r.dist / 345);
    if (r.target) {
      kind = 2;
      const zone = r.head ? HEAD_MUL : r.leg ? LEG_MUL : 1;
      const dealt = damagePlayer(game, r.target, p, w.dmg * fall * zone, w.id, { angle: ang, head: r.head });
      if (dealt > 0 && p.conn) game.emit(['hitm', Math.round(dealt), r.target.alive ? 0 : 1, r.head ? 1 : 0], 0, 0, 0, p.id);
    } else if (r.veh) {
      kind = 3;
      const dmg = w.dmg * fall * w.vehMult * r.veh.def.resist.bullet;
      damageVehicle(game, r.veh, dmg, p, w.id, 'bullet');
      if (p.conn && i === 0) game.emit(['hitm', 1, 0, 0], 0, 0, 0, p.id);
    }
    emitShot(game, p, w.idx, ox, oy, oz, ang, pit, r, kind, i === 0 ? 0 : 1, w.suppressed ? 1 : 0, w.suppressed ? 700 : 2200);
  }
}

function emitShot(game, p, widx, ox, oy, oz, ang, pit, r, kind, sub, supp, radius) {
  game.emit(['shot', p.id, widx, Math.round(ox), Math.round(oy), Math.round(ang * 1000) / 1000, Math.round(r.dist), kind, sub, supp, Math.round(oz * 10) / 10, Math.round(pit * 1000) / 1000], ox, oy, radius);
}

function lagTick(game, vt) {
  if (vt > 0 && game.time - vt < 0.4 && vt <= game.time + 0.05) return vt / DT;
  return 0;
}

function fireAlt(game, p, w, alt, vt, aimDist) {
  p.fireCd = alt.cd;
  if (w.alt === 'ugl') {
    const dist = clamp(aimDist || 400, 90, 900);
    spawnProjectile(game, { type: 'ugl', owner: p, x: p.x + Math.cos(p.angle) * 14, y: p.y + Math.sin(p.angle) * 14, ang: p.angle, life: dist / 760 });
    return;
  }
  // masterkey: a short blast of pellets
  const spread = alt.spread * Math.PI / 180;
  const tf = lagTick(game, vt);
  const oz = p.eyeZ;
  for (let i = 0; i < alt.pellets; i++) {
    const rr = Math.sqrt(Math.random()) * spread, th = Math.random() * Math.PI * 2;
    const ang = p.angle + rr * Math.cos(th), pit = clamp(p.pitch + rr * Math.sin(th), -1.5, 1.5);
    const r = castRay(game, p.x, p.y, oz, ang, pit, { range: 600, shooter: p, tf });
    let kind = r.tile ? 1 : 0;
    if (r.target) { kind = 2; const dealt = damagePlayer(game, r.target, p, alt.dmg * Math.pow(0.72, r.dist / 345) * (r.head ? HEAD_MUL : 1), 'mk', { angle: ang, head: r.head }); if (dealt > 0 && p.conn) game.emit(['hitm', Math.round(dealt), r.target.alive ? 0 : 1, r.head ? 1 : 0], 0, 0, 0, p.id); }
    else if (r.veh) { kind = 3; damageVehicle(game, r.veh, alt.dmg * 0.2, p, 'mk', 'bullet'); }
    emitShot(game, p, w.idx, p.x, p.y, oz, ang, pit, r, kind, i === 0 ? 0 : 1, 0, 2000);
  }
}

/** Entry and exit distance of a unit ray through a circle, or null if it misses. */
function chord(ox, oy, dx, dy, cx, cy, r) {
  const fx = cx - ox, fy = cy - oy;
  const t = fx * dx + fy * dy;
  const px = fx - t * dx, py = fy - t * dy;
  const d2 = px * px + py * py;
  if (d2 > r * r) return null;
  const h = Math.sqrt(r * r - d2);
  if (t + h < 0) return null;
  return [Math.max(0, t - h), t + h];
}

/**
 * Distance along a rising ray at which it is inside the vertical band [z0, z1] over the horizontal span [t0, t1], or -1.
 * Returns the first such distance.
 */
function bandHit(oz, slope, t0, t1, z0, z1) {
  const za = oz + slope * t0, zb = oz + slope * t1;
  if (Math.max(za, zb) < z0 || Math.min(za, zb) > z1) return -1;
  if (Math.abs(slope) < 1e-6) return t0;
  // first distance where the ray enters the band
  const enter = za > z1 ? (z1 - oz) / slope : za < z0 ? (z0 - oz) / slope : t0;
  return Math.max(t0, Math.min(t1, enter));
}

/**
 * Casts a bullet from height oz through the 2.5D world. Returns { dist (horizontal), z (height where it ended), target
 * (soldier), head, leg, veh (vehicle), tile (hit a wall) }.
 * opts: range, shooter, tf (lag compensation tick), ignoreVeh.
 */
export function castRay(game, ox, oy, oz, ang, pitch, opts) {
  const map = game.map;
  const shooter = opts.shooter;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const slope = Math.tan(pitch);
  const wall = map.castBullet(ox, oy, oz, dx, dy, slope, opts.range);
  const wallD = wall.d, wallTile = wall.tx >= 0;
  let best = wallD, target = null, veh = null, head = false, leg = false;
  const tf = opts.tf || 0;
  for (const q of game.players.values()) {
    if (q === shooter || !q.alive || q.veh || q.team === SPEC || q.spawnProt > 0) continue;
    if (q.team === shooter.team && !game.ff) continue;
    let qx = q.x, qy = q.y, qz = q.z, cf = q.cf;
    if (tf > 0) { q.rewound(tf, tmp); if (!tmp.alive) continue; qx = tmp.x; qy = tmp.y; qz = tmp.z; cf = tmp.cf; }
    if (Math.abs(qx - ox) > best + PLAYER_R || Math.abs(qy - oy) > best + PLAYER_R) continue;
    const c = chord(ox, oy, dx, dy, qx, qy, PLAYER_R);
    if (!c) continue;
    const h = BODY_H + (BODY_H_CROUCH - BODY_H) * cf;
    const d = bandHit(oz, slope, c[0], c[1], qz, qz + h);
    if (d >= 0 && d < best) {
      best = d; target = q; veh = null;
      const frac = (oz + slope * d - qz) / h;
      head = frac >= HEAD_FRAC; leg = frac < 0.3;
    }
  }
  for (const v of game.vehicles) {
    if (v.dead || v === opts.ignoreVeh) continue;
    if (v.team === shooter.team && !game.ff && v.team >= 0) continue;
    if (Math.abs(v.x - ox) > best + v.def.r || Math.abs(v.y - oy) > best + v.def.r) continue;
    const c = chord(ox, oy, dx, dy, v.x, v.y, v.def.r * 0.92);
    if (!c) continue;
    const zr = v.def.zr || [0, 26];
    const d = bandHit(oz, slope, c[0], c[1], zr[0], zr[1]);
    if (d >= 0 && d < best) { best = d; veh = v; target = null; head = leg = false; }
  }
  return { dist: best, z: oz + slope * best, target, veh, head, leg, tile: !target && !veh && wallTile && wallD < opts.range };
}

function swingKnife(game, p, w) {
  p.fireCd = w.cd;
  let best = null, bd = Infinity;
  for (const q of game.players.values()) {
    if (q === p || !q.alive || q.veh || q.team === SPEC || q.spawnProt > 0) continue;
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
  const dealt = damagePlayer(game, best, p, back ? w.backstab : w.dmg, 'knife', { angle: p.angle });
  if (dealt > 0 && p.conn) game.emit(['hitm', Math.round(dealt), best.alive ? 0 : 1], 0, 0, 0, p.id);
}

/**
 * Applies damage. `attacker` may be null (world). Returns health damage dealt.
 * wid is a weapon id or a source name ('he', 'molo', 'knife', 'vehicle', a projectile type...).
 */
export function damagePlayer(game, v, attacker, raw, wid, o = {}) {
  if (!v.alive || v.spawnProt > 0) return 0;
  const self = !!attacker && attacker.id === v.id;
  const friendly = !!attacker && !self && attacker.team === v.team;
  if (friendly && !game.ff) return 0;
  // armor soaks half of every hit until it is used up (explosions and falls included)
  let dmg = raw;
  if (v.armor > 0 && dmg > 0) { const soak = Math.min(v.armor, dmg * 0.5); v.armor -= soak; dmg -= soak; }
  const hp = Math.min(dmg, v.hp);
  v.hp -= hp;
  v.lastHurt = game.time;
  if (attacker && !self) {
    if (!friendly) { attacker.stats.damage += hp; }
    v.dmgFrom.set(attacker.id, (v.dmgFrom.get(attacker.id) || 0) + hp);
  }
  if (!o.quiet) {
    const from = attacker && !self ? Math.atan2(attacker.y - v.y, attacker.x - v.x) : (o.angle !== undefined ? o.angle + Math.PI : 0);
    game.emit(['hurt', Math.ceil(hp), Math.round(from * 100) / 100], v.x, v.y, 0, v.id);
  }
  if (v.bot && attacker && !self && v.hp > 0.01 && v.bot.onHurt) v.bot.onHurt(attacker);
  if (v.hp <= 0.01) killPlayer(game, v, attacker, wid, o);
  return hp;
}

const NO_CORPSE = new Set(['he', 'molo', 'vehicle', 'barrel', 'c4', 'mine', 'claymore', 'rpg', 'smaw', 'stinger', 'cannon', 'apcgun', 'hrocket', 'ugl', 'world', 'drown']);

export function killPlayer(game, v, attacker, wid, o = {}) {
  if (!v.alive) return;
  if (v.veh) game.leaveVehicleSilently(v);
  v.alive = false; v.hp = 0;
  v.useT = 0; v.reviveProg = 0; v.lockTarget = 0;
  const self = !attacker || attacker.id === v.id;
  const friendly = !self && attacker.team === v.team;
  v.stats.deaths++;
  v.streak = 0;
  v.deadAt = game.time;
  v.respawnAt = game.time + RULES.respawnDelay;
  v.killedBy = attacker && !self ? attacker.id : 0;
  let assister = 0;
  if (!self && !friendly) {
    attacker.stats.kills++; attacker.streak++;
    const sc = wid === 'knife' ? RULES.score.kill + 50 : o.roadkill ? RULES.score.roadkill : RULES.score.kill;
    game.addScore(attacker, sc, o.roadkill ? 'Roadkill' : wid === 'knife' ? 'Knife kill' : 'Kill');
    let bestD = 35;
    for (const [id, d] of v.dmgFrom) if (id !== attacker.id && d >= bestD) { bestD = d; assister = id; }
    const a = game.players.get(assister);
    if (a && a.team !== v.team) { a.stats.assists++; game.addScore(a, RULES.score.assist, 'Assist'); } else assister = 0;
    if (game.mode.onKill) game.mode.onKill(game, v, attacker);
    // squad / spot bonuses are handled by the mode
  } else if (friendly) {
    attacker.stats.kills = Math.max(0, attacker.stats.kills - 1); attacker.stats.score = Math.max(0, attacker.stats.score - 100);
  } else if (self) { v.stats.score = Math.max(0, v.stats.score - 50); }
  if (game.mode.onDeath) game.mode.onDeath(game, v, attacker, wid);
  game.broadcast({ t: 'kill', k: self ? 0 : attacker.id, v: v.id, w: wid, a: assister, tk: friendly ? 1 : 0, hs: o.head ? 1 : 0 });
  const corpse = !o.noCorpse && !NO_CORPSE.has(wid);
  game.emit(['die', v.id, Math.round(v.x), Math.round(v.y), Math.round(v.angle * 100) / 100, v.team, corpse ? 1 : 0], v.x, v.y, 99999);
  if (corpse) game.addCorpse(v);
  v.specId = 0;
  game.room.sendRosterSoon();
  for (const b of game.players.values()) if (b.bot && b.alive) b.bot.onDeathSeen(v, attacker);
}
