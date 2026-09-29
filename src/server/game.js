// One match: players, spawning, squads, revive, vehicles, projectiles, gadgets. Owned by a Room; the game mode
// (Conquest / Rush / Team Deathmatch) lives in modes/*.js and hooks into this class.
import { SPEC, PHASE, RULES, KEY, DT, otherTeam, SQUAD_NAMES } from '../shared/constants.js';
import { maxSpeedFor, sanitizeLoadout, CLASSES } from '../shared/weapons.js';
import { stepMovement, relativeDir } from '../shared/movement.js';
import { createMap } from '../shared/maps/index.js';
import { Player, newStats } from './player.js';
import { tryFire, tickWeaponTimers, damagePlayer } from './combat.js';
import { updateGrenades, updateFires, updateSmokes } from './grenades.js';
import { updateProjectiles } from './projectiles.js';
import { updateGadgets } from './gadgets.js';
import { initVehicles, updateVehicles, destroyVehicle, vehicleCmd, vehicleById, enterVehicle, exitVehicle, nearestVehicle, switchSeat, canEnter, freeSeat } from './vehicles.js';
import { explode } from './world.js';
import { buildSnapshot } from './snapshot.js';
import { BotBrain, BOT_NAMES, TeamMind } from './bot/brain.js';
import { NavGrid } from './bot/nav.js';
import { MODE_IMPL } from './modes/index.js';

export class Game {
  constructor(room) {
    this.room = room;
    this.settings = room.settings;
    this.modeId = room.settings.mode;
    this.mode = MODE_IMPL[this.modeId] || MODE_IMPL.conquest;
    this.map = createMap(room.settings.map);
    this.tileQueue = [];
    this.map.onChange((tx, ty, old, ch) => this.tileQueue.push([ty * this.map.w + tx, ch, old]));
    this.nav = new NavGrid(this.map);
    this.mind = new TeamMind(this);
    this.tick = 0;
    this.time = 0;
    this.phase = PHASE.LIVE;
    this.timer = RULES.matchTime;
    this.tix = [0, 0];
    this.grenades = []; this.smokes = []; this.fires = []; this.projectiles = []; this.gadgets = []; this.vehicles = []; this.corpses = [];
    this.events = [];
    this.nextId = 1;
    this.explDepth = 0;
    this.matchWinner = -1;
    this.over = false;
    this.flags = []; this.mcoms = [];
    this.spawnRing = [0, 0];
  }

  get players() { return this.room.players; }
  get ff() { return !!this.settings.friendlyFire; }

  // ------------------------------------------------------------------ events / messages
  emit(payload, x, y, range = 1800, to = 0) {
    this.events.push({ p: payload, x, y, r: range, to });
    const k = payload[0];
    if (k === 'step' || k === 'shot' || k === 'vshot' || k === 'boom' || k === 'launch') {
      let src = null;
      if (k === 'step' || k === 'shot') { src = this.players.get(payload[1]); if (!src) return; }
      const reach = k === 'step' ? (payload[5] ? 620 : 420) : k === 'shot' ? (payload[9] ? 600 : 1100) : k === 'boom' ? 1500 : 1400;
      for (const b of this.players.values()) {
        if (!b.bot || !b.alive || b.veh) continue;
        if (src && b.team === src.team) continue;
        const d = Math.hypot(b.x - x, b.y - y);
        if (d < reach) b.bot.hear(x, y, k);
      }
    }
  }
  broadcast(msg) { this.room.broadcast(msg); }
  aliveCount(team) { let n = 0; for (const p of this.players.values()) if (p.alive && p.team === team) n++; return n; }
  teamPlayers(team) { const a = []; for (const p of this.players.values()) if (p.team === team) a.push(p); return a; }
  playing() { const a = []; for (const p of this.players.values()) if (p.team !== SPEC) a.push(p); return a; }

  addScore(p, pts, label) {
    if (!p || !pts) return;
    p.stats.score += pts;
    if (p.conn) this.emit(['score', pts, label || ''], 0, 0, 0, p.id);
    this.room.sendRosterSoon();
  }

  // ------------------------------------------------------------------ match lifecycle
  startMatch() {
    for (const p of this.players.values()) { p.stats = newStats(); p.resetSim(); }
    this.mode.init(this);
    initVehicles(this);
    this.assignAllSquads();
    for (const p of this.players.values()) if (p.team !== SPEC) p.respawnAt = 0;
    this.broadcast({ t: 'begin', mode: this.modeId, tix: this.tix, map: this.settings.map });
    this.room.sendRoster();
  }

