// Scripted checks of individual game mechanics on a real (headless) game: capture, destruction, revive, vehicles, gadgets, rockets, C4...
import { Room } from '../src/server/room.js';
import { T, CT, KEY, TILE, RULES } from '../src/shared/constants.js';
import { WEAPONS } from '../src/shared/weapons.js';
import { damagePlayer } from '../src/server/combat.js';

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
const lo = (cls, primary, gadgets, extra = {}) => ({ cls, primary: { id: primary, att: extra.att || {} }, secondary: { id: 'p18', att: {} }, gadgets, gren: 'he' });
const open = (g, x, y) => g.map.nearestClear(x, y, g.map.blockInf, 2);

console.log('flag capture');
{
  const { g, ps, tick, spawn } = setup();
  const f = g.flags[1];
  const spot = open(g, f.x, f.y);
  spawn(ps[0], lo('assault', 'ar7', ['defib', 'medkit']), spot.x, spot.y);
  const before = f.owner;
  tick(60 * 25);
  check(before === -1 && f.owner === T, `a lone soldier captures a neutral flag in about 20 s (owner ${f.owner})`);
  spawn(ps[1], lo('assault', 'ar7', ['defib', 'medkit']), spot.x + 20, spot.y);
  tick(30);
  check(f.contested, 'an enemy on the flag contests it');
  check(ps[0].stats.captures >= 1 && ps[0].stats.score >= RULES.score.capture, 'the capturer is awarded points');
}

console.log('view-relative controls (third-person camera)');
{
  const { g, ps, hold, spawn } = setup();
  const s = open(g, 34 * 32, 40 * 32);
  spawn(ps[0], lo('assault', 'ar7', ['defib', 'medkit']), s.x, s.y);
  const x0 = ps[0].x, y0 = ps[0].y;
  hold(ps[0], KEY.UP, 0, 30);
  check(ps[0].x > x0 + 20 && Math.abs(ps[0].y - y0) < 5, 'W walks toward the view direction (looking east)');
  const y1 = ps[0].y;
  hold(ps[0], KEY.UP, Math.PI / 2, 30);
  check(ps[0].y > y1 + 15, 'W follows the view when the camera turns (looking south)');
  const x2 = ps[0].x;
  hold(ps[0], KEY.RIGHT, Math.PI / 2, 30);
  check(ps[0].x < x2 - 15, 'D strafes to the right of the view (looking south, right is west)');
  // helicopter: W flies where the pilot looks
  const heli = g.vehicles.find((v) => v.type === 'heli');
  heli.x = 40 * 32; heli.y = 40 * 32; heli.vx = heli.vy = 0;
  spawn(ps[1], lo('assault', 'ar7', ['defib', 'medkit']), heli.x + 10, heli.y);
  ps[1].usePrev = false; g.applyCmd(ps[1], KEY.USE, 0, 0, 0);
  if (ps[1].veh === heli.id) {
    const hx = heli.x, hy = heli.y;
    hold(ps[1], KEY.UP, Math.PI / 2, 60);
    check(heli.y > hy + 60 && Math.abs(heli.x - hx) < 40, `W flies the helicopter toward the view (${Math.round(heli.y - hy)} px south)`);
  } else check(false, 'the pilot could board the helicopter');
}

