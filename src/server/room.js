// A Room is a lobby + (optionally) a running Game, with its own set of players and bots.
import { T, CT, SPEC, PHASE, SNAP_EVERY, NAME_MAX, MAX_PLAYERS_PER_ROOM, MODES, RULES } from '../shared/constants.js';
import { MAP_DEFS } from '../shared/maps/index.js';
import { sanitizeLoadout } from '../shared/weapons.js';
import { Player, newStats } from './player.js';
import { Game } from './game.js';
import { cycleSpectate } from './snapshot.js';
import { selectSlot, startReload, toggleAlt } from './combat.js';
import { deployFlares } from './air-defense.js';
import { SQUAD_NAMES } from '../shared/constants.js';

export const DEFAULT_SETTINGS = {
  name: '', map: 'riverside', mode: 'conquest', teamSize: 8, bots: true, difficulty: 'normal', friendlyFire: false, public: false, vehicles: true, tickets: 250,
};
const DIFFICULTIES = ['easy', 'normal', 'hard', 'expert'];

export function sanitizeSettings(input, base = DEFAULT_SETTINGS) {
  const s = { ...base };
  if (!input || typeof input !== 'object') return s;
  if (typeof input.name === 'string') s.name = input.name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24);
  const mapChanged = MAP_DEFS.some((m) => m.id === input.map) && input.map !== s.map;
  const modeChanged = typeof input.mode === 'string' && MODES[input.mode] && input.mode !== s.mode;
  if (MAP_DEFS.some((m) => m.id === input.map)) s.map = input.map;
  if (typeof input.mode === 'string' && MODES[input.mode]) s.mode = input.mode;
  // keep map and mode compatible: whichever one changed wins
  const def = MAP_DEFS.find((m) => m.id === s.map);
  if (!def.modes.includes(s.mode)) {
    if (modeChanged && !mapChanged) s.map = (MAP_DEFS.find((m) => m.modes.includes(s.mode)) || MAP_DEFS[0]).id;
    else s.mode = def.modes[0];
  }
  if (Number.isInteger(input.teamSize)) s.teamSize = Math.max(1, Math.min(16, input.teamSize));
  if (typeof input.bots === 'boolean') s.bots = input.bots;
  if (DIFFICULTIES.includes(input.difficulty)) s.difficulty = input.difficulty;
  if (typeof input.friendlyFire === 'boolean') s.friendlyFire = input.friendlyFire;
  if (typeof input.public === 'boolean') s.public = input.public;
  if (typeof input.vehicles === 'boolean') s.vehicles = input.vehicles;
  if (RULES.ticketOptions.includes(input.tickets)) s.tickets = input.tickets;
  return s;
}

export class Room {
  constructor(code, settings, manager) {
    this.code = code;
    this.manager = manager;
    this.settings = sanitizeSettings(settings);
    this.players = new Map();
    this.hostId = 0;
    this.game = null;
    this.state = 'lobby';
    this.nextPid = 1;
    this.tickN = 0;
    this.emptySince = 0;
    this.rosterDirty = false;
    this.createdAt = Date.now();
  }

  // ------------------------------------------------------------------ messaging
  send(p, msg) { if (p.conn) p.conn.send(msg); }
  broadcast(msg) { const s = JSON.stringify(msg); for (const p of this.players.values()) if (p.conn) p.conn.sendRaw(s); }
  broadcastTeam(team, msg) { const s = JSON.stringify(msg); for (const p of this.players.values()) if (p.conn && (p.team === team || p.team === SPEC)) p.conn.sendRaw(s); }
  humans() { return [...this.players.values()].filter((p) => !p.isBot); }
  connectedHumans() { return this.humans().filter((p) => p.connected); }
  bots() { return [...this.players.values()].filter((p) => p.isBot); }
  get host() { return this.players.get(this.hostId); }

  roomInfo() {
    return {
      code: this.code, settings: this.settings, host: this.hostId, state: this.state,
      map: this.settings.map,
    };
  }

  listing() {
    const humans = this.connectedHumans().length;
    return { code: this.code, name: this.settings.name || `${this.host ? this.host.name : 'Room'}'s room`, map: this.settings.map, mode: this.settings.mode, humans, cap: this.settings.teamSize * 2, state: this.state, bots: this.settings.bots };
  }

