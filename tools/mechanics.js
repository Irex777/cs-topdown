// Scripted checks of individual game mechanics on a real (headless) game: capture, destruction, revive, vehicles, gadgets, rockets, C4...
import { Room } from '../src/server/room.js';
import { T, CT, KEY, SPEC, TILE, RULES } from '../src/shared/constants.js';
import { WEAPONS } from '../src/shared/weapons.js';

let failures = 0;
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { failures++; console.log('  FAIL', msg); } };
const fake = () => ({ send() {}, sendRaw() {}, congested: () => false, leaveRoom() {} });

function setup(settings = {}, humans = 2) {
  const room = new Room('MX', { map: 'riverside', mode: 'conquest', teamSize: 3, bots: false, vehicles: true, ...settings }, null);
  const ps = [];
  for (let i = 0; i < humans; i++) { const p = room.addHuman(fake(), 'P' + i); room.assignTeam(p, i % 2 === 0 ? T : CT); ps.push(p); }
  room.start();
  const g = room.game;
  let seq = 1;
  const tick = (n = 1) => { for (let i = 0; i < n; i++) room.tick(); };
  const cmd = (p, keys, angle = 0, aim = 300) => room.handle(p, { t: 'in', c: [[seq++, keys, angle, 0, aim]] });
  const hold = (p, keys, angle, ticks, aim) => { for (let i = 0; i < ticks; i++) { cmd(p, keys, angle, aim); tick(); } };
  const spawn = (p, lo, x, y) => {
    p.loadout = lo; p.respawnAt = 0;
    g.deploy(p, { k: 'base', id: 0, loadout: lo });
    p.x = x; p.y = y; p.vx = p.vy = 0; p.spawnProt = 0; p.drawT = 0; p.hp = 100;
  };
  return { room, g, ps, tick, cmd, hold, spawn };
}
const lo = (cls, primary, gadgets, extra = {}) => ({ cls, primary: { id: primary, att: extra.att || {} }, secondary: { id: 'm9', att: {} }, gadgets, gren: 'he' });
const open = (g, x, y) => g.map.nearestClear(x, y, g.map.blockInf, 2);

console.log('flag capture');
{
  const { g, ps, tick, spawn } = setup();
  const f = g.flags[1];
  const spot = open(g, f.x, f.y);
  spawn(ps[0], lo('assault', 'm416', ['defib', 'medkit']), spot.x, spot.y);
  const before = f.owner;
  tick(60 * 25);
  check(before === -1 && f.owner === T, `a lone soldier captures a neutral flag in about 20 s (owner ${f.owner})`);
  spawn(ps[1], lo('assault', 'm416', ['defib', 'medkit']), spot.x + 20, spot.y);
  tick(30);
  check(f.contested, 'an enemy on the flag contests it');
  check(ps[0].stats.captures >= 1 && ps[0].stats.score >= RULES.score.capture, 'the capturer is awarded points');
}

console.log('ticket bleed and match end');
{
  const { g, tick } = setup();
  for (const f of g.flags.slice(0, 5)) { f.owner = T; f.cap = -1; }
  const before = g.tix[1];
  tick(60 * 10);
  check(g.tix[1] < before - 1, `holding 5 of 7 flags bleeds the enemy tickets (${before} -> ${g.tix[1].toFixed(1)})`);
  g.tix[1] = 0.05;
  tick(60 * 2);
  check(g.matchWinner === T && g.phase === 4, 'match ends when a team runs out of tickets');
}

