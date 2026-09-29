// Where do bots die? Prints a coarse death heat map per team.  node tools/heat.js [map] [matches]
import { Room } from '../src/server/room.js';
import { SPEC } from '../src/shared/constants.js';
const map = process.argv[2] || 'dust', matches = Number(process.argv[3]) || 8;
const fake = { send() {}, sendRaw() {}, congested: () => false, leaveRoom() {} };
let W, H; const heat = [null, null]; let rounds = 0, tWins = 0;
for (let m = 0; m < matches; m++) {
  const room = new Room('HT', { map, teamSize: 5, bots: true, rounds: 16, difficulty: 'normal' }, null);
  const w = room.addHuman({ ...fake }, 'W'); room.assignTeam(w, SPEC); room.rebalanceBots(true);
  const orig = room.broadcast.bind(room);
  room.broadcast = (msg) => {
    if (msg.t === 'round_end') { rounds++; if (msg.winner === 0) tWins++; }
    if (msg.t === 'kill') {
      const g = room.game; const v = g.players.get(msg.v); if (!v) return;
      W = g.map.w; H = g.map.h;
      heat[v.team] ||= new Array(Math.ceil(W / 6) * Math.ceil(H / 6)).fill(0);
      heat[v.team][Math.floor(v.y / 32 / 6) * Math.ceil(W / 6) + Math.floor(v.x / 32 / 6)]++;
    }
    orig(msg);
  };
  room.start();
  for (let i = 0; i < 60 * 60 * 25 && room.game; i++) room.tick();
}
console.log(`${map}: T win ${(100 * tWins / rounds).toFixed(0)}% over ${rounds} rounds`);
for (const t of [0, 1]) {
  console.log(`deaths of ${['T', 'CT'][t]} (each cell = 6x6 tiles):`);
  const cw = Math.ceil(W / 6);
  for (let y = 0; y < Math.ceil(H / 6); y++) console.log(heat[t].slice(y * cw, (y + 1) * cw).map((v) => String(v).padStart(4)).join(''));
}
