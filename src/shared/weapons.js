// Arsenal: guns, attachments, gadgets, classes and loadouts. Distances are in pixels (16 px = 1 m).
import { BASE_SPEED, SPRINT_MUL } from './constants.js';

const W = (o) => Object.assign({
  auto: true, pellets: 1, rangeMod: 0.98, spread: 1, moveSpread: 5, burst: 0.5, burstMax: 6,
  scope: 0, scopedSpread: -1, suppressed: false, draw: 0.35, kick: 1, veh: 0.5, defOptic: 'iron', mode: 'AUTO',
}, o);

// The nine weapons of the arsenal. `tag` is the class label on the loadout card, `mode` the fire mode shown on the HUD.
export const WEAPON_LIST = [
  // ---- melee
  W({ id: 'knife', name: 'Combat Knife', tag: 'Melee', slot: 'knife', kind: 'knife', dmg: 45, backstab: 120, rpm: 100, mag: 0, reserve: 0, reload: 0, speed: 1.0, reach: 46, draw: 0.3, veh: 0, mode: 'MELEE' }),

  // ---- sidearm (every class)
  W({ id: 'p18', name: 'P-18', tag: 'Pistol', slot: 'secondary', kind: 'pistol', dmg: 30, rpm: 420, mag: 15, reserve: 75, reload: 1.9, speed: 0.98, auto: false, spread: 0.75, moveSpread: 4, burst: 0.8, burstMax: 4, rangeMod: 0.9, mode: 'SEMI' }),

  // ---- primaries
  W({ id: 'ar7', name: 'AR-7', tag: 'Assault Rifle', slot: 'primary', kind: 'rifle', dmg: 30, rpm: 680, mag: 30, reserve: 150, reload: 2.5, speed: 0.9, spread: 0.6, moveSpread: 6, burst: 0.6, burstMax: 7, rangeMod: 0.976, kick: 1.2 }),
  W({ id: 'br12', name: 'BR-12', tag: 'Battle Rifle', slot: 'primary', kind: 'rifle', dmg: 44, rpm: 480, mag: 20, reserve: 100, reload: 2.9, speed: 0.86, spread: 0.55, moveSpread: 7, burst: 1.15, burstMax: 5, rangeMod: 0.982, kick: 2 }),
  W({ id: 'vx9', name: 'VX-9', tag: 'Submachine Gun', slot: 'primary', kind: 'smg', dmg: 24, rpm: 880, mag: 31, reserve: 124, reload: 2.3, speed: 0.98, spread: 1.1, moveSpread: 3.5, burst: 0.45, burstMax: 8, rangeMod: 0.87 }),
  W({ id: 'sg4', name: 'SG-4', tag: 'Shotgun', slot: 'primary', kind: 'shotgun', dmg: 22, rpm: 84, mag: 7, reserve: 35, reload: 3.4, speed: 0.92, auto: false, spread: 3.3, moveSpread: 2, burst: 0, burstMax: 0, rangeMod: 0.72, kick: 2.5, pellets: 9, veh: 0.2, mode: 'PUMP' }),
  W({ id: 'mg60', name: 'MG-60', tag: 'Light Machine Gun', slot: 'primary', kind: 'lmg', dmg: 30, rpm: 720, mag: 100, reserve: 200, reload: 5.0, speed: 0.8, spread: 1.0, moveSpread: 8, burst: 0.4, burstMax: 15, rangeMod: 0.977, kick: 1.4 }),
  W({ id: 'dmr14', name: 'DMR-14', tag: 'Marksman Rifle', slot: 'primary', kind: 'dmr', dmg: 56, rpm: 330, mag: 20, reserve: 100, reload: 2.8, speed: 0.9, auto: false, spread: 0.65, moveSpread: 6, burst: 1.0, burstMax: 3, rangeMod: 0.986, kick: 2, mode: 'SEMI' }),
  W({ id: 'sr50', name: 'SR-50', tag: 'Sniper Rifle', slot: 'primary', kind: 'sniper', dmg: 112, rpm: 44, mag: 5, reserve: 30, reload: 3.8, speed: 0.9, auto: false, spread: 2.8, moveSpread: 5, burst: 0, burstMax: 0, rangeMod: 0.99, scope: 2, scopedSpread: 0.03, kick: 3.4, veh: 1.2, defOptic: 'sniper', mode: 'BOLT' }),
];

