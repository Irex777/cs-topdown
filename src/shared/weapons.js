// Weapon table, modelled on CS:GO numbers. Distances are in pixels (32px tile ~ 46 CS units).
import { BASE_SPEED } from './constants.js';

const W = (o) => Object.assign({
  team: -1, auto: true, pellets: 1, rangeMod: 0.98, spread: 1, moveSpread: 5, burst: 0.5, burstMax: 6,
  scope: 0, scopedSpread: 0, suppressed: false, draw: 0.35, kick: 1, reward: 300, ap: 0.7,
}, o);

export const WEAPON_LIST = [
  // ---- melee
  W({ id: 'knife', name: 'Knife', slot: 'knife', kind: 'knife', price: 0, dmg: 40, backstab: 120, rpm: 100, mag: 0, reserve: 0,
      reload: 0, speed: 1.0, reach: 46, reward: 1500, draw: 0.3 }),

  // ---- pistols
  W({ id: 'glock', name: 'Glock-18', slot: 'secondary', kind: 'pistol', team: 0, price: 0, dmg: 30, ap: 0.47, rpm: 400, mag: 20, reserve: 120,
      reload: 2.2, speed: 0.96, auto: false, spread: 0.9, moveSpread: 4.5, burst: 0.7, burstMax: 4, reward: 300, rangeMod: 0.9 }),
  W({ id: 'usp', name: 'USP-S', slot: 'secondary', kind: 'pistol', team: 1, price: 0, dmg: 35, ap: 0.5, rpm: 352, mag: 12, reserve: 24,
      reload: 2.2, speed: 0.96, auto: false, spread: 0.55, moveSpread: 4, burst: 0.6, burstMax: 4, reward: 300, rangeMod: 0.91, suppressed: true }),
  W({ id: 'p250', name: 'P250', slot: 'secondary', kind: 'pistol', price: 300, dmg: 38, ap: 0.64, rpm: 400, mag: 13, reserve: 26,
      reload: 2.2, speed: 0.96, auto: false, spread: 0.8, moveSpread: 4.5, burst: 0.8, burstMax: 4, reward: 300, rangeMod: 0.9 }),
  W({ id: 'tec9', name: 'Tec-9', slot: 'secondary', kind: 'pistol', team: 0, price: 500, dmg: 33, ap: 0.9, rpm: 500, mag: 24, reserve: 120,
      reload: 2.4, speed: 0.96, auto: false, spread: 1.0, moveSpread: 3.5, burst: 0.7, burstMax: 5, reward: 300, rangeMod: 0.9 }),
  W({ id: 'fiveseven', name: 'Five-SeveN', slot: 'secondary', kind: 'pistol', team: 1, price: 500, dmg: 32, ap: 0.9, rpm: 400, mag: 20, reserve: 100,
      reload: 2.2, speed: 0.96, auto: false, spread: 0.8, moveSpread: 4, burst: 0.7, burstMax: 5, reward: 300, rangeMod: 0.9 }),
  W({ id: 'deagle', name: 'Desert Eagle', slot: 'secondary', kind: 'pistol', price: 700, dmg: 63, ap: 0.93, rpm: 267, mag: 7, reserve: 35,
      reload: 2.2, speed: 0.92, auto: false, spread: 0.5, moveSpread: 7, burst: 3.0, burstMax: 3, reward: 300, rangeMod: 0.93, kick: 2 }),

  // ---- SMGs
  W({ id: 'mac10', name: 'MAC-10', slot: 'primary', kind: 'smg', team: 0, price: 1050, dmg: 29, ap: 0.57, rpm: 800, mag: 30, reserve: 100,
      reload: 2.6, speed: 0.96, spread: 1.6, moveSpread: 4, burst: 0.55, burstMax: 8, reward: 600, rangeMod: 0.85 }),
  W({ id: 'mp9', name: 'MP9', slot: 'primary', kind: 'smg', team: 1, price: 1250, dmg: 26, ap: 0.6, rpm: 857, mag: 30, reserve: 120,
      reload: 2.6, speed: 0.96, spread: 1.4, moveSpread: 3.5, burst: 0.5, burstMax: 8, reward: 600, rangeMod: 0.86 }),
  W({ id: 'mp7', name: 'MP7', slot: 'primary', kind: 'smg', price: 1500, dmg: 29, ap: 0.63, rpm: 750, mag: 30, reserve: 120,
      reload: 3.1, speed: 0.88, spread: 1.3, moveSpread: 4, burst: 0.5, burstMax: 8, reward: 600, rangeMod: 0.87 }),
  W({ id: 'ump45', name: 'UMP-45', slot: 'primary', kind: 'smg', price: 1200, dmg: 35, ap: 0.65, rpm: 666, mag: 25, reserve: 100,
      reload: 3.5, speed: 0.92, spread: 1.3, moveSpread: 4.5, burst: 0.6, burstMax: 7, reward: 600, rangeMod: 0.85 }),
  W({ id: 'p90', name: 'P90', slot: 'primary', kind: 'smg', price: 2350, dmg: 26, ap: 0.69, rpm: 857, mag: 50, reserve: 100,
      reload: 3.3, speed: 0.92, spread: 1.5, moveSpread: 3.5, burst: 0.4, burstMax: 10, reward: 300, rangeMod: 0.86 }),

  // ---- rifles
  W({ id: 'galil', name: 'Galil AR', slot: 'primary', kind: 'rifle', team: 0, price: 1800, dmg: 30, ap: 0.775, rpm: 666, mag: 35, reserve: 90,
      reload: 2.5, speed: 0.86, spread: 1.0, moveSpread: 6.5, burst: 0.55, burstMax: 8, reward: 300, rangeMod: 0.98 }),
  W({ id: 'famas', name: 'FAMAS', slot: 'primary', kind: 'rifle', team: 1, price: 2050, dmg: 31, ap: 0.775, rpm: 666, mag: 25, reserve: 90,
      reload: 3.3, speed: 0.88, spread: 0.9, moveSpread: 6, burst: 0.5, burstMax: 8, reward: 300, rangeMod: 0.98 }),
  W({ id: 'ak47', name: 'AK-47', slot: 'primary', kind: 'rifle', team: 0, price: 2700, dmg: 36, ap: 0.775, rpm: 600, mag: 30, reserve: 90,
      reload: 2.5, speed: 0.86, spread: 0.5, moveSpread: 7, burst: 0.75, burstMax: 7, reward: 300, rangeMod: 0.98, kick: 1.4 }),
  W({ id: 'm4a4', name: 'M4A4', slot: 'primary', kind: 'rifle', team: 1, price: 3100, dmg: 34, ap: 0.76, rpm: 666, mag: 30, reserve: 90,
      reload: 3.1, speed: 0.9, spread: 0.4, moveSpread: 6.5, burst: 0.6, burstMax: 7, reward: 300, rangeMod: 0.97, kick: 1.2 }),
  W({ id: 'm4a1s', name: 'M4A1-S', slot: 'primary', kind: 'rifle', team: 1, price: 2900, dmg: 34, ap: 0.76, rpm: 600, mag: 20, reserve: 40,
      reload: 2.3, speed: 0.9, spread: 0.35, moveSpread: 6.5, burst: 0.5, burstMax: 7, reward: 300, rangeMod: 0.98, suppressed: true }),
  W({ id: 'sg553', name: 'SG 553', slot: 'primary', kind: 'rifle', team: 0, price: 3000, dmg: 30, ap: 1.0, rpm: 666, mag: 30, reserve: 90,
      reload: 2.8, speed: 0.84, spread: 0.7, moveSpread: 6.5, burst: 0.6, burstMax: 7, reward: 300, rangeMod: 0.98, scope: 1, scopedSpread: 0.25 }),
  W({ id: 'aug', name: 'AUG', slot: 'primary', kind: 'rifle', team: 1, price: 3300, dmg: 28, ap: 0.9, rpm: 666, mag: 30, reserve: 90,
      reload: 3.8, speed: 0.88, spread: 0.7, moveSpread: 6.5, burst: 0.55, burstMax: 7, reward: 300, rangeMod: 0.98, scope: 1, scopedSpread: 0.25 }),

  // ---- snipers
  W({ id: 'ssg08', name: 'SSG 08', slot: 'primary', kind: 'sniper', price: 1700, dmg: 88, ap: 0.85, rpm: 48, mag: 10, reserve: 90,
      reload: 3.7, speed: 0.92, auto: false, spread: 2.6, moveSpread: 5, burst: 0, burstMax: 0, reward: 300, rangeMod: 0.99, scope: 2, scopedSpread: 0.05, kick: 2 }),
  W({ id: 'awp', name: 'AWP', slot: 'primary', kind: 'sniper', price: 4750, dmg: 115, ap: 0.975, rpm: 41, mag: 10, reserve: 30,
      reload: 3.7, speed: 0.8, auto: false, spread: 4.5, moveSpread: 8, burst: 0, burstMax: 0, reward: 100, rangeMod: 0.995, scope: 2, scopedSpread: 0.03, kick: 3, draw: 0.6 }),

  // ---- shotguns
  W({ id: 'nova', name: 'Nova', slot: 'primary', kind: 'shotgun', price: 1050, dmg: 26, ap: 0.5, rpm: 68, mag: 8, reserve: 32, pellets: 9,
      reload: 3.6, speed: 0.88, auto: false, spread: 3.6, moveSpread: 2, burst: 0, burstMax: 0, reward: 900, rangeMod: 0.7, kick: 2.5 }),
  W({ id: 'xm1014', name: 'XM1014', slot: 'primary', kind: 'shotgun', price: 2000, dmg: 20, ap: 0.8, rpm: 171, mag: 7, reserve: 32, pellets: 6,
      reload: 3.2, speed: 0.86, auto: false, spread: 3.2, moveSpread: 2, burst: 0.3, burstMax: 3, reward: 900, rangeMod: 0.72, kick: 2 }),
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

// Held-item codes sent over the network: gun index, or 100+ for grenades, 120 for bomb
export const HELD_GREN_BASE = 100;
export const HELD_BOMB = 120;

export const DEFAULT_SECONDARY = { 0: 'glock', 1: 'usp' };

export function canTeamUse(w, team) { return w.team === -1 || w.team === team; }

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Current inaccuracy half-angle (radians). */
export function weaponSpread(w, speed, burst, scoped) {
  if (w.kind === 'knife') return 0;
  const s = scoped && w.scope;
  const maxV = BASE_SPEED * w.speed;
  const mf = clamp((speed / maxV - 0.35) / 0.65, 0, 1);
  const base = s ? w.scopedSpread : w.spread;
  const deg = base + w.moveSpread * mf * (s ? 1.4 : 1) + w.burst * Math.min(burst, w.burstMax);
  return deg * Math.PI / 180;
}

/** Max movement speed in px/s for a given weapon and key state. */
export function maxSpeedFor(w, walking, scoped) {
  let v = (w ? w.speedPx : BASE_SPEED);
  if (scoped && w && w.scope) v *= w.scope === 2 ? 0.55 : 0.7;
  if (walking) v *= 0.5;
  return v;
}

/** Applies armor to raw damage. Returns [healthDamage, armorDamage]. */
export function applyArmor(dmg, ap, armor) {
  if (armor <= 0) return [dmg, 0];
  let health = dmg * ap;
  let armorDmg = (dmg - health) * 0.5;
  if (armorDmg > armor) {
    armorDmg = armor;
    health = dmg - armorDmg * 2;
  }
  return [health, armorDmg];
}

export function buyItems(team) {
  const list = [];
  for (const w of WEAPON_LIST) {
    if (w.kind === 'knife' || w.price === 0) continue;
    if (w.team !== -1 && w.team !== team) continue;
    list.push(w.id);
  }
  return list;
}
