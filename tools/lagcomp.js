// Lag-compensation check: shooting at where a moving target *was* (as the shooter saw it) must hit when the server rewinds.
import { Room } from '../src/server/room.js';
import { T, CT, KEY, PHASE } from '../src/shared/constants.js';
import { DT } from '../src/shared/constants.js';

const fake = () => ({ send() {}, sendRaw() {}, congested: () => false, leaveRoom() {} });
function trial(useVt, lagSec) {
  const room = new Room('LC', { map: 'pit', teamSize: 1, bots: false, mode: 'tdm' }, null);
  const a = room.addHuman(fake(), 'Shooter'), b = room.addHuman(fake(), 'Target');
  room.assignTeam(a, T); room.assignTeam(b, CT);
  room.start();
  const g = room.game;
  g.phase = PHASE.LIVE;
  for (let i = 0; i < 10; i++) room.tick();
  g.deploy(a, { k: 'base', id: 0 }); g.deploy(b, { k: 'base', id: 0 });
  for (const p of [a, b]) { p.alive = true; p.spawnProt = 0; p.hp = 100; p.vx = p.vy = 0; }
  a.sel = 'primary'; a.drawT = 0;
  b.x = 22 * 32 + 16; b.y = 10 * 32 + 16;            // target starts here and runs down (+y) through the open middle of the map
  a.x = 29 * 32 + 16; a.y = 15 * 32 + 16;            // shooter to the right, ~7 tiles away
  for (let ty = 10; ty <= 19; ty++) if (g.map.isSolidTile(22, ty)) throw new Error('test lane is blocked at row ' + ty);
  let seq = 1, hit = false;
  const hp0 = b.hp;
  for (let i = 0; i < 90; i++) {
    room.handle(b, { t: 'in', c: [[seq++, KEY.DOWN, 0, 0, 0]] });
    let cmd;
    if (i === 60) {
      const vt = g.time - lagSec;                     // what the shooter's screen showed
      const tf = vt / DT;
      const pos = { x: 0, y: 0, alive: false };
      b.rewound(tf, pos);
      const ang = Math.atan2(pos.y - a.y, pos.x - a.x);
      cmd = [seq++, KEY.FIRE, ang, useVt ? vt : 0, 0];
    } else cmd = [seq++, 0, Math.PI, 0, 0];
    room.handle(a, { t: 'in', c: [cmd] });
    room.tick();
    if (i === 62) hit = b.hp < hp0;
    if (process.env.DBG && i >= 59 && i <= 62) console.log(i, 'B', b.x.toFixed(0), b.y.toFixed(0), 'hp', b.hp, 'events', JSON.stringify(g.events.map((e) => e.p.slice(0, 8))));
  }
  return hit;
}
let ok = 0, okNoComp = 0; const N = 40;
for (let i = 0; i < N; i++) { if (trial(true, 0.15)) ok++; if (trial(false, 0.15)) okNoComp++; }
console.log(`shots aimed at a target 150 ms in the past (target running at ~190 px/s): with rewind ${ok}/${N} hit, without ${okNoComp}/${N} hit`);
const pass = ok >= N * 0.9 && okNoComp <= N * 0.3;
console.log(pass ? 'lag compensation: OK' : 'lag compensation: FAILED');
process.exit(pass ? 0 : 1);
