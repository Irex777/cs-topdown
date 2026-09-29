// One match: rounds, economy, bomb, players. Owned by a Room.
import { T, CT, SPEC, PHASE, RULES, KEY, DT, GRENADE, armorCost, otherTeam } from '../shared/constants.js';
import { WEAPONS, canTeamUse, maxSpeedFor } from '../shared/weapons.js';
import { stepMovement } from '../shared/movement.js';
import { getMap } from '../shared/maps/index.js';
import { Player } from './player.js';
import { tryFire, tickWeaponTimers, selectSlot, damagePlayer } from './combat.js';
import { updateGrenades, updateFires, updateSmokes } from './grenades.js';
import { buildSnapshot } from './snapshot.js';
import { BotBrain, BOT_NAMES, TeamMind } from './bot/brain.js';
import { NavGrid } from './bot/nav.js';

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const navCache = new Map();

export class Game {
  constructor(room) {
    this.room = room;
    this.settings = room.settings;
    this.mode = room.settings.mode;                 // 'defuse' | 'dm'
    this.map = getMap(room.settings.map);
    if (!navCache.has(this.map.id)) navCache.set(this.map.id, new NavGrid(this.map));
    this.nav = navCache.get(this.map.id);
    this.mind = new TeamMind(this);
    this.tick = 0;
    this.time = 0;
    this.phase = PHASE.FREEZE;
    this.timer = 0;
    this.round = 0;
    this.score = [0, 0];
    this.lossStreak = [0, 0];
    this.target = this.mode === 'dm' ? RULES.dmKills : Math.floor(this.settings.rounds / 2) + 1;
    this.regulation = this.settings.rounds;
    this.otRounds = 0;
    this.overtime = false;
    this.grenades = [];
    this.smokes = [];
    this.fires = [];
    this.drops = [];
    this.events = [];
    this.nextId = 1;
    this.bomb = { state: 'none', x: 0, y: 0, carrier: 0, planted: 0, site: -1, timer: 0, defuser: 0 };
    this.startCount = [0, 0];
    this.plantedThisRound = false;
    this.mvp = 0;
    this.matchWinner = -1;
    this.roundStartedAt = 0;
  }

  get players() { return this.room.players; }
  get ff() { return !!this.settings.friendlyFire; }

  // ------------------------------------------------------------------ events / messages
  emit(payload, x, y, range = 1800, to = 0) {
    this.events.push({ p: payload, x, y, r: range, to });
    const k = payload[0];
    if (k === 'step' || k === 'shot') {
      const src = this.players.get(payload[1]);
      if (!src) return;
      const reach = k === 'step' ? 520 : payload[9] ? 700 : 1500;
      for (const b of this.players.values()) {
        if (!b.bot || !b.alive || b.team === src.team) continue;
        const d = Math.hypot(b.x - x, b.y - y);
        if (d < reach) b.bot.hear(x, y, k);
      }
    }
  }
  broadcast(msg) { this.room.broadcast(msg); }
  aliveCount(team) { let n = 0; for (const p of this.players.values()) if (p.alive && p.team === team) n++; return n; }
  teamPlayers(team) { const a = []; for (const p of this.players.values()) if (p.team === team) a.push(p); return a; }

  // ------------------------------------------------------------------ match lifecycle
  startMatch() {
    for (const p of this.players.values()) { p.stats = { kills: 0, deaths: 0, assists: 0, score: 0, mvps: 0, damage: 0 }; p.resetSim(); }
    this.round = 0; this.score = [0, 0]; this.lossStreak = [0, 0];
    this.startRound(true);
  }

