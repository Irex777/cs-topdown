// Fuzz test: fake humans send random (but well-formed) messages while bots play, across maps/modes. Checks invariants.
import { Room } from '../src/server/room.js';
import { WEAPON_LIST } from '../src/shared/weapons.js';

const rand = (n) => Math.floor(Math.random() * n);
let failures = 0;
const fail = (msg) => { failures++; console.error('FAIL:', msg); };

function run(map, mode, humans, teamSize, seconds) {
  const room = new Room('FZ' + rand(99), { map, mode, teamSize, bots: true, rounds: 6, difficulty: ['easy', 'normal', 'hard', 'expert'][rand(4)], friendlyFire: Math.random() < 0.5 }, null);
  const conns = [];
  for (let i = 0; i < humans; i++) {
    const c = { sent: 0, msgs: [], send(m) { this.msgs.push(m.t + (m.k || '')); if (this.msgs.length > 50) this.msgs.shift(); this.sent++; }, sendRaw() {}, congested: () => false, leaveRoom() {} };
    room.addHuman(c, 'H' + i);
    conns.push(c);
  }
  room.start();
  const items = [...WEAPON_LIST.map((w) => w.id), 'kevlar', 'helmet', 'kit', 'he', 'flash', 'smoke', 'molo', 'bogus'];
  let seq = 1;
  const t0 = performance.now();
  for (let tick = 0; tick < seconds * 60; tick++) {
    for (const p of room.humans()) {
      if (tick % 2 === 0) {
        const cmds = [];
        for (let k = 0; k < 1 + rand(3); k++) cmds.push([seq++, rand(256), Math.random() * 6.28 - 3.14, room.game ? room.game.time - 0.1 : 0, rand(700)]);
        room.handle(p, { t: 'in', c: cmds });
      }
      const r = rand(120);
      if (r === 0) room.handle(p, { t: 'a', a: 'buy', item: items[rand(items.length)] });
      else if (r === 1) room.handle(p, { t: 'a', a: 'sw', slot: ['primary', 'secondary', 'knife', 'grenade', 'last'][rand(5)] });
      else if (r === 2) room.handle(p, { t: 'a', a: 'reload' });
      else if (r === 3) room.handle(p, { t: 'a', a: 'drop' });
      else if (r === 4) room.handle(p, { t: 'a', a: 'rebuy' });
      else if (r === 5) room.handle(p, { t: 'a', a: 'spec', dir: rand(2) ? 1 : -1 });
      else if (r === 6 && Math.random() < 0.1) room.handle(p, { t: 'team', team: rand(3) });
      else if (r === 7) room.handle(p, { t: 'chat', text: 'hello <b>' + tick, team: rand(2) });
      else if (r === 8) room.handle(p, { t: 'a', a: 'ping', x: rand(2000), y: rand(1500) });
    }
    try { room.tick(); } catch (e) { fail(`${map}/${mode} tick ${tick}: ${e.stack}`); return; }
    const g = room.game;
    if (!g) { if (mode === 'defuse' || tick > 60 * 5) break; continue; }
    if (tick % 30 === 0) {
      for (const p of g.players.values()) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) fail(`NaN pos ${p.name}`);
        if (p.alive && (p.x < 0 || p.y < 0 || p.x > g.map.width || p.y > g.map.height)) fail(`out of map ${p.name} ${p.x},${p.y}`);
        if (p.alive && g.map.isSolidAt(p.x, p.y)) fail(`${p.name} inside solid at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
        if (p.money < 0 || p.money > 16000) fail(`money ${p.money}`);
        if (p.hp > 100.01 || (p.alive && p.hp <= 0)) fail(`hp ${p.hp} alive=${p.alive}`);
        for (const [id, a] of Object.entries(p.ammo)) if (a.clip < 0 || a.reserve < 0 || a.clip > 60) fail(`ammo ${id} ${a.clip}/${a.reserve}`);
        if (p.totalGrenades() > 4) fail(`too many grenades ${p.totalGrenades()}`);
        const w = p.weapon();
        if (p.alive && p.sel !== 'grenade' && !w) fail(`selected empty slot ${p.sel} on ${p.name}`);
      }
      // snapshots must serialise
      for (const p of room.humans()) { try { JSON.stringify(g.snapshotFor(p)); } catch (e) { fail('snapshot ' + e.message); } }
    }
  }
  const g = room.game;
  console.log(`ok ${map}/${mode} humans=${humans} size=${teamSize}  ${(performance.now() - t0).toFixed(0)}ms  ${g ? 'round ' + g.round + ' score ' + g.score : 'match ended'}`);
}

for (const map of ['dust', 'warehouse', 'pit']) {
  for (const mode of ['defuse', 'dm']) {
    run(map, mode, 2, 5, 150);
    run(map, mode, 3, 2, 100);
  }
}
run('dust', 'defuse', 0, 8, 200);
run('dust', 'defuse', 1, 1, 200);
console.log(failures ? `${failures} FAILURES` : 'ALL OK');
process.exit(failures ? 1 : 0);