  // ------------------------------------------------------------------ membership
  addHuman(conn, name) {
    const id = this.nextPid++;
    const p = new Player(id, name, conn);
    conn.player = p; conn.room = this;
    p.connected = true;
    this.players.set(id, p);
    if (!this.hostId || !this.players.get(this.hostId) || !this.players.get(this.hostId).connected) this.hostId = id;
    this.assignTeam(p, 'auto', true);
    this.emptySince = 0;
    this.send(p, { t: 'room', ...this.roomInfo(), you: id });
    this.systemChat(`${p.name} joined`);
    this.rebalanceBots(this.state === 'lobby');
    this.sendRoster();
    if (this.state === 'playing') this.sendMatchInfo(p);
    return p;
  }

  attach(conn, p) {
    p.conn = conn; conn.player = p; conn.room = this; p.connected = true; this.emptySince = 0;
    this.send(p, { t: 'room', ...this.roomInfo(), you: p.id });
    if (this.state === 'playing') this.sendMatchInfo(p);
    this.sendRoster();
  }

  detach(p) {
    // human lost connection; in a running match they are kept for a short while so a refresh can rejoin
    p.conn = null; p.connected = false; p.leftAt = Date.now();
    if (this.state === 'lobby' || p.team === SPEC) this.removeHuman(p);
    else this.sendRoster();
    this.fixHost();
  }

  removeHuman(p) {
    if (this.game) this.game.removePlayer(p);
    this.players.delete(p.id);
    this.systemChat(`${p.name} left`);
    this.fixHost();
    this.rebalanceBots(this.state === 'lobby');
    this.sendRoster();
    if (!this.connectedHumans().length) this.emptySince = Date.now();
  }

  fixHost() {
    const h = this.players.get(this.hostId);
    if (!h || !h.connected) {
      const next = this.humans().find((p) => p.connected);
      if (next) { this.hostId = next.id; this.broadcast({ t: 'host', host: next.id }); }
    }
  }

  sendMatchInfo(p) {
    const g = this.game;
    this.send(p, { t: 'match', map: this.settings.map, mode: this.settings.mode, phase: g.phase, tix: g.tix, settings: this.settings, tiles: [...g.map.changes.entries()] });
  }

  teamCounts() {
    const c = [0, 0, 0];
    for (const p of this.players.values()) if (!p.isBot) c[p.team]++;
    return c;
  }

  assignTeam(p, team, silent = false) {
    const cap = this.settings.teamSize;
    const c = this.teamCounts();
    if (team === 'auto') {
      // fill the team with fewer humans, then the one with lower score
      team = c[T] <= c[CT] ? T : CT;
      if (c[team] >= cap) team = team === T ? CT : T;
      if (c[team] >= cap) team = SPEC;
    }
    if (team !== T && team !== CT && team !== SPEC) return false;
    if (team === p.team) return true;
    if (team !== SPEC && c[team] >= cap) return false;
    p.team = team;
    if (this.game) this.game.onTeamChange(p);
    if (!silent) { this.rebalanceBots(this.state === 'lobby'); this.sendRoster(); }
    return true;
  }

  /** Randomly splits the (non-spectating) humans evenly across the two teams. */
  shuffleTeams() {
    const list = this.humans().filter((p) => p.team !== SPEC);
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    list.forEach((p, i) => { p.team = i % 2 === 0 ? T : CT; });
    this.rebalanceBots(true);
    this.sendRoster();
  }

  // ------------------------------------------------------------------ bots
  rebalanceBots(safe) {
    const s = this.settings;
    const inMatch = !!this.game;
    for (const team of [T, CT]) {
      const humans = [...this.players.values()].filter((p) => !p.isBot && p.team === team).length;
      const bots = [...this.players.values()].filter((p) => p.isBot && p.team === team);
      const want = s.bots ? Math.max(0, s.teamSize - humans) : 0;
      while (bots.length > want) {
        // prefer removing dead bots; alive ones only at a safe point
        let idx = bots.findIndex((b) => !b.alive);
        if (idx < 0) { if (!safe && inMatch) break; idx = bots.length - 1; }
        const b = bots.splice(idx, 1)[0];
        if (this.game) this.game.removePlayer(b);
        this.players.delete(b.id);
      }
      while (bots.length < want) {
        const b = this.spawnBot(team);
        bots.push(b);
      }
      for (const b of bots) if (b.bot) b.bot.setDifficulty(s.difficulty);
    }
  }

