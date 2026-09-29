// Diagnostics for bot behaviour: usage of vehicles, revives, captures, idle time, tick cost.  node tools/botstats.js [map] [seconds] [teamSize] [mode]
import { Room } from '../src/server/room.js';
import { SPEC } from '../src/shared/constants.js';

const map = process.argv[2] || 'riverside';
const seconds = Number(process.argv[3]) || 300;
const teamSize = Number(process.argv[4]) || 16;
const mode = process.argv[5] || 'conquest';
const fake = { send() {}, sendRaw() {}, congested: () => false, leaveRoom() {} };
const room = new Room('BS', { map, teamSize, bots: true, mode, vehicles: true, difficulty: 'normal', tickets: 400 }, null);
const spec = room.addHuman({ ...fake }, 'W'); room.assignTeam(spec, SPEC); room.rebalanceBots(true);
room.start();
const g = room.game;
const stat = { vehSeconds: 0, alive: 0, idle: 0, samples: 0, byKind: {}, maxTick: 0, total: 0, snapBytes: 0, snaps: 0 };
const last = new Map();
for (let i = 0; i < seconds * 60; i++) {
  const a = performance.now(); room.tick(); const d = performance.now() - a; stat.total += d; if (d > stat.maxTick) stat.maxTick = d;
  if (!room.game) break;
  if (i % 60 === 0) {
    for (const p of g.players.values()) {
      if (p.team === SPEC || !p.alive) continue;
      stat.alive++;
      if (p.veh) { stat.vehSeconds++; const v = g.vehicleById(p.veh); if (v) stat.byKind[v.type] = (stat.byKind[v.type] || 0) + 1; continue; }
      const l = last.get(p.id);
      if (l && Math.hypot(l.x - p.x, l.y - p.y) < 8 && g.time - l.t < 30) { l.n++; if (l.n >= 6 && !p.bot.visible) stat.idle++; } else last.set(p.id, { x: p.x, y: p.y, t: g.time, n: 0 });
      if (l && Math.hypot(l.x - p.x, l.y - p.y) >= 8) { l.x = p.x; l.y = p.y; l.n = 0; l.t = g.time; }
    }
    stat.samples++;
    if (i % 600 === 0) { const s = JSON.stringify(g.snapshotFor(spec)); stat.snapBytes += s.length; stat.snaps++; }
  }
}
const ps = [...g.players.values()].filter((p) => p.team !== SPEC);
const sum = (f) => ps.reduce((a, p) => a + f(p), 0);
console.log(`${map}/${mode} ${teamSize}v${teamSize}: ${seconds}s, total ${stat.total.toFixed(0)} ms (${(stat.total / (seconds * 60)).toFixed(2)} ms/tick, worst ${stat.maxTick.toFixed(1)} ms)`);
console.log(`kills ${sum((p) => p.stats.kills)}  deaths ${sum((p) => p.stats.deaths)}  revives ${sum((p) => p.stats.revives)}  heals ${sum((p) => p.stats.heals)}  captures ${sum((p) => p.stats.captures)}  vehicle kills ${sum((p) => p.stats.vehicleKills)}  repairs ${sum((p) => p.stats.repairs)}`);
console.log(`bots in vehicles ${(stat.vehSeconds / Math.max(1, stat.alive) * 100).toFixed(1)}% of alive time`, JSON.stringify(stat.byKind), `idle samples ${(stat.idle / Math.max(1, stat.alive) * 100).toFixed(1)}%`);
console.log(`avg snapshot for a spectator ${(stat.snapBytes / Math.max(1, stat.snaps) / 1000).toFixed(1)} kB  ×30/s = ${(stat.snapBytes / Math.max(1, stat.snaps) * 30 / 1000).toFixed(0)} kB/s per client`);
console.log(`tickets ${g.tix.map((v) => Math.round(v))}  tiles destroyed ${g.map.changes.size}  phase ${g.phase}  winner ${g.matchWinner}`);
const cls = {}; for (const p of ps) cls[p.cls] = (cls[p.cls] || 0) + 1; console.log('classes', JSON.stringify(cls));