export const WEAPONS = {};
export const WID = {};
WEAPON_LIST.forEach((w, i) => {
  w.idx = i;
  w.cd = 60 / w.rpm;            // seconds between shots
  w.speedPx = BASE_SPEED * w.speed;
  WEAPONS[w.id] = w;
  WID[w.id] = i;
});

// ---- attachments --------------------------------------------------------------------------------------------------
// Every entry is a bundle of multipliers. `fits` lists the weapon kinds that can mount it; `no` is the number on the loadout sheet.
const ALL = ['pistol', 'smg', 'rifle', 'lmg', 'dmr', 'sniper', 'shotgun'];
export const ATTACH_SLOTS = ['optic', 'barrel', 'under', 'mag'];
export const ATTACH_SLOT_NAMES = { optic: 'Optic', barrel: 'Muzzle', under: 'Rail / Grip', mag: 'Magazine' };

export const ATTACH = {
  optic: {
    iron:   { name: 'Iron Sights', desc: 'Standard sights.', fits: ALL },
    reddot: { name: 'Red Dot', no: 1, desc: 'Fast target acquisition. Great for close to mid range.', fits: ['pistol', 'smg', 'rifle', 'lmg', 'dmr', 'shotgun'], adsSpread: 0.86, spread: 0.97 },
    holo:   { name: 'Holographic', no: 2, desc: 'Clear sight picture with a wide field of view.', fits: ['smg', 'rifle', 'lmg', 'dmr', 'shotgun'], adsSpread: 0.82, spread: 0.96, adsSpeed: 0.98 },
    acog:   { name: '4X Scope', no: 3, desc: 'Medium range magnification. Steady and precise.', fits: ['smg', 'rifle', 'lmg', 'dmr'], scope: 1, adsSpeed: 0.94 },
    sniper: { name: 'Sniper Scope', no: 4, desc: 'High magnification for long range engagements.', fits: ['dmr', 'sniper'], scope: 2, adsSpeed: 0.85 },
  },
  barrel: {
    none: { name: 'Standard Muzzle', desc: '', fits: ALL },
    supp: { name: 'Suppressor', no: 5, desc: 'Reduces sound and muzzle flash. Hidden from the enemy radar. Less damage at range.', fits: ['pistol', 'smg', 'rifle', 'lmg', 'dmr', 'sniper'], suppressed: true, dmg: 0.94, range: 0.88, burst: 0.92 },
    comp: { name: 'Compensator', no: 6, desc: 'Reduces vertical recoil for better control.', fits: ['pistol', 'smg', 'rifle', 'lmg', 'dmr', 'shotgun'], burst: 0.66, moveSpread: 1.1 },
  },
  under: {
    none:  { name: 'None', desc: '', fits: ALL },
    vgrip: { name: 'Vertical Foregrip', no: 7, desc: 'Improves recoil control and stability.', fits: ['smg', 'rifle', 'lmg', 'dmr', 'shotgun'], burst: 0.72 },
    agrip: { name: 'Angled Grip', no: 8, desc: 'Faster aim down sights and better handling on the move.', fits: ['smg', 'rifle', 'lmg', 'dmr', 'shotgun'], moveSpread: 0.68, adsSpeed: 1.06 },
    laser: { name: 'Laser Module', no: 9, desc: 'Improves hip-fire accuracy.', fits: ['pistol', 'smg', 'rifle', 'lmg', 'shotgun'], spread: 0.78, moveSpread: 0.85 },
    flash: { name: 'Flashlight', no: 10, desc: 'Lights up dark areas. Steadies aim while moving.', fits: ['pistol', 'smg', 'rifle', 'lmg', 'dmr', 'shotgun'], moveSpread: 0.9, light: true },
  },
  mag: {
    std:  { name: 'Standard Magazine', desc: '', fits: ALL },
    ext:  { name: 'Extended Magazine', no: 11, desc: '+40% magazine capacity.', fits: ['pistol', 'smg', 'rifle', 'lmg', 'dmr', 'sniper'], mag: 1.4, reload: 1.1, speed: 0.99 },
    drum: { name: 'Drum Magazine', no: 12, desc: 'Massive ammo capacity. Slower reload and handling.', fits: ['smg', 'rifle', 'lmg'], mag: 2.2, reload: 1.3, speed: 0.95, adsSpeed: 0.95 },
  },
};
export const DEFAULT_ATT = { optic: 'iron', barrel: 'none', under: 'none', mag: 'std' };

/** Options of an attachment slot that fit the weapon's kind. */
export function attachOptions(w, slot) {
  const out = [];
  for (const [id, a] of Object.entries(ATTACH[slot])) if (a.fits.includes(w.kind)) out.push(id);
  return out;
}

