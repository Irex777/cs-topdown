// Integration test: starts the real server on a random port and talks to it over WebSockets like a browser would.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4200 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, ['src/server/index.js'], { cwd: root, env: { ...process.env, PORT: String(port), CS_DEBUG: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
let failures = 0;
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { failures++; console.log('  FAIL', msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await new Promise((res) => server.stdout.on('data', (d) => { if (String(d).includes('ready')) res(); }));

class Client {
  constructor(name, game = 'bf') {
    this.name = name; this.msgs = []; this.snaps = 0; this.last = null; this.waiters = [];
    this.ws = new WebSocket(`ws://localhost:${port}/${game}/ws`);
    this.ready = new Promise((r) => this.ws.on('open', r));
    this.ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.t === 's') { this.snaps++; this.last = m; } else this.msgs.push(m);
      this.waiters = this.waiters.filter((w) => !w(m));
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(pred, ms = 4000) {
    const hit = this.msgs.find(pred); if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout waiting for message')), ms);
      this.waiters.push((m) => { if (pred(m)) { clearTimeout(t); res(m); return true; } return false; });
    });
  }
}

try {
  const land = await fetch(`http://localhost:${port}/`);
  const landHtml = await land.text();
  check(land.status === 200 && landHtml.includes('Frontline') && landHtml.includes('href="/cs/"'), 'landing page offers both games');
  const http = await fetch(`http://localhost:${port}/bf/`);
  check(http.status === 200 && (await http.text()).includes('Frontline'), 'serves the client page');
  for (const f of ['/bf/js/main.js', '/bf/shared/constants.js', '/bf/css/style.css', '/cs/', '/cs/js/main.js', '/cs/shared/constants.js', '/cs/css/style.css']) check((await fetch(`http://localhost:${port}${f}`)).status === 200, `serves ${f}`);
  check((await fetch(`http://localhost:${port}/cs`, { redirect: 'manual' })).status === 301, '/cs redirects to /cs/');
  check((await fetch(`http://localhost:${port}/bf/../../package.json`)).status !== 200, 'blocks path traversal');
  check((await fetch(`http://localhost:${port}/bf/%2e%2e/%2e%2e/package.json`)).status !== 200, 'blocks encoded path traversal');

  const a = new Client('Alice'); await a.ready;
  a.send({ t: 'hello', name: 'Alice' });
  const welcome = await a.wait((m) => m.t === 'welcome');
  check(Array.isArray(welcome.maps) && welcome.maps.length >= 3, 'welcome lists maps');
  a.send({ t: 'create', name: 'Alice', settings: { map: 'pit', teamSize: 2, bots: true, mode: 'tdm' } });
  const room = await a.wait((m) => m.t === 'room');
  check(/^[A-Z]{4}$/.test(room.code), `room code ${room.code}`);
  check(room.host === room.you, 'creator is host');

  const b = new Client('Bob'); await b.ready;
  b.send({ t: 'hello', name: 'Bob' });
  await b.wait((m) => m.t === 'welcome');
  b.send({ t: 'join', code: room.code.toLowerCase(), name: 'Bob' });
  const roomB = await b.wait((m) => m.t === 'room');
  check(roomB.code === room.code, 'friend joins with (case-insensitive) code');
  b.send({ t: 'join', code: 'ZZZZ', name: 'Bob' });
  // already in a room: ignored, but a fresh client gets an error for unknown rooms
  const c = new Client('Carol'); await c.ready;
  c.send({ t: 'hello', name: 'Carol' }); await c.wait((m) => m.t === 'welcome');
  c.send({ t: 'join', code: 'QQQQ', name: 'Carol' });
  check((await c.wait((m) => m.t === 'error')).code === 'noroom', 'unknown room gives an error');
  c.ws.close();

  await sleep(200);
  const roster = [...a.msgs].reverse().find((m) => m.t === 'roster');
  check(roster.players.filter((p) => !p.b).length === 2, 'roster has both humans');
  check(roster.players.filter((p) => p.b).length >= 2, 'bots fill the empty slots');

  a.send({ t: 'shuffle' });
  await sleep(250);
  const r2 = [...a.msgs].reverse().find((m) => m.t === 'roster');
  const teams = r2.players.filter((p) => !p.b).map((p) => p.tm).sort();
  check(teams.length === 2 && teams[0] === 0 && teams[1] === 1, 'host can shuffle teams (humans end up on opposite sides)');
  b.send({ t: 'shuffle' });
  await sleep(100);

  b.send({ t: 'chat', text: 'hi <script>', team: 0 });
  const chat = await a.wait((m) => m.t === 'chat' && m.from === roomB.you);
  check(chat.text === 'hi <script>', 'chat is relayed');

  b.send({ t: 'start' });
  await sleep(200);
  check(!b.msgs.some((m) => m.t === 'match'), 'non-host cannot start the match');
  a.send({ t: 'start' });
  const match = await a.wait((m) => m.t === 'match');
  check(match.map === 'pit' && match.mode === 'tdm', 'host starts the match');
  await a.wait((m) => m.t === 'begin');
  await sleep(500);
  check(a.snaps > 5, `snapshots stream in while dead (${a.snaps})`);
  check(a.last.al === 0 && Array.isArray(a.last.sps) || a.msgs.length > 0, 'spawn options are offered on the deploy screen');
  a.send({ t: 'a', a: 'loadout', lo: { cls: 'recon', primary: { id: 'sv98', att: { optic: 'scope12', barrel: 'supp' } }, secondary: { id: 'deagle', att: {} }, gadgets: ['beacon', 'sensor'], gren: 'smoke' } });
  a.send({ t: 'a', a: 'deploy', k: 'base', id: 0 });
  await sleep(800);
  const snap = a.last;
  check(snap.al === 1 && snap.me && snap.me.own === 1 && snap.me.hp === 100, 'deploying spawns the player');
  check(snap.me.cls === 'recon' && snap.me.pw >= 0, 'the chosen class and weapon are applied');
  check(snap.me.mv && snap.me.mv[1] === 3, 'a 12x scope reports scope level 3 (movement profile)');
  check(snap.p.length >= 1 && snap.p.every((t) => t.length === 9), 'player tuples well-formed');
  check(a.msgs.some((m) => m.t === 'kit' && m.lo.primary.id === 'sv98'), 'server confirms the applied loadout');

  // movement, sprint is faster than walking
  let seq = 0;
  const run = async (keys, n) => { const x0 = a.last.me.x, y0 = a.last.me.y; for (let i = 0; i < n; i++) { const c = []; for (let k = 0; k < 6; k++) c.push([++seq, keys, 0, 0, 0]); a.send({ t: 'in', c }); await sleep(50); } await sleep(150); return Math.hypot(a.last.me.x - x0, a.last.me.y - y0); };
  const dWalk = await run(8, 12);
  a.send({ t: 'a', a: 'sw', slot: 'knife' });
  await sleep(300);
  const dRun = await run(1 + 8 + 256 - 1, 12);
  check(dWalk > 20, `holding right moves the player (${dWalk.toFixed(0)} px)`);
  check(a.last.ack > 0, 'server acknowledges input sequence numbers');
  void dRun;

  // wrong / hostile input is ignored
  a.send({ t: 'in', c: 'garbage' }); a.send({ t: 'a', a: 'deploy', k: { x: 1 } }); a.send({ t: 'settings', settings: null });
  a.send({ t: 'a', a: 'loadout', lo: { cls: 'nope', primary: { id: '__proto__' } } });
  a.ws.send('not json'); a.ws.send(JSON.stringify({ t: 42 }));
  await sleep(200);
  check(a.snaps > 0 && a.ws.readyState === 1, 'server survives malformed messages');

  // settings: only host
  b.send({ t: 'settings', settings: { map: 'dust' } });
  await sleep(150);
  check(!a.msgs.some((m) => m.t === 'settings' && m.settings.map === 'dust'), 'non-host cannot change settings');

  // refresh / reconnect keeps the seat
  const token = welcome.token;
  a.ws.close();
  await sleep(300);
  const a2 = new Client('Alice'); await a2.ready;
  a2.send({ t: 'hello', name: 'Alice', token });
  const w2 = await a2.wait((m) => m.t === 'welcome');
  check(w2.resumed === 1, 'session resumes after reconnect');
  await a2.wait((m) => m.t === 'match');
  await sleep(400);
  check(a2.snaps > 3 && a2.last.me, 'resumed player receives snapshots again');
  a2.send({ t: 'leave' }); b.send({ t: 'leave' });

  // ---- a Conquest match on the big map: flags, tickets, vehicles and destruction all show up in the snapshots
  const d = new Client('Dora'); await d.ready;
  d.send({ t: 'hello', name: 'Dora' }); await d.wait((m) => m.t === 'welcome');
  d.send({ t: 'create', name: 'Dora', autostart: true, settings: { map: 'riverside', mode: 'conquest', teamSize: 4, bots: true, vehicles: true } });
  await d.wait((m) => m.t === 'match');
  await sleep(700);
  d.send({ t: 'a', a: 'deploy', k: 'base', id: 0, lo: { cls: 'engineer', primary: { id: 'mp7', att: {} }, secondary: { id: 'm9', att: {} }, gadgets: ['repair', 'rpg'], gren: 'he' } });
  await sleep(1200);
  const cs = d.last;
  check(cs.al === 1 && Array.isArray(cs.fl) && cs.fl.length === 7, 'conquest snapshot carries 7 flags');
  check(Array.isArray(cs.tix) && cs.tix[0] > 100, 'tickets are streamed');
  check(Array.isArray(cs.v) && cs.v.length > 0, 'vehicles are streamed');
  check(cs.me.g && cs.me.g[1] && cs.me.g[1][0] >= 0, 'gadgets are part of the own state');
  const tank = cs.v.find((t) => t[1] === 3);
  check(!!tank, 'a tank waits in the base');
  d.send({ t: 'dbg', cmd: 'tp', x: 1, y: 1 });   // debug is off for this server: nothing must happen
  await sleep(150);
  check(Math.abs(d.last.me.x - 1) > 10, 'debug commands are disabled by default');
  d.send({ t: 'leave' });
  await sleep(200);
  const list = await fetch(`http://localhost:${port}/bf/api/rooms`).then((r) => r.json());
  check(Array.isArray(list), 'public room list endpoint works');

  // ---- the original CS game lives next to it on /cs
  const cs1 = new Client('Carl', 'cs'); await cs1.ready;
  cs1.send({ t: 'hello', name: 'Carl' });
  const csWelcome = await cs1.wait((m) => m.t === 'welcome');
  check(csWelcome.maps.some((mp) => mp.id === 'dust'), 'CS server offers its own maps');
  cs1.send({ t: 'create', name: 'Carl', autostart: true, settings: { map: 'dust', mode: 'defuse', teamSize: 2, bots: true } });
  await cs1.wait((m) => m.t === 'room');
  await sleep(1500);
  check(cs1.snaps > 10, `CS match streams snapshots (${cs1.snaps})`);
  const bfOnly = new Client('Bea'); await bfOnly.ready;
  bfOnly.send({ t: 'hello', name: 'Bea' });
  const bfW = await bfOnly.wait((m) => m.t === 'welcome');
  check(bfW.maps.some((mp) => mp.id === 'riverside') && !csWelcome.maps.some((mp) => mp.id === 'riverside'), 'the two games keep separate map lists');
  const csList = await fetch(`http://localhost:${port}/cs/api/rooms`).then((r) => r.json());
  check(Array.isArray(csList), 'CS public room list endpoint works');
  cs1.send({ t: 'leave' }); bfOnly.ws.close();
} catch (e) {
  failures++; console.log('  FAIL exception:', e.message);
}
server.kill();
console.log(failures ? `\n${failures} integration check(s) FAILED` : '\nintegration: ALL OK');
process.exit(failures ? 1 : 0);