  startRound(fresh = false) {
    this.round++;
    this.grenades.length = 0; this.smokes.length = 0; this.fires.length = 0; this.drops.length = 0;
    this.bomb = { state: 'none', x: 0, y: 0, carrier: 0, planted: 0, site: -1, timer: 0, defuser: 0 };
    this.plantedThisRound = false;
    this.room.rebalanceBots(true);
    const spawnOrder = [shuffle(this.map.spawns[T].slice()), shuffle(this.map.spawns[CT].slice())];
    const idx = [0, 0];
    for (const p of this.players.values()) {
      if (p.team === SPEC) { p.alive = false; continue; }
      const keep = !fresh && p.alive && !p.resetEquip;
      this.spawn(p, spawnOrder[p.team][idx[p.team]++ % spawnOrder[p.team].length], keep, idx[p.team]);
      p.resetEquip = false;
    }
    this.startCount = [this.aliveCount(T), this.aliveCount(CT)];
    if (this.mode === 'defuse') {
      this.mind.newRound();
      const ts = this.teamPlayers(T).filter((p) => p.alive);
      if (ts.length) {
        const c = ts[Math.floor(Math.random() * ts.length)];
        c.hasBomb = true;
        this.bomb = { state: 'carried', x: c.x, y: c.y, carrier: c.id, planted: 0, site: -1, timer: 0, defuser: 0 };
      }
      this.phase = PHASE.FREEZE;
      this.timer = RULES.freezeTime;
    } else {
      this.phase = PHASE.LIVE;
      this.timer = RULES.dmTime;
    }
    this.roundStartedAt = this.time;
    this.mvp = 0;
    for (const p of this.players.values()) { p.roundKills = 0; p.roundDamage = 0; p.buys = []; }
    this.broadcast({ t: 'round_start', round: this.round, phase: this.phase, score: this.score, target: this.target, mode: this.mode });
    this.room.sendRoster();
  }

  spawn(p, pt, keepEquip, slot = 0) {
    if (!keepEquip) {
      p.primary = null; p.secondary = null; p.armor = 0; p.helmet = false; p.kit = false;
      p.grenades = { he: 0, flash: 0, smoke: 0, molo: 0 }; p.ammo = {};
      p.giveDefaults(p.team);
      if (this.mode === 'dm') p.money = RULES.maxMoney;
    }
    if (!p.secondary) p.giveDefaults(p.team);
    p.alive = true; p.hp = 100; p.hasBomb = false;
    const jx = slot > 12 ? (Math.random() - 0.5) * 24 : 0, jy = slot > 12 ? (Math.random() - 0.5) * 24 : 0;
    const fr = this.map.nearestFree(pt.x + jx, pt.y + jy);
    p.x = fr.x; p.y = fr.y; p.vx = 0; p.vy = 0;
    const face = this.map.spawnCenter[otherTeam(p.team)];
    p.angle = Math.atan2(face.y - p.y, face.x - p.x);
    p.fireCd = 0; p.reloadT = 0; p.drawT = 0.3; p.burst = 0; p.scoped = false;
    p.planting = 0; p.defusing = 0; p.flashUntil = 0; p.flashFullUntil = 0;
    p.dmgFrom.clear();
    p.sel = p.primary ? 'primary' : 'secondary';
    p.spawnProt = this.mode === 'dm' ? 2.0 : 0;
    p.respawnCounter = (p.respawnCounter + 1) & 255;
    p.cmdQ.length = 0;
    p.dropLock = 0;
    // refill ammo for a fresh loadout, keep it for survivors
    if (!keepEquip) for (const id of Object.keys(p.ammo)) { const w = WEAPONS[id]; p.ammo[id] = { clip: w.mag, reserve: w.reserve }; }
    if (this.mode === 'dm' && !p.bot) this.rebuy(p, true);
    if (p.bot) p.bot.onSpawn();
  }

  endRound(winner, reason) {
    if (this.phase !== PHASE.LIVE) return;
    this.phase = PHASE.POST;
    this.timer = RULES.postTime;
    if (winner === T || winner === CT) {
      this.score[winner]++;
      const loser = otherTeam(winner);
      for (const p of this.players.values()) {
        if (p.team === winner) this.addMoney(p, RULES.winMoney);
        else if (p.team === loser) {
          this.addMoney(p, Math.min(RULES.lossMax, RULES.lossBase + RULES.lossStep * this.lossStreak[loser]));
          if (loser === T && this.plantedThisRound) this.addMoney(p, RULES.plantTeamBonus);
        }
      }
      this.lossStreak[loser]++;
      this.lossStreak[winner] = Math.max(0, this.lossStreak[winner] - 1);
    }
    // round MVP
    let best = null;
    for (const p of this.players.values()) {
      if (p.team !== winner) continue;
      let v = p.roundKills * 10 + p.roundDamage / 50 + (p.alive ? 2 : 0);
      if ((reason === 'bomb' && this.bomb.planter === p.id) || (reason === 'defused' && this.bomb.defusedBy === p.id)) v += 100;
      if (!best || v > best.v) best = { p, v };
    }
    if (best && (best.v > 0)) { best.p.stats.mvps++; this.mvp = best.p.id; }
    // did the match end?
    this.matchWinner = -1;
    if (this.score[T] >= this.target) this.matchWinner = T;
    else if (this.score[CT] >= this.target) this.matchWinner = CT;
    else if (this.score[0] === this.score[1] && this.round >= this.regulation && this.regulation > 0 && !this.overtime) {
      // tied at the end of regulation -> overtime
    }
    this.broadcast({
      t: 'round_end', winner, reason, score: this.score, mvp: this.mvp, round: this.round, matchOver: this.matchWinner >= 0,
      streak: this.lossStreak,
    });
    this.room.sendRoster();
  }

