// Runs many bot-vs-bot rounds and prints win rates / plant rates.  node tools/balance.js [map] [matches] [teamSize] [difficulty]
import { Room } from '../src/server/room.js';
import { SPEC } from '../src/shared/constants.js';
import { BotBrain } from '../src/server/bot/brain.js';
import { WEAPONS } from '../src/shared/weapons.js';
if (process.env.SYM) {
  for (const id of ['m4a4', 'm4a1s']) Object.assign(WEAPONS[id], { dmg: WEAPONS.ak47.dmg, ap: WEAPONS.ak47.ap, rpm: WEAPONS.ak47.rpm, cd: WEAPONS.ak47.cd, mag: 30, spread: WEAPONS.ak47.spread, moveSpread: WEAPONS.ak47.moveSpread, burst: WEAPONS.ak47.burst, price: 2700, speedPx: WEAPONS.ak47.speedPx });
  Object.assign(WEAPONS.usp, { dmg: WEAPONS.glock.dmg, ap: WEAPONS.glock.ap, rpm: WEAPONS.glock.rpm, cd: WEAPONS.glock.cd, mag: 20 });
}
if (process.env.NO_OBJ_NADES) BotBrain.prototype.considerObjectiveNade = () => {};
if (process.env.NO_COMBAT_NADES) BotBrain.prototype.considerCombatNade = () => {};

const map = process.argv[2] || 'dust';
const matches = Number(process.argv[3]) || 6;
const teamSize = Number(process.argv[4]) || 5;
const diff = process.argv[5] || 'normal';
const fake = { send() {}, sendRaw() {}, congested: () => false, leaveRoom() {} };
const agg = { T: 0, CT: 0, reasons: {}, plants: 0, rounds: 0, kills: 0, secs: 0, defuses: 0, matchesEnded: 0 };
for (let m = 0; m < matches; m++) {
  const room = new Room('BAL', { map, teamSize, bots: true, rounds: 16, difficulty: diff }, null);
  const w = room.addHuman({ ...fake }, 'W');
  room.assignTeam(w, SPEC);
  room.rebalanceBots(true);
  const orig = room.broadcast.bind(room);
  let roundStart = 0;
  room.broadcast = (msg) => {
    if (msg.t === 'kill') agg.kills++;
    if (msg.t === 'bomb' && msg.ev === 'planted') agg.plants++;
    if (msg.t === 'bomb' && msg.ev === 'defused') agg.defuses++;
    if (msg.t === 'round_start') roundStart = room.game.time;
    if (msg.t === 'round_end') { agg.rounds++; agg[['T', 'CT'][msg.winner]]++; agg.reasons[msg.reason] = (agg.reasons[msg.reason] || 0) + 1; agg.secs += room.game.time - roundStart; }
    if (msg.t === 'match_over') agg.matchesEnded++;
    orig(msg);
  };
  room.start();
  for (let i = 0; i < 60 * 60 * 25 && room.game; i++) room.tick();
}
const r = agg.rounds || 1;
console.log(`${map} ${teamSize}v${teamSize} ${diff}: rounds=${agg.rounds} T=${(100 * agg.T / r).toFixed(0)}% CT=${(100 * agg.CT / r).toFixed(0)}%  plants=${(100 * agg.plants / r).toFixed(0)}% defuses=${agg.defuses} kills/round=${(agg.kills / r).toFixed(1)} avgRound=${(agg.secs / r).toFixed(0)}s reasons=${JSON.stringify(agg.reasons)}`);
