// 1v1 duels between two bots in the open: how quickly and how accurately do they fight?  node tools/botduel.js [distancePx] [trials] [difficulty]
import { Room } from '../src/server/room.js';
import { SPEC, T, CT } from '../src/shared/constants.js';

const dist = Number(process.argv[2]) || 320;
const trials = Number(process.argv[3]) || 24;
const difficulty = process.argv[4] || 'normal';
const fake = { send() {}, sendRaw() {}, congested: () => false, leaveRoom() {} };
let kills = 0, ttk = [], shots = 0, dmg = 0, timeouts = 0;
for (let t = 0; t < trials; t++) {
  const room = new Room('DU', { map: 'riverside', teamSize: 1, bots: true, mode: 'tdm', vehicles: false, difficulty, tickets: 999 }, null);
  const spec = room.addHuman({ ...fake }, 'W'); room.assignTeam(spec, SPEC); room.rebalanceBots(true);
  room.start();
  const g = room.game;
  const bots = [...g.players.values()].filter((p) => p.bot);
  for (let i = 0; i < 400; i++) { room.tick(); if (bots.every((b) => b.alive)) break; }
  // find an open east-west strip near the middle of the field
  const m = g.map;
  let spot = null;
  for (let ty = 30; ty < m.h - 30 && !spot; ty += 3) for (let tx = 30; tx < m.w - 30; tx += 3) {
    const x0 = tx * 32 + 16, y0 = ty * 32 + 16;
    if (m.clearLineR(x0, y0, x0 + dist, y0, 14) && !m.isBlockedTile(tx, ty) && m.top[ty * m.w + tx + Math.round(dist / 32)] === 0) { spot = { x: x0, y: y0 }; break; }
  }
  if (!spot) { console.log('no open strip found'); process.exit(1); }
  const [a, b] = bots;
  for (const [p, x, ang] of [[a, spot.x, 0], [b, spot.x + dist, Math.PI]]) {
    p.x = x; p.y = spot.y; p.vx = p.vy = 0; p.angle = ang; p.bot.aim = ang; p.spawnProt = 0; p.hp = 100; p.armor = 0; p.z = 0;
    p.bot.job = null; p.bot.jobCd = 99;
  }
  let shotsHere = 0;
  const emit0 = g.emit.bind(g);
  g.emit = (pp, ...r) => { if (pp[0] === 'shot') shotsHere++; return emit0(pp, ...r); };
  const dmg0 = a.stats.damage + b.stats.damage;
  let done = false;
  for (let i = 0; i < 60 * 25 && !done; i++) {
    room.tick();
    if (!a.alive || !b.alive) { done = true; kills++; ttk.push(i / 60); }
  }
  if (!done) timeouts++;
  shots += shotsHere; dmg += a.stats.damage + b.stats.damage - dmg0;
}
const avg = ttk.length ? ttk.reduce((x, y) => x + y, 0) / ttk.length : NaN;
console.log(`duels at ${dist}px (${difficulty}), ${trials} trials: decided ${kills}, timeouts ${timeouts}, mean time to kill ${avg.toFixed(1)}s, shots/trial ${(shots / trials).toFixed(0)}, damage/shot ${(dmg / Math.max(1, shots)).toFixed(1)}`);
void T; void CT;