  nextRoundOrFinish() {
    if (this.matchWinner >= 0) {
      this.phase = PHASE.OVER;
      this.timer = 12;
      this.broadcast({ t: 'match_over', winner: this.matchWinner, score: this.score });
      this.room.sendRoster();
      return;
    }
    let swapped = false;
    const half = Math.floor(this.regulation / 2);
    if (!this.overtime && this.round === half) swapped = true;
    if (!this.overtime && this.round >= this.regulation && this.score[0] === this.score[1]) {
      // overtime: first to (score + 4), swap every 3
      this.overtime = true; this.otRounds = 0; this.target = this.score[0] + 4; swapped = true;
    } else if (this.overtime) {
      this.otRounds++;
      if (this.otRounds % RULES.overtimeRounds === 0 && this.score[0] === this.score[1]) { this.target = this.score[0] + 4; swapped = true; }
      else if (this.otRounds % 3 === 0) swapped = true;
    }
    if (swapped) this.swapSides(this.overtime);
    this.startRound(swapped);
  }

  swapSides(overtimeMoney) {
    this.score = [this.score[1], this.score[0]];
    this.lossStreak = [0, 0];
    for (const p of this.players.values()) {
      if (p.team === T) p.team = CT; else if (p.team === CT) p.team = T;
      p.resetEquip = true;
      p.money = overtimeMoney ? RULES.overtimeMoney : RULES.startMoney;
    }
    this.broadcast({ t: 'swap', overtime: this.overtime });
  }

  addMoney(p, amt) { p.money = Math.max(0, Math.min(RULES.maxMoney, p.money + amt)); }

  // ------------------------------------------------------------------ player management
  removePlayer(p) {
    if (this.bomb.carrier === p.id && p.alive) this.dropBomb(p);
    p.alive = false;
  }

  onTeamChange(p) {
    if (p.alive) { p.alive = false; if (p.hasBomb) this.dropBomb(p); }
    p.hasBomb = false;
    p.cmdQ.length = 0;
    p.resetEquip = true;
    p.money = this.mode === 'dm' ? RULES.maxMoney : Math.max(p.money, this.round > 1 ? p.money : RULES.startMoney);
    if (this.mode === 'dm' && p.team !== SPEC) p.respawnAt = this.time + 0.5;
  }

  // ------------------------------------------------------------------ main tick
  update() {
    this.tick++;
    this.time = this.tick * DT;
    const dt = DT;

    // phase timers
    if (this.mode === 'defuse') {
      this.timer -= dt;
      if (this.phase === PHASE.FREEZE && this.timer <= 0) { this.phase = PHASE.LIVE; this.timer = RULES.roundTime; this.roundStartedAt = this.time; this.broadcast({ t: 'live' }); }
      else if (this.phase === PHASE.POST && this.timer <= 0) this.nextRoundOrFinish();
      else if (this.phase === PHASE.OVER && this.timer <= 0) { this.room.endMatch(); return; }
    } else {
      this.timer -= dt;
      if (this.phase === PHASE.LIVE && (this.timer <= 0 || this.score[0] >= this.target || this.score[1] >= this.target)) {
        this.phase = PHASE.OVER; this.timer = 12;
        this.matchWinner = this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? T : CT;
        this.broadcast({ t: 'match_over', winner: this.matchWinner, score: this.score });
        this.room.sendRoster();
      } else if (this.phase === PHASE.OVER && this.timer <= 0) { this.room.endMatch(); return; }
    }

    // players
    for (const p of this.players.values()) this.updatePlayer(p, dt);
    updateGrenades(this, dt);
    updateFires(this, dt);
    updateSmokes(this, dt);
    this.updateBomb(dt);
    if (this.mode === 'defuse') this.mind.update(dt);
    this.updateDrops(dt);
    if (this.mode === 'defuse') this.checkRoundEnd();
    for (const p of this.players.values()) p.record(this.tick);
  }

