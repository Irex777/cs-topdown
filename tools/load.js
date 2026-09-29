// Load test: N human clients (no bots) all sending inputs at 60 Hz in one room; reports server CPU and bandwidth.
// Usage: node tools/load.js [clients=10] [seconds=20]
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const N = Number(process.argv[2]) || 10, SECS = Number(process.argv[3]) || 20;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4800 + Math.floor(Math.random() * 100);
const server = spawn(process.execPath, ['src/server/index.js'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('ready') && r()));
const cpu = () => { const f = fs.readFileSync(`/proc/${server.pid}/stat`, 'utf8').split(' '); return (Number(f[13]) + Number(f[14])) / 100; };

let bytes = 0, snaps = 0;
const clients = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < N; i++) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const c = { ws, code: null, id: 0, seq: 0, alive: false };
  ws.on('message', (d) => {
    bytes += d.length;
    const m = JSON.parse(d);
    if (m.t === 's') { snaps++; c.alive = !!m.al; c.last = m; }
    if (m.t === 'room') { c.code = m.code; c.id = m.you; }
  });
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ t: 'hello', name: 'L' + i }));
  if (i === 0) ws.send(JSON.stringify({ t: 'create', name: 'L0', settings: { map: 'dust', teamSize: Math.ceil(N / 2), bots: false, rounds: 30 } }));
  else { await sleep(150); ws.send(JSON.stringify({ t: 'join', code: clients[0].code, name: 'L' + i })); }
  await sleep(150);
  clients.push(c);
}
clients[0].ws.send(JSON.stringify({ t: 'start' }));
await sleep(9500);
const cpu0 = cpu(), t0 = Date.now(); bytes = 0; snaps = 0;
const timer = setInterval(() => {
  for (const c of clients) {
    const cmds = [];
    for (let k = 0; k < 1; k++) cmds.push([++c.seq, 1 + Math.floor(Math.random() * 15) | (Math.random() < 0.5 ? 16 : 0), Math.random() * 6.28, 0, 200]);
    c.ws.send(JSON.stringify({ t: 'in', c: cmds }));
  }
}, 1000 / 60);
await sleep(SECS * 1000);
clearInterval(timer);
const dt = (Date.now() - t0) / 1000, dcpu = cpu() - cpu0;
console.log(`${N} clients, ${dt.toFixed(0)} s: server CPU ${(100 * dcpu / dt).toFixed(1)}% of one core, downstream ${(bytes / dt / 1024 / N).toFixed(1)} KB/s per client, ${(snaps / dt / N).toFixed(1)} snapshots/s per client`);
const mem = fs.readFileSync(`/proc/${server.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/);
console.log(`server RSS ${(Number(mem[1]) / 1024).toFixed(0)} MB`);
for (const c of clients) c.ws.close();
server.kill();
process.exit(0);
