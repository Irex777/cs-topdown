import { PLAYER_R, SPEC, GREN_ORDER, GRENADE, EYE_H, EYE_H_CROUCH, BODY_H, BODY_H_CROUCH } from '../shared/constants.js';
import {
  WEAPONS, resolveWeapon, defaultLoadout, sanitizeLoadout, GADGETS, GADGET_LIST, CLASSES, ALT, HELD_GREN_BASE, HELD_GADGET_BASE,
} from '../shared/weapons.js';

const HIST = 64;

export class Player {
  constructor(id, name, conn) {
    this.id = id;
    this.name = name;
    this.conn = conn;          // websocket for humans, null for bots
    this.bot = null;           // BotBrain for bots
    this.isBot = false;
    this.team = SPEC;
    this.squad = -1;
    this.connected = true;
    this.token = null;
    this.ping = 0;
    this.stats = newStats();
    this.cmdQ = [];
    this.lastSeq = 0;
    this.qSeq = 0;
    this.leftAt = 0;
    this.lastChat = 0;
    this.lastPing = 0;
    this.specId = 0;           // who this (dead/spectating) player is following
    this.chatCd = 0;
    this.loadout = defaultLoadout('assault');   // what the player picked; applied when they spawn
    this.resetSim();
  }

  resetSim() {
    this.cmdQ.length = 0;
    this.lastSeq = 0; this.qSeq = 0;
    this.alive = false;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.angle = 0;
    this.z = 0; this.vz = 0; this.cf = 0; this.pitch = 0;      // feet height, vertical speed, crouch factor 0..1, look pitch (up +)
    this.hp = 100; this.armor = 0;
    this.veh = 0; this.seat = 0;
    this.heldBody = 0; this.throwLock = false;
    this.cls = this.loadout ? this.loadout.cls : 'assault';
    this.primaryW = null; this.secondaryW = null;
    this.gadgets = [null, null];
    this.grenades = { he: 0, flash: 0, smoke: 0, molo: 0 };
    this.am = { primary: { clip: 0, reserve: 0 }, secondary: { clip: 0, reserve: 0 }, alt: { clip: 0, reserve: 0 } };
    this.sel = 'primary'; this.gsel = 'he'; this.lastSel = 'secondary'; this.altMode = false;
    this.clickBuf = 0; this.reloadTotal = 1;
    this.fireCd = 0; this.reloadT = 0; this.drawT = 0; this.burst = 0; this.burstT = 0; this.prevFire = false; this.prevScope = false;
    this.scoped = false; this.walking = false; this.sprinting = false;
    this.usePrev = false; this.useT = 0; this.useKind = '';
    this.flashUntil = 0; this.flashFullUntil = 0;
    this.stepAcc = 0;
    this.dmgFrom = new Map();
    this.deadAt = 0;
    this.respawnAt = 0;
    this.spawnProt = 0;
    this.respawnCounter = 0;
    this.lastKeys = 0; this.lastAim = 0;
    this.lastHurt = -99; this.lastShot = -99;
    this.spotUntil = 0;
    this.lockTarget = 0; this.lockT = 0;
    this.reviveProg = 0; this.repairAcc = 0; this.healAcc = 0;
    this.pendingSpawn = null;
    this.killedBy = 0;
    this.hx = new Float32Array(HIST); this.hy = new Float32Array(HIST); this.hz = new Float32Array(HIST); this.hc = new Float32Array(HIST); this.ha = new Uint8Array(HIST); this.ht = new Float64Array(HIST);
    this.streak = 0;
  }

  get speed() { return Math.hypot(this.vx, this.vy); }
  get radius() { return PLAYER_R; }
  get onFoot() { return this.alive && !this.veh; }
  /** height of the eyes / hit box above the ground for the current stance */
  get eyeZ() { return this.z + EYE_H + (EYE_H_CROUCH - EYE_H) * this.cf; }
  get bodyH() { return BODY_H + (BODY_H_CROUCH - BODY_H) * this.cf; }

  record(tick) {
    const i = tick % HIST;
    this.hx[i] = this.x; this.hy[i] = this.y; this.hz[i] = this.z; this.hc[i] = this.cf; this.ha[i] = this.alive && !this.veh ? 1 : 0; this.ht[i] = tick;
  }

  /** Position at fractional tick tf (lag compensation). Falls back to the current position. */
  rewound(tf, out) {
    const i0 = Math.floor(tf), i1 = i0 + 1;
    const a = i0 % HIST, b = i1 % HIST;
    if (i0 < 1 || this.ht[a] !== i0 || this.ht[b] !== i1) { out.x = this.x; out.y = this.y; out.z = this.z; out.cf = this.cf; out.alive = this.alive && !this.veh; return out; }
    const k = tf - i0;
    out.x = this.hx[a] + (this.hx[b] - this.hx[a]) * k;
    out.y = this.hy[a] + (this.hy[b] - this.hy[a]) * k;
    out.z = this.hz[a] + (this.hz[b] - this.hz[a]) * k;
    out.cf = this.hc[a] + (this.hc[b] - this.hc[a]) * k;
    out.alive = this.ha[a] === 1 && this.ha[b] === 1;
    return out;
  }

