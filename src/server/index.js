// HTTP (static client) + WebSocket game server.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as bfRoom from './room.js';
import { mapList as bfMaps } from '../shared/maps/index.js';
import * as csRoom from '../cs/server/room.js';
import { mapList as csMaps } from '../cs/shared/maps/index.js';
import { NAME_MAX, TICK } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..');
const LANDING_DIR = path.join(SRC, 'landing');
// One process hosts several games. Each has its own client bundle, shared rules, room manager and WebSocket path.
const GAMES = {
  bf: { name: 'Frontline: Voxel Warfare', client: path.join(SRC, 'client'), shared: path.join(SRC, 'shared'), Room: bfRoom.Room, sanitizeSettings: bfRoom.sanitizeSettings, defaults: bfRoom.DEFAULT_SETTINGS, mapList: bfMaps },
  cs: { name: 'CS Top-Down', client: path.join(SRC, 'cs', 'client'), shared: path.join(SRC, 'cs', 'shared'), Room: csRoom.Room, sanitizeSettings: csRoom.sanitizeSettings, defaults: csRoom.DEFAULT_SETTINGS, mapList: csMaps },
};
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_ROOMS = 60;
const MAX_CONNS = 400;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.map': 'application/json',
};
const gzCache = new Map();

function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache' };
    const compressible = ['.html', '.js', '.css', '.json', '.svg'].includes(ext);
    const wantsGzip = compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (wantsGzip) {
      const c = gzCache.get(file);
      if (c && c.mtime === st.mtimeMs) { res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': c.buf.length }); res.end(c.buf); return; }
      fs.readFile(file, (e, data) => {
        if (e) { res.writeHead(500); res.end(); return; }
        const buf = zlib.gzipSync(data);
        gzCache.set(file, { mtime: st.mtimeMs, buf });
        res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': buf.length });
        res.end(buf);
      });
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

function safeJoin(root, rel) {
  const p = path.normalize(path.join(root, rel));
  return p.startsWith(root + path.sep) || p === root ? p : null;
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); res.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
  if (pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  if (pathname === '/api/rooms') {   // both games, for the landing page
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(Object.fromEntries(Object.entries(managers).map(([k, m]) => [k, m.publicRooms().length]))));
    return;
  }
  const m = /^\/(bf|cs)(\/.*)?$/.exec(pathname);
  if (m) {
    const g = m[1], rest = m[2];
    if (!rest) { res.writeHead(301, { Location: `/${g}/${url.search}` }); res.end(); return; }
    if (rest === '/api/rooms') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(managers[g].publicRooms()));
      return;
    }
    const file = rest.startsWith('/shared/') ? safeJoin(GAMES[g].shared, rest.slice('/shared/'.length)) : safeJoin(GAMES[g].client, rest === '/' ? 'index.html' : rest.slice(1));
    if (!file) { res.writeHead(403); res.end(); return; }
    serveFile(req, res, file);
    return;
  }
  const file = safeJoin(LANDING_DIR, pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!file) { res.writeHead(403); res.end(); return; }
  serveFile(req, res, file);
});

// ---------------------------------------------------------------------------------------------
class Conn {
  constructor(ws) {
    this.ws = ws;
    this.player = null;
    this.room = null;
    this.name = 'Player';
    this.token = crypto.randomBytes(12).toString('hex');
    this.alive = true;
    this.msgCount = 0;
    this.msgWindow = Date.now();
  }
  send(obj) { this.sendRaw(JSON.stringify(obj)); }
  sendRaw(str) { if (this.ws.readyState === 1) this.ws.send(str); }
  congested() { return this.ws.bufferedAmount > 512 * 1024; }
  leaveRoom() { this.player = null; this.room = null; }
}

class Manager {
  constructor(game) {
    this.game = game;
    this.rooms = new Map();
    this.conns = new Set();
    this.sessions = new Map();   // token -> {code, pid}
  }

  publicRooms() {
    return [...this.rooms.values()].filter((r) => r.settings.public && r.connectedHumans().length).map((r) => r.listing());
  }