export function normAtt(w, att = {}) {
  const out = { ...DEFAULT_ATT, optic: w.defOptic };
  for (const slot of ATTACH_SLOTS) {
    const v = att && att[slot];
    const a = typeof v === 'string' ? ATTACH[slot][v] : null;
    if (a && a.fits.includes(w.kind)) out[slot] = v;
  }
  if (w.defOptic !== 'iron' && out.optic === 'iron') out.optic = w.defOptic;
  return out;
}

const resolved = new Map();
/** A weapon with its attachments applied. Cached; treat the result as immutable. */
export function resolveWeapon(id, att) {
  const base = WEAPONS[id];
  if (!base) return null;
  const a = normAtt(base, att);
  const key = `${id}|${a.optic}|${a.barrel}|${a.under}|${a.mag}`;
  let w = resolved.get(key);
  if (w) return w;
  w = { ...base, att: a, key, alt: null, adsSpeed: 1, adsSpread: 1, vehMult: base.veh, slug: false, scope: 0, light: false };
  let rangeF = 1, magF = 1, reloadF = 1, rpmF = 1;
  for (const slot of ATTACH_SLOTS) {
    const m = ATTACH[slot][a[slot]];
    if (!m) continue;
    if (m.dmg) w.dmg *= m.dmg;
    if (m.rpm) rpmF *= m.rpm;
    if (m.spread) { w.spread *= m.spread; if (w.scopedSpread >= 0) w.scopedSpread *= m.spread; }
    if (m.adsSpread) w.adsSpread *= m.adsSpread;
    if (m.moveSpread) w.moveSpread *= m.moveSpread;
    if (m.burst) w.burst *= m.burst;
    if (m.range) rangeF *= m.range;
    if (m.speed) w.speed *= m.speed;
    if (m.adsSpeed) w.adsSpeed *= m.adsSpeed;
    if (m.mag) magF *= m.mag;
    if (m.reload) reloadF *= m.reload;
    if (m.scope !== undefined) w.scope = m.scope;
    if (m.suppressed) w.suppressed = true;
    if (m.light) w.light = true;
    if (m.alt) w.alt = m.alt;
    if (m.veh) w.vehMult *= m.veh;
    if (m.slug) w.slug = true;
  }
  if (w.slug) { w.pellets = 1; w.dmg = base.dmg * base.pellets * 0.72; w.spread = base.spread * 0.22; w.rangeMod = 0.955; w.vehMult *= 2; }
  w.rangeMod = Math.pow(w.rangeMod, 1 / rangeF);
  w.mag = Math.max(1, Math.round(base.mag * magF));
  w.reserve = base.reserve;
  w.reload = base.reload * reloadF;
  w.rpm = base.rpm * rpmF;
  w.cd = 60 / w.rpm;
  w.speedPx = BASE_SPEED * w.speed;
  if (w.scope > 0 && w.scopedSpread < 0) w.scopedSpread = w.spread * (w.scope >= 2 ? 0.22 : 0.4);
  w.idx = base.idx;
  resolved.set(key, w);
  return w;
}

// Alt fire modes (underbarrel launchers; no attachment mounts them any more but the engine still supports them)
export const ALT = {
  ugl: { name: '40 mm Grenade', mag: 1, reserve: 4, reload: 2.4, cd: 0.7, speed: 760, dmg: 78, radius: 118, tile: 110 },
  mk:  { name: 'Masterkey', mag: 4, reserve: 12, reload: 2.6, cd: 0.55, pellets: 7, dmg: 17, spread: 4.2 },
};

// ---- held-item codes sent over the network -------------------------------------------------------------------------
export const HELD_GREN_BASE = 100;   // 100..103 grenades
export const HELD_GADGET_BASE = 200; // 200.. gadgets

