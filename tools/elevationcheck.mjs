// Authored terrain, shared physics and height-aware combat regressions.
import assert from 'node:assert/strict';
import { MAP_DEFS, createMap } from '../src/shared/maps/index.js';
import { GameMap } from '../src/shared/gamemap.js';
import { MapBuilder } from '../src/shared/maps/builder.js';
import { stepMovement } from '../src/shared/movement.js';
import { vehicleShot, stepVehicle, VEHICLES } from '../src/shared/vehicles.js';
import { Room } from '../src/server/room.js';
import { throwGrenade, updateGrenades } from '../src/server/grenades.js';
import { spawnProjectile, updateProjectiles } from '../src/server/projectiles.js';
import { Vehicle, destroyVehicle } from '../src/server/vehicles.js';
import { explode } from '../src/server/world.js';
import { DT, TILE } from '../src/shared/constants.js';
let checks = 0;
const check = (value, name) => { assert.ok(value, name); checks++; console.log('ok', name); };
const fake = () => ({ send() {}, sendRaw() {}, congested: () => false, leaveRoom() {} });
for (const def of MAP_DEFS) {
  const map = createMap(def.id), copy = createMap(def.id), stride = map.w + 1;
  check(map.elevation.every((v, i) => v === copy.elevation[i] && Number.isFinite(v)), def.id + ' deterministic finite heightfield');
  const lo = Math.min(...map.elevation), hi = Math.max(...map.elevation);
  check(hi - lo > 30, def.id + ` meaningful relief (${((hi - lo) / 16).toFixed(1)} m)`);
  let maxGrade = 0, waterLevel = true;
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const i = y * stride + x, h = map.elevation;
    maxGrade = Math.max(maxGrade, Math.hypot(h[i + 1] - h[i], h[i + stride] - h[i]) / TILE, Math.hypot(h[i + stride + 1] - h[i + stride], h[i + stride + 1] - h[i + 1]) / TILE);
    if (map.water[y * map.w + x]) waterLevel &&= [h[i], h[i + 1], h[i + stride], h[i + stride + 1]].every((v) => v === 0);
  }
  check(maxGrade < .36 && waterLevel, def.id + ' navigable slopes and level water');
  check(map.buildings.every((b) => {
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (Math.abs(map.elevation[y * stride + x] - b.base) > .002) return false;
    return Math.abs(b.eave - b.base - b.wallHeight) < .002;
  }), def.id + ' level building foundations and elevated roof envelopes');
  let lane;
  for (let y = 3; y < map.h - 3 && !lane; y++) for (let x = 3; x < map.w - 3 && !lane; x++) {
    const sx = (x + .5) * TILE, sy = (y + .5) * TILE;
    for (const [dx, dy] of [[190, 0], [0, 190]]) {
      if (Math.abs(map.heightAt(sx + dx, sy + dy) - map.heightAt(sx, sy)) < 4) continue;
      if (map.clearLineR(sx, sy, sx + dx, sy + dy, 13, map.blockFoot) && !map.waterAt(sx, sy)) { lane = { x: sx, y: sy, dx, dy }; break; }
    }
  }
  check(!!lane, def.id + ' has an open sloping route');
  for (const reverse of [false, true]) {
    const x = lane.x + (reverse ? lane.dx : 0), y = lane.y + (reverse ? lane.dy : 0);
    const state = { x, y, z: map.heightAt(x, y), vx: 0, vy: 0, vz: 0, cf: 0 };
    const dx = Math.sign(lane.dx) * (reverse ? -1 : 1), dy = Math.sign(lane.dy) * (reverse ? -1 : 1);
    let attached = true;
    for (let i = 0; i < 60; i++) { stepMovement(map, state, 0, 180, false, dx, dy); attached &&= Math.abs(state.z - map.heightAt(state.x, state.y)) < .002 && state.vz === 0; }
    check(attached && Math.hypot(state.x - x, state.y - y) > 145, def.id + (reverse ? ' downhill' : ' uphill') + ' walking stays on terrain');
  }
  const room = new Room('TerrainQA', { map: def.id, mode: def.modes[0], teamSize: 1, bots: false, vehicles: true }, null);
  const p = room.addHuman(fake(), 'QA'); room.assignTeam(p, 0); room.start(); const g = room.game;
  check(g.deploy(p, { k: 'base', id: 0 }) && Math.abs(p.z - g.map.heightAt(p.x, p.y)) < .001, def.id + ' actual spawn starts on terrain');
  p.x = lane.x; p.y = lane.y; p.z = g.map.heightAt(p.x, p.y); p.angle = Math.atan2(lane.dy, lane.dx); p.gsel = 'he'; p.grenades.he = 2;
  throwGrenade(g, p, 160); const nade = g.grenades[0]; nade.fuse = 100;
  // Rigid contacts allow transient penetration up to 5 cm; settled centres remain above the 13 cm sphere radius.
  const launchZ = nade.z; let airborne = false, safe = true;
  for (let i = 0; i < 360; i++) { g.time += DT; g.physics.step(DT); updateGrenades(g, DT); const ground = g.map.heightAt(nade.x, nade.y); safe &&= nade.z >= ground + 1.25; airborne ||= nade.z > launchZ + 4; }
  check(airborne && safe && nade.z >= g.map.heightAt(nade.x, nade.y) + 1.7 && Math.abs(nade.vz) < 4, def.id + ' grenade flight and landing use physical altitude');
  check(g.snapshotFor(p).g[0].length === 7, def.id + ' grenade altitude reaches the renderer');
  for (const v of g.vehicles) {
    v.x = lane.x; v.y = lane.y; v.chassisZ = g.map.heightAt(v.x, v.y);
    check(Math.abs(v.z - (v.def.kind === 'air' ? v.flightZ : v.def.kind === 'boat' ? 0 : g.map.heightAt(v.x, v.y))) < .001, def.id + ' ' + v.type + ' uses correct surface');
    const shot = vehicleShot(v, 0, v.a, 400, v.z + 18);
    if (v.def.seats[0].weapon) check(shot.z >= v.z, def.id + ' ' + v.type + ' muzzle is above terrain');
  }
}
// Isolate a ridge to distinguish real occlusion from walls and test exact diagonal ray intersections.
const builder = new MapBuilder(40, 20, '.'); builder.rect(1, 1, 2, 2, 't').rect(35, 15, 2, 2, 'c');
const map = new GameMap({ id: 'ridge', ...builder.finish() });
for (let y = 0; y <= map.h; y++) for (let x = 0; x <= map.w; x++) map.elevation[y * (map.w + 1) + x] = 120 + Math.max(0, 100 - Math.abs(x - 20) * 8);
check(!map.los(300, 300, 1000, 300) && map.los(300, 300, 1000, 300, 250, 250), 'A ridge hides ground targets while high rays pass over it');
const hit = map.castBullet(300, 300, 146, 1, 0, 0, 700);
check(hit.ground && Math.abs(map.heightAt(300 + hit.d, 300) - 146) < .01 && hit.d < 300, 'Bullets hit the physical hillside');
for (const [dx, dy] of [[.8, .6], [.6, -.8], [-.8, .6]]) {
  const startZ = map.heightAt(600, 300) + 26, hit = map.castBullet(600, 300, startZ, dx, dy, -.4, 300);
  check(hit.ground && Math.abs(map.heightAt(600 + dx * hit.d, 300 + dy * hit.d) - startZ + .4 * hit.d) < .01, 'Oblique shots intersect the rendered terrain triangles exactly');
}
const room = new Room('RaisedCombat', { map: 'riverside', mode: 'conquest', teamSize: 1, bots: false, vehicles: true }, null);
const p = room.addHuman(fake(), 'QA'); room.assignTeam(p, 0); room.start(); const g = room.game; g.map = map; g.vehicles = [];
g.deploy(p, { k: 'base', id: 0 }); p.x = 300; p.y = 300; p.z = map.heightAt(p.x, p.y); p.hp = 100; p.armor = 0; p.spawnProt = 0;
explode(g, { x: p.x + 10, y: p.y, radius: 80, dmg: 30, tile: 100 });
check(p.hp < 100 && g.events.some((e) => e.p[0] === 'boom' && e.p[5] > 120), 'Raised ground explosions damage nearby infantry and carry altitude');
spawnProjectile(g, { type: 'rpg', owner: p, x: p.x, y: p.y, ang: 0, pitch: 0 });
check(g.projectiles[0].z === p.eyeZ, 'Infantry rockets launch from actual eye height');
for (let i = 0; i < 120 && g.projectiles.length; i++) updateProjectiles(g, DT);
check(g.projectiles.length === 0, 'Infantry rockets detonate against rising terrain');
const drive = (dir) => { const s = { x: 500, y: 300, a: dir ? Math.PI : 0, vx: 0, vy: 0 }; for (let i = 0; i < 60; i++) stepVehicle(map, s, VEHICLES.jeep, 1, s.a); return Math.hypot(s.vx, s.vy); };
check(drive(false) < drive(true), 'Uphill driving loses speed while downhill remains capped');
const air = new Vehicle(g, { type: 'heli', x: p.x, y: p.y, a: 0, team: 1 }); g.vehicles = [air]; air.flightZ = p.z + 192; p.hp = 100; g.events = [];
destroyVehicle(g, air, null, 'world');
check(p.hp === 100 && g.events.some((e) => e.p[0] === 'boom' && e.p[5] > p.z + 190), 'Aircraft destruction happens at flight altitude, clear of ground troops');
console.log(checks, 'terrain checks passed');
