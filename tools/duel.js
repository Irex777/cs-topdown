// How dangerous is one bot to a scripted "human" who strafes (or stands still) in the open?  node tools/duel.js [trials]
import { Room } from '../src/server/room.js';
import { KEY, T, CT, PHASE } from '../src/shared/constants.js';

const trials = Number(process.argv[2]) || 30;
const fake = { send() {}, sendRaw() {}, congested: () => false, leaveRoom() {} };

function duel(difficulty, dist, strafe) {
  const room = new Room('DU', { map: 'pit', teamSize: 1, bots: false, difficulty, mode: 'dm' }, null);
  const human = room.addHuman({ ...fake }, 'Dummy');
  room.assignTeam(human, CT);
  room.settings.bots = true; room.settings.teamSize = 1;
  room.start();
  const g = room.game;
  // one T bot only
  for (const p of [...g.players.values()]) if (p.bot && p.team === CT) g.players.delete(p.id);
  const bot = [...g.players.values()].find((p) => p.bot);
  if (!bot) return null;
  bot.team = T;
  g.phase = PHASE.LIVE;
  const y = 16 * 32 + 16;
  human.x = 26 * 32; human.y = y; human.alive = true; human.spawnProt = 0; human.hp = 100; human.armor = 0; human.vx = human.vy = 0;
  bot.x = human.x - dist; bot.y = y; bot.alive = true; bot.spawnProt = 0; bot.hp = 100; bot.armor = 0;
  bot.giveWeapon('ak47'); bot.sel = 'primary'; bot.primary = 'ak47'; bot.bot.buyAt = 1e9; bot.bot.bought = true;
  human.giveWeapon('ak47'); human.primary = 'ak47'; human.sel = 'primary';
  let seq = 1;
  for (let i = 0; i < 60 * 12; i++) {
    const ang = Math.atan2(bot.y - human.y, bot.x - human.x);
    let keys = 0;
    if (strafe) keys = (Math.floor(i / 30) % 2 === 0) ? KEY.UP : KEY.DOWN;
    room.handle(human, { t: 'in', c: [[seq++, keys, ang, 0, 0]] });
    room.tick();
    if (!human.alive) return { killedAt: i / 60 };
  }
  return { killedAt: Infinity, hp: human.hp };
}

for (const diff of ['easy', 'normal', 'hard', 'expert']) {
  for (const [dist, strafe] of [[300, true], [600, true], [600, false]]) {
    const res = [];
    for (let i = 0; i < trials; i++) { const r = duel(diff, dist, strafe); if (r) res.push(r.killedAt); }
    const killed = res.filter((x) => x !== Infinity);
    const med = killed.sort((a, b) => a - b)[Math.floor(killed.length / 2)];
    console.log(`${diff.padEnd(6)} dist=${dist} ${strafe ? 'strafing  ' : 'standing  '} bot killed target ${(100 * killed.length / res.length).toFixed(0)}% within 12 s, median time ${med ? med.toFixed(1) + 's' : '-'}`);
  }
}
