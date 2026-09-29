// Arsenal: guns, attachments, gadgets, classes and loadouts. Distances are in pixels (32 px tile ~ 1.6 m).
import { BASE_SPEED, SPRINT_MUL } from './constants.js';

const W = (o) => Object.assign({
  auto: true, pellets: 1, rangeMod: 0.98, spread: 1, moveSpread: 5, burst: 0.5, burstMax: 6,
  scope: 0, scopedSpread: -1, suppressed: false, draw: 0.35, kick: 1, veh: 0.5, defOptic: 'iron',
}, o);

export const WEAPON_LIST = [
  // ---- melee
  W({ id: 'knife', name: 'Combat Knife', slot: 'knife', kind: 'knife', dmg: 45, backstab: 120, rpm: 100, mag: 0, reserve: 0, reload: 0, speed: 1.0, reach: 46, draw: 0.3, veh: 0 }),

  // ---- sidearms (every class)
  W({ id: 'm9', name: 'M9', slot: 'secondary', kind: 'pistol', dmg: 27, rpm: 480, mag: 15, reserve: 75, reload: 2.0, speed: 0.98, auto: false, spread: 0.8, moveSpread: 4, burst: 0.7, burstMax: 4, rangeMod: 0.9 }),
  W({ id: 'm1911', name: 'M1911', slot: 'secondary', kind: 'pistol', dmg: 36, rpm: 380, mag: 8, reserve: 48, reload: 2.0, speed: 0.98, auto: false, spread: 0.6, moveSpread: 4, burst: 0.9, burstMax: 3, rangeMod: 0.91 }),
  W({ id: 'g18', name: 'G18 Auto', slot: 'secondary', kind: 'pistol', dmg: 20, rpm: 1000, mag: 20, reserve: 100, reload: 2.2, speed: 0.98, auto: true, spread: 1.2, moveSpread: 4, burst: 1.1, burstMax: 8, rangeMod: 0.86 }),
  W({ id: 'deagle', name: 'Desert Eagle', slot: 'secondary', kind: 'pistol', dmg: 60, rpm: 260, mag: 7, reserve: 35, reload: 2.2, speed: 0.95, auto: false, spread: 0.5, moveSpread: 7, burst: 3.0, burstMax: 3, rangeMod: 0.93, kick: 2 }),
  W({ id: 'mp412', name: 'MP412 Rex', slot: 'secondary', kind: 'pistol', dmg: 56, rpm: 200, mag: 6, reserve: 36, reload: 3.4, speed: 0.96, auto: false, spread: 0.35, moveSpread: 6, burst: 2.2, burstMax: 2, rangeMod: 0.95, kick: 2, veh: 0.7 }),

  // ---- assault rifles (Assault)
  W({ id: 'm416', name: 'M416', slot: 'primary', kind: 'rifle', dmg: 30, rpm: 700, mag: 30, reserve: 150, reload: 2.5, speed: 0.9, spread: 0.6, moveSpread: 6, burst: 0.6, burstMax: 7, rangeMod: 0.976, kick: 1.2 }),
  W({ id: 'ak74m', name: 'AK-74M', slot: 'primary', kind: 'rifle', dmg: 34, rpm: 620, mag: 30, reserve: 150, reload: 2.6, speed: 0.9, spread: 0.7, moveSpread: 7, burst: 0.85, burstMax: 7, rangeMod: 0.976, kick: 1.4 }),
  W({ id: 'scarh', name: 'SCAR-H', slot: 'primary', kind: 'rifle', dmg: 43, rpm: 500, mag: 20, reserve: 100, reload: 2.9, speed: 0.86, spread: 0.55, moveSpread: 7, burst: 1.15, burstMax: 5, rangeMod: 0.98, kick: 2 }),
  W({ id: 'aug', name: 'AUG A3', slot: 'primary', kind: 'rifle', dmg: 28, rpm: 730, mag: 30, reserve: 150, reload: 2.7, speed: 0.92, spread: 0.55, moveSpread: 5.5, burst: 0.45, burstMax: 7, rangeMod: 0.978, kick: 1 }),

  // ---- PDWs / carbines (Engineer)
  W({ id: 'mp7', name: 'MP7', slot: 'primary', kind: 'smg', dmg: 25, rpm: 850, mag: 30, reserve: 150, reload: 2.4, speed: 0.98, spread: 1.15, moveSpread: 3.5, burst: 0.45, burstMax: 8, rangeMod: 0.87 }),
  W({ id: 'ump45', name: 'UMP-45', slot: 'primary', kind: 'smg', dmg: 32, rpm: 620, mag: 25, reserve: 125, reload: 2.8, speed: 0.96, spread: 1.05, moveSpread: 4, burst: 0.55, burstMax: 7, rangeMod: 0.87 }),
  W({ id: 'p90', name: 'P90', slot: 'primary', kind: 'smg', dmg: 23, rpm: 900, mag: 50, reserve: 150, reload: 3.1, speed: 0.96, spread: 1.3, moveSpread: 3.5, burst: 0.4, burstMax: 10, rangeMod: 0.87 }),
  W({ id: 'aks74u', name: 'AKS-74u', slot: 'primary', kind: 'smg', dmg: 30, rpm: 680, mag: 30, reserve: 150, reload: 2.5, speed: 0.95, spread: 0.85, moveSpread: 5, burst: 0.7, burstMax: 7, rangeMod: 0.93, kick: 1.2 }),

  // ---- light machine guns (Support)
  W({ id: 'm249', name: 'M249 SAW', slot: 'primary', kind: 'lmg', dmg: 28, rpm: 750, mag: 100, reserve: 200, reload: 5.0, speed: 0.8, spread: 1.0, moveSpread: 8, burst: 0.4, burstMax: 15, rangeMod: 0.975, kick: 1.3 }),
  W({ id: 'pkp', name: 'PKP Pecheneg', slot: 'primary', kind: 'lmg', dmg: 37, rpm: 600, mag: 100, reserve: 200, reload: 5.4, speed: 0.78, spread: 1.0, moveSpread: 9, burst: 0.55, burstMax: 14, rangeMod: 0.98, kick: 1.6 }),
  W({ id: 'mg36', name: 'MG36', slot: 'primary', kind: 'lmg', dmg: 26, rpm: 800, mag: 100, reserve: 200, reload: 4.8, speed: 0.84, spread: 0.85, moveSpread: 7, burst: 0.35, burstMax: 15, rangeMod: 0.972, kick: 1.1 }),

  // ---- sniper rifles / DMRs (Recon)
  W({ id: 'sv98', name: 'SV-98', slot: 'primary', kind: 'sniper', dmg: 105, rpm: 46, mag: 10, reserve: 50, reload: 3.6, speed: 0.92, auto: false, spread: 2.8, moveSpread: 5, burst: 0, burstMax: 0, rangeMod: 0.986, scope: 2, scopedSpread: 0.04, kick: 3, defOptic: 'scope8' }),
  W({ id: 'm40a5', name: 'M40A5', slot: 'primary', kind: 'sniper', dmg: 100, rpm: 52, mag: 5, reserve: 40, reload: 3.3, speed: 0.93, auto: false, spread: 2.6, moveSpread: 5, burst: 0, burstMax: 0, rangeMod: 0.988, scope: 2, scopedSpread: 0.03, kick: 3, defOptic: 'scope8' }),
  W({ id: 'm98b', name: 'M98B', slot: 'primary', kind: 'sniper', dmg: 128, rpm: 38, mag: 5, reserve: 30, reload: 4.6, speed: 0.78, auto: false, spread: 4.5, moveSpread: 8, burst: 0, burstMax: 0, rangeMod: 0.993, scope: 2, scopedSpread: 0.03, kick: 4, draw: 0.6, veh: 1.6, defOptic: 'scope8' }),
  W({ id: 'sks', name: 'SKS', slot: 'primary', kind: 'dmr', dmg: 56, rpm: 300, mag: 20, reserve: 100, reload: 2.9, speed: 0.9, auto: false, spread: 0.7, moveSpread: 6, burst: 1.0, burstMax: 3, rangeMod: 0.985, kick: 2 }),
  W({ id: 'mk11', name: 'MK11', slot: 'primary', kind: 'dmr', dmg: 48, rpm: 360, mag: 20, reserve: 100, reload: 2.8, speed: 0.9, auto: false, spread: 0.6, moveSpread: 6, burst: 0.9, burstMax: 3, rangeMod: 0.986, kick: 1.8 }),

  // ---- shotguns (every class)
  W({ id: '870', name: '870 MCS', slot: 'primary', kind: 'shotgun', dmg: 24, rpm: 68, mag: 7, reserve: 35, reload: 3.4, speed: 0.92, auto: false, spread: 3.4, moveSpread: 2, burst: 0, burstMax: 0, rangeMod: 0.72, kick: 2.5, pellets: 9, veh: 0.2 }),
  W({ id: 'saiga12', name: 'Saiga-12', slot: 'primary', kind: 'shotgun', dmg: 17, rpm: 240, mag: 8, reserve: 40, reload: 3.6, speed: 0.9, auto: true, spread: 3.2, moveSpread: 2, burst: 0.4, burstMax: 3, rangeMod: 0.72, kick: 2, pellets: 8, veh: 0.2 }),
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
// Every entry is a bundle of multipliers. `fits` lists the weapon kinds that can mount it.
const ALL = ['pistol', 'smg', 'rifle', 'lmg', 'dmr', 'sniper', 'shotgun'];
export const ATTACH_SLOTS = ['optic', 'barrel', 'under', 'mag'];
export const ATTACH_SLOT_NAMES = { optic: 'Optic', barrel: 'Muzzle / Barrel', under: 'Underbarrel', mag: 'Ammunition' };

export const ATTACH = {
  optic: {
    iron:    { name: 'Iron Sights', desc: 'Standard sights.', fits: ALL },
    reddot:  { name: 'Red Dot', desc: 'Faster, tighter aiming down sights.', fits: ['pistol', 'smg', 'rifle', 'lmg', 'dmr', 'shotgun', 'sniper'], adsSpread: 0.86, spread: 0.97 },
    holo:    { name: 'Holographic', desc: 'Clear sight picture. Tighter ADS spread.', fits: ['smg', 'rifle', 'lmg', 'dmr', 'shotgun'], adsSpread: 0.82, spread: 0.96, adsSpeed: 0.98 },
    acog:    { name: '4x Scope', desc: 'See farther when aiming down sights.', fits: ['smg', 'rifle', 'lmg', 'dmr', 'sniper'], scope: 1, adsSpeed: 0.94 },
    scope8:  { name: '8x Scope', desc: 'Long range optic with a narrow view.', fits: ['rifle', 'dmr', 'sniper'], scope: 2, adsSpeed: 0.85 },
    scope12: { name: '12x Sniper Scope', desc: 'Extreme range. Very narrow view.', fits: ['sniper', 'dmr'], scope: 3, adsSpeed: 0.75 },
  },
  barrel: {
    none:  { name: 'Standard Muzzle', desc: '', fits: ALL },
    supp:  { name: 'Suppressor', desc: 'Quiet shots, hidden from the enemy radar. Less damage at range.', fits: ['pistol', 'smg', 'rifle', 'lmg', 'dmr', 'sniper'], suppressed: true, dmg: 0.94, range: 0.88, burst: 0.92 },
    flash: { name: 'Flash Hider', desc: 'Less recoil build-up while firing.', fits: ['smg', 'rifle', 'lmg', 'dmr', 'shotgun'], burst: 0.82 },
    comp:  { name: 'Compensator', desc: 'Much less recoil, wider moving spread.', fits: ['pistol', 'smg', 'rifle', 'lmg', 'dmr'], burst: 0.66, moveSpread: 1.12 },
    heavy: { name: 'Heavy Barrel', desc: 'Tighter grouping, slower handling.', fits: ['smg', 'rifle', 'lmg', 'dmr', 'sniper'], spread: 0.82, adsSpread: 0.85, speed: 0.96, burst: 0.92 },
    long:  { name: 'Long Barrel', desc: 'More range and damage, slower to aim.', fits: ['rifle', 'lmg', 'dmr', 'sniper', 'smg'], dmg: 1.05, range: 1.25, speed: 0.97, adsSpeed: 0.95 },
    choke: { name: 'Choke', desc: 'Tighter pellet spread.', fits: ['shotgun'], spread: 0.7, range: 1.15 },
  },
  under: {
    none:  { name: 'None', desc: '', fits: ALL },
    vgrip: { name: 'Vertical Grip', desc: 'Less recoil build-up.', fits: ['smg', 'rifle', 'lmg', 'dmr', 'shotgun'], burst: 0.72 },
    agrip: { name: 'Angled Grip', desc: 'Accurate while moving. Quicker ADS.', fits: ['smg', 'rifle', 'lmg', 'dmr', 'shotgun'], moveSpread: 0.68, adsSpeed: 1.06 },
    laser: { name: 'Laser Sight', desc: 'Much better hip-fire accuracy.', fits: ['pistol', 'smg', 'rifle', 'shotgun'], spread: 0.78, moveSpread: 0.85 },
    bipod: { name: 'Bipod', desc: 'Very stable, slower to move.', fits: ['lmg', 'dmr', 'sniper'], burst: 0.5, adsSpread: 0.8, speed: 0.97 },
    ugl:   { name: 'Grenade Launcher', desc: 'Alt fire (F): 40 mm explosive grenade. Wrecks walls.', fits: ['rifle'], alt: 'ugl', speed: 0.96 },
    mk:    { name: 'Masterkey', desc: 'Alt fire (F): underbarrel shotgun for close quarters.', fits: ['rifle', 'smg'], alt: 'mk', speed: 0.97 },
  },
  mag: {
    std:  { name: 'Standard Ammo', desc: '', fits: ALL },
    ext:  { name: 'Extended Mags', desc: '+40% magazine size, slower reload.', fits: ['pistol', 'smg', 'rifle', 'lmg', 'dmr', 'sniper'], mag: 1.4, reload: 1.12, speed: 0.98 },
    hp:   { name: 'Hollow Point', desc: 'More damage to soldiers, shorter range, weak vs vehicles.', fits: ALL, dmg: 1.1, range: 0.85, veh: 0.7 },
    ap:   { name: 'Armor Piercing', desc: 'Much more damage to vehicles, slightly less to soldiers.', fits: ['rifle', 'lmg', 'dmr', 'sniper', 'smg'], dmg: 0.96, veh: 2.4 },
    slug: { name: 'Slugs', desc: 'One heavy accurate slug per shot.', fits: ['shotgun'], slug: true },
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
  w = { ...base, att: a, key, alt: null, adsSpeed: 1, adsSpread: 1, vehMult: base.veh, slug: false, scope: 0 };
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

// Alt fire modes (underbarrel)
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
  { id: 'rpg',      name: 'RPG-7', kind: 'launcher', charges: 5, desc: 'Unguided rocket. Heavy damage to vehicles and walls.', proj: 'rpg', cd: 1.1, reload: 2.6, mag: 1 },
  { id: 'smaw',     name: 'SMAW', kind: 'launcher', charges: 6, desc: 'Fast rocket, longer range, bigger blast.', proj: 'smaw', cd: 1.3, reload: 3.0, mag: 1 },
  { id: 'stinger',  name: 'FIM-92 Stinger', kind: 'launcher', charges: 4, desc: 'Locks onto aircraft. Hold RMB to lock.', proj: 'stinger', cd: 1.5, reload: 3.2, mag: 1, aa: true },
  { id: 'ammo',     name: 'Ammo Crate', kind: 'deploy', charges: 3, life: 26, radius: 110, desc: 'Resupplies ammo and grenades of everyone nearby.' },
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

// ---- classes -----------------------------------------------------------------------------------------------------
export const CLASS_ORDER = ['assault', 'engineer', 'support', 'recon'];
const SHOTGUNS = ['870', 'saiga12'];
export const CLASSES = {
  assault: {
    name: 'Assault', icon: 'A', color: '#e0703a', desc: 'Front-line medic. Revives fallen squadmates and heals with bags.',
    primaries: ['m416', 'ak74m', 'scarh', 'aug', ...SHOTGUNS], gadgets: [['defib'], ['medkit']], hp: 100, speed: 1.0, gren: 'he', grenCount: 2,
  },
  engineer: {
    name: 'Engineer', icon: 'E', color: '#e0b93a', desc: 'Vehicle hunter and mechanic. Rockets, mines, repairs.',
    primaries: ['mp7', 'ump45', 'p90', 'aks74u', ...SHOTGUNS], gadgets: [['repair', 'mine'], ['rpg', 'smaw', 'stinger']], hp: 100, speed: 1.02, gren: 'he', grenCount: 2,
  },
  support: {
    name: 'Support', icon: 'S', color: '#4aa8e0', desc: 'Suppressing fire and supplies. Ammo crates, C4 and claymores.',
    primaries: ['m249', 'pkp', 'mg36', ...SHOTGUNS], gadgets: [['ammo'], ['c4', 'claymore']], hp: 100, speed: 0.97, gren: 'he', grenCount: 3,
  },
  recon: {
    name: 'Recon', icon: 'R', color: '#7fd35a', desc: 'Long range scouting. Snipers, spawn beacons and motion sensors.',
    primaries: ['sv98', 'm40a5', 'm98b', 'sks', 'mk11', ...SHOTGUNS], gadgets: [['beacon'], ['sensor', 'c4']], hp: 100, speed: 1.0, gren: 'smoke', grenCount: 2,
  },
};
export const SIDEARMS = ['m9', 'm1911', 'g18', 'deagle', 'mp412'];

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

/** Current inaccuracy half-angle (radians). */
export function weaponSpread(w, speed, burst, scoped) {
  if (w.kind === 'knife') return 0;
  const s = scoped && w.scope > 0;
  const maxV = BASE_SPEED * w.speed;
  const mf = clamp((speed / maxV - 0.35) / 0.65, 0, 1);
  // aiming down sights: scoped optics use their scoped spread, iron sights tighten by ~40%
  const base = s ? w.scopedSpread : scoped ? w.spread * 0.6 * w.adsSpread : w.spread;
  const deg = base + w.moveSpread * mf * (s ? 1.4 : scoped ? 0.7 : 1) + w.burst * Math.min(burst, w.burstMax) * (scoped && !s ? 0.7 : 1);
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
