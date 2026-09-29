// Prints an ASCII "replay" of bots during a round. node tools/trace.js [map] [round] [everySeconds]
import { Room } from '../src/server/room.js';
import { SPEC, TILE } from '../src/shared/constants.js';
const map = process.argv[2] || 'dust', wantRound = Number(process.argv[3]) || 2, every = Number(process.argv[4]) || 4;
const fake = { send() {}, sendRaw() {}, congested: () => false, leaveRoom() {} };
const room = new Room('TR', { map, teamSize: 5, bots: true, rounds: 30, difficulty: 'normal' }, null);
const w = room.addHuman({ ...fake }, 'W'); room.assignTeam(w, SPEC); room.rebalanceBots(true);
room.start();
const g = room.game;
let last = -99;
for (let i = 0; i < 60 * 60 * 10 && room.game; i++) {
  room.tick();
  if (g.round === wantRound && g.phase === 2 && g.time - last >= every) {
    last = g.time;
    const grid = g.map.chars.slice().map((c) => (c === '#' ? '#' : c === 'X' || c === 'o' ? 'x' : ' '));
    for (const p of g.players.values()) {
      if (!p.alive || p.team === SPEC) continue;
      const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
      grid[ty * g.map.w + tx] = p.team === 0 ? (p.hasBomb ? 'B' : 'T') : 'C';
    }
    const b = g.bomb; if (b.state === 'planted') grid[Math.floor(b.y / TILE) * g.map.w + Math.floor(b.x / TILE)] = '*';
    console.log(`--- round ${g.round} t=${(g.time - g.roundStartedAt).toFixed(0)}s aliveT=${g.aliveCount(0)} aliveCT=${g.aliveCount(1)} bomb=${b.state}`);
    for (let y = 0; y < g.map.h; y++) console.log(grid.slice(y * g.map.w, (y + 1) * g.map.w).join(''));
  }
  if (g.round > wantRound) break;
}