// ---- gadgets -----------------------------------------------------------------------------------------------------
export const GADGET_LIST = [
  { id: 'defib',    name: 'Defibrillator', kind: 'defib', charges: 0, desc: 'Hold fire next to a fallen teammate to bring them back.' },
  { id: 'medkit',   name: 'Medic Bag', kind: 'deploy', charges: 3, life: 18, radius: 110, desc: 'Drop a bag that heals everyone nearby.' },
  { id: 'repair',   name: 'Repair Tool', kind: 'repair', charges: 0, desc: 'Hold fire on a friendly vehicle to repair it.' },
  { id: 'mine',     name: 'AT Mine', kind: 'deploy', charges: 3, desc: 'Hidden mine that wrecks ground vehicles.' },
  { id: 'rpg',      name: 'RL-80', kind: 'launcher', charges: 5, desc: 'Rocket launcher. Heavy damage to vehicles and walls.', proj: 'rpg', cd: 1.1, reload: 2.6, mag: 1 },
  { id: 'smaw',     name: 'RL-80 HEAT', kind: 'launcher', charges: 6, desc: 'Fast rocket, longer range, bigger blast.', proj: 'smaw', cd: 1.3, reload: 3.0, mag: 1 },
  { id: 'stinger',  name: 'Stinger AA', kind: 'launcher', charges: 4, desc: 'Hold RMB on an enemy helicopter to lock, then LMB to launch. Flares break the lock.', proj: 'stinger', cd: 1.5, reload: 3.2, mag: 1, aa: true },
  { id: 'ammo',     name: 'Ammo Crate', kind: 'deploy', charges: 3, life: 26, radius: 110, desc: 'Resupplies ammo, armor and grenades of everyone nearby.' },
  { id: 'claymore', name: 'Claymore', kind: 'deploy', charges: 2, desc: 'Directional mine. Shreds enemy infantry in front of it.' },
  { id: 'c4',       name: 'C4', kind: 'c4', charges: 3, desc: 'Place with fire, detonate with right mouse. Sticks to vehicles.' },
  { id: 'beacon',   name: 'Spawn Beacon', kind: 'deploy', charges: 1, life: 120, desc: 'Squadmates can spawn on it.' },
  { id: 'sensor',   name: 'Motion Sensor', kind: 'deploy', charges: 2, life: 45, radius: 340, desc: 'Reveals moving enemies nearby to the whole team.' },
];
export const GADGETS = {};
GADGET_LIST.forEach((g, i) => { g.idx = i; GADGETS[g.id] = g; });

// ---- projectiles ---------------------------------------------------------------------------------------------------
// speed px/s, life s, expl = explosion radius px, dmg vs soldiers, veh = damage vs vehicles, tile = damage to walls
export const PROJ = {
  rpg:     { name: 'RPG', speed: 780, life: 2.6, radius: 6, expl: 105, dmg: 130, veh: 240, tile: 260, smoke: 1, air: 0.6 },
  smaw:    { name: 'SMAW', speed: 1050, life: 2.6, radius: 6, expl: 125, dmg: 140, veh: 300, tile: 320, smoke: 1, air: 0.6 },
  stinger: { name: 'Stinger', speed: 900, life: 4.0, radius: 6, expl: 90, dmg: 60, veh: 190, tile: 60, smoke: 1, homing: 7, air: 1.5 },
  cannon:  { name: 'Tank Shell', speed: 1300, life: 1.6, radius: 7, expl: 120, dmg: 120, veh: 340, tile: 400, air: 0.4 },
  apcgun:  { name: 'Autocannon', speed: 1400, life: 1.2, radius: 5, expl: 44, dmg: 34, veh: 46, tile: 60, air: 0.7 },
  hrocket: { name: 'Rocket Pod', speed: 900, life: 1.7, radius: 5, expl: 78, dmg: 70, veh: 90, tile: 130, air: 0 },
  ugl:     { name: '40mm', speed: 760, life: 1.4, radius: 5, expl: 118, dmg: 78, veh: 55, tile: 110, air: 0 },
  torpedo: { name: 'Depth charge', speed: 700, life: 1.8, radius: 6, expl: 95, dmg: 90, veh: 180, tile: 200, air: 0 },
};

export const AIR_DEFENSE = { lockTime: 1.4, range: 2400, cone: .12, flareLife: 3, flareCooldown: 12, flareCharges: 4 };

