import assert from 'node:assert/strict';
import { Room } from '../src/server/room.js';
import { explode } from '../src/server/world.js';
import { bodyBounds, rayBody } from '../src/shared/rigid.js';
import { stepMovement } from '../src/shared/movement.js';
import { KEY } from '../src/shared/constants.js';
const fake = () => ({ send() {}, sendRaw() {}, congested: () => false, leaveRoom() {} });
const room = new Room('PHY', { map: 'riverside', mode: 'conquest', teamSize: 2, bots: false, vehicles: true }, null);
const p = room.addHuman(fake(), 'Physics'); room.assignTeam(p, 0); room.start();
const g = room.game, m = g.map, physics = g.physics; g.deploy(p, { k: 'base', id: 0 }); p.spawnProt = 9999;
let checks = 0; const check = (ok, text) => { assert.ok(ok, text); console.log('ok', text); checks++; };
let point;
for (let ty = 6; ty < m.h - 6 && !point; ty++) for (let tx = 6; tx < m.w - 6 && !point; tx++) {
  const x = (tx + .5) * 32, y = (ty + .5) * 32;
  if (m.roofByTile[ty * m.w + tx] >= 0 || m.waterAt(x, y) || g.vehicles.some((v) => Math.hypot(v.x - x, v.y - y) < 140)) continue;
  const clear = m.nearestClear(x, y, m.blockInf, 1, 0);
  if (clear.x === x && clear.y === y && !m.blockInf[ty * m.w + tx]) {
    let open = true; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (m.blockInf[(ty + dy) * m.w + tx + dx]) open = false;
    if (open) point = { x, y };
  }
}
assert.ok(point, 'open terrain yard outside roof footprints');
const { x, y } = point, z = m.heightAt(x, y);
const step = (n) => { for (let i = 0; i < n; i++) { g.time += 1 / 60; physics.step(1 / 60); } };
const box = physics.add('X', x, y, z + 80, 24, 24, 20, true);
step(420);
const resting = physics.tuple(box), bottom = bodyBounds(resting).z0;
check(Math.abs(bottom - m.heightAt(resting[2], resting[3])) < 4, 'rigid props settle on the shared terrain heightfield');
check(box.body.sleepState === 2, 'resting props sleep');
const tuple = physics.tuple(box), bounds = bodyBounds(tuple);
check(Number.isFinite(rayBody(tuple, tuple[2] - 25, tuple[3], tuple[4], 1, 0, 0, 50)), 'bullets hit physical props');
check(!Number.isFinite(rayBody(tuple, tuple[2] - 25, tuple[3] + 50, tuple[4], 1, 0, 0, 50)), 'bullets outside a prop miss');
check(m.castBullet(tuple[2] - 25, tuple[3], tuple[4], 1, 0, 0, 50).rigid === box.id, 'live map ballistics use body transforms');
check(bounds.z1 > m.heightAt(tuple[2], tuple[3]) + 10, 'body bounds reflect its actual collision shape');
p.x = tuple[2] - 30; p.y = tuple[3]; p.z = m.heightAt(p.x, p.y); p.angle = 0; p.pitch = 0;
check(physics.use(p) && p.heldBody === box.id, 'E picks up a movable prop');
step(30); check(p.heldBody === box.id, 'held props remain stable against player collision');
physics.release(p, true); check(!p.heldBody && box.body.velocity.x > 3, 'throw transfers an impulse and releases the prop');
const tx = Math.floor(x / 32) + 2, ty = Math.floor(y / 32); m.setTile(tx, ty, 'X');
const moved = physics.activate(tx, ty); check(moved && m.charAt(tx, ty) === ';', 'pushing replaces static cover with a networked rigid prop');
const snap = g.snapshotFor(p); check(snap.rb?.some((t) => t[0] === moved.id), 'snapshots contain authoritative movable props');
physics.hit(moved.id, 200, 0, 0, p); check(!physics.bodies.has(moved.id), 'shooting breaks moved crates into fragments');
const barrel = physics.add('o', x + 80, y, z + 10, 12, 12, 18, true); physics.hit(barrel.id, 80, 0, 0, p);
check(g.events.some((e) => e.p[0] === 'boom' && e.p[1] === 'barrel'), 'moved explosive barrels still detonate');
const edits = m.terrainEdits?.size || 0; physics.crater(x, y, z, 150, 700);
check((m.terrainEdits?.size || 0) > edits, 'ground-level explosions deform terrain permanently');
check(g.snapshotFor(p).td?.length > 0, 'terrain edits reach late joiners');
const b = m.buildings.find((b) => b.active); physics.collapse(b);
check(!b.active && b.collapsed && physics.collapses.length > 0, 'unsupported roofs initiate staged wall collapse');
check([...physics.bodies.values()].some((q) => q.ch === 'R'), 'roof pieces become physical falling panels');
step(300); check(b.supports.every((i) => m.chars[i] !== b.wall && m.chars[i] !== 'G'), 'collapse removes remaining supporting walls');
check(g.snapshotFor(p).bs.includes(b.id), 'collapsed buildings synchronize independently of tile order');
const grenade = { id: 9999, x, y, z: m.heightAt(x, y) + 50, vx: 55, vy: 0, vz: 20 }; physics.grenade(grenade); step(240);
const gb = physics.grenadeBodies.get(grenade.id);
check(gb.position.z * 16 >= m.heightAt(gb.position.x * 16, gb.position.y * 16) - 1, 'grenade rigid bodies bounce and settle above terrain');
check(g.events.some((e) => e.p[0] === 'bounce'), 'physical grenade contacts produce bounce feedback'); physics.removeGrenade(grenade.id);
const state = { x, y, z: z + 160, vx: 0, vy: 0, vz: 0, cf: 0 }; for (let i = 0; i < 150; i++) stepMovement(m, state, 0, 92, false);
check(state.landingSpeed === 0 && state.z < z + 15, 'soldiers land under metre-scaled gravity');
check(KEY.USE === 128, 'interaction preserves existing input protocol');
for (const map of ['riverside', 'harbor', 'dunes', 'dust', 'warehouse', 'foundry', 'pit']) {
  const match = new Room('HULL', { map, mode: 'conquest', teamSize: 1, bots: false, vehicles: true }, null); match.start();
  const world = match.game;
  check(world.vehicles.every((v) => {
    if (v.def.kind === 'air') return true;
    const mask = v.def.kind === 'boat' ? world.map.blockBoat : world.map.blockInf;
    const hull = world.map.moveHull(v.x, v.y, 0, 0, v.def.size[0], v.def.size[1], v.a, mask);
    return Math.hypot(hull.x - v.x, hull.y - v.y) < .1;
  }), map + ' vehicles spawn with clear full hulls');
}
let worst = 0; const timing = [];
for (let i = 0; i < 350; i++) {
  if (i % 10 === 0) explode(g, { x: x + 100 + Math.sin(i) * 80, y: y + Math.cos(i) * 80, z, radius: 180, tile: 800, dmg: 0, veh: 0, kind: 'c4' });
  const start = performance.now(); step(1); const cost = performance.now() - start; timing.push(cost); worst = Math.max(worst, cost);
  assert.ok([...physics.bodies.values()].every((q) => Number.isFinite(q.body.position.z)), 'stress tick ' + i + ' finite');
}
timing.sort((a, b) => a - b); check(physics.bodies.size <= 128, 'explosion storms respect the rigid body budget');
console.log(`${checks} physics checks passed; p95 ${timing[Math.floor(timing.length * .95)].toFixed(2)}ms, worst ${worst.toFixed(2)}ms; bodies ${physics.bodies.size}, statics ${physics.statics.size}`);
