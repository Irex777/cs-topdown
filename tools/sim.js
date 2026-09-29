// Headless bot-vs-bot simulation: node tools/sim.js [map] [seconds] [teamSize] [difficulty] [mode]
import { Room } from '../src/server/room.js';
import { SPEC } from '../src/shared/constants.js';

const map = process.argv[2] || 'riverside';
const seconds = Number(process.argv[3]) || 240;
const teamSize = Number(process.argv[4]) || 8;
const difficulty = process.argv[5] || 'normal';
const mode = process.argv[6] || (map === 'riverside' ? 'conquest' : 'tdm');

const fake = { send() {}, sendRaw() {}, congested: () => false, leaveRoom() {} };
const room = new Room('TEST', { map, teamSize, bots: true, difficulty, mode, vehicles: true }, null);
const spec = room.addHuman({ ...fake, player: null, room: null }, 'Watcher');
room.assignTeam(spec, SPEC);
room.rebalanceBots(true);

const log = { kills: 0, msgs: {}, flags: 0, vkills: 0 };
const origBroadcast = room.broadcast.bind(room);
room.broadcast = (m) => {
  log.msgs[m.t] = (log.msgs[m.t] || 0) + 1;
  if (m.t === 'kill') { log.kills++; if (m.vt) log.vkills++; }
  if (m.t === 'flag') log.flags++;
  origBroadcast(m);
};
room.start();
const t0 = performance.now();
let worst = 0;
for (let i = 0; i < seconds * 60; i++) {
  const a = performance.now();
  room.tick();
  const dt = performance.now() - a;
  if (dt > worst) worst = dt;
  if (!room.game) break;
}
const g = room.game;
console.log(`sim ${map}/${mode} ${teamSize}v${teamSize} ${difficulty}: ${seconds}s game-time in ${(performance.now() - t0).toFixed(0)}ms (worst tick ${worst.toFixed(1)}ms)`);
console.log(`kills=${log.kills} vehicleKills=${log.vkills} flagChanges=${log.flags}`, 'tickets', g && g.tix.map((v) => Math.round(v)), 'phase', g && g.phase, 'tiles destroyed', g && g.map.changes.size);
if (g) {
  if (g.flags.length) console.log('flags', g.flags.map((f) => `${f.name}:${['R', 'B', '-'][f.owner < 0 ? 2 : f.owner]}`).join(' '));
  console.log('vehicles', g.vehicles.map((v) => `${v.type}${v.dead ? '(dead)' : ''}[${v.occupants().length}]`).join(' '));
  const list = [...g.players.values()].filter((p) => p.team !== SPEC).map((p) => `${p.name}[${['R', 'B'][p.team]}${p.squad}] ${p.cls} ${p.stats.kills}/${p.stats.deaths} sc${p.stats.score} ${p.alive ? (p.veh ? 'veh' : 'alive') : 'dead'}`);
  console.log(list.join('\n'));
}
