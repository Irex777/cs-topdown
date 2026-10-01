import assert from 'node:assert/strict';
import { GameMap } from '../src/shared/gamemap.js';
import { MapBuilder } from '../src/shared/maps/builder.js';
import { createMap } from '../src/shared/maps/index.js';
import { VEHICLES, exitSpot } from '../src/shared/vehicles.js';
const builder = new MapBuilder(30, 30, '.');
builder.house(5, 5, 8, 6);
builder.rect(1, 1, 2, 2, 't').rect(26, 26, 2, 2, 'c');
const map = new GameMap({ id: 'test', name: 'test', rows: builder.rows(), objects: builder.objects });
assert.equal(map.buildings.length, 1);
const roof = map.buildings[0];
let hit = map.castBullet(9 * 32, 8 * 32, 26, 1, 0, 1, 300);
assert.ok(hit.top && Math.abs(hit.d - 26) < .01, 'Upward indoor shot stops at the ceiling');
hit = map.castBullet(9 * 32, 8 * 32, 110, 1, 0, -.5, 300);
assert.ok(hit.top && Math.abs(hit.d - 44) < .01, 'Downward shot hits the pitched roof');
hit = map.castBullet(9 * 32, 8 * 32, 100, 1, 0, 0, 200);
assert.equal(hit.tx, -1, 'Level shot above ridge passes over roof');
hit = map.castBullet(9 * 32, 8 * 32, 26, 1, 0, 0, 300);
assert.equal(hit.top, false, 'Indoor level shot reaches the wall');
assert.ok(hit.d > 80, 'Roof does not obstruct floor-level movement/shot');
for (const i of roof.supports.slice(0, Math.ceil(roof.supports.length * .31))) map.setTile(i % map.w, Math.floor(i / map.w), 'r');
assert.equal(roof.active, false, 'Roof collapses when supports are destroyed');
hit = map.castBullet(9 * 32, 8 * 32, 26, 1, 0, 1, 100);
assert.equal(hit.tx, -1, 'Collapsed roof releases overhead ballistics');
for (const id of ['riverside', 'harbor', 'dunes']) {
  const m = createMap(id);
  assert.ok(m.buildings.length > 0, id + ' has valid house envelopes');
  assert.ok(m.buildings.every((b) => b.active && b.supports.length > 0), id + ' roofs match map walls');
  console.log(id, m.buildings.length, 'supported roofs');
}
for (const [id, def] of Object.entries(VEHICLES)) {
  const v = { x: 400, y: 400, a: 0 };
  const p = exitSpot(map, v, def, 0);
  assert.ok(Math.hypot(p.x - v.x, p.y - v.y) >= def.size[1] / 2 + 10, id + ' exit clears visible hull');
}
console.log('Building envelopes, destruction and vehicle exits passed');

// The taller models must still let their mounted guns aim at infantry.
const { Room } = await import('../src/server/room.js');
const { vehicleFire } = await import('../src/server/vehicles.js');
const fake = () => ({ send() {}, sendRaw() {}, congested: () => false, leaveRoom() {} });
const room = new Room('ScaleQA', { map: 'riverside', mode: 'conquest', teamSize: 2, bots: false, vehicles: true }, null);
const shooter = room.addHuman(fake(), 'Gunner'), target = room.addHuman(fake(), 'Target');
room.assignTeam(shooter, 0); room.assignTeam(target, 1); room.start();
const game = room.game;
for (const p of [shooter, target]) { p.respawnAt = 0; game.deploy(p, { k: 'base', id: 0 }); p.spawnProt = 0; }
for (let y = 50; y <= 60; y++) for (let x = 70; x <= 86; x++) game.map.setTile(x, y, '.');
for (const id of ['tank', 'apc', 'jeep', 'heli', 'boat']) {
  const v = game.vehicles.find((v) => v.type === id);
  assert.ok(v, id + ' test vehicle exists');
  const rest = game.vehicles; game.vehicles = [v];
  v.x = 2350; v.y = 1760; v.a = v.ta = v.seatAim[1] = 0;
  v.team = shooter.team; v.cd[1] = v.rel[1] = 0;
  shooter.x = v.x; shooter.y = v.y; shooter.veh = v.id; shooter.seat = 1;
  target.x = v.x + 240; target.y = v.y; target.z = 0; target.cf = 0; target.hp = 100; target.alive = true;
  vehicleFire(game, v, 1, shooter, true, 0, 240);
  assert.ok(target.hp < 100, id + ' mounted gun hits infantry from its model height');
  game.vehicles = rest;
}
console.log('All five mounted machine guns hit infantry at the crosshair distance');
