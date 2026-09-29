// Measures bot movement quality: stuck events, time spent idle while wanting to move, direction jitter.  node tools/botquality.js [map]
import { Room } from '../src/server/room.js';
import { SPEC } from '../src/shared/constants.js';
const map = process.argv[2] || 'dust';
const fake = { send() {}, sendRaw() {}, congested: () => false, leaveRoom() {} };
const room = new Room('BQ', { map, teamSize: 5, bots: true, rounds: 30, difficulty: 'normal' }, null);
const w = room.addHuman({ ...fake }, 'W'); room.assignTeam(w, SPEC); room.rebalanceBots(true);
room.start();
const g = room.game;
const st = { botSeconds: 0, nudges: 0, idleWanting: 0, reversals: 0, samples: 0, stuckSpots: new Map() };
const prev = new Map();
for (let i = 0; i < 60 * 600 && room.game; i++) {
  room.tick();
  if (g.phase !== 2) continue;
  for (const p of g.players.values()) {
    if (!p.bot || !p.alive) continue;
    st.botSeconds += 1 / 60;
    const b = p.bot;
    const pr = prev.get(p.id) || { nudge: 0, vx: 0, vy: 0 };
    if (b.nudgeT > 0 && pr.nudge <= 0) { st.nudges++; const k = `${Math.floor(p.x / 32)},${Math.floor(p.y / 32)}`; st.stuckSpots.set(k, (st.stuckSpots.get(k) || 0) + 1); }
    const sp = p.speed;
    if (b.goal && b.path && sp < 12 && !b.visible) st.idleWanting += 1 / 60;
    const dot = (p.vx * pr.vx + p.vy * pr.vy);
    if (sp > 60 && Math.hypot(pr.vx, pr.vy) > 60 && dot < 0) st.reversals++;
    prev.set(p.id, { nudge: b.nudgeT, vx: p.vx, vy: p.vy });
    st.samples++;
  }
}
const top = [...st.stuckSpots.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log(`${map}: bot-seconds=${st.botSeconds.toFixed(0)} nudges/min=${(st.nudges / (st.botSeconds / 60)).toFixed(2)} idle-while-pathing=${(100 * st.idleWanting / st.botSeconds).toFixed(1)}% reversals/min=${(st.reversals / (st.botSeconds / 60)).toFixed(1)}`);
console.log('top stuck tiles:', JSON.stringify(top));