  // ---------- inventory ----------
  /** The gun currently in hand (resolved with attachments), the knife, or null for gadgets and grenades. */
  weapon() {
    if (this.sel === 'primary') return this.primaryW;
    if (this.sel === 'secondary') return this.secondaryW;
    if (this.sel === 'knife') return WEAPONS.knife;
    return null;
  }
  gadget() {
    if (this.sel === 'gadget0') return this.gadgets[0];
    if (this.sel === 'gadget1') return this.gadgets[1];
    return null;
  }
  isGrenadeSelected() { return this.sel === 'grenade'; }
  totalGrenades() { let n = 0; for (const k of GREN_ORDER) n += this.grenades[k]; return n; }

  /** Compact code for what's in the player's hands (sent to clients). */
  heldCode() {
    if (this.sel === 'grenade') return HELD_GREN_BASE + Math.max(0, GREN_ORDER.indexOf(this.gsel));
    const g = this.gadget();
    if (g) return HELD_GADGET_BASE + g.def.idx;
    const w = this.weapon();
    return w ? w.idx : 0;
  }

  /** ammo record of the selected gun (primary / secondary), or the alt-fire record while an underbarrel is selected */
  ammoOf(w) {
    if (!w) return { clip: 0, reserve: 0 };
    if (this.altMode && w.alt && (this.sel === 'primary')) return this.am.alt;
    if (this.sel === 'primary') return this.am.primary;
    if (this.sel === 'secondary') return this.am.secondary;
    return { clip: 0, reserve: 0 };
  }

  /** Applies the chosen loadout and fills every magazine, gadget and grenade. */
  equip() {
    const lo = sanitizeLoadout(this.loadout);
    this.loadout = lo;
    this.cls = lo.cls;
    this.primaryW = resolveWeapon(lo.primary.id, lo.primary.att);
    this.secondaryW = resolveWeapon(lo.secondary.id, lo.secondary.att);
    this.am.primary = { clip: this.primaryW.mag, reserve: this.primaryW.reserve };
    this.am.secondary = { clip: this.secondaryW.mag, reserve: this.secondaryW.reserve };
    const alt = this.primaryW.alt ? ALT[this.primaryW.alt] : null;
    this.am.alt = alt ? { clip: alt.mag, reserve: alt.reserve } : { clip: 0, reserve: 0 };
    this.altMode = false;
    this.gadgets = lo.gadgets.map((id) => ({ id, def: GADGETS[id], charges: GADGETS[id].charges, loaded: true }));
    const c = CLASSES[lo.cls];
    this.grenades = { he: 0, flash: 0, smoke: 0, molo: 0 };
    this.grenades[lo.gren] = Math.min(GRENADE[lo.gren].max, c.grenCount + (lo.gren === 'he' ? 0 : 0));
    this.gsel = lo.gren;
    this.sel = 'primary';
    this.lastSel = 'secondary';
    this.reloadT = 0; this.burst = 0; this.scoped = false;
    this.drawT = 0.3;
  }

  /** Refills ammo (fraction 0..1 of a full load) and grenades; used by ammo crates. */
  resupply(frac = 1) {
    let did = false;
    for (const slot of ['primary', 'secondary']) {
      const w = slot === 'primary' ? this.primaryW : this.secondaryW;
      if (!w) continue;
      const am = this.am[slot];
      const full = w.reserve + w.mag;
      const have = am.clip + am.reserve;
      if (have < full) { am.reserve = Math.min(w.reserve + (w.mag - am.clip), am.reserve + Math.ceil(w.mag * frac)); did = true; }
    }
    const alt = this.primaryW && this.primaryW.alt ? ALT[this.primaryW.alt] : null;
    if (alt && this.am.alt.reserve < alt.reserve) { this.am.alt.reserve = Math.min(alt.reserve, this.am.alt.reserve + 1); did = true; }
    for (const g of this.gadgets) {
      if (g && g.def.kind === 'launcher' && g.charges < g.def.charges) { g.charges = Math.min(g.def.charges, g.charges + 1); did = true; }
    }
    const c = CLASSES[this.cls];
    const gt = this.loadout.gren;
    if (this.grenades[gt] < c.grenCount) { this.grenades[gt]++; did = true; }
    return did;
  }

  /** If the selected slot is empty (grenades thrown, gadget used up), fall back to the primary weapon. Returns true if changed. */
  fixSelection() {
    const bad = (this.sel === 'grenade' && this.totalGrenades() === 0) || (this.sel === 'primary' && !this.primaryW);
    if (!bad) return false;
    this.sel = this.primaryW ? 'primary' : 'secondary';
    this.reloadT = 0; this.scoped = false; this.drawT = 0.3;
    return true;
  }
}

export function newStats() {
  return { kills: 0, deaths: 0, assists: 0, score: 0, revives: 0, captures: 0, damage: 0, heals: 0, repairs: 0, vehicleKills: 0 };
}

export { GADGET_LIST };
