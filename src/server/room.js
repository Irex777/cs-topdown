// A Room is a lobby + (optionally) a running Game, with its own set of players and bots.
import { T, CT, SPEC, PHASE, SNAP_EVERY, NAME_MAX, MAX_PLAYERS_PER_ROOM } from '../shared/constants.js';
import { WEAPONS } from '../shared/weapons.js';
import { MAP_DEFS } from '../shared/maps/index.js';
import { Player } from './player.js';
import { Game } from './game.js';
import { cycleSpectate } from './snapshot.js';
import { selectSlot, startReload } from './combat.js';

export const DEFAULT_SETTINGS = {
  name: '', map: 'dust', mode: 'defuse', rounds: 16, teamSize: 5, bots: true, difficulty: 'normal', friendlyFire: false, public: false,
};
const ROUND_OPTIONS = [6, 10, 16, 24, 30];
const DIFFICULTIES = ['easy', 'normal', 'hard', 'expert'];

export function sanitizeSettings(input, base = DEFAULT_SETTINGS) {
  const s = { ...base };
  if (!input || typeof input !== 'object') return s;
  if (typeof input.name === 'string') s.name = input.name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24);
  if (MAP_DEFS.some((m) => m.id === input.map)) s.map = input.map;
  if (input.mode === 'defuse' || input.mode === 'dm') s.mode = input.mode;
  if (ROUND_OPTIONS.includes(input.rounds)) s.rounds = input.rounds;
  if (Number.isInteger(input.teamSize)) s.teamSize = Math.max(1, Math.min(8, input.teamSize));
  if (typeof input.bots === 'boolean') s.bots = input.bots;
  if (DIFFICULTIES.includes(input.difficulty)) s.difficulty = input.difficulty;
  if (typeof input.friendlyFire === 'boolean') s.friendlyFire = input.friendlyFire;
  if (typeof input.public === 'boolean') s.public = input.public;
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
    this.chatLog = [];
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
    this.send(p, { t: 'match', map: this.settings.map, mode: this.settings.mode, round: g.round, phase: g.phase, score: g.score, target: g.target, settings: this.settings });
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
      while (bots.length < want && (safe || !inMatch)) {
        const b = this.spawnBot(team);
        bots.push(b);
      }
      for (const b of bots) if (b.bot) b.bot.setDifficulty(s.difficulty);
    }
  }

  spawnBot(team) {
    const id = this.nextPid++;
    const used = new Set([...this.players.values()].map((p) => p.name));
    const g = this.game || { createBot: null };
    let b;
    if (this.game) b = this.game.createBot(id, team, this.settings.difficulty);
    else b = makeLobbyBot(id, team, this.settings.difficulty);
    let name = b.name, n = 2;
    while (used.has(name)) name = `${b.name}${n++}`;
    b.name = name;
    this.players.set(id, b);
    void g;
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
        s: p.stats.score, mv: p.stats.mvps, pg: Math.round(p.ping || 0), al: p.alive ? 1 : 0, dc: p.connected ? 0 : 1, mo: p.money,
        dm: Math.round(p.stats.damage),
      });
    }
    const st = { t: 'roster', host: this.hostId, players: list };
    for (const p of this.players.values()) {
      if (!p.conn) continue;
      // money only for own team (and spectators)
      const mine = list.map((e) => (e.tm === p.team || p.team === SPEC ? e : { ...e, mo: -1 }));
      p.conn.send({ ...st, players: mine });
    }
  }

  systemChat(text) { this.broadcast({ t: 'chat', from: 0, name: '', team: -1, text, sys: 1 }); }

  // ------------------------------------------------------------------ match control
  start() {
    if (this.state === 'playing') return;
    this.state = 'playing';
    this.game = new Game(this);
    this.broadcast({ t: 'match', map: this.settings.map, mode: this.settings.mode, round: 0, phase: PHASE.FREEZE, score: [0, 0], target: this.game.target, settings: this.settings });
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
    for (const p of this.players.values()) { p.resetSim(); p.stats = { kills: 0, deaths: 0, assists: 0, score: 0, mvps: 0, damage: 0 }; }
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
          p.cmdQ.push([seq, c[1] & 255, ang, Number(c[3]) || 0, Math.max(0, Math.min(1000, Number(c[4]) || 0))]);
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
      case 'rtt': p.ping = Math.max(0, Math.min(999, Number(m.ms) || 0)); return;
      default: return;
    }
  }

  handleAction(p, m) {
    const g = this.game;
    if (!g) return;
    switch (m.a) {
      case 'reload': if (p.alive) startReload(g, p); break;
      case 'sw': if (p.alive && ['primary', 'secondary', 'knife', 'grenade', 'last'].includes(m.slot)) selectSlot(g, p, m.slot); break;
      case 'drop': {
        if (!p.alive || g.phase === PHASE.POST) break;
        if (p.sel === 'primary' && p.primary) { const id = p.primary; g.dropWeapon(p, id, 30); p.primary = null; selectSlot(g, p, 'secondary'); }
        else if (p.sel === 'secondary' && p.secondary && p.primary) { const id = p.secondary; g.dropWeapon(p, id, 30); p.secondary = null; selectSlot(g, p, 'primary'); }
        else if (p.hasBomb && p.sel === 'knife') g.dropBomb(p);
        break;
      }
      case 'buy': if (typeof m.item === 'string') { if (g.buy(p, m.item)) this.send(p, { t: 'bought', item: m.item }); } break;
      case 'rebuy': g.rebuy(p); break;
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

export { NAME_MAX, MAX_PLAYERS_PER_ROOM, WEAPONS };