  spawnBot(team) {
    const id = this.nextPid++;
    const used = new Set([...this.players.values()].map((p) => p.name));
    let b;
    if (this.game) b = this.game.createBot(id, team, this.settings.difficulty);
    else b = makeLobbyBot(id, team, this.settings.difficulty);
    let name = b.name, n = 2;
    while (used.has(name)) name = `${b.name}${n++}`;
    b.name = name;
    this.players.set(id, b);
    if (this.game) { this.game.assignSquad(b); b.respawnAt = this.game.time + 1; }
    return b;
  }

  // ------------------------------------------------------------------ roster
  sendRosterSoon() { this.rosterDirty = true; }

  sendRoster() {
    this.rosterDirty = false;
    const list = [];
    for (const p of this.players.values()) {
      list.push({
        id: p.id, n: p.name, tm: p.team, b: p.isBot ? 1 : 0, k: p.stats.kills, d: p.stats.deaths, a: p.stats.assists,
        s: p.stats.score, pg: Math.round(p.ping || 0), al: p.alive ? 1 : 0, dc: p.connected ? 0 : 1, sq: p.squad, cl: p.cls || (p.loadout && p.loadout.cls) || 'assault',
        cp: p.stats.captures, rv: p.stats.revives, vh: p.veh ? 1 : 0,
      });
    }
    const st = { t: 'roster', host: this.hostId, players: list };
    for (const p of this.players.values()) {
      if (!p.conn) continue;
      p.conn.send(st);
    }
  }

  systemChat(text) { this.broadcast({ t: 'chat', from: 0, name: '', team: -1, text, sys: 1 }); }

  // ------------------------------------------------------------------ match control
  start() {
    if (this.state === 'playing') return;
    this.state = 'playing';
    this.game = new Game(this);
    this.broadcast({ t: 'match', map: this.settings.map, mode: this.settings.mode, phase: PHASE.LIVE, tix: [0, 0], settings: this.settings, tiles: [] });
    // convert any lobby bots into real game bots
    for (const b of this.bots()) {
      const nb = this.game.createBot(b.id, b.team, this.settings.difficulty);
      nb.name = b.name;
      this.players.set(b.id, nb);
    }
    this.game.startMatch();
  }

  endMatch() {
    this.state = 'lobby';
    this.game = null;
    for (const p of this.players.values()) { p.resetSim(); p.stats = newStats(); p.squad = -1; }
    // drop disconnected humans
    for (const p of this.humans()) if (!p.connected) this.players.delete(p.id);
    for (const b of this.bots()) this.players.delete(b.id);
    this.rebalanceBots(true);
    this.broadcast({ t: 'lobby', ...this.roomInfo() });
    this.sendRoster();
  }

