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
  constructor(name) {
    this.name = name; this.msgs = []; this.snaps = 0; this.last = null; this.waiters = [];
    this.ws = new WebSocket(`ws://localhost:${port}/ws`);
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
  const http = await fetch(`http://localhost:${port}/`);
  check(http.status === 200 && (await http.text()).includes('CS Top-Down'), 'serves the client page');
  for (const f of ['/js/main.js', '/shared/constants.js', '/css/style.css']) check((await fetch(`http://localhost:${port}${f}`)).status === 200, `serves ${f}`);
  check((await fetch(`http://localhost:${port}/../package.json`)).status !== 200, 'blocks path traversal');
  check((await fetch(`http://localhost:${port}/%2e%2e/package.json`)).status !== 200, 'blocks encoded path traversal');

  const a = new Client('Alice'); await a.ready;
  a.send({ t: 'hello', name: 'Alice' });
  const welcome = await a.wait((m) => m.t === 'welcome');
  check(Array.isArray(welcome.maps) && welcome.maps.length >= 3, 'welcome lists maps');
  a.send({ t: 'create', name: 'Alice', settings: { map: 'pit', teamSize: 2, bots: true, rounds: 6, mode: 'defuse' } });
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
  check(match.map === 'pit', 'host starts the match');
  await a.wait((m) => m.t === 'round_start');
  await sleep(700);
  check(a.snaps > 10, `snapshots stream in (${a.snaps})`);
  const snap = a.last;
  check(snap.me && snap.me.own === 1 && snap.me.hp === 100, 'own player state present');
  check(snap.p.length >= 2, 'sees teammates');
  check(snap.p.every((t) => t.length === 8), 'player tuples well-formed');

  // buying during freeze
  const money0 = a.last.me.money;
  a.send({ t: 'a', a: 'buy', item: 'kevlar' });
  await sleep(200);
  check(a.last.me.ar === 100 && a.last.me.money === money0 - 650, 'buy kevlar deducts money');
  a.send({ t: 'a', a: 'buy', item: 'awp' });
  await sleep(150);
  check(a.last.me.pri === -1, 'cannot afford AWP with $800');

  // movement is frozen during freeze time, then works
  const x0 = a.last.me.x;
  let seq = 0;
  const step = (keys, n) => { const c = []; for (let i = 0; i < n; i++) c.push([++seq, keys, 0, 0, 0]); a.send({ t: 'in', c }); };
  step(8, 10);
  await sleep(300);
  check(Math.abs(a.last.me.x - x0) < 1, 'frozen during freeze time');
  await sleep(8500);
  check(a.last.ph === 2, 'round goes live after freeze');
  const x1 = a.last.me.x;
  for (let i = 0; i < 12; i++) { step(8, 5); await sleep(80); }
  await sleep(200);
  check(a.last.me.x > x1 + 30, 'holding right moves the player');
  check(a.last.ack > 0, 'server acknowledges input sequence numbers');

  // wrong / hostile input is ignored
  a.send({ t: 'in', c: 'garbage' }); a.send({ t: 'a', a: 'buy', item: { x: 1 } }); a.send({ t: 'settings', settings: null });
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
  check(a2.snaps > 3 && a2.last.me.own === 1, 'resumed player receives snapshots again');

  a2.send({ t: 'leave' }); b.send({ t: 'leave' });
  await sleep(200);
  const list = await fetch(`http://localhost:${port}/api/rooms`).then((r) => r.json());
  check(Array.isArray(list), 'public room list endpoint works');
} catch (e) {
  failures++; console.log('  FAIL exception:', e.message);
}
server.kill();
console.log(failures ? `\n${failures} integration check(s) FAILED` : '\nintegration: ALL OK');
process.exit(failures ? 1 : 0);