  updatePlayer(p, dt) {
    if (p.team === SPEC) return;
    if (p.spawnProt > 0) p.spawnProt -= dt;
    if (!p.alive) {
      p.cmdQ.length = 0;
      if (this.mode === 'dm' && p.respawnAt && this.time >= p.respawnAt && this.phase === PHASE.LIVE) {
        p.respawnAt = 0;
        const sp = this.map.spawns[p.team];
        this.spawn(p, sp[Math.floor(Math.random() * sp.length)], false, 0);
      }
      return;
    }
    tickWeaponTimers(this, p, dt);
    if (p.bot) {
      const c = p.bot.think(dt);
      this.applyCmd(p, c.keys, c.angle, 0, c.aimDist, c.ax, c.ay);
    } else {
      const q = p.cmdQ;
      let n = q.length > 8 ? 4 : q.length > 3 ? 2 : 1;
      while (n-- > 0 && q.length) {
        const c = q.shift();
        this.applyCmd(p, c[1], c[2], c[3], c[4]);
        p.lastSeq = c[0];
        if (!p.alive) break;
      }
    }
  }

  applyCmd(p, keys, angle, vt, aimDist, ax, ay) {
    p.angle = angle;
    p.lastKeys = keys;
    const w = p.weapon();
    const wantScope = (keys & KEY.SCOPE) !== 0 && !!w && w.scope > 0;
    p.scoped = wantScope;
    p.walking = (keys & KEY.WALK) !== 0;
    const frozen = this.phase === PHASE.FREEZE && this.mode === 'defuse';
    stepMovement(this.map, p, keys, maxSpeedFor(w, p.walking, p.scoped), frozen, ax, ay);
    // footsteps
    const sp = p.speed;
    if (!p.walking && sp > 70) {
      p.stepAcc += sp * DT;
      if (p.stepAcc > 64) { p.stepAcc = 0; this.emit(['step', p.id, Math.round(p.x), Math.round(p.y), p.team], p.x, p.y, 640); }
    } else if (sp <= 70) p.stepAcc = Math.max(p.stepAcc, 40);
    this.handleUse(p, (keys & KEY.USE) !== 0);
    if (this.bomb.state === 'carried' && this.bomb.carrier === p.id) { this.bomb.x = p.x; this.bomb.y = p.y; }
    const fire = (keys & KEY.FIRE) !== 0;
    if (this.phase === PHASE.LIVE || this.mode === 'dm') tryFire(this, p, fire, !p.prevFire && fire, vt, aimDist);
    p.prevFire = fire;
    this.checkPickups(p);
  }