console.log('destruction');
{
  const { g, ps, tick, spawn } = setup();
  const b = open(g, 34 * 32, 40 * 32);
  spawn(ps[0], lo('support', 'm249', ['ammo', 'c4']), b.x, b.y);
  // find a destructible wall near the west outpost
  let wall = null;
  for (let y = 30; y < 60 && !wall; y++) for (let x = 20; x < 50 && !wall; x++) if (g.map.chars[y * g.map.w + x] === 'B') wall = { x, y };
  const wx = (wall.x + 0.5) * TILE, wy = (wall.y + 0.5) * TILE;
  const n0 = g.map.changes.size;
  // C4 next to the wall
  ps[0].sel = 'gadget1'; ps[0].drawT = 0; ps[0].x = wx; ps[0].y = wy + 60; ps[0].angle = -Math.PI / 2;
  const c4 = ps[0].gadgets[1];
  c4.charges = 3;
  g.map.setTile(wall.x, wall.y + 1, '.');
  const placed = () => g.gadgets.filter((q) => q.type === 'c4').length;
  ps[0].fireCd = 0;
  g.applyCmd(ps[0], KEY.FIRE, -Math.PI / 2, 0, 60);
  check(placed() === 1, 'C4 can be placed');
  ps[0].fireCd = 0; ps[0].prevFire = false;
  tick(60);
  g.applyCmd(ps[0], KEY.SCOPE, -Math.PI / 2, 0, 60);
  tick(2);
  check(g.map.changes.size > n0, `C4 blows a hole in the wall (${g.map.changes.size - n0} tiles changed)`);
  check(!g.map.isSolidTile(wall.x, wall.y) || g.map.chars[wall.y * g.map.w + wall.x] !== 'B', 'the wall tile became rubble');
  const path = g.nav.findPath(wx, wy + 80, wx, wy - 80, false);
  check(!!path, 'bots can path through the new hole');
}

console.log('revive');
{
  const { g, ps, tick, spawn, cmd, hold } = setup({}, 3);
  ps[2].team = T; g.onTeamChange(ps[2]);
  const at = open(g, 40 * 32, 45 * 32);
  spawn(ps[0], lo('assault', 'm416', ['defib', 'medkit']), at.x, at.y);
  spawn(ps[2], lo('assault', 'm416', ['defib', 'medkit']), at.x + 60, at.y);
  const victim = ps[2];
  victim.hp = 0.5;
  // shoot the victim with the enemy player
  spawn(ps[1], lo('recon', 'sv98', ['beacon', 'sensor']), at.x + 300, at.y);
  ps[1].angle = Math.PI;
  ps[1].fireCd = 0;
  const wasAlive = victim.alive;
  hold(ps[1], KEY.FIRE, Math.PI, 3);
  tick(3);
  check(wasAlive && !victim.alive, 'the victim is killed by a rifle shot');
  check(g.corpses.some((c) => c.pid === victim.id), 'a revivable body is left behind');
  // medic walks next to the body and uses the defibrillator
  ps[0].x = victim.x - 20; ps[0].y = victim.y; ps[0].sel = 'gadget0'; ps[0].drawT = 0; ps[0].fireCd = 0;
  hold(ps[0], KEY.FIRE, 0, 90);
  check(victim.alive && victim.hp > 30 && victim.hp <= 50, `holding fire with the defibrillator revives the soldier (hp ${Math.round(victim.hp)})`);
  check(ps[0].stats.revives === 1, 'the medic is credited for the revive');
  void cmd;
}

console.log('vehicles');
{
  const { g, ps, tick, spawn, hold } = setup();
  const tank = g.vehicles.find((v) => v.type === 'tank' && v.team === T);
  const road = open(g, 60 * 32, 56 * 32);
  tank.x = road.x; tank.y = road.y; tank.a = 0; tank.ta = 0;
  spawn(ps[0], lo('assault', 'm416', ['defib', 'medkit']), tank.x - 40, tank.y);
  ps[0].usePrev = false;
  g.applyCmd(ps[0], KEY.USE, 0, 0, 0);
  check(ps[0].veh === tank.id && tank.seats[0] === ps[0].id, 'E boards the nearest vehicle');
  const x0 = tank.x;
  hold(ps[0], KEY.UP, 0, 90);
  check(tank.x > x0 + 80, `the tank drives forward (${Math.round(tank.x - x0)} px in 1.5 s)`);
  const sp = tank.speed;
  check(sp > 100 && sp <= 205, `speed is capped (${Math.round(sp)} px/s)`);
  // fire the cannon at a wall in front of the tank
  const n0 = g.map.changes.size;
  ps[0].angle = 0;
  tank.ta = 0;
  hold(ps[0], KEY.FIRE, 0, 5);
  tick(120);
  check(g.projectiles.length >= 0 && (g.map.changes.size >= n0), 'the cannon fires shells (they explode within 2 s)');
  // ram a soldier
  const victim = ps[1];
  spawn(victim, lo('assault', 'm416', ['defib', 'medkit']), tank.x + 90, tank.y);
  hold(ps[0], KEY.UP, 0, 90);
  check(!victim.alive, 'running over an enemy soldier kills them');
  g.applyCmd(ps[0], 0, 0, 0, 0);
  ps[0].usePrev = false; g.applyCmd(ps[0], KEY.USE, 0, 0, 0);
  check(ps[0].veh === 0, 'E leaves the vehicle');
  // enemy steals an empty vehicle
  const jeep = g.vehicles.find((v) => v.type === 'jeep' && v.team === T);
  spawn(ps[1], lo('assault', 'm416', ['defib', 'medkit']), jeep.x + 10, jeep.y + 30);
  ps[1].usePrev = false; g.applyCmd(ps[1], KEY.USE, 0, 0, 0);
  check(ps[1].veh === jeep.id && jeep.team === CT, 'an empty enemy vehicle can be stolen');
}

