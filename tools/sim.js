// Headless bot-vs-bot simulation: node tools/sim.js [map] [seconds] [teamSize] [difficulty]
import { Room } from '../src/server/room.js';
import { SPEC } from '../src/shared/constants.js';

const map = process.argv[2] || 'dust';
const seconds = Number(process.argv[3]) || 240;
const teamSize = Number(process.argv[4]) || 5;
const difficulty = process.argv[5] || 'normal';

const fake = { send() {}, sendRaw() {}, congested: () => false, leaveRoom() {} };
const room = new Room('TEST', { map, teamSize, bots: true, rounds: 30, difficulty }, null);
const spec = room.addHuman({ ...fake, player: null, room: null }, 'Watcher');
room.assignTeam(spec, SPEC);
room.rebalanceBots(true);

const log = { rounds: [], kills: 0, plants: 0, defuses: 0, explosions: 0, msgs: {} };
const origBroadcast = room.broadcast.bind(room);
room.broadcast = (m) => {
  log.msgs[m.t] = (log.msgs[m.t] || 0) + 1;
  if (m.t === 'kill') log.kills++;
  if (m.t === 'bomb' && m.ev === 'planted') log.plants++;
  if (m.t === 'round_end') log.rounds.push(`${m.round}:${['T', 'CT'][m.winner]}/${m.reason}`);
  if (m.t === 'bomb' && m.ev === 'defused') log.defuses++;
  origBroadcast(m);
};
room.start();
const t0 = performance.now();
let lastRound = 0;
for (let i = 0; i < seconds * 60; i++) {
  room.tick();
  const g = room.game;
  if (!g) break;
  if (g.round !== lastRound) { lastRound = g.round; }
}
const g = room.game;
console.log(`sim ${map} ${teamSize}v${teamSize} ${difficulty}: ${seconds}s game-time in ${(performance.now() - t0).toFixed(0)}ms`);
console.log('rounds:', log.rounds.join('  '));
console.log(`kills=${log.kills} plants=${log.plants} defuses=${log.defuses}`, 'score', g && g.score, 'phase', g && g.phase);
if (g) {
  const list = [...g.players.values()].filter((p) => p.team !== SPEC).map((p) => `${p.name}[${['T', 'CT'][p.team]}] ${p.stats.kills}/${p.stats.deaths} $${p.money} ${p.alive ? 'alive' : 'dead'} ${p.primary || '-'}`);
  console.log(list.join('\n'));
}