  // ------------------------------------------------------------------ use (plant / defuse / pickup)
  handleUse(p, held) {
    const edge = held && !p.usePrev;
    p.usePrev = held;
    if (!held) { p.planting = 0; if (p.defusing) { p.defusing = 0; if (this.bomb.defuser === p.id) this.bomb.defuser = 0; } return; }
    if (this.mode !== 'defuse') { if (edge) this.pickupNearest(p); return; }
    const b = this.bomb;
    if (p.team === T && p.hasBomb && b.state === 'carried' && this.phase === PHASE.LIVE) {
      const site = this.map.siteAt(p.x, p.y);
      if (site && p.speed < 30) {
        if (p.planting === 0) this.emit(['plant_start', p.id, p.x, p.y], p.x, p.y, 900);
        p.planting += DT;
        if (p.planting >= RULES.plantTime) this.plantBomb(p, site - 1);
        return;
      }
      p.planting = 0;
    }
    if (p.team === CT && b.state === 'planted' && p.alive) {
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < 44 && p.speed < 30 && (b.defuser === 0 || b.defuser === p.id)) {
        if (!p.defusing) { b.defuser = p.id; this.emit(['defuse_start', p.id, b.x, b.y], b.x, b.y, 900); }
        p.defusing += DT;
        const need = p.kit ? RULES.defuseTimeKit : RULES.defuseTime;
        if (p.defusing >= need) this.defuseBomb(p);
        return;
      }
      p.defusing = 0;
      if (b.defuser === p.id) b.defuser = 0;
    }
    if (edge) this.pickupNearest(p);
  }

  plantBomb(p, site) {
    const b = this.bomb;
    const fr = this.map.nearestFree(p.x, p.y);
    b.state = 'planted'; b.x = fr.x; b.y = fr.y; b.site = site; b.planter = p.id; b.timer = RULES.bombTimer; b.carrier = 0; b.defuser = 0;
    p.hasBomb = false; p.planting = 0;
    this.plantedThisRound = true;
    this.addMoney(p, RULES.plantReward);
    p.stats.score += 3;
    this.emit(['planted', p.id, b.x, b.y, site], b.x, b.y, 4000);
    this.broadcast({ t: 'bomb', ev: 'planted', site, by: p.id });
    for (const q of this.players.values()) if (q.bot && q.alive) q.bot.onBombPlanted();
  }

  defuseBomb(p) {
    const b = this.bomb;
    b.state = 'defused'; b.defusedBy = p.id; p.defusing = 0;
    this.addMoney(p, RULES.defuseReward);
    p.stats.score += 3;
    this.emit(['defused', p.id, b.x, b.y], b.x, b.y, 4000);
    this.broadcast({ t: 'bomb', ev: 'defused', by: p.id });
    this.endRound(CT, 'defused');
  }

  dropBomb(p) {
    if (!p.hasBomb) return;
    p.hasBomb = false;
    const fr = this.map.nearestFree(p.x, p.y);
    this.bomb.state = 'dropped'; this.bomb.x = fr.x; this.bomb.y = fr.y; this.bomb.carrier = 0;
    this.broadcast({ t: 'bomb', ev: 'dropped', by: p.id });
  }

  updateBomb(dt) {
    const b = this.bomb;
    if (b.state === 'dropped') {
      for (const p of this.players.values()) {
        if (p.alive && p.team === T && Math.hypot(p.x - b.x, p.y - b.y) < 26) {
          p.hasBomb = true; b.state = 'carried'; b.carrier = p.id;
          this.broadcast({ t: 'bomb', ev: 'pickup', by: p.id });
          break;
        }
      }
    } else if (b.state === 'planted' && this.phase === PHASE.LIVE) {
      const before = Math.ceil(b.timer);
      b.timer -= dt;
      if (Math.ceil(b.timer) !== before || before === Math.ceil(RULES.bombTimer)) {
        this.emit(['beep', b.x, b.y, b.timer], b.x, b.y, 1600);
      }
      if (b.timer <= 0) this.explodeBomb();
    }
  }

  explodeBomb() {
    const b = this.bomb;
    b.state = 'exploded';
    this.emit(['boom', 'bomb', b.x, b.y], b.x, b.y, 6000);
    for (const p of [...this.players.values()]) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d > RULES.bombRadius) continue;
      if (d > 90 && !this.map.los(b.x, b.y, p.x, p.y)) continue;
      const dmg = RULES.bombDamage * Math.max(0, 1 - d / RULES.bombRadius);
      damagePlayer(this, p, null, dmg, 0.4, 'bomb', { silent: false });
    }
    this.endRound(T, 'bomb');
  }

  // ------------------------------------------------------------------ round end conditions
  checkRoundEnd() {
    if (this.phase !== PHASE.LIVE) return;
    const b = this.bomb.state;
    const aT = this.aliveCount(T), aCT = this.aliveCount(CT);
    if (this.startCount[CT] > 0 && aCT === 0) return this.endRound(T, 'elim');
    if (this.startCount[T] > 0 && aT === 0 && b !== 'planted') return this.endRound(CT, 'elim');
    if (this.timer <= 0 && b !== 'planted') return this.endRound(CT, 'time');
  }

  // ------------------------------------------------------------------ drops & pickup
  dropWeapon(p, id, throwDist = 26) {
    if (!id) return;
    const am = p.ammo[id] || { clip: 0, reserve: 0 };
    const w = WEAPONS[id];
    if (!w || w.kind === 'knife') return;
    const ang = p.angle;
    const pos = this.map.clearLine(p.x, p.y, p.x + Math.cos(ang) * throwDist, p.y + Math.sin(ang) * throwDist)
      ? { x: p.x + Math.cos(ang) * throwDist, y: p.y + Math.sin(ang) * throwDist } : { x: p.x, y: p.y };
    const d = { id: this.nextId++, wid: id, x: pos.x, y: pos.y, clip: am.clip, reserve: am.reserve, by: p.id, t: this.time };
    this.drops.push(d);
    delete p.ammo[id];
    return d;
  }

  updateDrops() {
    // drops persist for the round; nothing to simulate, kept for future expiry rules
  }

  pickupNearest(p) {
    let best = null, bd = 34;
    for (const d of this.drops) {
      const dist = Math.hypot(d.x - p.x, d.y - p.y);
      if (dist < bd && canTeamUse(WEAPONS[d.wid], p.team)) { bd = dist; best = d; }
    }
    if (best) this.takeDrop(p, best);
  }

  checkPickups(p) {
    if (!this.drops.length) return;
    for (const d of this.drops) {
      if (d.by === p.id && this.time - d.t < 1.2) continue;
      const w = WEAPONS[d.wid];
      if (Math.hypot(d.x - p.x, d.y - p.y) > 22) continue;
      if (!canTeamUse(w, p.team)) continue;
      if ((w.slot === 'primary' && !p.primary) || (w.slot === 'secondary' && !p.secondary)) { this.takeDrop(p, d); break; }
    }
  }

  takeDrop(p, d) {
    const w = WEAPONS[d.wid];
    if (!w) return;
    const cur = w.slot === 'primary' ? p.primary : p.secondary;
    if (cur === d.wid) return;
    if (cur) { p.dropLock = 0; const nd = this.dropWeapon(p, cur, 8); if (nd) nd.t = this.time; }
    this.drops.splice(this.drops.indexOf(d), 1);
    if (w.slot === 'primary') p.primary = d.wid; else p.secondary = d.wid;
    p.ammo[d.wid] = { clip: d.clip, reserve: d.reserve };
    selectSlot(this, p, w.slot);
    this.emit(['pickup', p.id, p.x, p.y], p.x, p.y, 500);
  }

  // ------------------------------------------------------------------ buying
  canBuy(p) {
    if (!p.alive || p.team === SPEC) return false;
    if (this.mode === 'dm') return this.map.zoneAt(p.x, p.y) === p.team + 1 || p.spawnProt > 0;
    if (this.phase === PHASE.FREEZE) return true;
    if (this.phase === PHASE.LIVE && this.time - this.roundStartedAt <= RULES.buyTime) return this.map.zoneAt(p.x, p.y) === p.team + 1;
    return false;
  }

  buy(p, item, silent = false) {
    if (!this.canBuy(p)) return false;
    const money = this.mode === 'dm' ? Infinity : p.money;
    const spend = (c) => { if (this.mode !== 'dm') p.money -= c; };
    if (item === 'kevlar') {
      if (p.armor >= 100 || money < armorCost.kevlar) return false;
      spend(armorCost.kevlar); p.armor = 100;
    } else if (item === 'helmet') {
      const c = p.armor >= 100 ? armorCost.helmetUpgrade : armorCost.helmet;
      if (p.helmet && p.armor >= 100) return false;
      if (money < c) return false;
      spend(c); p.armor = 100; p.helmet = true;
    } else if (item === 'kit') {
      if (p.team !== CT || p.kit || money < armorCost.kit) return false;
      spend(armorCost.kit); p.kit = true;
    } else if (GRENADE[item]) {
      if (money < GRENADE[item].price || !p.canCarryGrenade(item)) return false;
      spend(GRENADE[item].price); p.grenades[item]++;
      if (!silent) { p.sel = 'grenade'; p.gsel = item; }
    } else if (WEAPONS[item]) {
      const w = WEAPONS[item];
      if (w.price <= 0 || w.kind === 'knife' || !canTeamUse(w, p.team) || money < w.price) return false;
      const cur = w.slot === 'primary' ? p.primary : p.secondary;
      if (cur === item) return false;
      if (cur) this.dropWeapon(p, cur, 22);
      spend(w.price);
      p.giveWeapon(item, true);
      if (!silent) selectSlot(this, p, w.slot);
    } else return false;
    p.buys.push(item);
    if (!silent) this.emit(['buy', p.id, p.x, p.y], p.x, p.y, 500);
    return true;
  }

  rebuy(p, silent = false) {
    const list = p.lastBuys.slice();
    for (const it of list) this.buy(p, it, silent);
  }

  // ------------------------------------------------------------------ snapshots
  snapshotFor(p) { return buildSnapshot(this, p); }

  /** Called by the room to add a bot to the game. */
  createBot(id, team, difficulty) {
    const name = BOT_NAMES[(id * 7 + Math.floor(Math.random() * 3)) % BOT_NAMES.length];
    const b = new Player(id, name, null);
    b.isBot = true; b.team = team;
    b.bot = new BotBrain(this, b, difficulty);
    return b;
  }
}