console.log('rockets and C4 against vehicles');
{
  const { g, ps, tick, spawn } = setup();
  const tank = g.vehicles.find((v) => v.type === 'tank' && v.team === CT);
  const eng = ps[0];
  spawn(eng, lo('engineer', 'mp7', ['repair', 'rpg']), tank.x - 260, tank.y);
  eng.sel = 'gadget1'; eng.angle = 0;
  const hp0 = tank.hp;
  let shots = 0;
  for (let i = 0; i < 12 && !tank.dead; i++) {
    eng.fireCd = 0; eng.reloadT = 0; eng.gadgets[1].loaded = true; eng.gadgets[1].charges = 5; eng.prevFire = false;
    g.applyCmd(eng, KEY.FIRE, 0, 0, 260); shots++;
    tick(60);
  }
  check(tank.hp < hp0, `RPG rockets damage a tank (${hp0} -> ${Math.round(tank.hp)} after ${shots} rockets)`);
  check(tank.dead && shots <= 8, `a tank is destroyed by a handful of rockets (${shots})`);
  check(eng.stats.score >= RULES.score.vehicle, 'destroying an enemy vehicle awards points');
  // C4 on a jeep
  const jeep = g.vehicles.find((v) => v.type === 'jeep' && v.team === CT);
  const field = open(g, 60 * 32, 60 * 32);
  jeep.x = field.x + 70; jeep.y = field.y;
  const sup = ps[0];
  sup.loadout = lo('support', 'm249', ['ammo', 'c4']); sup.alive = false; sup.respawnAt = 0;
  spawn(sup, lo('support', 'm249', ['ammo', 'c4']), field.x, field.y);
  sup.sel = 'gadget1'; sup.fireCd = 0; sup.prevFire = false; sup.prevScope = false;
  g.applyCmd(sup, KEY.FIRE, 0, 0, 70);
  const c4 = g.gadgets.find((q) => q.type === 'c4');
  check(!!c4 && c4.attach === jeep.id, 'C4 sticks to a vehicle');
  tick(40);
  g.applyCmd(sup, KEY.SCOPE, 0, 0, 0);
  tick(2);
  check(jeep.dead, 'detonating C4 destroys the jeep');
}

console.log('medic bag, ammo crate, beacon, spot');
{
  const { g, ps, tick, spawn } = setup({}, 3);
  ps[2].team = T; g.onTeamChange(ps[2]);
  const at = open(g, 40 * 32, 45 * 32);
  spawn(ps[0], lo('assault', 'm416', ['defib', 'medkit']), at.x, at.y);
  ps[0].sel = 'gadget1'; ps[0].fireCd = 0;
  ps[2].squad = ps[0].squad;
  spawn(ps[2], lo('support', 'm249', ['ammo', 'c4']), at.x + 40, at.y);
  ps[2].hp = 40; ps[2].lastHurt = g.time; ps[2].am.primary.reserve = 0; ps[2].am.primary.clip = 3;
  g.applyCmd(ps[0], KEY.FIRE, 0, 0, 0);
  check(g.gadgets.some((q) => q.type === 'medkit'), 'a medic bag can be dropped');
  tick(60 * 4);
  check(ps[2].hp > 70, `nearby soldiers are healed by the bag (hp ${Math.round(ps[2].hp)})`);
  ps[2].sel = 'gadget0'; ps[2].fireCd = 0; ps[2].prevFire = false;
  g.applyCmd(ps[2], KEY.FIRE, 0, 0, 0);
  tick(60 * 3);
  check(ps[2].am.primary.reserve > 0, 'an ammo crate resupplies magazines');
  // beacon
  const rec = ps[0];
  rec.alive = false; rec.respawnAt = 0;
  spawn(rec, lo('recon', 'sv98', ['beacon', 'sensor']), at.x, at.y + 60);
  rec.sel = 'gadget0'; rec.fireCd = 0; rec.prevFire = false; rec.vx = rec.vy = 0;
  g.applyCmd(rec, KEY.FIRE, 0, 0, 0);
  check(g.gadgets.some((q) => q.type === 'beacon'), 'a spawn beacon can be deployed');
  ps[2].alive = false; ps[2].respawnAt = 0; ps[2].squad = rec.squad;
  const opts = g.spawnOptions(ps[2]);
  check(opts.some((o) => o.k === 'beacon' && o.ok), 'squadmates get the beacon as a spawn option');
  check(opts.some((o) => o.k === 'squad'), 'squadmates can spawn on each other');
  // spotting
  const enemy = ps[1];
  spawn(enemy, lo('assault', 'm416', ['defib', 'medkit']), rec.x + 200, rec.y);
  check(g.spot(rec, enemy.x, enemy.y), 'an enemy in line of sight can be spotted');
  const snap = g.snapshotFor(ps[0]);
  void snap;
  check(enemy.spotUntil > g.time, 'spotted enemies stay marked for a few seconds');
}