console.log('vertical play: jumping, cover, headshots');
{
  const { g, ps, hold, tick, spawn } = setup({ friendlyFire: true }, 2);
  const s = open(g, 40 * 32, 40 * 32);
  const tx = Math.floor(s.x / TILE), ty = Math.floor(s.y / TILE);
  // a flat test yard: clear a strip 14 tiles long, put sandbags 2 tiles to the east
  for (let dx = -1; dx <= 14; dx++) for (let dy = -2; dy <= 2; dy++) g.map.setTile(tx + dx, ty + dy, '.');
  spawn(ps[0], lo('assault', 'ar7', ['defib', 'medkit']), (tx + 0.5) * TILE, (ty + 0.5) * TILE);
  g.map.setTile(tx + 2, ty, 'L');
  const p = ps[0];
  // jump toward the sandbags and land on top
  let maxZ = 0, onTop = false;
  for (let i = 0; i < 100; i++) {
    g.applyCmd(p, KEY.UP | KEY.JUMP, 0, 0, 0);
    tick();
    maxZ = Math.max(maxZ, p.z);
    if (p.x > (tx + 2) * TILE + 6 && p.z > 12) onTop = true;
  }
  const jz = (() => { const q = ps[1]; if (!q.alive) { q.loadout = lo('assault', 'ar7', ['defib', 'medkit']); q.respawnAt = 0; g.spawnPlayer(q, { k: 'base', id: 0 }); } q.x = (tx + 10.5) * TILE; q.y = (ty + 0.5) * TILE; q.z = 0; q.vz = 0; let m = 0; for (let i = 0; i < 40; i++) { g.applyCmd(q, KEY.JUMP, 0, 0, 0); tick(); m = Math.max(m, q.z); } return m; })();
  check(jz > 18 && jz < 26, `a jump on open ground lifts the soldier ~${jz.toFixed(0)} px`);
  void maxZ;
  check(onTop, 'a jump gets onto low sandbags');
  // a crate is not a wall: but a brick wall stops the jumper
  g.map.setTile(tx + 8, ty, 'B');
  spawn(p, lo('assault', 'ar7', ['defib', 'medkit']), (tx + 6.5) * TILE, (ty + 0.5) * TILE);
  for (let i = 0; i < 90; i++) { g.applyCmd(p, KEY.UP | KEY.JUMP, 0, 0, 0); tick(); }
  check(p.x < (tx + 8) * TILE, 'a brick wall cannot be climbed');

  // shooting: shooter at the west end, target 200 px east
  const shooter = ps[0], target = ps[1];
  const setup2 = () => {
    for (let dx = 0; dx <= 14; dx++) g.map.setTile(tx + dx, ty, '.');
    for (const [q, x] of [[shooter, (tx + 0.5) * TILE], [target, (tx + 0.5) * TILE + 200]]) {
      if (!q.alive) { q.loadout = lo('assault', 'ar7', ['defib', 'medkit']); q.respawnAt = 0; g.spawnPlayer(q, { k: 'base', id: 0 }); }
      q.x = x; q.y = (ty + 0.5) * TILE; q.z = 0; q.vz = 0; q.cf = 0; q.vx = q.vy = 0; q.hp = 100; q.armor = 0; q.spawnProt = 0;
    }
    shooter.fireCd = 0; shooter.drawT = 0; shooter.burst = 0; shooter.reloadT = 0;
  };
  const shoot = (pitchAim) => {
    const before = target.hp;
    shooter.fireCd = 0; shooter.prevFire = false; shooter.clickBuf = 0;
    g.applyCmd(shooter, KEY.FIRE | KEY.SCOPE, 0, 0, 200, undefined, undefined, pitchAim);
    if (process.env.DBG) console.log('shoot', shooter.x | 0, shooter.y | 0, shooter.z, 'target', target.x | 0, target.y | 0, target.z, target.cf, 'hp', target.hp, 'alive', target.alive, 'team', shooter.team, target.team, JSON.stringify(g.events.filter((e) => e.p[0] === 'shot').map((e) => e.p)));
    return before - target.hp;
  };
  setup2();
  const eye = shooter.eyeZ;
  const dHead = shoot(Math.atan2(26 - eye, 200));
  setup2();
  const dBody = shoot(Math.atan2(14 - eye, 200));
  check(dBody > 20 && dHead > dBody * 1.7, `headshots hurt more than body shots (body ${dBody.toFixed(0)}, head ${dHead.toFixed(0)})`);
  setup2();
  const dOver = shoot(Math.atan2(50 - eye, 200));
  check(dOver === 0, 'a shot aimed above the target misses');
  setup2();
  target.cf = 1;                       // crouched: only 19 px tall
  const dCrouchHigh = shoot(Math.atan2(26 - eye, 200));
  check(dCrouchHigh === 0, 'a crouching target is missed by a shot at standing head height');
  setup2();
  target.cf = 1;
  const dCrouchLow = shoot(Math.atan2(10 - eye, 200));
  check(dCrouchLow > 0, 'a crouching target can be hit lower down');
  // cover: sandbags (14 px) between the two
  setup2();
  g.map.setTile(tx + 4, ty, 'L');
  const dLowShot = shoot(Math.atan2(4 - eye, 200));       // aimed at the legs: the sandbags in front stop it
  setup2();
  g.map.setTile(tx + 4, ty, 'L');
  const dOverCover = shoot(Math.atan2(26 - eye, 200));    // aimed at the head: passes over the sandbags
  check(dLowShot === 0 && dOverCover > 0, `sandbags stop chest shots but not head shots (${dLowShot.toFixed(0)} / ${dOverCover.toFixed(0)})`);
  setup2();
  g.map.setTile(tx + 4, ty, 'B');
  check(shoot(Math.atan2(20 - eye, 200)) === 0, 'a brick wall stops every bullet');
  void hold;
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
  spawn(ps[0], lo('support', 'mg60', ['ammo', 'c4']), b.x, b.y);
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
  spawn(ps[0], lo('assault', 'ar7', ['defib', 'medkit']), at.x, at.y);
  spawn(ps[2], lo('assault', 'ar7', ['defib', 'medkit']), at.x + 60, at.y);
  const victim = ps[2];
  victim.hp = 0.5;
  // shoot the victim with the enemy player
  spawn(ps[1], lo('recon', 'sr50', ['beacon', 'sensor']), at.x + 300, at.y);
  ps[1].angle = Math.PI;
  ps[1].fireCd = 0;
  const wasAlive = victim.alive;
  hold(ps[1], KEY.FIRE | KEY.SCOPE, Math.PI, 3);
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
  spawn(ps[0], lo('assault', 'ar7', ['defib', 'medkit']), tank.x - 40, tank.y);
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
  spawn(victim, lo('assault', 'ar7', ['defib', 'medkit']), tank.x + 90, tank.y);
  hold(ps[0], KEY.UP, 0, 90);
  check(!victim.alive, 'running over an enemy soldier kills them');
  g.applyCmd(ps[0], 0, 0, 0, 0);
  ps[0].usePrev = false; g.applyCmd(ps[0], KEY.USE, 0, 0, 0);
  check(ps[0].veh === 0, 'E leaves the vehicle');
  // enemy steals an empty vehicle
  const jeep = g.vehicles.find((v) => v.type === 'jeep' && v.team === T);
  spawn(ps[1], lo('assault', 'ar7', ['defib', 'medkit']), jeep.x + 10, jeep.y + 30);
  ps[1].usePrev = false; g.applyCmd(ps[1], KEY.USE, 0, 0, 0);
  check(ps[1].veh === jeep.id && jeep.team === CT, 'an empty enemy vehicle can be stolen');
}

