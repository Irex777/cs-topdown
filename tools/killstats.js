import { Room } from '../src/server/room.js';
import { SPEC } from '../src/shared/constants.js';
const map = process.argv[2] || 'dust';
const fake = { send() {}, sendRaw() {}, congested: () => false, leaveRoom() {} };
const st = { first: [0, 0], kills: [0, 0], dist: [[], []], weapons: {}, bombKills: 0, tOnSiteAtPlant: [], roundsBySecond: {} };
for (let m = 0; m < 6; m++) {
  const room = new Room('KS', { map, teamSize: 5, bots: true, rounds: 16, difficulty: 'normal' }, null);
  const w = room.addHuman({ ...fake }, 'W'); room.assignTeam(w, SPEC); room.rebalanceBots(true);
  let firstDone = false;
  const orig = room.broadcast.bind(room);
  room.broadcast = (msg) => {
    if (msg.t === 'round_start') firstDone = false;
    if (msg.t === 'kill') {
      const g = room.game; const k = g.players.get(msg.k), v = g.players.get(msg.v);
      if (k && v && k.team !== v.team) {
        st.kills[k.team]++; st.dist[k.team].push(Math.hypot(k.x - v.x, k.y - v.y));
        if (!firstDone) { firstDone = true; st.first[k.team]++; }
        st.weapons[msg.w] = (st.weapons[msg.w] || 0) + 1;
      }
    }
    orig(msg);
  };
  room.start();
  for (let i = 0; i < 60 * 60 * 25 && room.game; i++) room.tick();
}
const avg = (a) => (a.reduce((x, y) => x + y, 0) / (a.length || 1)).toFixed(0);
console.log(`${map}: kills T=${st.kills[0]} CT=${st.kills[1]} firstKill T=${st.first[0]} CT=${st.first[1]} avgDist T=${avg(st.dist[0])} CT=${avg(st.dist[1])}`);
console.log(JSON.stringify(st.weapons));
