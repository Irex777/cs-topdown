// Authoritative rigid bodies in SI units; the game uses 16 world units per metre.
import { RigidWorld } from './rapier.js';
import { TILE } from '../shared/constants.js';
import { TILES } from '../shared/gamemap.js';
import { bodyBounds } from '../shared/rigid.js';
import { explode } from './world.js';
import { treeHeight } from '../shared/heights.js';
import { crater } from '../shared/destruction.js';
import { damagePlayer } from './combat.js';

const U = 16, LIMIT = 128;
const density = { '#': 1600, B: 950, G: 220, M: 300, X: 8, o: 75, '=': 80, L: 280, T: 500, R: 350 };
const v3 = (x, y, z) => ({ x, y, z });
export class BattlefieldPhysics {
  constructor(game) {
    this.game = game; this.map = game.map; this.bodies = new Map(); this.statics = new Map(); this.actors = new Map(); this.collapses = [];
    this.grenadeBodies = new Map();
    this.world = new RigidWorld(-9.81);
    this.buildGround();
    this.world.step(1 / 120);       // builds the terrain's collision structure now, instead of as a hitch when the first debris appears
    this.map.dynamicBodies = [];
    this.map.onChange((tx, ty, old, _ch, reason) => {
      const i = ty * this.map.w + tx, staticBody = this.statics.get(i);
      if (staticBody) { this.world.remove(staticBody); this.statics.delete(i); }
      if (TILES[old]?.hp && !this.activating && reason === 'damage') this.fracture(tx, ty, old);
      if (reason === 'damage') for (const b of this.map.buildings) if (!b.active && !b.collapsed) this.collapse(b);
    });
  }
  /** the terrain as chunked heightfield colliders; craters change map.elevation and only the touched chunks are rebuilt, once per step */
  buildGround() {
    const m = this.map;
    this.world.setTerrain(m.w, m.h, TILE / U, (i, j) => m.elevation[j * (m.w + 1) + i] / U);
    this.groundEdits = [];
  }
  rebuildGround() { this.buildGround(); }
  add(ch, x, y, z, sx, sy, sz, whole = false, velocity = null) {
    if (this.bodies.size >= LIMIT) {
      const victim = [...this.bodies.values()].find((q) => !q.held && q.body.sleeping && !q.whole && q.ch !== 'R') || [...this.bodies.values()].find((q) => !q.held && !q.whole && q.ch !== 'R');
      if (!victim) return null;
      this.remove(victim);
    }
    const mass = Math.max(.3, sx * sy * sz / U ** 3 * (density[ch] || 500));
    const q = { id: this.game.nextId++, ch, body: null, sx, sy, sz, whole, born: this.game.time, hp: TILES[ch]?.hp || 120, impactAt: 0 };
    q.body = this.world.dynamic({
      mass, box: [sx / U / 2, sy / U / 2, sz / U / 2], position: [x / U, y / U, z / U], linearDamping: .06, angularDamping: .2, group: 2, mask: 7,
      velocity: velocity ? [velocity.x / U, velocity.y / U, velocity.z / U] : null,
      angular: whole ? null : [(Math.random() - .5) * 5, (Math.random() - .5) * 5, (Math.random() - .5) * 5],
      onImpact: (speed, other) => {
        const body = q.body;
        if (speed < 1.8 || this.game.time - q.impactAt < .18) return;
        q.impactAt = this.game.time;
        const victim = other.userData?.player;
        if (victim?.alive && !q.held && speed > 4 && body.mass > 8 && victim.id !== q.thrower && victim.spawnProt <= 0) {
          const owner = this.game.players.get(q.thrower) || null;
          if (!owner || owner.team !== victim.team || this.game.ff) damagePlayer(this.game, victim, owner, Math.min(120, body.mass * speed * speed / 60), 'debris', { expl: true });
        }
        const pos = body.position;
        this.game.emit(['material', ch, Math.round(pos.x * U), Math.round(pos.y * U), Math.round(pos.z * U), Math.min(1, speed / 12)], pos.x * U, pos.y * U, 900);
      },
    });
    this.bodies.set(q.id, q); return q;
  }
  remove(q) { this.world.remove(q.body); this.bodies.delete(q.id); }
  grenade(g) {
    let last = -1;
    const body = this.world.dynamic({
      mass: .4, ball: .13, position: [g.x / U, g.y / U, g.z / U], velocity: [g.vx / U, g.vy / U, g.vz / U], angular: [4, 7, 2], linearDamping: .035, angularDamping: .3, group: 2, mask: 3, ccd: true,
      onImpact: (speed) => { const p = body.position; if (Math.abs(speed) > 1.2 && this.game.time - last > .12) { last = this.game.time; this.game.emit(['bounce', g.id, Math.round(p.x * U), Math.round(p.y * U), Math.round(p.z * U)], p.x * U, p.y * U, 750); } },
    });
    this.grenadeBodies.set(g.id, body);
  }
  removeGrenade(id) { const b = this.grenadeBodies.get(id); if (b) this.world.remove(b); this.grenadeBodies.delete(id); }
  crater(x, y, z, radius, power) {
    if (power < 140 || z > this.map.heightAt(x, y) + radius * .3) return;
    const edits = crater(this.map, x, y, Math.min(100, radius * .65), Math.min(18, power / 45));
    if (edits.length) { for (const [i] of edits) this.groundEdits.push(i); for (const q of this.bodies.values()) q.body.wakeUp(); }
  }
  lineClear(x, y, z, tx, ty, tz, ignore = 0) {
    const previous = this.map.ignoreRigid; this.map.ignoreRigid = ignore;
    const clear = this.map.los(x, y, tx, ty, z, tz); this.map.ignoreRigid = previous; return clear;
  }
  hit(id, damage, angle, pitch, owner) {
    const q = this.bodies.get(id); if (!q || q.held) return;
    const b = q.body; b.wakeUp(); b.applyImpulse(v3(Math.cos(angle) * .8, Math.sin(angle) * .8, Math.sin(pitch) * .8)); q.hp -= damage;
    if (q.hp > 0) return;
    const bp = b.position, x = bp.x * U, y = bp.y * U, z = bp.z * U;
    this.remove(q);
    if (q.ch === 'o') explode(this.game, { x, y, z, radius: 95, dmg: 70, veh: 60, tile: 150, owner, wid: 'barrel', kind: 'barrel' });
    else if (q.whole) for (let n = 0; n < 4; n++) this.add(q.ch, x + (n % 2 ? 6 : -6), y, z + (n > 1 ? 5 : -5), 10, 4, 9, false, { x: Math.cos(angle) * 50, y: Math.sin(angle) * 50, z: 25 });
  }
  fracture(tx, ty, ch) {
    const x = (tx + .5) * TILE, y = (ty + .5) * TILE, z = this.map.tileBase(tx, ty);
    const height = ch === 'B' || ch === 'G' || ch === '#' ? this.map.wallHeights[ty * this.map.w + tx] || 52 : TILES[ch]?.h3 || 20;
    const blast = this.blast;
    const impulse = (cx, cy, cz) => {
      if (!blast) return null;
      const dx = cx - blast.x, dy = cy - blast.y, dz = cz - blast.z, d = Math.hypot(dx, dy, dz) || 1;
      const speed = Math.min(180, blast.power * .22) * Math.max(.15, 1 - d / (blast.radius + 32));
      return { x: dx / d * speed, y: dy / d * speed, z: Math.max(25, dz / d * speed + 35) };
    };
    if (ch === 'T') {
      const h = treeHeight(tx, ty);
      const q = this.add(ch, x, y, z + h / 2, 10, 10, h, true, impulse(x, y, z + h / 2));
      if (q) q.body.setAngularVelocity(1.3, .7, .1);
    } else {
      const rows = Math.min(5, Math.max(1, Math.ceil(height / 26))), cols = ch === 'G' ? 3 : 2;
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const sx = TILE / cols * .85, sz = height / rows * .86, cx = tx * TILE + TILE / cols * (col + .5), cz = z + height / rows * (row + .5);
        this.add(ch, cx, y, cz, sx, ch === 'G' ? 2 : ch === 'X' ? 4 : ch === '=' ? 2 : 12, sz, false, impulse(cx, y, cz));
      }
    }
    this.game.emit(['fracture', ch, x, y, z, height], x, y, 1200);
  }
  collapse(b) {
    b.collapsed = true; b.active = false;
    const roof = this.statics.get('roof:' + b.id); if (roof) { this.world.remove(roof); this.statics.delete('roof:' + b.id); }
    for (let y = b.y0; y < b.y1; y += 64) for (let x = b.x0; x < b.x1; x += 64) {
      const sx = Math.min(64, b.x1 - x), sy = Math.min(64, b.y1 - y);
      this.add('R', x + sx / 2, y + sy / 2, b.eave + b.rise / 2, sx * .94, sy * .94, 5, false, { x: (Math.random() - .5) * 20, y: (Math.random() - .5) * 20, z: -12 });
    }
    for (const i of b.supports) if (this.map.isDestructible(i % this.map.w, Math.floor(i / this.map.w))) this.collapses.push(i);
    this.game.emit(['collapse', b.id, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.eave], (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 2200);
  }
  damageRoofs(x, y, z, radius, power) {
    for (const b of this.map.buildings) {
      if (!b.active) continue;
      const d = Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1), Math.max(b.eave - z, 0, z - b.ridge));
      if (d >= radius) continue;
      b.roofDamage = (b.roofDamage || 0) + power * (1 - d / radius);
      if (b.roofDamage > 700) this.collapse(b);
    }
  }
  activate(tx, ty) {
    const ch = this.map.charAt(tx, ty); if (ch !== 'X' && ch !== 'o') return null;
    const height = TILES[ch].h3, q = this.add(ch, (tx + .5) * TILE, (ty + .5) * TILE, this.map.tileBase(tx, ty) + height / 2, ch === 'o' ? 12 : 24, ch === 'o' ? 12 : 24, height, true);
    if (!q) return null;
    this.activating = true; this.map.setTile(tx, ty, ';'); this.activating = false; return q;
  }
  pushProps(s, vehicle = false) {
    const speed = Math.hypot(s.vx, s.vy); if (speed < (vehicle ? 20 : 8)) return;
    const reach = vehicle ? s.def.r + 16 : 22;
    const a = Math.atan2(s.vy, s.vx), tx = Math.floor((s.x + Math.cos(a) * reach) / TILE), ty = Math.floor((s.y + Math.sin(a) * reach) / TILE);
    const q = this.activate(tx, ty);
    if (q) q.body.applyImpulse(v3(Math.cos(a) * q.body.mass * Math.min(9, speed / U), Math.sin(a) * q.body.mass * Math.min(9, speed / U), 0));
    if (vehicle && s.def.crush && speed > 25 && this.map.isDestructible(tx, ty) && this.map.charAt(tx, ty) !== 'M') {
      this.blast = { x: s.x, y: s.y, z: s.z + 12, power: speed * 3, radius: 70 };
      this.map.damageTile(tx, ty, speed * 8); this.blast = null;
    }
  }
  use(p) {
    if (p.heldBody) { this.release(p, false); return true; }
    let best = null, distance = 52;
    for (const q of this.bodies.values()) {
      if (!q.whole || q.ch === 'T' || q.held || q.body.mass > 200) continue;
      const bp = q.body.position, dx = bp.x * U - p.x, dy = bp.y * U - p.y;
      const d = Math.hypot(dx, dy, bp.z * U - p.eyeZ);
      if (d < distance && dx * Math.cos(p.angle) + dy * Math.sin(p.angle) > d * .65 && this.lineClear(p.x, p.y, p.eyeZ, bp.x * U, bp.y * U, bp.z * U, q.id)) { best = q; distance = d; }
    }
    if (!best) {
      const tx = Math.floor((p.x + Math.cos(p.angle) * 32) / TILE), ty = Math.floor((p.y + Math.sin(p.angle) * 32) / TILE);
      best = this.activate(tx, ty);
      if (best) { const bp = best.body.position; if (Math.hypot(bp.x * U - p.x, bp.y * U - p.y) > 52) best = null; }
    }
    if (!best) return false;
    p.heldBody = best.id; best.held = p.id; best.body.wakeUp(); return true;
  }
  release(p, toss) {
    const q = this.bodies.get(p.heldBody); p.heldBody = 0;
    if (!q) return;
    q.held = 0; q.thrower = p.id;
    if (toss) q.body.applyImpulse(v3(Math.cos(p.angle) * Math.cos(p.pitch) * q.body.mass * 8, Math.sin(p.angle) * Math.cos(p.pitch) * q.body.mass * 8, (Math.sin(p.pitch) * 8 + 2) * q.body.mass));
  }
  blastBodies(x, y, z, radius, power, owner = null) {
    for (const q of [...this.bodies.values()]) {
      if (!this.bodies.has(q.id)) continue;            // an earlier blast in this loop may already have destroyed it
      const b = q.body, bp = b.position, dx = bp.x * U - x, dy = bp.y * U - y, dz = bp.z * U - z, d = Math.hypot(dx, dy, dz) || 1;
      if (d > radius || !this.lineClear(x, y, z + 4, bp.x * U, bp.y * U, bp.z * U, q.id)) continue;
      const speed = Math.min(12, power / 80) * (1 - d / radius); b.wakeUp(); b.applyImpulse(v3(dx / d * speed * b.mass, dy / d * speed * b.mass, (dz / d * speed + 1) * b.mass));
      if (q.whole && !q.held) this.hit(q.id, power * (1 - d / radius), Math.atan2(dy, dx), 0, owner);
    }
  }
  // Local static collider cache grows only around bodies; distant decorative objects cost no solver work.
  ensureStatics() {
    const needed = new Set();
    for (const q of [...this.bodies.values(), ...[...this.grenadeBodies.values()].map((body) => ({ body }))]) {
      if (q.body.sleeping) continue;
      const qp = q.body.position, tx = Math.floor(qp.x * U / TILE), ty = Math.floor(qp.y * U / TILE);
      for (let y = ty - 3; y <= ty + 3; y++) for (let x = tx - 3; x <= tx + 3; x++) {
        if (!this.map.inBounds(x, y)) continue;
        const i = y * this.map.w + x; if (!this.map.solid[i]) continue;
        needed.add(i);
        if (this.statics.has(i)) continue;
        const ch = this.map.chars[i], h = this.map.top[i] / U;
        const horizontal = this.map.chars[i - 1] === ch || this.map.chars[i + 1] === ch;
        const hx = ch === 'T' ? .32 : ch === 'X' ? .75 : ch === 'o' ? .7 : ch === '=' ? horizontal ? 1 : .08 : 1;
        const hy = ch === 'T' ? .32 : ch === 'X' ? .75 : ch === 'o' ? .7 : ch === '=' ? horizontal ? .08 : 1 : 1;
        this.statics.set(i, this.world.fixed({ position: [(x + .5) * 2, (y + .5) * 2, this.map.tileBase(x, y) / U + h / 2], shapes: [{ box: [hx, hy, h / 2] }], group: 1, mask: 2 }));
      }
      for (const roof of this.map.buildings) {
        if (!roof.active || tx * TILE < roof.x0 - 100 || tx * TILE > roof.x1 + 100 || ty * TILE < roof.y0 - 100 || ty * TILE > roof.y1 + 100) continue;
        const key = 'roof:' + roof.id; needed.add(key); if (this.statics.has(key)) continue;
        const w = (roof.x1 - roof.x0) / U, h = (roof.y1 - roof.y0) / U, shapes = [{ box: [w / 2, h / 2, .12], offset: [0, 0, -.12] }];
        if (roof.rise > 4) for (const sign of [-1, 1]) {
          const slope = Math.atan(roof.slope), alongY = roof.axis === 'y', angle = slope * sign * (alongY ? -1 : 1) / 2;
          const rotation = alongY ? { x: Math.sin(angle), y: 0, z: 0, w: Math.cos(angle) } : { x: 0, y: Math.sin(angle), z: 0, w: Math.cos(angle) };
          shapes.push({ box: [alongY ? w / 2 : w / 4 / Math.cos(slope), alongY ? h / 4 / Math.cos(slope) : h / 2, .1], offset: [alongY ? 0 : sign * w / 4, alongY ? sign * h / 4 : 0, roof.rise / U / 2], rotation });
        }
        this.statics.set(key, this.world.fixed({ position: [(roof.x0 + roof.x1) / U / 2, (roof.y0 + roof.y1) / U / 2, roof.eave / U], shapes, group: 1, mask: 2 }));
      }
    }
    // Keep colliders beneath sleeping bodies so a new blast can wake a settled pile safely.
    if (this.statics.size > 1600) for (const [i, b] of this.statics) if (!needed.has(i)) { this.world.remove(b); this.statics.delete(i); }
  }
  step(dt) {
    for (let n = 0; n < 4 && this.collapses.length; n++) { const i = this.collapses.shift(); this.map.damageTile(i % this.map.w, Math.floor(i / this.map.w), 10000); }
    if (!this.bodies.size && !this.grenadeBodies.size) { this.map.dynamicBodies = []; return; }
    const used = new Set();
    const actor = (id, x, y, z, shape, angle = 0) => {
      used.add(id); let b = this.actors.get(id);
      if (!b) { b = this.world.kinematic({ position: [x / U, y / U, z / U], shape: shape(), group: 4, mask: 2 }); this.actors.set(id, b); }
      b.moveKinematic(x / U, y / U, z / U, angle);
      return b;
    };
    for (const p of this.game.players.values()) if (p.alive && !p.veh) actor('p' + p.id, p.x, p.y, p.z + 10, () => ({ ball: .62 })).userData = { player: p };
    for (const v of this.game.vehicles) if (!v.dead) { this.pushProps(v, true); actor('v' + v.id, v.x, v.y, v.z + v.def.size[2] / 2, () => ({ box: [v.def.size[0] / U / 2, v.def.size[1] / U / 2, v.def.size[2] / U / 2] }), v.a); }
    for (const [id, b] of this.actors) if (!used.has(id)) { this.world.remove(b); this.actors.delete(id); }
    for (const q of this.bodies.values()) {
      if (q.held) {
        const p = this.game.players.get(q.held);
        if (!p?.alive || p.veh) { if (p) p.heldBody = 0; q.held = 0; }
        else {
          const b = q.body, x = p.x + Math.cos(p.angle) * 38 - Math.sin(p.angle) * 8, y = p.y + Math.sin(p.angle) * 38 + Math.cos(p.angle) * 8, z = p.eyeZ - 14;
          if (!this.lineClear(p.x, p.y, p.eyeZ, x, y, z, q.id)) this.release(p, false);
          else { const bp = b.position; b.wakeUp(); b.setVelocity(Math.max(-12, Math.min(12, (x / U - bp.x) * 14)), Math.max(-12, Math.min(12, (y / U - bp.y) * 14)), Math.max(-12, Math.min(12, (z / U - bp.z) * 14))); b.dampAngular(.85); }
        }
      }
      const qp = q.body.position;
      if ((!q.whole && this.game.time - q.born > 90) || qp.z < -100 || !Number.isFinite(qp.x)) this.remove(q);
    }
    if (this.groundEdits.length) { this.world.refreshTerrain(this.groundEdits); this.groundEdits = []; }
    this.ensureStatics(); this.world.step(dt / 2); this.world.step(dt / 2);
    this.map.dynamicBodies = [...this.bodies.values()].filter((q) => q.ch !== 'G' && q.ch !== '=').map((q) => bodyBounds(this.tuple(q)));
  }
  tuple(q) {
    const b = q.body, p = b.position, r = b.quaternion, v = b.velocity;
    const n = (x) => Math.round(x * 100) / 100;
    return [q.id, q.ch, n(p.x * U), n(p.y * U), n(p.z * U), n(r.x), n(r.y), n(r.z), n(r.w), q.sx, q.sy, q.sz, n(v.x * U), n(v.y * U), n(v.z * U), q.whole ? 1 : 0];
  }
  snapshot(x, y) { return [...this.bodies.values()].filter((q) => { const p = q.body.position; return Math.hypot(p.x * U - x, p.y * U - y) < 1800; }).map((q) => this.tuple(q)); }
}