  newCode() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (let i = 0; i < 100; i++) {
      let c = '';
      for (let k = 0; k < 4; k++) c += letters[crypto.randomInt(letters.length)];
      if (!this.rooms.has(c)) return c;
    }
    return crypto.randomBytes(3).toString('hex').toUpperCase();
  }

  cleanName(n) {
    const s = String(n || '').replace(/[\u0000-\u001f<>&"']/g, '').trim().slice(0, NAME_MAX);
    return s || 'Player' + Math.floor(Math.random() * 900 + 100);
  }

  uniqueName(room, name) {
    const used = new Set([...room.players.values()].map((p) => p.name));
    let n = name, i = 2;
    while (used.has(n)) n = `${name.slice(0, NAME_MAX - 2)}${i++}`;
    return n;
  }

  onConnect(ws) {
    if (this.conns.size >= MAX_CONNS) { ws.close(1013, 'server full'); return; }
    const c = new Conn(ws);
    this.conns.add(c);
    ws.on('message', (data) => this.onMessage(c, data));
    ws.on('close', () => this.onClose(c));
    ws.on('error', () => {});
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
  }

  onClose(c) {
    this.conns.delete(c);
    const room = c.room, p = c.player;
    if (room && p && p.conn === c) {
      this.sessions.set(c.token, { code: room.code, pid: p.id });
      room.detach(p);
    }
  }

  onMessage(c, data) {
    const now = Date.now();
    if (now - c.msgWindow > 1000) { c.msgWindow = now; c.msgCount = 0; }
    if (++c.msgCount > 400) return;          // flood guard
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'hello': return this.hello(c, m);
      case 'list': return c.send({ t: 'rooms', rooms: this.publicRooms() });
      case 'create': return this.create(c, m);
      case 'join': return this.join(c, m);
      case 'leave': if (c.room && c.player) { const r = c.room; r.removeHuman(c.player); c.leaveRoom(); this.gc(r); } return;
      case 'pong': return c.send({ t: 'pong', ts: m.ts });
      default: if (c.room && c.player) c.room.handle(c.player, m);
    }
  }

  hello(c, m) {
    c.name = this.cleanName(m.name);
    // resume an existing session (page refresh / brief disconnect)
    if (typeof m.token === 'string') {
      const s = this.sessions.get(m.token);
      const room = s && this.rooms.get(s.code);
      const p = room && room.players.get(s.pid);
      if (p && !p.isBot && !p.connected) {
        this.sessions.delete(m.token);
        c.token = m.token;
        c.name = p.name;
        c.send({ t: 'welcome', token: c.token, name: c.name, maps: this.game.mapList(), resumed: 1 });
        room.attach(c, p);
        return;
      }
    }
    c.send({ t: 'welcome', token: c.token, name: c.name, maps: this.game.mapList(), defaults: this.game.defaults });
  }

  create(c, m) {
    if (c.room) return;
    if (this.rooms.size >= MAX_ROOMS) { c.send({ t: 'error', text: 'Server is full, try again later.' }); return; }
    if (typeof m.name === 'string') c.name = this.cleanName(m.name);
    const code = this.newCode();
    const room = new this.game.Room(code, this.game.sanitizeSettings(m.settings), this);
    this.rooms.set(code, room);
    room.addHuman(c, this.uniqueName(room, c.name));
    if (m.autostart) room.start();
    console.log(`[${this.game.id} room ${code}] created by ${c.name}`);
  }

  join(c, m) {
    if (c.room) return;
    if (typeof m.name === 'string') c.name = this.cleanName(m.name);
    const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const room = this.rooms.get(code);
    if (!room) { c.send({ t: 'error', text: `Room ${code || '?'} not found.`, code: 'noroom' }); return; }
    if (room.connectedHumans().length >= 16) { c.send({ t: 'error', text: 'That room is full.' }); return; }
    room.addHuman(c, this.uniqueName(room, c.name));
  }

  gc(room) {
    if (!room.connectedHumans().length) room.emptySince = room.emptySince || Date.now();
  }

  sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.connectedHumans().length) { room.emptySince = 0; continue; }
      if (!room.emptySince) room.emptySince = now;
      if (now - room.emptySince > (room.state === 'playing' ? 60000 : 20000)) {
        this.rooms.delete(code);
        console.log(`[${this.game.id} room ${code}] closed (empty)`);
      }
    }
    for (const [tok, s] of this.sessions) if (!this.rooms.has(s.code)) this.sessions.delete(tok);
    for (const c of this.conns) {
      if (c.ws.isAlive === false) { c.ws.terminate(); continue; }
      c.ws.isAlive = false;
      try { c.ws.ping(); } catch { /* ignore */ }
    }
  }
}

for (const [id, g] of Object.entries(GAMES)) g.id = id;
const managers = Object.fromEntries(Object.entries(GAMES).map(([id, g]) => [id, new Manager(g)]));
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 16 * 1024 });
server.on('upgrade', (req, socket, head) => {
  let pathname = '';
  try { pathname = new URL(req.url, 'http://x').pathname; } catch { /* ignore */ }
  const m = /^\/(bf|cs)\/ws$/.exec(pathname);
  if (!m) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => managers[m[1]].onConnect(ws));
});

// ---- fixed-step game loop shared by all rooms
const STEP = 1000 / TICK;
let last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += Math.min(250, now - last);
  last = now;
  let n = 0;
  while (acc >= STEP && n < 6) {
    for (const mg of Object.values(managers)) for (const room of mg.rooms.values()) {
      try { room.tick(); } catch (e) { console.error(`[${mg.game.id} room ${room.code}] tick error`, e); }
    }
    acc -= STEP; n++;
  }
  if (n === 6) acc = 0;
}, 4);
setInterval(() => { for (const mg of Object.values(managers)) mg.sweep(); }, 10000);

server.listen(PORT, HOST, () => {
  console.log(`\n  Frontline: Voxel Warfare server ready on port ${PORT}\n`);
  console.log(`  Local:    http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log(`  Network:  http://${i.address}:${PORT}   <- friends on your Wi-Fi/LAN use this`);
  }
  console.log('');
});

export { managers };