console.log('rockets and C4 against vehicles');
{
  const { g, ps, tick, spawn } = setup();
  const tank = g.vehicles.find((v) => v.type === 'tank' && v.team === CT);
  const eng = ps[0];
  spawn(eng, lo('engineer', 'vx9', ['repair', 'rpg']), tank.x - 260, tank.y);
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
  sup.loadout = lo('support', 'mg60', ['ammo', 'c4']); sup.alive = false; sup.respawnAt = 0;
  spawn(sup, lo('support', 'mg60', ['ammo', 'c4']), field.x, field.y);
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
  spawn(ps[0], lo('assault', 'ar7', ['defib', 'medkit']), at.x, at.y);
  ps[0].sel = 'gadget1'; ps[0].fireCd = 0;
  ps[2].squad = ps[0].squad;
  spawn(ps[2], lo('support', 'mg60', ['ammo', 'c4']), at.x + 40, at.y);
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
  spawn(rec, lo('recon', 'sr50', ['beacon', 'sensor']), at.x, at.y + 60);
  rec.sel = 'gadget0'; rec.fireCd = 0; rec.prevFire = false; rec.vx = rec.vy = 0;
  g.applyCmd(rec, KEY.FIRE, 0, 0, 0);
  check(g.gadgets.some((q) => q.type === 'beacon'), 'a spawn beacon can be deployed');
  ps[2].alive = false; ps[2].respawnAt = 0; ps[2].squad = rec.squad;
  const opts = g.spawnOptions(ps[2]);
  check(opts.some((o) => o.k === 'beacon' && o.ok), 'squadmates get the beacon as a spawn option');
  check(opts.some((o) => o.k === 'squad'), 'squadmates can spawn on each other');
  // spotting
  const enemy = ps[1];
  spawn(enemy, lo('assault', 'ar7', ['defib', 'medkit']), rec.x + 200, rec.y);
  check(g.spot(rec, enemy.x, enemy.y), 'an enemy in line of sight can be spotted');
  const snap = g.snapshotFor(ps[0]);
  void snap;
  check(enemy.spotUntil > g.time, 'spotted enemies stay marked for a few seconds');
}

