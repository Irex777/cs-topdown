import { RULES, PLAYER_R, SPEC, GRENADE, GREN_ORDER, MAX_GRENADES } from '../shared/constants.js';
import { WEAPONS, DEFAULT_SECONDARY, HELD_GREN_BASE } from '../shared/weapons.js';

const HIST = 64;

export class Player {
  constructor(id, name, conn) {
    this.id = id;
    this.name = name;
    this.conn = conn;          // websocket for humans, null for bots
    this.bot = null;           // BotBrain for bots
    this.isBot = false;
    this.team = SPEC;
    this.connected = true;
    this.token = null;
    this.ping = 0;
    this.stats = { kills: 0, deaths: 0, assists: 0, score: 0, mvps: 0, damage: 0 };
    this.cmdQ = [];
    this.lastSeq = 0;
    this.qSeq = 0;
    this.leftAt = 0;
    this.lastChat = 0;
    this.lastPing = 0;
    this.specId = 0;           // who this (dead/spectating) player is following
    this.chatCd = 0;
    this.resetSim();
  }

  resetSim() {
    this.alive = false;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.angle = 0;
    this.hp = 100; this.armor = 0; this.helmet = false; this.kit = false; this.hasBomb = false;
    this.money = RULES.startMoney;
    this.primary = null; this.secondary = null;
    this.grenades = { he: 0, flash: 0, smoke: 0, molo: 0 };
    this.ammo = {};
    this.sel = 'secondary'; this.gsel = 'he'; this.lastSel = 'primary';
    this.clickBuf = 0; this.reloadTotal = 1; this.resetEquip = false;
    this.fireCd = 0; this.reloadT = 0; this.drawT = 0; this.burst = 0; this.burstT = 0; this.prevFire = false;
    this.scoped = false; this.walking = false;
    this.planting = 0; this.defusing = 0; this.usePrev = false;
    this.flashUntil = 0; this.flashFullUntil = 0;
    this.stepAcc = 0;
    this.dmgFrom = new Map();
    this.respawnAt = 0;
    this.spawnProt = 0;
    this.respawnCounter = 0;
    this.lastKeys = 0; this.lastAim = 0;
    this.hx = new Float32Array(HIST); this.hy = new Float32Array(HIST); this.ha = new Uint8Array(HIST); this.ht = new Float64Array(HIST);
    this.dropLock = 0;
    this.roundKills = 0; this.roundDamage = 0;
    this.buys = [];
    this.lastBuys = [];
  }

  get speed() { return Math.hypot(this.vx, this.vy); }
  get radius() { return PLAYER_R; }

  record(tick) {
    const i = tick % HIST;
    this.hx[i] = this.x; this.hy[i] = this.y; this.ha[i] = this.alive ? 1 : 0; this.ht[i] = tick;
  }

  /** Position at fractional tick tf (lag compensation). Falls back to the current position. */
  rewound(tf, out) {
    const i0 = Math.floor(tf), i1 = i0 + 1;
    const a = i0 % HIST, b = i1 % HIST;
    if (i0 < 1 || this.ht[a] !== i0 || this.ht[b] !== i1) { out.x = this.x; out.y = this.y; out.alive = this.alive; return out; }
    const k = tf - i0;
    out.x = this.hx[a] + (this.hx[b] - this.hx[a]) * k;
    out.y = this.hy[a] + (this.hy[b] - this.hy[a]) * k;
    out.alive = this.ha[a] === 1 && this.ha[b] === 1;
    return out;
  }

  // ---------- inventory ----------
  weapon() {
    if (this.sel === 'primary') return this.primary ? WEAPONS[this.primary] : null;
    if (this.sel === 'secondary') return this.secondary ? WEAPONS[this.secondary] : null;
    if (this.sel === 'knife') return WEAPONS.knife;
    return null;
  }
  isGrenadeSelected() { return this.sel === 'grenade'; }
  totalGrenades() { let n = 0; for (const k of GREN_ORDER) n += this.grenades[k]; return n; }
  canCarryGrenade(type) { return this.grenades[type] < GRENADE[type].max && this.totalGrenades() < MAX_GRENADES; }

  /** Compact code for what's in the player's hands (sent to clients). */
  heldCode() {
    if (this.sel === 'grenade') return HELD_GREN_BASE + Math.max(0, GREN_ORDER.indexOf(this.gsel));
    const w = this.weapon();
    return w ? w.idx : 0;
  }

  giveWeapon(id, full = true) {
    const w = WEAPONS[id];
    if (!w) return;
    if (w.slot === 'primary') this.primary = id; else if (w.slot === 'secondary') this.secondary = id;
    if (full || !this.ammo[id]) this.ammo[id] = { clip: w.mag, reserve: w.reserve };
  }

  giveDefaults(team) {
    this.secondary = null;
    this.giveWeapon(DEFAULT_SECONDARY[team]);
  }

  ammoOf(w) { return w && this.ammo[w.id] ? this.ammo[w.id] : { clip: 0, reserve: 0 }; }
}