  // ------------------------------------------------------------------ input from clients
  handle(p, m) {
    const g = this.game;
    switch (m.t) {
      case 'in': {
        if (!g || !Array.isArray(m.c) || p.team === SPEC) return;
        for (const c of m.c) {
          if (!Array.isArray(c) || c.length < 4) continue;
          const seq = c[0] | 0;
          if (seq <= p.qSeq) continue;
          p.qSeq = seq;
          const ang = Number(c[2]);
          if (!Number.isFinite(ang)) continue;
          p.cmdQ.push([seq, c[1] & 4095, ang, Number(c[3]) || 0, Math.max(0, Math.min(2000, Number(c[4]) || 0)), Math.max(-1.5, Math.min(1.5, Number(c[5]) || 0)), Number.isFinite(c[6]) ? Math.max(0, Math.min(4096, c[6])) : null, Number.isFinite(c[7]) ? Math.max(-4096, Math.min(16384, c[7])) : null, Number.isFinite(c[8]) ? Math.max(-4096, Math.min(16384, c[8])) : null]);
        }
        if (p.cmdQ.length > 24) p.cmdQ.splice(0, p.cmdQ.length - 24);
        return;
      }
      case 'a': return this.handleAction(p, m);
      case 'team': {
        const ok = this.assignTeam(p, m.team === 'auto' ? 'auto' : m.team | 0);
        if (!ok) this.send(p, { t: 'toast', text: 'That team is full' });
        return;
      }
      case 'chat': {
        const now = Date.now();
        if (now - (p.lastChat || 0) < 350) return;
        p.lastChat = now;
        let text = String(m.text || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 160);
        if (!text) return;
        const team = m.team ? 1 : 0;
        const msg = { t: 'chat', from: p.id, name: p.name, team: team ? p.team : -1, text };
        if (team && p.team !== SPEC) this.broadcastTeam(p.team, msg); else this.broadcast(msg);
        return;
      }
      case 'start': if (p.id === this.hostId && this.state === 'lobby') this.start(); return;
      case 'lobby': if (p.id === this.hostId && this.state === 'playing') this.endMatch(); return;
      case 'shuffle': if (p.id === this.hostId && this.state === 'lobby') this.shuffleTeams(); return;
      case 'settings': {
        if (p.id !== this.hostId) return;
        const old = this.settings;
        this.settings = sanitizeSettings(m.settings, old);
        if (this.state === 'playing') {          // only some settings can change mid-match
          this.settings = { ...old, name: this.settings.name, difficulty: this.settings.difficulty, friendlyFire: this.settings.friendlyFire, public: this.settings.public };
          if (this.game) this.game.settings = this.settings;
        }
        this.rebalanceBots(this.state === 'lobby');
        this.broadcast({ t: 'settings', settings: this.settings });
        this.sendRoster();
        return;
      }
      case 'kick': {
        if (p.id !== this.hostId) return;
        const v = this.players.get(m.id | 0);
        if (v && !v.isBot && v.id !== p.id) { this.send(v, { t: 'kicked' }); const c = v.conn; this.removeHuman(v); if (c) c.leaveRoom(); }
        return;
      }
      case 'dbg': if (process.env.CS_DEBUG) this.debug(p, m); return;
      case 'rtt': p.ping = Math.max(0, Math.min(999, Number(m.ms) || 0)); return;
      default: return;
    }
  }

  /** Developer helpers, only reachable when the server runs with CS_DEBUG=1. */
  debug(p, m) {
    const g = this.game;
    if (!g) return;
    if (m.cmd === 'kill') { p.hp = 0; import('./combat.js').then((c) => c.killPlayer(g, p, null, 'world')); }
    else if (m.cmd === 'tp') { p.x = Number(m.x); p.y = Number(m.y); p.z = g.map.heightAt(p.x, p.y); p.vz = 0; p.vx = p.vy = 0; }
    else if (m.cmd === 'god') p.spawnProt = 9999;
    else if (m.cmd === 'tix') { g.tix = [Number(m.a), Number(m.b)]; }
    else if (m.cmd === 'flag' && g.flags[m.i | 0]) { const f = g.flags[m.i | 0]; f.owner = m.owner | 0; f.cap = f.owner === 0 ? -1 : 1; }
    else if (m.cmd === 'enter') {
      const v = g.vehicles.find((q) => q.type === m.type && !q.dead && !q.occupants().length);
      if (v && p.alive) { p.x = v.x; p.y = v.y; import('./vehicles.js').then((vm) => vm.enterVehicle(g, p, v, m.seat | 0)); }
    }
    else if (m.cmd === 'vehiclePose' && p.veh) {
      const v = g.vehicleById(p.veh);
      if (v && Number.isFinite(m.x) && Number.isFinite(m.y)) { v.x = m.x; v.y = m.y; v.a = v.ta = Number(m.angle) || 0; v.seatAim.fill(v.a); v.vx = v.vy = v.vz = v.steer = v.yawRate = v.throttle = 0; v.chassisZ = g.map.heightAt(v.x, v.y); if (v.def.kind === 'air') v.flightZ = Number.isFinite(m.z) ? m.z : v.chassisZ + v.def.alt; p.x = v.x; p.y = v.y; p.z = v.z; p.vz = v.vz || 0; }
    }
    else if (m.cmd === 'boom') { import('./world.js').then((w) => w.explode(g, { x: Number(m.x), y: Number(m.y), radius: Number(m.r) || 160, dmg: 100, veh: 400, tile: Number(m.tile) || 700, owner: p, wid: 'c4', kind: m.kind || 'c4' })); }
    else if (m.cmd === 'give') { p.loadout = { ...p.loadout, cls: m.cls || p.loadout.cls }; }
    else if (m.cmd === 'state') this.send(p, { t: 'toast', text: JSON.stringify({ x: p.x, y: p.y, alive: p.alive }) });
  }