// ---- classes -----------------------------------------------------------------------------------------------------
export const CLASS_ORDER = ['assault', 'engineer', 'support', 'recon'];
export const CLASSES = {
  assault: {
    name: 'Assault', icon: 'A', color: '#e0703a', desc: 'Front-line medic. Revives fallen squadmates and heals with bags.',
    primaries: ['ar7', 'br12', 'sg4'], gadgets: [['defib'], ['medkit']], hp: 100, armor: 50, speed: 1.0, gren: 'he', grenCount: 2,
  },
  engineer: {
    name: 'Engineer', icon: 'E', color: '#e0b93a', desc: 'Vehicle hunter and mechanic. Rockets, mines, repairs.',
    primaries: ['vx9', 'br12', 'sg4'], gadgets: [['repair', 'mine'], ['rpg', 'smaw', 'stinger']], hp: 100, armor: 50, speed: 1.02, gren: 'he', grenCount: 2,
  },
  support: {
    name: 'Support', icon: 'S', color: '#4aa8e0', desc: 'Suppressing fire and supplies. Ammo crates, C4 and claymores.',
    primaries: ['mg60', 'ar7', 'sg4'], gadgets: [['ammo'], ['c4', 'claymore']], hp: 100, armor: 75, speed: 0.97, gren: 'he', grenCount: 3,
  },
  recon: {
    name: 'Recon', icon: 'R', color: '#7fd35a', desc: 'Long range scouting. Snipers, spawn beacons and motion sensors.',
    primaries: ['sr50', 'dmr14', 'vx9'], gadgets: [['beacon'], ['sensor', 'c4']], hp: 100, armor: 25, speed: 1.0, gren: 'smoke', grenCount: 2,
  },
};
export const SIDEARMS = ['p18'];

export function defaultLoadout(cls = 'assault') {
  const c = CLASSES[cls] || CLASSES.assault;
  const primary = c.primaries[0];
  return {
    cls: CLASSES[cls] ? cls : 'assault',
    primary: { id: primary, att: normAtt(WEAPONS[primary], {}) },
    secondary: { id: SIDEARMS[0], att: normAtt(WEAPONS[SIDEARMS[0]], {}) },
    gadgets: [c.gadgets[0][0], c.gadgets[1][0]],
    gren: c.gren,
  };
}

/** Validates an untrusted loadout coming from a client and returns a clean one. */
export function sanitizeLoadout(input) {
  const cls = input && CLASSES[input.cls] ? input.cls : 'assault';
  const c = CLASSES[cls];
  const out = defaultLoadout(cls);
  if (!input || typeof input !== 'object') return out;
  const pid = input.primary && input.primary.id;
  if (typeof pid === 'string' && c.primaries.includes(pid)) out.primary = { id: pid, att: normAtt(WEAPONS[pid], input.primary.att) };
  const sid = input.secondary && input.secondary.id;
  if (typeof sid === 'string' && SIDEARMS.includes(sid)) out.secondary = { id: sid, att: normAtt(WEAPONS[sid], input.secondary.att) };
  if (Array.isArray(input.gadgets)) {
    for (let i = 0; i < 2; i++) if (c.gadgets[i].includes(input.gadgets[i])) out.gadgets[i] = input.gadgets[i];
  }
  if (typeof input.gren === 'string' && ['he', 'flash', 'smoke', 'molo'].includes(input.gren)) out.gren = input.gren;
  return out;
}

export function canUseGadget(cls, id) { return CLASSES[cls].gadgets.some((l) => l.includes(id)); }

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Current inaccuracy half-angle (radians). First person: hip fire is loose, aiming down sights tightens it a lot, moving,
 * jumping and sustained fire open it up, crouching (cf 0..1) steadies it. Recoil itself is a camera kick handled by the client.
 */
export function weaponSpread(w, speed, burst, scoped, cf = 0, air = false) {
  if (w.kind === 'knife') return 0;
  const s = scoped && w.scope > 0;
  const maxV = BASE_SPEED * w.speed;
  const mf = clamp((speed / maxV - 0.3) / 0.7, 0, 1);
  const hip = 2.3;
  let deg;
  if (s) deg = w.scopedSpread + w.moveSpread * mf * 1.2 + w.burst * Math.min(burst, w.burstMax) * 0.35;
  else if (scoped) deg = w.spread * 0.6 * w.adsSpread + w.moveSpread * mf * 0.5 + w.burst * Math.min(burst, w.burstMax) * 0.3;
  else deg = w.spread * hip + w.moveSpread * mf * 1.1 + w.burst * Math.min(burst, w.burstMax) * 0.45;
  deg *= 1 - 0.32 * cf;
  if (air) deg = deg * 1.8 + 2.5;
  return deg * Math.PI / 180;
}

/** Max movement speed in px/s for a given weapon and key state. */
export function maxSpeedFor(w, walking, scoped, sprint = false) {
  let v = (w ? w.speedPx : BASE_SPEED);
  if (scoped && w) v *= (w.scope === 3 ? 0.45 : w.scope === 2 ? 0.55 : w.scope === 1 ? 0.7 : 0.78) * (w.adsSpeed || 1);
  else if (sprint && !walking) v *= SPRINT_MUL;
  if (walking) v *= 0.5;
  return v;
}
