// Fuzz test: fake humans send random (but well-formed) messages while bots play, across maps and modes. Checks invariants.
import { Room } from '../src/server/room.js';
import { WEAPON_LIST, CLASS_ORDER, CLASSES, GADGET_LIST, ATTACH, ATTACH_SLOTS } from '../src/shared/weapons.js';
import { VEHICLES } from '../src/shared/vehicles.js';

const rand = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rand(a.length)];
let failures = 0;
const fail = (msg) => { failures++; console.error('FAIL:', msg); };

function randomLoadout() {
  const cls = pick(CLASS_ORDER);
  const c = CLASSES[cls];
  const att = {};
  for (const slot of ATTACH_SLOTS) if (Math.random() < 0.7) att[slot] = pick(Object.keys(ATTACH[slot]));
  const lo = { cls, primary: { id: pick(c.primaries), att }, secondary: { id: pick(['m9', 'deagle', 'g18', 'm1911', 'mp412']), att: {} }, gadgets: [pick(c.gadgets[0]), pick(c.gadgets[1])], gren: pick(['he', 'flash', 'smoke', 'molo']) };
  if (Math.random() < 0.1) lo.primary.id = 'bogus';
  if (Math.random() < 0.1) lo.cls = 'x';
  return lo;
}

function run(map, mode, humans, teamSize, seconds) {
  const room = new Room('FZ' + rand(99), { map, mode, teamSize, bots: true, difficulty: pick(['easy', 'normal', 'hard', 'expert']), friendlyFire: Math.random() < 0.5, vehicles: true, tickets: 150 }, null);
  const conns = [];
  for (let i = 0; i < humans; i++) {
    const c = { sent: 0, send(m) { this.sent++; }, sendRaw() {}, congested: () => false, leaveRoom() {} };
    room.addHuman(c, 'H' + i);
    conns.push(c);
  }
  room.start();
  let seq = 1;
  const t0 = performance.now();
  for (let tick = 0; tick < seconds * 60; tick++) {
    for (const p of room.humans()) {
      if (tick % 2 === 0) {
        const cmds = [];
        for (let k = 0; k < 1 + rand(3); k++) cmds.push([seq++, rand(1024), Math.random() * 6.28 - 3.14, room.game ? room.game.time - 0.1 : 0, rand(900)]);
        room.handle(p, { t: 'in', c: cmds });
      }
      const r = rand(90);
      if (r === 0) room.handle(p, { t: 'a', a: 'deploy', k: pick(['base', 'flag', 'squad', 'beacon', 'area', 'nope']), id: rand(8), lo: randomLoadout() });
      else if (r === 1) room.handle(p, { t: 'a', a: 'sw', slot: pick(['primary', 'secondary', 'gadget0', 'gadget1', 'grenade', 'knife', 'last', 'bogus']) });
      else if (r === 2) room.handle(p, { t: 'a', a: 'reload' });
      else if (r === 3) room.handle(p, { t: 'a', a: 'alt' });
      else if (r === 4) room.handle(p, { t: 'a', a: 'seat', n: rand(5) });
      else if (r === 5) room.handle(p, { t: 'a', a: 'spec', dir: rand(2) ? 1 : -1 });
      else if (r === 6 && Math.random() < 0.1) room.handle(p, { t: 'team', team: rand(3) });
      else if (r === 7) room.handle(p, { t: 'chat', text: 'hello <b>' + tick, team: rand(2) });
      else if (r === 8) room.handle(p, { t: 'a', a: 'ping', x: rand(2000), y: rand(1500) });
      else if (r === 9) room.handle(p, { t: 'a', a: 'spot', x: rand(4000), y: rand(3000) });
      else if (r === 10) room.handle(p, { t: 'a', a: 'squad', n: rand(9) });
      else if (r === 11) room.handle(p, { t: 'a', a: 'loadout', lo: randomLoadout() });
      else if (r === 12) room.handle(p, { t: 'a', a: 'deploy', k: 'base', id: 0, lo: randomLoadout() });
    }
    try { room.tick(); } catch (e) { fail(`${map}/${mode} tick ${tick}: ${e.stack}`); return; }
    const g = room.game;
    if (!g) { if (tick > 60 * 5) break; continue; }
    if (tick % 30 === 0) {
      for (const p of g.players.values()) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) fail(`NaN pos ${p.name}`);
        if (p.alive && (p.x < 0 || p.y < 0 || p.x > g.map.width || p.y > g.map.height)) fail(`out of map ${p.name} ${p.x},${p.y}`);
        if (p.alive && !p.veh && g.map.isBlockedAt(p.x, p.y)) fail(`${p.name} inside an obstacle at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
        if (p.hp > 100.01 || (p.alive && p.hp <= 0)) fail(`hp ${p.hp} alive=${p.alive}`);
        for (const slot of ['primary', 'secondary', 'alt']) { const a = p.am[slot]; if (a.clip < 0 || a.reserve < 0 || a.clip > 200) fail(`ammo ${slot} ${a.clip}/${a.reserve}`); }
        if (p.alive) for (const gd of p.gadgets) if (gd && (gd.charges < 0 || gd.charges > 10)) fail(`gadget charges ${gd.charges}`);
        if (p.alive && p.sel === 'grenade' && p.totalGrenades() <= 0) fail('holding a grenade with none left');
        if (p.veh) { const v = g.vehicleById(p.veh); if (!v || v.dead || v.seats[p.seat] !== p.id) fail(`${p.name} claims a seat it does not hold`); }
      }
      for (const v of g.vehicles) {
        if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.a)) fail(`NaN vehicle ${v.type}`);
        if (!v.dead && (v.x < 0 || v.y < 0 || v.x > g.map.width || v.y > g.map.height)) fail(`vehicle ${v.type} left the map`);
        for (const pid of v.seats) if (pid) { const q = g.players.get(pid); if (!q || q.veh !== v.id) fail(`seat of ${v.type} holds a stranger`); }
        if (!VEHICLES[v.type]) fail('unknown vehicle');
      }
      if (g.tix.some((t) => !Number.isFinite(t))) fail(`tickets ${g.tix}`);
      if (g.gadgets.length > 120) fail(`too many gadgets ${g.gadgets.length}`);
      if (g.projectiles.length > 200) fail(`too many projectiles ${g.projectiles.length}`);
      for (const p of room.humans()) { try { JSON.stringify(g.snapshotFor(p)); } catch (e) { fail('snapshot ' + e.message); } }
    }
  }
  const g = room.game;
  console.log(`ok ${map}/${mode} humans=${humans} size=${teamSize}  ${(performance.now() - t0).toFixed(0)}ms  ${g ? 'tickets ' + g.tix.map((v) => Math.round(v)) + ' tiles ' + g.map.changes.size : 'match ended'}`);
}

for (const [map, mode] of [['riverside', 'conquest'], ['harbor', 'rush'], ['dunes', 'conquest'], ['riverside', 'tdm'], ['pit', 'tdm'], ['warehouse', 'tdm']]) {
  run(map, mode, 2, 6, 120);
  run(map, mode, 3, 2, 90);
}
run('riverside', 'conquest', 0, 12, 200);
run('harbor', 'conquest', 1, 1, 150);
console.log(failures ? `${failures} FAILURES` : 'ALL OK');
process.exit(failures ? 1 : 0);
void WEAPON_LIST; void GADGET_LIST;