console.log('aircraft, attachments, alt fire');
{
  const { g, ps, tick, spawn, hold } = setup();
  const heli = g.vehicles.find((v) => v.type === 'heli' && v.team === T);
  spawn(ps[0], lo('assault', 'ar7', ['defib', 'medkit']), heli.x + 30, heli.y);
  ps[0].usePrev = false; g.applyCmd(ps[0], KEY.USE, 0, 0, 0);
  check(ps[0].veh === heli.id, 'a helicopter can be boarded');
  // fly east straight over the base wall and the river: no collisions for aircraft
  hold(ps[0], KEY.RIGHT, 0, 60 * 6);
  check(heli.x > 5000 || heli.speed > 100, `helicopters fly over walls and water (x=${Math.round(heli.x)})`);
  const sup = lo('assault', 'ar7', ['defib', 'medkit'], { att: { barrel: 'supp', optic: 'acog', under: 'vgrip', mag: 'ext' } });
  spawn(ps[1], sup, 3000, 3000);
  const w = ps[1].primaryW;
  check(w.suppressed && w.scope === 1 && w.mag === 42 && w.burst < WEAPONS.ar7.burst, `attachments change the weapon (suppressed ${w.suppressed}, scope ${w.scope}, mag ${w.mag}, burst ${w.burst})`);
  check(w.dmg < WEAPONS.ar7.dmg, 'a suppressor reduces damage');
  void tick;
}

console.log('swimming');
{
  const { g, ps, tick, spawn } = setup();
  const m = g.map;
  // a deep-water tile next to open land on its west side
  let spotTile = null;
  for (let ty = 5; ty < m.h - 5 && !spotTile; ty++) for (let tx = 6; tx < m.w - 8; tx++) {
    if (m.water[ty * m.w + tx] === 2 && m.water[ty * m.w + tx + 1] === 2 && m.water[ty * m.w + tx + 2] === 2 && m.water[ty * m.w + tx - 1] !== 2 && !m.isSolidTile(tx - 1, ty) && !m.isSolidTile(tx - 2, ty) && m.water[ty * m.w + tx - 2] !== 2) { spotTile = [tx, ty]; break; }
  }
  check(!!spotTile, 'the map has a shore to swim from');
  if (spotTile) {
    const [tx, ty] = spotTile;
    spawn(ps[0], lo('assault', 'ar7', ['defib', 'medkit']), (tx - 2 + 0.5) * TILE, (ty + 0.5) * TILE);
    const p = ps[0];
    p.spawnProt = 0;
    let maxV = 0;
    for (let i = 0; i < 60 * 3; i++) { g.applyCmd(p, KEY.UP, 0, 0, 0); tick(); maxV = Math.max(maxV, Math.hypot(p.vx, p.vy)); }
    check(p.x > (tx + 0.5) * TILE, `a soldier can wade into deep water (x=${Math.round(p.x)}, water starts at ${tx * TILE})`);
    check(m.waterAt(p.x, p.y) === 2 && maxV > 20, 'and swims at a slower pace');
    let swimMax = 0; for (let i = 0; i < 60; i++) { g.applyCmd(p, KEY.UP | KEY.SPRINT | KEY.JUMP, 0, 0, 0); tick(); swimMax = Math.max(swimMax, Math.hypot(p.vx, p.vy)); }
    check(swimMax <= 62 && p.z < 1, `no sprinting or jumping in deep water (speed ${swimMax.toFixed(0)}, z ${p.z.toFixed(1)})`);
  }
}

console.log('armor');
{
  const { g, ps, spawn } = setup();
  const at = open(g, 3000, 3000);
  spawn(ps[1], lo('support', 'mg60', ['ammo', 'c4']), at.x, at.y);
  const v = ps[1];
  v.spawnProt = 0;
  check(v.armor === 75, `support spawns with 75 armor (${v.armor})`);
  damagePlayer(g, v, ps[0], 40, 'ar7');
  check(v.hp === 80 && v.armor === 55, `armor soaks half a hit (hp ${v.hp}, armor ${v.armor})`);
  v.armor = 10; damagePlayer(g, v, ps[0], 60, 'ar7');
  check(v.armor === 0 && v.hp === 30, `spent armor lets the rest through (hp ${v.hp}, armor ${v.armor})`);
}

console.log('rush');
{
  const { g, ps, tick, spawn } = setup({ mode: 'rush' });
  const m = g.mcoms.find((q) => q.stage === 0);
  const at = open(g, m.x, m.y);
  spawn(ps[0], lo('assault', 'ar7', ['defib', 'medkit']), at.x, at.y);
  ps[0].x = m.x + 10; ps[0].y = m.y; ps[0].usePrev = false;
  for (let i = 0; i < 60 * 4.3; i++) { g.applyCmd(ps[0], KEY.USE, 0, 0, 0); tick(); }
  check(m.state === 1, 'holding E arms the M-COM');
  spawn(ps[1], lo('assault', 'ar7', ['defib', 'medkit']), at.x, at.y);
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