  handleAction(p, m) {
    const g = this.game;
    if (!g) return;
    switch (m.a) {
      case 'reload': if (p.alive) startReload(g, p); break;
      case 'sw': if (p.alive && typeof m.slot === 'string') selectSlot(g, p, m.slot); break;
      case 'alt': if (p.alive) toggleAlt(g, p); break;
      case 'loadout': p.loadout = sanitizeLoadout(m.lo); break;
      case 'deploy': {
        if (p.team === SPEC || p.alive) break;
        if (g.time < p.respawnAt) { this.send(p, { t: 'toast', text: 'Wait for the respawn timer' }); break; }
        const ok = g.deploy(p, { k: String(m.k || ''), id: m.id, loadout: m.lo });
        if (!ok) { p._needSp = true; const reason = g.spawnOptions(p).find((o) => o.k === m.k && o.id === m.id)?.why; this.send(p, { t: 'toast', text: `${reason || 'That spawn point is unavailable'}. Choose another spawn point.` }); }
        break;
      }
      case 'flares': deployFlares(g, p); break;
      case 'seat': if (p.alive) g.seatRequest(p, m.n | 0); break;
      case 'spot': if (p.alive) { const x = Number(m.x), y = Number(m.y); if (Number.isFinite(x) && Number.isFinite(y)) g.spot(p, x, y); } break;
      case 'squad': {
        const want = m.n | 0;
        if (want < 0 || want >= SQUAD_NAMES.length || p.team === SPEC) break;
        const n = [...this.players.values()].filter((q) => q.team === p.team && q.squad === want && q !== p).length;
        if (n >= RULES.squadSize) { this.send(p, { t: 'toast', text: 'That squad is full' }); break; }
        p.squad = want; this.sendRoster();
        break;
      }
      case 'spec': {
        if (p.alive) break;
        if (m.id) { const q = g.players.get(m.id | 0); if (q && q.alive && q.team !== SPEC && (p.team === SPEC || q.team === p.team)) p.specId = q.id; }
        else cycleSpectate(g, p, m.dir < 0 ? -1 : 1);
        break;
      }
      case 'ping': {
        const now = Date.now();
        if (now - (p.lastPing || 0) < 900 || p.team === SPEC) break;
        p.lastPing = now;
        const x = Number(m.x), y = Number(m.y);
        if (Number.isFinite(x) && Number.isFinite(y)) this.broadcastTeam(p.team, { t: 'ping', id: p.id, x, y, team: p.team });
        break;
      }
      default: break;
    }
  }

  // ------------------------------------------------------------------ tick
  tick() {
    this.tickN++;
    const g = this.game;
    if (!g) return;
    g.update();
    if (!this.game) return;   // match ended during the tick
    if (this.tickN % SNAP_EVERY === 0) {
      for (const p of this.players.values()) {
        if (!p.conn || p.isBot) continue;
        if (p.conn.congested()) continue;
        p.conn.send(g.snapshotFor(p));
      }
      g.events.length = 0;
    }
    if (this.rosterDirty && this.tickN % 15 === 0) this.sendRoster();
    // disconnected humans are removed after a grace period
    if (this.tickN % 120 === 0) {
      const now = Date.now();
      for (const p of this.humans()) if (!p.connected && now - p.leftAt > 45000) this.removeHuman(p);
    }
  }
}

function makeLobbyBot(id, team, difficulty) {
  const b = new Player(id, 'Bot', null);
  b.isBot = true; b.team = team; b.difficulty = difficulty;
  b.name = pickName(id);
  return b;
}

const LOBBY_NAMES = ['Viper', 'Ghost', 'Rook', 'Nova', 'Blitz', 'Echo', 'Dagger', 'Hex', 'Raven', 'Tango', 'Sable', 'Onyx', 'Flint', 'Jinx', 'Kilo', 'Mako'];
function pickName(id) { return LOBBY_NAMES[(id * 5 + Math.floor(Math.random() * 4)) % LOBBY_NAMES.length]; }

export { NAME_MAX, MAX_PLAYERS_PER_ROOM };