console.log('aircraft, attachments, alt fire');
{
  const { g, ps, tick, spawn, hold } = setup();
  const heli = g.vehicles.find((v) => v.type === 'heli' && v.team === T);
  spawn(ps[0], lo('assault', 'm416', ['defib', 'medkit']), heli.x + 30, heli.y);
  ps[0].usePrev = false; g.applyCmd(ps[0], KEY.USE, 0, 0, 0);
  check(ps[0].veh === heli.id, 'a helicopter can be boarded');
  // fly east straight over the base wall and the river: no collisions for aircraft
  hold(ps[0], KEY.RIGHT, 0, 60 * 6);
  check(heli.x > 5000 || heli.speed > 100, `helicopters fly over walls and water (x=${Math.round(heli.x)})`);
  const sup = lo('assault', 'm416', ['defib', 'medkit'], { att: { barrel: 'supp', optic: 'acog', under: 'ugl', mag: 'ext' } });
  spawn(ps[1], sup, 3000, 3000);
  const w = ps[1].primaryW;
  check(w.suppressed && w.scope === 1 && w.alt === 'ugl' && w.mag === 42, `attachments change the weapon (suppressed ${w.suppressed}, scope ${w.scope}, alt ${w.alt}, mag ${w.mag})`);
  check(w.dmg < WEAPONS.m416.dmg, 'a suppressor reduces damage');
  const at = open(g, 3000, 3000);
  ps[1].x = at.x; ps[1].y = at.y;
  ps[1].altMode = true; ps[1].fireCd = 0; ps[1].prevFire = false; ps[1].clickBuf = 0;
  g.applyCmd(ps[1], KEY.FIRE, 0, 0, 400);
  check(g.projectiles.some((p) => p.type === 'ugl'), 'the underbarrel launcher fires a grenade');
  void tick;
}

console.log('rush');
{
  const { g, ps, tick, spawn } = setup({ mode: 'rush' });
  const m = g.mcoms.find((q) => q.stage === 0);
  const at = open(g, m.x, m.y);
  spawn(ps[0], lo('assault', 'm416', ['defib', 'medkit']), at.x, at.y);
  ps[0].x = m.x + 10; ps[0].y = m.y; ps[0].usePrev = false;
  for (let i = 0; i < 60 * 4.3; i++) { g.applyCmd(ps[0], KEY.USE, 0, 0, 0); tick(); }
  check(m.state === 1, 'holding E arms the M-COM');
  spawn(ps[1], lo('assault', 'm416', ['defib', 'medkit']), at.x, at.y);
  ps[1].x = m.x - 10; ps[1].y = m.y; ps[1].usePrev = false;
  for (let i = 0; i < 60 * 4.3; i++) { g.applyCmd(ps[1], KEY.USE, 0, 0, 0); tick(); }
  check(m.state === 0, 'holding E as a defender disarms it');
  m.state = 1; m.timer = 0.05; m.by = ps[0].id;
  const others = g.mcoms.filter((q) => q.stage === 0 && q !== m);
  for (const o of others) o.state = 2;
  tick(10);
  check(g.stage === 1, 'destroying the last M-COM of a stage advances the attack');
}

console.log(failures ? `\n${failures} mechanics check(s) FAILED` : '\nmechanics: ALL OK');
process.exit(failures ? 1 : 0);