  removePlayer(p) {
    if (p.veh) this.leaveVehicleSilently(p);
    p.alive = false;
    this.corpses = this.corpses.filter((c) => c.pid !== p.id);
  }

  onTeamChange(p) {
    if (p.alive) { if (p.veh) this.leaveVehicleSilently(p); p.alive = false; }
    p.cmdQ.length = 0;
    this.corpses = this.corpses.filter((c) => c.pid !== p.id);
    p.squad = -1;
    if (p.team !== SPEC) { this.assignSquad(p); p.respawnAt = this.time + 1; p.deadAt = this.time; }
    this.room.sendRosterSoon();
  }

  leaveVehicleSilently(p) {
    const v = vehicleById(this, p.veh);
    if (v) { for (let s = 0; s < v.seats.length; s++) if (v.seats[s] === p.id) v.seats[s] = 0; }
    p.veh = 0; p.seat = 0;
  }

  // ------------------------------------------------------------------ squads
  assignAllSquads() {
    for (const p of this.players.values()) p.squad = -1;
    for (const p of this.players.values()) if (p.team !== SPEC) this.assignSquad(p);
  }

  assignSquad(p) {
    const size = RULES.squadSize;
    const count = new Map();
    for (const q of this.players.values()) if (q !== p && q.team === p.team && q.squad >= 0) count.set(q.squad, (count.get(q.squad) || 0) + 1);
    // humans like to play with humans: prefer a squad that already has a human, otherwise the emptiest open one
    let best = -1, bs = -1;
    for (let s = 0; s < SQUAD_NAMES.length; s++) {
      const n = count.get(s) || 0;
      if (n >= size) continue;
      const hum = [...this.players.values()].some((q) => q !== p && q.team === p.team && q.squad === s && !q.isBot);
      const score = (p.isBot ? (n > 0 ? 20 - n : 0) - (hum ? 5 : 0) : (hum ? 30 : 0) + n * 4 + (n === 0 ? 1 : 0));
      if (score > bs) { bs = score; best = s; }
    }
    p.squad = best < 0 ? 0 : best;
  }

  // ------------------------------------------------------------------ corpses & revive
  addCorpse(v) {
    this.corpses = this.corpses.filter((c) => c.pid !== v.id);
    this.corpses.push({ pid: v.id, x: v.x, y: v.y, team: v.team, t: this.time, a: v.angle });
  }

  nearestCorpse(medic, r) {
    let best = null, bd = r;
    for (const c of this.corpses) {
      if (c.team !== medic.team) continue;
      const d = Math.hypot(c.x - medic.x, c.y - medic.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  revive(c, medic) {
    const p = this.players.get(c.pid);
    this.corpses = this.corpses.filter((q) => q !== c);
    if (!p || p.alive || p.team !== medic.team) return false;
    this.spawnPlayer(p, { x: c.x, y: c.y, revived: true });
    p.hp = RULES.reviveHp;
    this.addScore(medic, RULES.score.revive, 'Revive');
    medic.stats.revives++;
    this.emit(['revived', p.id, Math.round(c.x), Math.round(c.y)], c.x, c.y, 1500);
    return true;
  }

  // ------------------------------------------------------------------ spawning
  spawnOptions(p) {
    const opts = this.mode.spawnOptions(this, p);
    // squad members
    for (const m of this.players.values()) {
      if (m === p || m.team !== p.team || m.squad !== p.squad || !m.alive) continue;
      let ok = true, why = '';
      if (this.time - m.lastHurt < 3.5) { ok = false; why = 'In combat'; }
      let seat = -1;
      if (m.veh) {
        const v = vehicleById(this, m.veh);
        seat = v ? freeSeat(v) : -1;
        if (seat < 0) { ok = false; why = 'Vehicle full'; }
      }
      if (this.map.zoneAt(m.x, m.y) === otherTeam(p.team) + 1) { ok = false; why = 'Enemy base'; }
      opts.push({ k: 'squad', id: m.id, name: m.name, x: m.x, y: m.y, ok, why, veh: m.veh ? 1 : 0 });
    }
    for (const g of this.gadgets) {
      if (g.type !== 'beacon' || g.team !== p.team || g.squad !== p.squad) continue;
      opts.push({ k: 'beacon', id: g.id, name: 'Spawn Beacon', x: g.x, y: g.y, ok: true, why: '' });
    }
    return opts;
  }

  /** Human or bot asks to deploy. req = { k, id, loadout } */
  deploy(p, req) {
    if (p.alive || p.team === SPEC || this.phase !== PHASE.LIVE) return false;
    if (req && req.loadout) p.loadout = sanitizeLoadout(req.loadout);
    if (this.time < p.respawnAt) return false;
    const opts = this.spawnOptions(p);
    let opt = null;
    if (req && req.k) opt = opts.find((o) => o.k === req.k && o.id === req.id && o.ok);
    if (!opt) opt = opts.find((o) => o.ok) || null;
    if (!opt) return false;
    this.spawnPlayer(p, opt);
    return true;
  }

  spawnPlayer(p, opt) {
    p.equip();
    p.alive = true; p.hp = 100; p.veh = 0; p.seat = 0;
    p.armor = opt.revived ? 0 : ((CLASSES[p.cls] && CLASSES[p.cls].armor) || 0);
    let x = opt.x, y = opt.y;
    if (opt.k === 'base') {
      const sp = this.map.spawns[p.team];
      const pt = sp[Math.floor(Math.random() * sp.length)];
      const fr = this.map.freeSpotNear(pt.x, pt.y, 0, 60, Math.random, 1);
      x = fr.x; y = fr.y;
    } else if (opt.k === 'flag' || opt.k === 'area') {
      const fr = this.map.freeSpotNear(opt.x, opt.y, 30, opt.r || 110, Math.random, 1);
      x = fr.x; y = fr.y;
    } else if (opt.k === 'squad' || opt.k === 'beacon') {
      const fr = this.map.freeSpotNear(opt.x, opt.y, 24, 70, Math.random, 1);
      x = fr.x; y = fr.y;
    } else { const fr = this.map.nearestFree(x, y); x = fr.x; y = fr.y; }
    p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.z = 0; p.vz = 0; p.cf = 0; p.pitch = 0;
    const face = this.map.spawnCenter[otherTeam(p.team)] || { x: this.map.width / 2, y: this.map.height / 2 };
    p.angle = Math.atan2(face.y - p.y, face.x - p.x);
    p.fireCd = 0; p.reloadT = 0; p.drawT = 0.3; p.burst = 0; p.scoped = false;
    p.useT = 0; p.reviveProg = 0; p.flashUntil = 0; p.flashFullUntil = 0;
    p.dmgFrom.clear();
    p.lastHurt = this.time - 10;
    p.spawnProt = opt.revived ? 0.8 : RULES.spawnProtect;
    p.respawnCounter = (p.respawnCounter + 1) & 255;
    p.cmdQ.length = 0;
    p.killedBy = 0;
    this.corpses = this.corpses.filter((c) => c.pid !== p.id);
    if (opt.k === 'squad' && opt.veh) {
      const m = this.players.get(opt.id);
      const v = m ? vehicleById(this, m.veh) : null;
      if (v) enterVehicle(this, p, v, -1);
    }
    if (opt.k === 'beacon') { const g = this.gadgets.find((q) => q.id === opt.id); const o = g && this.players.get(g.owner); if (o && o !== p) this.addScore(o, RULES.score.beaconSpawn, 'Beacon spawn'); }
    if (p.bot) p.bot.onSpawn();
    if (p.conn) p.conn.send({ t: 'kit', lo: p.loadout });
    this.room.sendRosterSoon();
    this.emit(['spawn', p.id, Math.round(p.x), Math.round(p.y)], p.x, p.y, 900);
  }

  removeGadget(g, attacker, boom) {
    const i = this.gadgets.indexOf(g);
    if (i < 0) return;
    this.gadgets.splice(i, 1);
    const owner = this.players.get(g.owner) || null;
    if (boom) {
      if (g.type === 'c4') explode(this, { x: g.x, y: g.y, radius: 150, dmg: 160, veh: 720, tile: 700, owner: owner || attacker, wid: 'c4', kind: 'c4', hitVeh: g.attach ? this.vehicles.find((v) => v.id === g.attach) : null });
      else if (g.type === 'mine') explode(this, { x: g.x, y: g.y, radius: 90, dmg: 40, veh: 520, tile: 140, owner: owner || attacker, wid: 'mine', kind: 'mine' });
      else if (g.type === 'claymore') explode(this, { x: g.x, y: g.y, radius: 130, dmg: 100, veh: 40, tile: 60, owner: owner || attacker, wid: 'claymore', kind: 'claymore' });
      else if (attacker && owner && attacker.team !== owner.team) this.addScore(attacker, RULES.score.destroyGadget, 'Gadget destroyed');
    }
  }

  // ------------------------------------------------------------------ main tick
  update() {
    this.tick++;
    this.time = this.tick * DT;
    const dt = DT;
    if (this.phase === PHASE.OVER) {
      this.timer -= dt;
      if (this.timer <= 0) { this.room.endMatch(); return; }
    } else if (this.phase === PHASE.LIVE) {
      this.timer -= dt;
      this.mode.update(this, dt);
      this.mind.update(dt);
    }
    for (const p of this.players.values()) this.updatePlayer(p, dt);
    updateVehicles(this, dt);
    updateProjectiles(this, dt);
    updateGrenades(this, dt);
    updateFires(this, dt);
    updateSmokes(this, dt);
    updateGadgets(this, dt);
    this.enforceBases(dt);
    this.expireCorpses();
    for (const p of this.players.values()) p.record(this.tick);
    this.flushTiles();
  }

  expireCorpses() {
    if (!this.corpses.length) return;
    this.corpses = this.corpses.filter((c) => {
      if (this.time - c.t > RULES.reviveWindow) return false;
      const p = this.players.get(c.pid);
      return !!p && !p.alive;
    });
  }

  /** Enemies inside a team's spawn area are shredded, so nobody can camp the respawn zone. */
  enforceBases(dt) {
    if (this.modeId === 'tdm' && this.map.def.theme && this.map.def.theme.legacy) return;
    for (const p of this.players.values()) {
      if (!p.alive || p.team === SPEC || p.veh) continue;
      const z = this.map.zoneAt(p.x, p.y);
      if (z && z !== p.team + 1) damagePlayer(this, p, null, 70 * dt, 'world', { quiet: false });
    }
    for (const v of this.vehicles) {
      if (v.dead || !v.occupants().length) continue;
      const z = this.map.zoneAt(v.x, v.y);
      if (z && z !== v.team + 1) { v.hp -= 160 * dt; if (v.hp <= 0) destroyVehicle(this, v, null, 'world'); }
    }
  }

  flushTiles() {
    if (!this.tileQueue.length) return;
    const q = this.tileQueue;
    this.tileQueue = [];
    for (let i = 0; i < q.length; i += 400) this.broadcast({ t: 'tiles', c: q.slice(i, i + 400) });
  }

  updatePlayer(p, dt) {
    if (p.team === SPEC) return;
    if (p.spawnProt > 0) p.spawnProt -= dt;
    if (!p.alive) {
      p.cmdQ.length = 0;
      if (p.bot && this.phase === PHASE.LIVE && this.time >= p.respawnAt) p.bot.deployNow();
      return;
    }
    if (p.veh) {
      if (p.hp < 100 && this.time - p.lastHurt > RULES.regenDelay) p.hp = Math.min(100, p.hp + RULES.regenRate * dt);
      p.fireCd = Math.max(0, p.fireCd - dt);
    } else tickWeaponTimers(this, p, dt);
    if (p.bot) {
      const c = p.bot.think(dt);
      this.applyCmd(p, c.keys, c.angle, 0, c.aimDist, c.ax, c.ay, c.pitch);
      if (c.seat !== undefined && c.seat >= 0) switchSeat(this, p, c.seat);
    } else {
      const q = p.cmdQ;
      let n = q.length > 8 ? 4 : q.length > 3 ? 2 : 1;
      while (n-- > 0 && q.length) {
        const c = q.shift();
        this.applyCmd(p, c[1], c[2], c[3], c[4], undefined, undefined, c[5]);
        p.lastSeq = c[0];
        if (!p.alive) break;
      }
    }
  }

  /** Server time a command was issued at: the client's clock estimate (render time + interpolation delay), clamped to something plausible. */
  cmdTime(vt) {
    if (!(vt > 0)) return this.time;
    return Math.max(this.time - 0.4, Math.min(this.time, Math.round((vt + 0.1) * 1000) / 1000));
  }

  applyCmd(p, keys, angle, vt, aimDist, ax, ay, pitch = 0) {
    const useHeld = (keys & KEY.USE) !== 0;
    if (p.veh) {
      vehicleCmd(this, p, keys, angle, vt, aimDist);
      this.handleUse(p, useHeld, keys);
      p.prevFire = (keys & KEY.FIRE) !== 0;
      return;
    }
    p.angle = angle;
    p.pitch = Math.max(-1.5, Math.min(1.5, Number.isFinite(pitch) ? pitch : 0));
    p.lastKeys = keys;
    const w = p.weapon();
    const fire = (keys & KEY.FIRE) !== 0;
    const wantScope = (keys & KEY.SCOPE) !== 0 && !!w && w.kind !== 'knife';
    p.scoped = wantScope;
    const human = ax === undefined;
    p.walking = (keys & KEY.WALK) !== 0 || p.cf > 0.5;
    // sprinting: humans must be running forward; only while not aiming, shooting or crouched
    p.sprinting = (keys & KEY.SPRINT) !== 0 && !wantScope && !p.walking && !fire && (!human || (keys & KEY.UP) !== 0);
    if (human) [ax, ay] = relativeDir(keys, angle);   // humans: keys are relative to the view
    stepMovement(this.map, p, keys, maxSpeedFor(w, p.walking, p.scoped, p.sprinting), false, ax, ay);
    // footsteps (silent in the air and when crouched)
    const sp = p.speed;
    if (!p.walking && p.z < 1 && sp > 45) {
      p.stepAcc += sp * DT;
      if (p.stepAcc > 44) { p.stepAcc = 0; this.emit(['step', p.id, Math.round(p.x), Math.round(p.y), p.team, p.sprinting ? 1 : 0], p.x, p.y, p.sprinting ? 720 : 640); }
    } else if (sp <= 45) p.stepAcc = Math.max(p.stepAcc, 40);
    this.handleUse(p, useHeld, keys);
    tryFire(this, p, fire, !p.prevFire && fire, vt, aimDist, keys);
    p.prevFire = fire;
  }

  // ------------------------------------------------------------------ use key: vehicles and objectives
  handleUse(p, held, keys) {
    const edge = held && !p.usePrev;
    p.usePrev = held;
    if (!held) { this.mode.onUseRelease && this.mode.onUseRelease(this, p); p.useT = 0; return; }
    if (edge) {
      if (p.veh) { exitVehicle(this, p); return; }
      const v = nearestVehicle(this, p);
      if (v && canEnter(v, p) && freeSeat(v) >= 0) { enterVehicle(this, p, v, -1); return; }
    }
    if (!p.veh && this.mode.onUse) this.mode.onUse(this, p, edge, DT);
  }

  /** used by the room for explicit seat requests */
  seatRequest(p, seat) { if (p.veh) switchSeat(this, p, seat); else { const v = nearestVehicle(this, p); if (v) enterVehicle(this, p, v, seat); } }

  // ------------------------------------------------------------------ spotting
  spot(p, x, y) {
    if (!p.alive || this.time - (p.lastSpot || 0) < 0.6) return false;
    p.lastSpot = this.time;
    let best = null, bd = 90, kind = 0;
    for (const q of this.players.values()) {
      if (!q.alive || q.team === p.team || q.team === SPEC) continue;
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < bd && this.map.los(p.x, p.y, q.x, q.y)) { bd = d; best = q; kind = 0; }
    }
    for (const v of this.vehicles) {
      if (v.dead || v.team === p.team) continue;
      const d = Math.hypot(v.x - x, v.y - y) - v.def.r;
      if (d < bd) { bd = d; best = v; kind = 1; }
    }
    if (!best) return false;
    if (kind === 0) { best.spotUntil = this.time + RULES.spotTime; best.spotBy = p.id; } else { best.spotUntil = this.time + RULES.spotTime; best.spotBy = p.id; }
    this.addScore(p, RULES.score.spot, 'Spot');
    return true;
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

  vehicleById(id) { return vehicleById(this, id); }

  endMatch(winner) {
    if (this.phase === PHASE.OVER) return;
    this.phase = PHASE.OVER;
    this.timer = RULES.overTime;
    this.matchWinner = winner;
    const scores = [...this.players.values()].filter((p) => p.team !== SPEC).sort((a, b) => b.stats.score - a.stats.score);
    this.broadcast({ t: 'match_over', winner, tix: this.tix.map((v) => Math.max(0, Math.round(v))), mvp: scores[0] ? scores[0].id : 0 });
    this.room.sendRoster();
  }
}
